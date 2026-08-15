//! Filesystem and process boundary for the dsh-norm-spec Rust bridge.
//!
//! The library resolves a sealed, release-derived norm-spec payload, verifies
//! its provenance and contents, and invokes the upstream machine protocols.

#![forbid(unsafe_code)]

mod process;
mod server;
mod upstream;

pub use server::serve;
pub use upstream::{
    PAYLOAD_LOCK_API, PAYLOAD_LOCK_FILE, PayloadIdentity, ResolvedPayload, UpstreamError,
    UpstreamRuntime, UpstreamVerification, seal_payload,
};
