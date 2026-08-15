//! Session-scoped JSONL bridge server.

use std::{
    collections::HashSet,
    io::{self, BufRead, Write},
    path::PathBuf,
    sync::mpsc::{self, Receiver, SyncSender},
    thread::{self, JoinHandle},
};

use dsh_norm_engine::{BRIDGE_API_VERSION, NormCompatibility, PromptContext};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;

use crate::{
    UpstreamError,
    process::CancellationToken,
    upstream::{UpstreamOperationError, UpstreamRuntime},
};

const MAX_FRAME_BYTES: usize = 1024 * 1024;
const MAX_REQUEST_ID_BYTES: usize = 128;
const MAX_TRACKED_REQUEST_IDS: usize = 65_536;
const CHANNEL_CAPACITY: usize = 64;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EventFrame<T> {
    #[serde(rename = "apiVersion")]
    api_version: &'static str,
    #[serde(rename = "type")]
    kind: &'static str,
    event: &'static str,
    #[serde(flatten)]
    details: T,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadyDetails<'a> {
    payload: &'a crate::PayloadIdentity,
    compatibility: &'a NormCompatibility,
}

#[derive(Serialize)]
struct ErrorDetails<'a> {
    error: &'a UpstreamError,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResponseFrame<'a> {
    #[serde(rename = "apiVersion")]
    api_version: &'static str,
    #[serde(rename = "type")]
    kind: &'static str,
    id: &'a str,
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'a UpstreamError>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RequestFrame {
    #[serde(rename = "apiVersion")]
    api_version: String,
    #[serde(rename = "type")]
    kind: String,
    id: String,
    method: String,
    #[serde(default)]
    params: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CollectParams {
    root: PathBuf,
    target: PathBuf,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PromptContextParams {
    root: PathBuf,
    target: PathBuf,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ValidateParams {
    root: PathBuf,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CancelParams {
    request_id: String,
}

struct ActiveRequest {
    id: String,
    cancellation: CancellationToken,
}

enum LoopControl {
    Continue,
    Stop,
}

struct SessionState<'a> {
    runtime: &'a UpstreamRuntime,
    output: &'a SyncSender<String>,
    events: &'a SyncSender<InputEvent>,
    active: Option<ActiveRequest>,
    seen_ids: HashSet<String>,
    shutdown_id: Option<String>,
}

enum InputEvent {
    Line(String),
    End,
    Failed(String),
    OperationFinished {
        id: String,
        result: Result<Value, UpstreamOperationError>,
    },
}

/// Run the session-scoped bridge over standard input and standard output.
///
/// The sealed payload and exact compatibility identity are verified before a
/// `ready` event is emitted. Each subsequent input and output frame occupies
/// exactly one JSON line.
///
/// # Errors
///
/// Returns a stable error after emitting `startupFailed` or `fatal` when the
/// bridge cannot initialize or its request stream becomes invalid.
pub fn serve(payload: PathBuf) -> Result<(), UpstreamError> {
    let runtime = match UpstreamRuntime::open(payload) {
        Ok(runtime) => runtime,
        Err(error) => {
            emit_direct_event("startupFailed", &error)?;
            return Err(error);
        }
    };
    let compatibility = match runtime.handshake() {
        Ok(compatibility) => compatibility,
        Err(error) => {
            emit_direct_event("startupFailed", &error)?;
            return Err(error);
        }
    };
    run_initialized(&runtime, &compatibility)
}

fn run_initialized(
    runtime: &UpstreamRuntime,
    compatibility: &NormCompatibility,
) -> Result<(), UpstreamError> {
    let (output_tx, output_rx) = mpsc::sync_channel(CHANNEL_CAPACITY);
    let writer = spawn_writer(output_rx);
    send_serialized(
        &output_tx,
        &EventFrame {
            api_version: BRIDGE_API_VERSION,
            kind: "event",
            event: "ready",
            details: ReadyDetails {
                payload: runtime.payload().identity(),
                compatibility,
            },
        },
    )?;

    let (event_tx, event_rx) = mpsc::sync_channel(CHANNEL_CAPACITY);
    spawn_input_reader(event_tx.clone());
    let result = event_loop(runtime, &output_tx, &event_tx, &event_rx);
    drop(output_tx);
    join_writer(writer)?;
    result
}

fn event_loop(
    runtime: &UpstreamRuntime,
    output: &SyncSender<String>,
    events: &SyncSender<InputEvent>,
    event_rx: &Receiver<InputEvent>,
) -> Result<(), UpstreamError> {
    let mut state = SessionState {
        runtime,
        output,
        events,
        active: None,
        seen_ids: HashSet::new(),
        shutdown_id: None,
    };

    loop {
        let event = event_rx.recv().map_err(|_| {
            bridge_error(
                "dsh-norm-spec/bridge/event-channel-closed",
                "the bridge event channel closed unexpectedly",
            )
        })?;
        let control = match event {
            InputEvent::Line(line) => state.handle_line(&line)?,
            InputEvent::OperationFinished { id, result } => state.handle_operation(&id, result)?,
            InputEvent::End => state.handle_end()?,
            InputEvent::Failed(message) => {
                let error = bridge_error("dsh-norm-spec/bridge/input-invalid", message);
                return fail(output, &error, state.active.as_ref());
            }
        };
        if matches!(control, LoopControl::Stop) {
            return Ok(());
        }
    }
}

impl SessionState<'_> {
    fn handle_line(&mut self, line: &str) -> Result<LoopControl, UpstreamError> {
        let request = match decode_request(line, &mut self.seen_ids) {
            Ok(request) => request,
            Err(error) => {
                return fail(self.output, &error, self.active.as_ref()).map(|()| LoopControl::Stop);
            }
        };
        if self.shutdown_id.is_some() {
            let error = bridge_error(
                "dsh-norm-spec/bridge/shutting-down",
                "the bridge is already shutting down",
            );
            send_error(self.output, &request.id, &error)?;
            return Ok(LoopControl::Continue);
        }
        match request.method.as_str() {
            "status" => self.handle_status(&request),
            "collect" => self.handle_collect(request),
            "promptContext" => self.handle_prompt_context(request),
            "validate" => self.handle_validate(request),
            "cancel" => self.handle_cancel(&request),
            "shutdown" => self.handle_shutdown(request),
            _ => {
                let error = bridge_error(
                    "dsh-norm-spec/bridge/method-unsupported",
                    format!("unsupported bridge method: {}", request.method),
                );
                send_error(self.output, &request.id, &error)?;
                Ok(LoopControl::Continue)
            }
        }
    }

    fn handle_status(&self, request: &RequestFrame) -> Result<LoopControl, UpstreamError> {
        if let Err(error) = require_no_params(request) {
            send_error(self.output, &request.id, &error)?;
            return Ok(LoopControl::Continue);
        }
        send_ok(
            self.output,
            &request.id,
            Some(serde_json::json!({
                "payload": self.runtime.payload().identity(),
            })),
        )?;
        Ok(LoopControl::Continue)
    }

    fn handle_collect(&mut self, request: RequestFrame) -> Result<LoopControl, UpstreamError> {
        if self.active.is_some() {
            send_busy(self.output, &request.id)?;
            return Ok(LoopControl::Continue);
        }
        let params: CollectParams = match request_params(&request) {
            Ok(params) => params,
            Err(error) => {
                send_error(self.output, &request.id, &error)?;
                return Ok(LoopControl::Continue);
            }
        };
        let cancellation = CancellationToken::default();
        spawn_collect(
            self.runtime.clone(),
            request.id.clone(),
            params,
            cancellation.clone(),
            self.events.clone(),
        );
        self.active = Some(ActiveRequest {
            id: request.id,
            cancellation,
        });
        Ok(LoopControl::Continue)
    }

    fn handle_prompt_context(
        &mut self,
        request: RequestFrame,
    ) -> Result<LoopControl, UpstreamError> {
        if self.active.is_some() {
            send_busy(self.output, &request.id)?;
            return Ok(LoopControl::Continue);
        }
        let params: PromptContextParams = match request_params(&request) {
            Ok(params) => params,
            Err(error) => {
                send_error(self.output, &request.id, &error)?;
                return Ok(LoopControl::Continue);
            }
        };
        let cancellation = CancellationToken::default();
        spawn_prompt_context(
            self.runtime.clone(),
            request.id.clone(),
            params,
            cancellation.clone(),
            self.events.clone(),
        );
        self.active = Some(ActiveRequest {
            id: request.id,
            cancellation,
        });
        Ok(LoopControl::Continue)
    }

    fn handle_validate(&mut self, request: RequestFrame) -> Result<LoopControl, UpstreamError> {
        if self.active.is_some() {
            send_busy(self.output, &request.id)?;
            return Ok(LoopControl::Continue);
        }
        let params: ValidateParams = match request_params(&request) {
            Ok(params) => params,
            Err(error) => {
                send_error(self.output, &request.id, &error)?;
                return Ok(LoopControl::Continue);
            }
        };
        let cancellation = CancellationToken::default();
        spawn_validate(
            self.runtime.clone(),
            request.id.clone(),
            params,
            cancellation.clone(),
            self.events.clone(),
        );
        self.active = Some(ActiveRequest {
            id: request.id,
            cancellation,
        });
        Ok(LoopControl::Continue)
    }

    fn handle_cancel(&self, request: &RequestFrame) -> Result<LoopControl, UpstreamError> {
        let params: CancelParams = match request_params(request) {
            Ok(params) => params,
            Err(error) => {
                send_error(self.output, &request.id, &error)?;
                return Ok(LoopControl::Continue);
            }
        };
        let Some(current) = self.active.as_ref() else {
            send_not_active(self.output, &request.id, &params.request_id)?;
            return Ok(LoopControl::Continue);
        };
        if current.id != params.request_id {
            send_not_active(self.output, &request.id, &params.request_id)?;
            return Ok(LoopControl::Continue);
        }
        let accepted = current.cancellation.cancel()?;
        send_ok(
            self.output,
            &request.id,
            Some(serde_json::json!({
                "requestId": params.request_id,
                "accepted": accepted,
            })),
        )?;
        Ok(LoopControl::Continue)
    }

    fn handle_shutdown(&mut self, request: RequestFrame) -> Result<LoopControl, UpstreamError> {
        if let Err(error) = require_no_params(&request) {
            send_error(self.output, &request.id, &error)?;
            return Ok(LoopControl::Continue);
        }
        if let Some(current) = self.active.as_ref() {
            current.cancellation.cancel()?;
            self.shutdown_id = Some(request.id);
            Ok(LoopControl::Continue)
        } else {
            send_ok(self.output, &request.id, None)?;
            Ok(LoopControl::Stop)
        }
    }

    fn handle_operation(
        &mut self,
        id: &str,
        result: Result<Value, UpstreamOperationError>,
    ) -> Result<LoopControl, UpstreamError> {
        let Some(current) = self.active.take() else {
            let error = bridge_error(
                "dsh-norm-spec/bridge/operation-orphaned",
                format!("operation completed without active request: {id}"),
            );
            return fail(self.output, &error, None).map(|()| LoopControl::Stop);
        };
        if current.id != id {
            let error = bridge_error(
                "dsh-norm-spec/bridge/operation-mismatch",
                format!("operation response ID {id} did not match {}", current.id),
            );
            return fail(self.output, &error, Some(&current)).map(|()| LoopControl::Stop);
        }
        match result {
            Ok(value) => send_ok(self.output, id, Some(value))?,
            Err(UpstreamOperationError::Cancelled) => send_cancelled(self.output, id)?,
            Err(UpstreamOperationError::Failed(error)) => send_error(self.output, id, &error)?,
        }
        if let Some(id) = self.shutdown_id.take() {
            send_ok(self.output, &id, None)?;
            Ok(LoopControl::Stop)
        } else {
            Ok(LoopControl::Continue)
        }
    }

    fn handle_end(&self) -> Result<LoopControl, UpstreamError> {
        if self.shutdown_id.is_some() {
            return Ok(LoopControl::Continue);
        }
        let error = bridge_error(
            "dsh-norm-spec/bridge/input-closed",
            "bridge input closed without an acknowledged shutdown",
        );
        fail(self.output, &error, self.active.as_ref()).map(|()| LoopControl::Stop)
    }
}

fn spawn_collect(
    runtime: UpstreamRuntime,
    id: String,
    params: CollectParams,
    cancellation: CancellationToken,
    events: SyncSender<InputEvent>,
) {
    thread::spawn(move || {
        let result = runtime
            .collect_initialized(&params.root, &params.target, &cancellation)
            .and_then(to_value);
        let _ = events.send(InputEvent::OperationFinished { id, result });
    });
}

fn spawn_prompt_context(
    runtime: UpstreamRuntime,
    id: String,
    params: PromptContextParams,
    cancellation: CancellationToken,
    events: SyncSender<InputEvent>,
) {
    thread::spawn(move || {
        let result = runtime
            .collect_initialized(&params.root, &params.target, &cancellation)
            .and_then(|collection| {
                PromptContext::from_collection(collection).map_err(|error| {
                    UpstreamOperationError::Failed(UpstreamError::external(
                        error.code(),
                        error.message(),
                    ))
                })
            })
            .and_then(to_value);
        let _ = events.send(InputEvent::OperationFinished { id, result });
    });
}

fn spawn_validate(
    runtime: UpstreamRuntime,
    id: String,
    params: ValidateParams,
    cancellation: CancellationToken,
    events: SyncSender<InputEvent>,
) {
    thread::spawn(move || {
        let result = runtime
            .validate_all_initialized(&params.root, &cancellation)
            .and_then(to_value);
        let _ = events.send(InputEvent::OperationFinished { id, result });
    });
}

fn to_value(value: impl Serialize) -> Result<Value, UpstreamOperationError> {
    serde_json::to_value(value).map_err(|error| {
        UpstreamOperationError::Failed(bridge_error(
            "dsh-norm-spec/bridge/serialization",
            format!("bridge result could not be serialized: {error}"),
        ))
    })
}

fn spawn_input_reader(events: SyncSender<InputEvent>) {
    thread::spawn(move || {
        let stdin = io::stdin();
        let mut input = stdin.lock();
        loop {
            match read_input_frame(&mut input) {
                Ok(None) => {
                    let _ = events.send(InputEvent::End);
                    return;
                }
                Ok(Some(line)) => {
                    if events.send(InputEvent::Line(line)).is_err() {
                        return;
                    }
                }
                Err(message) => {
                    let _ = events.send(InputEvent::Failed(message));
                    return;
                }
            }
        }
    });
}

fn read_input_frame(input: &mut impl BufRead) -> Result<Option<String>, String> {
    let mut frame = Vec::new();
    loop {
        let available = input
            .fill_buf()
            .map_err(|error| format!("bridge input could not be read: {error}"))?;
        if available.is_empty() {
            return if frame.is_empty() {
                Ok(None)
            } else {
                Err("bridge request was not newline terminated".to_owned())
            };
        }
        if let Some(newline) = available.iter().position(|byte| *byte == b'\n') {
            let consumed = newline + 1;
            if frame.len() + consumed > MAX_FRAME_BYTES {
                return Err(format!("bridge request exceeded {MAX_FRAME_BYTES} bytes"));
            }
            frame.extend_from_slice(&available[..newline]);
            input.consume(consumed);
            if frame.last() == Some(&b'\r') {
                frame.pop();
            }
            return String::from_utf8(frame)
                .map(Some)
                .map_err(|error| format!("bridge request is not valid UTF-8: {error}"));
        }
        let consumed = available.len();
        if frame.len() + consumed > MAX_FRAME_BYTES {
            return Err(format!("bridge request exceeded {MAX_FRAME_BYTES} bytes"));
        }
        frame.extend_from_slice(available);
        input.consume(consumed);
    }
}

fn spawn_writer(output: Receiver<String>) -> JoinHandle<Result<(), String>> {
    thread::spawn(move || {
        let stdout = io::stdout();
        let mut writer = io::BufWriter::new(stdout.lock());
        for line in output {
            writeln!(writer, "{line}").map_err(|error| error.to_string())?;
            writer.flush().map_err(|error| error.to_string())?;
        }
        Ok(())
    })
}

fn join_writer(writer: JoinHandle<Result<(), String>>) -> Result<(), UpstreamError> {
    writer
        .join()
        .map_err(|_| {
            bridge_error(
                "dsh-norm-spec/bridge/output-failed",
                "bridge output writer panicked",
            )
        })?
        .map_err(|error| {
            bridge_error(
                "dsh-norm-spec/bridge/output-failed",
                format!("bridge output could not be written: {error}"),
            )
        })
}

fn decode_request(
    line: &str,
    seen_ids: &mut HashSet<String>,
) -> Result<RequestFrame, UpstreamError> {
    let request: RequestFrame = serde_json::from_str(line).map_err(|error| {
        bridge_error(
            "dsh-norm-spec/bridge/frame-invalid",
            format!("bridge request is not valid JSON: {error}"),
        )
    })?;
    if request.api_version != BRIDGE_API_VERSION {
        return Err(bridge_error(
            "dsh-norm-spec/bridge/protocol-mismatch",
            format!("unexpected bridge API: {}", request.api_version),
        ));
    }
    if request.kind != "request" {
        return Err(bridge_error(
            "dsh-norm-spec/bridge/frame-invalid",
            format!("unexpected input frame type: {}", request.kind),
        ));
    }
    if request.id.is_empty() || request.id.len() > MAX_REQUEST_ID_BYTES {
        return Err(bridge_error(
            "dsh-norm-spec/bridge/request-id-invalid",
            "request ID must contain between 1 and 128 UTF-8 bytes",
        ));
    }
    if seen_ids.contains(&request.id) {
        return Err(bridge_error(
            "dsh-norm-spec/bridge/request-id-reused",
            format!("request ID was already used: {}", request.id),
        ));
    }
    if seen_ids.len() >= MAX_TRACKED_REQUEST_IDS {
        return Err(bridge_error(
            "dsh-norm-spec/bridge/request-limit",
            format!("bridge session exceeded {MAX_TRACKED_REQUEST_IDS} unique requests"),
        ));
    }
    seen_ids.insert(request.id.clone());
    Ok(request)
}

fn request_params<T: DeserializeOwned>(request: &RequestFrame) -> Result<T, UpstreamError> {
    serde_json::from_value(request.params.clone().unwrap_or(Value::Null)).map_err(|error| {
        bridge_error(
            "dsh-norm-spec/bridge/params-invalid",
            format!("invalid parameters for {}: {error}", request.method),
        )
    })
}

fn require_no_params(request: &RequestFrame) -> Result<(), UpstreamError> {
    match request.params.as_ref() {
        None | Some(Value::Null) => Ok(()),
        Some(Value::Object(fields)) if fields.is_empty() => Ok(()),
        Some(_) => Err(bridge_error(
            "dsh-norm-spec/bridge/params-invalid",
            format!("{} does not accept parameters", request.method),
        )),
    }
}

fn send_ok(
    output: &SyncSender<String>,
    id: &str,
    result: Option<Value>,
) -> Result<(), UpstreamError> {
    send_serialized(
        output,
        &ResponseFrame {
            api_version: BRIDGE_API_VERSION,
            kind: "response",
            id,
            status: "ok",
            result,
            error: None,
        },
    )
}

fn send_cancelled(output: &SyncSender<String>, id: &str) -> Result<(), UpstreamError> {
    send_serialized(
        output,
        &ResponseFrame {
            api_version: BRIDGE_API_VERSION,
            kind: "response",
            id,
            status: "cancelled",
            result: None,
            error: None,
        },
    )
}

fn send_error(
    output: &SyncSender<String>,
    id: &str,
    error: &UpstreamError,
) -> Result<(), UpstreamError> {
    send_serialized(
        output,
        &ResponseFrame {
            api_version: BRIDGE_API_VERSION,
            kind: "response",
            id,
            status: "error",
            result: None,
            error: Some(error),
        },
    )
}

fn send_busy(output: &SyncSender<String>, id: &str) -> Result<(), UpstreamError> {
    send_error(
        output,
        id,
        &bridge_error(
            "dsh-norm-spec/bridge/busy",
            "another upstream operation is already active",
        ),
    )
}

fn send_not_active(
    output: &SyncSender<String>,
    id: &str,
    request_id: &str,
) -> Result<(), UpstreamError> {
    send_error(
        output,
        id,
        &bridge_error(
            "dsh-norm-spec/bridge/request-not-active",
            format!("request is not active: {request_id}"),
        ),
    )
}

fn send_serialized(
    output: &SyncSender<String>,
    frame: &impl Serialize,
) -> Result<(), UpstreamError> {
    let line = serde_json::to_string(frame).map_err(|error| {
        bridge_error(
            "dsh-norm-spec/bridge/serialization",
            format!("bridge frame could not be serialized: {error}"),
        )
    })?;
    output.send(line).map_err(|_| {
        bridge_error(
            "dsh-norm-spec/bridge/output-closed",
            "bridge output channel closed unexpectedly",
        )
    })
}

fn fail(
    output: &SyncSender<String>,
    error: &UpstreamError,
    active: Option<&ActiveRequest>,
) -> Result<(), UpstreamError> {
    if let Some(active) = active {
        let _ = active.cancellation.cancel();
    }
    send_serialized(
        output,
        &EventFrame {
            api_version: BRIDGE_API_VERSION,
            kind: "event",
            event: "fatal",
            details: ErrorDetails { error },
        },
    )?;
    Err(error.clone())
}

fn emit_direct_event(event: &'static str, error: &UpstreamError) -> Result<(), UpstreamError> {
    let frame = EventFrame {
        api_version: BRIDGE_API_VERSION,
        kind: "event",
        event,
        details: ErrorDetails { error },
    };
    let json = serde_json::to_string(&frame).map_err(|serialization_error| {
        bridge_error(
            "dsh-norm-spec/bridge/serialization",
            format!("startup failure could not be serialized: {serialization_error}"),
        )
    })?;
    let stdout = io::stdout();
    let mut output = stdout.lock();
    writeln!(output, "{json}").map_err(|write_error| {
        bridge_error(
            "dsh-norm-spec/bridge/output-failed",
            format!("startup failure could not be written: {write_error}"),
        )
    })?;
    output.flush().map_err(|flush_error| {
        bridge_error(
            "dsh-norm-spec/bridge/output-failed",
            format!("startup failure could not be flushed: {flush_error}"),
        )
    })
}

fn bridge_error(code: &'static str, message: impl Into<String>) -> UpstreamError {
    UpstreamError::external(code, message)
}

#[cfg(test)]
mod tests {
    use std::{collections::HashSet, io::Cursor};

    use super::{
        BRIDGE_API_VERSION, CollectParams, MAX_FRAME_BYTES, PromptContextParams, decode_request,
        read_input_frame, request_params,
    };

    #[test]
    fn input_frames_are_bounded_and_newline_terminated() -> Result<(), Box<dyn std::error::Error>> {
        let mut input = Cursor::new(b"{\"id\":\"r1\"}\r\n".as_slice());
        assert_eq!(
            read_input_frame(&mut input)?,
            Some(r#"{"id":"r1"}"#.to_owned())
        );
        assert_eq!(read_input_frame(&mut input)?, None);

        let mut incomplete = Cursor::new(b"{}".as_slice());
        assert_eq!(
            read_input_frame(&mut incomplete),
            Err("bridge request was not newline terminated".to_owned())
        );

        let mut oversized = Cursor::new(vec![b'x'; MAX_FRAME_BYTES + 1]);
        let Err(error) = read_input_frame(&mut oversized) else {
            return Err("oversized input frame unexpectedly passed".into());
        };
        assert!(error.contains("exceeded"));
        Ok(())
    }

    #[test]
    fn request_ids_are_versioned_and_single_use() -> Result<(), Box<dyn std::error::Error>> {
        let mut seen = HashSet::new();
        let frame = format!(
            r#"{{"apiVersion":"{BRIDGE_API_VERSION}","type":"request","id":"r1","method":"status"}}"#
        );
        let request = decode_request(&frame, &mut seen)?;
        assert_eq!(request.id, "r1");
        let Err(error) = decode_request(&frame, &mut seen) else {
            return Err("duplicate request ID unexpectedly passed".into());
        };
        assert_eq!(error.code(), "dsh-norm-spec/bridge/request-id-reused");
        Ok(())
    }

    #[test]
    fn collect_params_reject_unknown_fields() -> Result<(), Box<dyn std::error::Error>> {
        let mut seen = HashSet::new();
        let frame = format!(
            r#"{{"apiVersion":"{BRIDGE_API_VERSION}","type":"request","id":"r2","method":"collect","params":{{"root":".","target":"README.md","extra":true}}}}"#
        );
        let request = decode_request(&frame, &mut seen)?;
        let Err(error) = request_params::<CollectParams>(&request) else {
            return Err("unknown collect parameter unexpectedly passed".into());
        };
        assert_eq!(error.code(), "dsh-norm-spec/bridge/params-invalid");
        Ok(())
    }

    #[test]
    fn prompt_context_params_require_root_and_target() -> Result<(), Box<dyn std::error::Error>> {
        let mut seen = HashSet::new();
        let frame = format!(
            r#"{{"apiVersion":"{BRIDGE_API_VERSION}","type":"request","id":"r-context","method":"promptContext","params":{{"root":"."}}}}"#
        );
        let request = decode_request(&frame, &mut seen)?;
        let Err(error) = request_params::<PromptContextParams>(&request) else {
            return Err("promptContext unexpectedly accepted a missing target".into());
        };
        assert_eq!(error.code(), "dsh-norm-spec/bridge/params-invalid");
        Ok(())
    }

    #[test]
    fn protocol_mismatch_is_fatal_before_dispatch() {
        let mut seen = HashSet::new();
        let frame = r#"{"apiVersion":"dsh-norm-spec/bridge/v2","type":"request","id":"r3","method":"status"}"#;
        let Err(error) = decode_request(frame, &mut seen) else {
            panic!("mismatched protocol unexpectedly passed");
        };
        assert_eq!(error.code(), "dsh-norm-spec/bridge/protocol-mismatch");
    }
}
