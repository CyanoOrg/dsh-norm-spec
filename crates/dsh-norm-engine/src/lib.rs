//! Framework-neutral models for the dsh-norm-spec adapter.
//!
//! This crate owns the typed view of normalized upstream responses and future
//! policy evaluation. It deliberately contains no YAML parser, filesystem
//! inheritance walker, schema validator, process exit, or hidden network I/O.

#![forbid(unsafe_code)]

mod norm_protocol;
mod prompt_context;
mod upstream_pin;

pub use norm_protocol::{
    NormCollectResponse, NormCollectedConvention, NormCompatibility, NormConformanceCandidate,
    NormConformanceFailure, NormConformanceIdentity, NormConformanceIssue, NormConformanceReport,
    NormConformanceSuite, NormConformanceSummary, NormDiagnostic, NormErrorDetail,
    NormErrorResponse, NormProductIdentity, NormRustApiIdentity, NormValidateResponse,
    NormValidationResult, NormValidationStatus, NormValidationSummary,
};
pub use prompt_context::{
    MAX_PROMPT_CONTEXT_BYTES, PROMPT_CONTEXT_API_VERSION, PromptContext, PromptContextError,
};
pub use upstream_pin::{
    NORM_COLLECT_API, NORM_COMPATIBILITY_API, NORM_CONFORMANCE_API, NORM_CONTRACT_BUNDLE_API,
    NORM_ERROR_API, NORM_FORMAT, NORM_PRODUCT_NAME, NORM_PRODUCT_VERSION, NORM_VALIDATE_API,
    RELEASE_ARTIFACT_API, UPSTREAM_CHECKSUM_FILE, UPSTREAM_PIN_API, UpstreamAssetPin, UpstreamPin,
    native_rust_target,
};

use serde::Serialize;

/// Machine API identifier for the Node/Rust bridge.
pub const BRIDGE_API_VERSION: &str = "dsh-norm-spec/bridge/v1";

/// Runtime identity returned during bridge negotiation.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeIdentity {
    /// Bridge protocol implemented by this runtime.
    pub bridge_api_version: &'static str,
    /// Exact norm-spec product version pinned for the first adapter payload.
    pub expected_norm_product_version: &'static str,
    /// Canonical norm-spec compatibility protocol required by this runtime.
    pub expected_norm_compatibility_api: &'static str,
    /// Canonical norm-spec collect protocol required by this runtime.
    pub expected_norm_collect_api: &'static str,
    /// Canonical norm-spec validate protocol required by this runtime.
    pub expected_norm_validate_api: &'static str,
    /// Ephemeral prompt-context protocol produced by this runtime.
    pub prompt_context_api_version: &'static str,
    /// Rust package version.
    pub package_version: &'static str,
}

/// Return the compile-time runtime identity.
#[must_use]
pub const fn runtime_identity() -> RuntimeIdentity {
    RuntimeIdentity {
        bridge_api_version: BRIDGE_API_VERSION,
        expected_norm_product_version: NORM_PRODUCT_VERSION,
        expected_norm_compatibility_api: NORM_COMPATIBILITY_API,
        expected_norm_collect_api: NORM_COLLECT_API,
        expected_norm_validate_api: NORM_VALIDATE_API,
        prompt_context_api_version: PROMPT_CONTEXT_API_VERSION,
        package_version: env!("CARGO_PKG_VERSION"),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        BRIDGE_API_VERSION, NORM_COLLECT_API, NORM_COMPATIBILITY_API, NORM_PRODUCT_VERSION,
        NORM_VALIDATE_API, PROMPT_CONTEXT_API_VERSION, UpstreamPin, runtime_identity,
    };

    #[test]
    fn identity_declares_bridge_and_upstream_protocols() {
        let identity = runtime_identity();
        assert_eq!(identity.bridge_api_version, BRIDGE_API_VERSION);
        assert_eq!(identity.expected_norm_product_version, NORM_PRODUCT_VERSION);
        assert_eq!(
            identity.expected_norm_compatibility_api,
            NORM_COMPATIBILITY_API
        );
        assert_eq!(identity.expected_norm_collect_api, NORM_COLLECT_API);
        assert_eq!(identity.expected_norm_validate_api, NORM_VALIDATE_API);
        assert_eq!(
            identity.prompt_context_api_version,
            PROMPT_CONTEXT_API_VERSION
        );
        assert_eq!(identity.package_version, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn embedded_pin_matches_compile_time_identity() {
        let pin = match UpstreamPin::embedded() {
            Ok(pin) => pin,
            Err(error) => panic!("embedded pin must be valid test data: {error}"),
        };
        assert_eq!(pin.compatibility.product.name, "norm-spec");
        assert_eq!(pin.compatibility.product.version, NORM_PRODUCT_VERSION);
        assert_eq!(pin.compatibility.api_version, NORM_COMPATIBILITY_API);
        assert!(
            pin.compatibility
                .machine_apis
                .iter()
                .any(|api| api == NORM_COLLECT_API)
        );
        assert!(
            pin.compatibility
                .machine_apis
                .iter()
                .any(|api| api == NORM_VALIDATE_API)
        );
        assert_eq!(pin.assets.len(), 4);
    }
}
