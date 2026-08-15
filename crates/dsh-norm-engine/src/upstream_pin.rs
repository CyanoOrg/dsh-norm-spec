//! Compile-time pin for the first supported norm-spec payload.

use serde::{Deserialize, Serialize};

use crate::NormCompatibility;

/// Upstream pin document protocol.
pub const UPSTREAM_PIN_API: &str = "dsh-norm-spec/upstream-pin/v1";
/// Upstream release-artifact manifest protocol.
pub const RELEASE_ARTIFACT_API: &str = "norm-spec/release-artifact/v1";
/// Filename used to retain the original release checksum line beside a payload.
pub const UPSTREAM_CHECKSUM_FILE: &str = "archive.sha256";
/// Expected upstream product name.
pub const NORM_PRODUCT_NAME: &str = "norm-spec";
/// Exact upstream product version selected for Gate B.
pub const NORM_PRODUCT_VERSION: &str = "0.1.0-rc.1";
/// Supported `.norm` format identifier.
pub const NORM_FORMAT: &str = "norm-spec/a1";
/// Required compatibility protocol.
pub const NORM_COMPATIBILITY_API: &str = "norm-spec/compatibility/v1";
/// Required collect protocol.
pub const NORM_COLLECT_API: &str = "norm-spec/collect/v1";
/// Required validate protocol.
pub const NORM_VALIDATE_API: &str = "norm-spec/validate/v1";
/// Required shared error protocol.
pub const NORM_ERROR_API: &str = "norm-spec/error/v1";
/// Required contract-bundle protocol.
pub const NORM_CONTRACT_BUNDLE_API: &str = "norm-spec/contract-bundle/v1";
/// Required conformance-report protocol.
pub const NORM_CONFORMANCE_API: &str = "norm-spec/conformance/v1";

const EMBEDDED_PIN: &str = include_str!("../assets/norm-spec-v0.1.0-rc.1.json");

/// One exact native archive selected from the upstream release.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UpstreamAssetPin {
    /// Rust compilation target carried by the archive.
    pub target: String,
    /// Exact GitHub Release asset name.
    pub name: String,
    /// Lowercase SHA-256 of the archive bytes.
    pub sha256: String,
    /// Canonical public download URL.
    pub url: String,
}

/// Immutable upstream release and protocol selection compiled into the bridge.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpstreamPin {
    /// Upstream pin document protocol.
    #[serde(rename = "apiVersion")]
    pub api_version: String,
    /// Canonical upstream repository URL.
    pub repository: String,
    /// Exact immutable release tag.
    pub tag: String,
    /// Exact release source revision.
    pub source_revision: String,
    /// Exact compatibility response expected from every selected asset.
    pub compatibility: NormCompatibility,
    /// Native release archives supported by the first payload line.
    pub assets: Vec<UpstreamAssetPin>,
}

impl UpstreamPin {
    /// Parse the release pin embedded in this crate.
    ///
    /// # Errors
    ///
    /// Returns a JSON error if the repository-owned asset is malformed.
    pub fn embedded() -> Result<Self, serde_json::Error> {
        serde_json::from_str(EMBEDDED_PIN)
    }

    /// Find the exact archive pin for a Rust target.
    #[must_use]
    pub fn asset_for_target(&self, target: &str) -> Option<&UpstreamAssetPin> {
        self.assets.iter().find(|asset| asset.target == target)
    }
}

/// Return the native Rust target supported by the current compiled bridge.
#[must_use]
pub const fn native_rust_target() -> Option<&'static str> {
    if cfg!(all(
        target_os = "linux",
        target_arch = "x86_64",
        target_env = "gnu"
    )) {
        Some("x86_64-unknown-linux-gnu")
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Some("aarch64-apple-darwin")
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Some("x86_64-apple-darwin")
    } else if cfg!(all(
        target_os = "windows",
        target_arch = "x86_64",
        target_env = "msvc"
    )) {
        Some("x86_64-pc-windows-msvc")
    } else {
        None
    }
}
