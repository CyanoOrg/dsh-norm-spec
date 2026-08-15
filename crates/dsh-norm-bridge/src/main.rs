//! One-shot diagnostics for the dsh-norm bridge and its pinned upstream runtime.

use std::{collections::BTreeMap, env, ffi::OsString, path::PathBuf, process::ExitCode};

use dsh_norm_bridge::{UpstreamError, UpstreamRuntime, seal_payload, serve};
use dsh_norm_engine::{BRIDGE_API_VERSION, UpstreamPin, runtime_identity};
use serde::Serialize;
use serde_json::Value;

const EXIT_OPERATION: u8 = 1;
const EXIT_USAGE: u8 = 2;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SuccessEnvelope {
    #[serde(rename = "apiVersion")]
    api_version: &'static str,
    operation: &'static str,
    status: &'static str,
    result: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorEnvelope<'a> {
    #[serde(rename = "apiVersion")]
    api_version: &'static str,
    operation: &'a str,
    status: &'static str,
    error: &'a UpstreamError,
}

fn main() -> ExitCode {
    let mut arguments = env::args_os().skip(1);
    let Some(command) = arguments.next() else {
        return emit_error("usage", &usage_error("a command is required"), EXIT_USAGE);
    };
    let Some(command) = command.to_str() else {
        return emit_error(
            "usage",
            &usage_error("command name is not valid UTF-8"),
            EXIT_USAGE,
        );
    };

    match command {
        "--version" | "-V" => {
            println!("dsh-norm-bridge {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        "identity" => emit_value("identity", runtime_identity()),
        "upstream-pin" => run_upstream_pin(arguments),
        "upstream-seal" => run_upstream_seal(arguments),
        "upstream-verify" => run_upstream_verify(arguments),
        "upstream-collect" => run_upstream_collect(arguments),
        "upstream-validate" => run_upstream_validate(arguments),
        "serve" => run_serve(arguments),
        _ => emit_error(
            "usage",
            &usage_error(format!("unsupported command: {command}")),
            EXIT_USAGE,
        ),
    }
}

fn run_serve(arguments: impl Iterator<Item = OsString>) -> ExitCode {
    let payload = match required_payload(arguments, "serve") {
        Ok(payload) => payload,
        Err(exit) => return exit,
    };
    match serve(payload) {
        Ok(()) => ExitCode::SUCCESS,
        Err(_) => ExitCode::from(EXIT_OPERATION),
    }
}

fn run_upstream_pin(arguments: impl Iterator<Item = OsString>) -> ExitCode {
    let options = match Options::parse(arguments) {
        Ok(options) => options,
        Err(error) => return emit_error("upstream.pin", &error, EXIT_USAGE),
    };
    let target = match options.exact_string("--target") {
        Ok(target) => target,
        Err(error) => return emit_error("upstream.pin", &error, EXIT_USAGE),
    };
    let pin = match UpstreamPin::embedded() {
        Ok(pin) => pin,
        Err(error) => {
            return emit_error(
                "upstream.pin",
                &UpstreamError::external(
                    "dsh-norm-spec/payload/pin-invalid",
                    format!("compiled upstream pin is invalid: {error}"),
                ),
                EXIT_OPERATION,
            );
        }
    };
    let Some(asset) = pin.asset_for_target(&target) else {
        return emit_error(
            "upstream.pin",
            &UpstreamError::external(
                "dsh-norm-spec/payload/unsupported-platform",
                format!("the upstream pin has no asset for {target}"),
            ),
            EXIT_OPERATION,
        );
    };
    emit_value("upstream.pin", asset)
}

fn run_upstream_seal(arguments: impl Iterator<Item = OsString>) -> ExitCode {
    let payload = match required_payload(arguments, "upstream.seal") {
        Ok(payload) => payload,
        Err(exit) => return exit,
    };
    match seal_payload(payload) {
        Ok(identity) => emit_value("upstream.seal", identity),
        Err(error) => emit_error("upstream.seal", &error, EXIT_OPERATION),
    }
}

fn run_upstream_verify(arguments: impl Iterator<Item = OsString>) -> ExitCode {
    let payload = match required_payload(arguments, "upstream.verify") {
        Ok(payload) => payload,
        Err(exit) => return exit,
    };
    let runtime = match UpstreamRuntime::open(payload) {
        Ok(runtime) => runtime,
        Err(error) => return emit_error("upstream.verify", &error, EXIT_OPERATION),
    };
    match runtime.verify() {
        Ok(verification) => emit_value("upstream.verify", verification),
        Err(error) => emit_error("upstream.verify", &error, EXIT_OPERATION),
    }
}

fn run_upstream_collect(arguments: impl Iterator<Item = OsString>) -> ExitCode {
    let mut options = match Options::parse(arguments) {
        Ok(options) => options,
        Err(error) => return emit_error("upstream.collect", &error, EXIT_USAGE),
    };
    let payload = match options.take_path("--payload") {
        Ok(path) => path,
        Err(error) => return emit_error("upstream.collect", &error, EXIT_USAGE),
    };
    let root = match options.take_path("--root") {
        Ok(path) => path,
        Err(error) => return emit_error("upstream.collect", &error, EXIT_USAGE),
    };
    let target = match options.take_path("--target") {
        Ok(path) => path,
        Err(error) => return emit_error("upstream.collect", &error, EXIT_USAGE),
    };
    if let Err(error) = options.finish() {
        return emit_error("upstream.collect", &error, EXIT_USAGE);
    }
    let runtime = match UpstreamRuntime::open(payload) {
        Ok(runtime) => runtime,
        Err(error) => return emit_error("upstream.collect", &error, EXIT_OPERATION),
    };
    match runtime.collect(root, target) {
        Ok(response) => emit_value("upstream.collect", response),
        Err(error) => emit_error("upstream.collect", &error, EXIT_OPERATION),
    }
}

fn run_upstream_validate(arguments: impl Iterator<Item = OsString>) -> ExitCode {
    let mut options = match Options::parse(arguments) {
        Ok(options) => options,
        Err(error) => return emit_error("upstream.validate", &error, EXIT_USAGE),
    };
    let payload = match options.take_path("--payload") {
        Ok(path) => path,
        Err(error) => return emit_error("upstream.validate", &error, EXIT_USAGE),
    };
    let root = match options.take_path("--root") {
        Ok(path) => path,
        Err(error) => return emit_error("upstream.validate", &error, EXIT_USAGE),
    };
    if let Err(error) = options.finish() {
        return emit_error("upstream.validate", &error, EXIT_USAGE);
    }
    let runtime = match UpstreamRuntime::open(payload) {
        Ok(runtime) => runtime,
        Err(error) => return emit_error("upstream.validate", &error, EXIT_OPERATION),
    };
    match runtime.validate_all(root) {
        Ok(response) => emit_value("upstream.validate", response),
        Err(error) => emit_error("upstream.validate", &error, EXIT_OPERATION),
    }
}

fn required_payload(
    arguments: impl Iterator<Item = OsString>,
    operation: &str,
) -> Result<PathBuf, ExitCode> {
    let mut options =
        Options::parse(arguments).map_err(|error| emit_error(operation, &error, EXIT_USAGE))?;
    let payload = options
        .take_path("--payload")
        .map_err(|error| emit_error(operation, &error, EXIT_USAGE))?;
    options
        .finish()
        .map_err(|error| emit_error(operation, &error, EXIT_USAGE))?;
    Ok(payload)
}

fn emit_value(operation: &'static str, value: impl Serialize) -> ExitCode {
    let result = match serde_json::to_value(value) {
        Ok(result) => result,
        Err(error) => {
            eprintln!("dsh-norm-bridge serialization failure: {error}");
            return ExitCode::from(EXIT_OPERATION);
        }
    };
    let response = SuccessEnvelope {
        api_version: BRIDGE_API_VERSION,
        operation,
        status: "ok",
        result,
    };
    emit_json(&response, ExitCode::SUCCESS)
}

fn emit_error(operation: &str, error: &UpstreamError, exit_code: u8) -> ExitCode {
    emit_json(
        &ErrorEnvelope {
            api_version: BRIDGE_API_VERSION,
            operation,
            status: "error",
            error,
        },
        ExitCode::from(exit_code),
    )
}

fn emit_json(value: &impl Serialize, exit_code: ExitCode) -> ExitCode {
    match serde_json::to_string(value) {
        Ok(json) => {
            println!("{json}");
            exit_code
        }
        Err(error) => {
            eprintln!("dsh-norm-bridge serialization failure: {error}");
            ExitCode::from(EXIT_OPERATION)
        }
    }
}

fn usage_error(message: impl Into<String>) -> UpstreamError {
    UpstreamError::external("dsh-norm-spec/usage", message)
}

struct Options {
    values: BTreeMap<String, OsString>,
}

impl Options {
    fn parse(mut arguments: impl Iterator<Item = OsString>) -> Result<Self, UpstreamError> {
        let mut values = BTreeMap::new();
        while let Some(flag) = arguments.next() {
            let Some(flag) = flag.to_str() else {
                return Err(usage_error("option name is not valid UTF-8"));
            };
            if !flag.starts_with("--") {
                return Err(usage_error(format!(
                    "unexpected positional argument: {flag}"
                )));
            }
            let Some(value) = arguments.next() else {
                return Err(usage_error(format!("option requires a value: {flag}")));
            };
            if values.insert(flag.to_owned(), value).is_some() {
                return Err(usage_error(format!("option was provided twice: {flag}")));
            }
        }
        Ok(Self { values })
    }

    fn take_path(&mut self, name: &str) -> Result<PathBuf, UpstreamError> {
        let value = self
            .values
            .remove(name)
            .ok_or_else(|| usage_error(format!("missing required option: {name}")))?;
        Ok(PathBuf::from(value))
    }

    fn exact_string(mut self, name: &str) -> Result<String, UpstreamError> {
        let value = self
            .values
            .remove(name)
            .ok_or_else(|| usage_error(format!("missing required option: {name}")))?;
        if let Some(unknown) = self.values.keys().next() {
            return Err(usage_error(format!("unsupported option: {unknown}")));
        }
        value
            .into_string()
            .map_err(|_| usage_error(format!("option value is not valid UTF-8: {name}")))
    }

    fn finish(&self) -> Result<(), UpstreamError> {
        if let Some(unknown) = self.values.keys().next() {
            return Err(usage_error(format!("unsupported option: {unknown}")));
        }
        Ok(())
    }
}
