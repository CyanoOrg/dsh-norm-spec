//! Cancellable child-process execution for bridge operations.

use std::{
    io::{self, Read},
    process::{Child, Command, ExitStatus, Output, Stdio},
    sync::{
        Arc, Mutex, MutexGuard,
        atomic::{AtomicBool, Ordering},
    },
    thread::{self, JoinHandle},
    time::Duration,
};

use crate::upstream::UpstreamError;

const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(2);

/// Terminal result of a cancellable child process.
pub(crate) enum ProcessOutcome {
    /// The process exited and produced a complete output.
    Completed(Output),
    /// Cancellation was requested before the process completed.
    Cancelled,
}

#[derive(Debug, Default)]
struct CancellationState {
    cancelled: AtomicBool,
    child: Mutex<Option<Child>>,
}

/// A request-scoped process cancellation handle.
#[derive(Clone, Debug, Default)]
pub(crate) struct CancellationToken {
    state: Arc<CancellationState>,
}

impl CancellationToken {
    /// Request cancellation and terminate the current child when one exists.
    pub(crate) fn cancel(&self) -> Result<bool, UpstreamError> {
        let first_request = !self.state.cancelled.swap(true, Ordering::SeqCst);
        let mut child = self.child()?;
        if let Some(child) = child.as_mut()
            && let Err(error) = child.kill()
            && error.kind() != io::ErrorKind::InvalidInput
        {
            return Err(process_error(
                "cancel",
                format!("could not terminate the active process: {error}"),
            ));
        }
        Ok(first_request)
    }

    fn is_cancelled(&self) -> bool {
        self.state.cancelled.load(Ordering::SeqCst)
    }

    fn child(&self) -> Result<MutexGuard<'_, Option<Child>>, UpstreamError> {
        self.state.child.lock().map_err(|_| {
            process_error(
                "state",
                "the bridge process cancellation state was poisoned",
            )
        })
    }
}

/// Run one command while making its child available to a cancellation request.
pub(crate) fn run_cancellable(
    command: &mut Command,
    operation: &str,
    token: &CancellationToken,
) -> Result<ProcessOutcome, UpstreamError> {
    if token.is_cancelled() {
        return Ok(ProcessOutcome::Cancelled);
    }

    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            process_error(
                operation,
                format!("norm-spec process is unavailable: {error}"),
            )
        })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| process_error(operation, "norm-spec stdout pipe was not available"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| process_error(operation, "norm-spec stderr pipe was not available"))?;

    {
        let mut active = token.child()?;
        *active = Some(child);
        if token.is_cancelled()
            && let Some(child) = active.as_mut()
            && let Err(error) = child.kill()
            && error.kind() != io::ErrorKind::InvalidInput
        {
            return Err(process_error(
                operation,
                format!("could not terminate the cancelled process: {error}"),
            ));
        }
    }

    let stdout_reader = read_stream(stdout);
    let stderr_reader = read_stream(stderr);
    let status = wait_for_exit(operation, token)?;
    let stdout = join_stream(operation, "stdout", stdout_reader)?;
    let stderr = join_stream(operation, "stderr", stderr_reader)?;

    if token.is_cancelled() {
        return Ok(ProcessOutcome::Cancelled);
    }

    Ok(ProcessOutcome::Completed(Output {
        status,
        stdout,
        stderr,
    }))
}

fn wait_for_exit(operation: &str, token: &CancellationToken) -> Result<ExitStatus, UpstreamError> {
    loop {
        let status = {
            let mut active = token.child()?;
            let child = active.as_mut().ok_or_else(|| {
                process_error(operation, "the active process was lost before completion")
            })?;
            child.try_wait().map_err(|error| {
                process_error(
                    operation,
                    format!("could not observe norm-spec process completion: {error}"),
                )
            })?
        };
        if let Some(status) = status {
            let mut active = token.child()?;
            *active = None;
            return Ok(status);
        }
        thread::sleep(PROCESS_POLL_INTERVAL);
    }
}

fn read_stream(mut stream: impl Read + Send + 'static) -> JoinHandle<io::Result<Vec<u8>>> {
    thread::spawn(move || {
        let mut bytes = Vec::new();
        stream.read_to_end(&mut bytes)?;
        Ok(bytes)
    })
}

fn join_stream(
    operation: &str,
    stream: &str,
    reader: JoinHandle<io::Result<Vec<u8>>>,
) -> Result<Vec<u8>, UpstreamError> {
    reader
        .join()
        .map_err(|_| process_error(operation, format!("{stream} reader thread panicked")))?
        .map_err(|error| {
            process_error(
                operation,
                format!("could not read norm-spec {stream}: {error}"),
            )
        })
}

fn process_error(operation: &str, message: impl Into<String>) -> UpstreamError {
    UpstreamError::external(
        "dsh-norm-spec/upstream/unavailable",
        format!("{operation}: {}", message.into()),
    )
}

#[cfg(test)]
mod tests {
    use std::{env, process::Command, thread, time::Duration};

    use super::{CancellationToken, ProcessOutcome, run_cancellable};

    #[test]
    fn cancellation_terminates_the_target_process() -> Result<(), Box<dyn std::error::Error>> {
        let mut command = Command::new(env::current_exe()?);
        command
            .args([
                "--exact",
                "process::tests::cancellation_helper",
                "--nocapture",
            ])
            .env("PI_NORM_SPEC_CANCELLATION_HELPER", "1");
        let token = CancellationToken::default();
        let worker_token = token.clone();
        let worker = thread::spawn(move || run_cancellable(&mut command, "test", &worker_token));

        thread::sleep(Duration::from_millis(50));
        assert!(token.cancel()?);
        assert!(!token.cancel()?);
        let outcome = worker.join().map_err(|_| "process worker panicked")??;
        assert!(matches!(outcome, ProcessOutcome::Cancelled));
        Ok(())
    }

    #[test]
    fn cancellation_helper() {
        if env::var_os("PI_NORM_SPEC_CANCELLATION_HELPER").is_some() {
            thread::sleep(Duration::from_secs(10));
        }
    }
}
