//! Typed consumer models for norm-spec machine responses.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Exact norm-spec product identity.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NormProductIdentity {
    /// Stable product name.
    pub name: String,
    /// Exact product version.
    pub version: String,
}

/// Exact norm-spec Rust facade identity.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NormRustApiIdentity {
    /// Versioned Rust API identifier.
    pub id: String,
    /// Cargo package that provides the facade.
    pub package: String,
    /// Exact facade version.
    pub version: String,
}

/// Frozen norm-spec conformance identity.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormConformanceIdentity {
    /// Contract-bundle protocol.
    pub bundle_api: String,
    /// Conformance-report protocol.
    pub report_api: String,
    /// Frozen suite identifier.
    pub suite: String,
    /// Declared case count.
    pub case_count: usize,
    /// Digest of the exact contract bundle.
    pub contract_digest: String,
}

/// Machine-readable norm-spec compatibility response.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormCompatibility {
    /// Compatibility response protocol.
    #[serde(rename = "apiVersion")]
    pub api_version: String,
    /// Exact product identity.
    pub product: NormProductIdentity,
    /// Supported format identifiers.
    pub formats: Vec<String>,
    /// Public Rust facade identity.
    pub rust_api: NormRustApiIdentity,
    /// Supported machine APIs.
    pub machine_apis: Vec<String>,
    /// Frozen conformance identity.
    pub conformance: NormConformanceIdentity,
}

/// One collected convention returned by norm-spec.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NormCollectedConvention {
    /// Root-relative portable path.
    pub path: String,
    /// Parsed YAML frontmatter represented as JSON data.
    pub frontmatter: Value,
    /// Trimmed Markdown body.
    pub body: String,
}

/// Successful norm-spec collection response.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormCollectResponse {
    /// Collect response protocol.
    #[serde(rename = "apiVersion")]
    pub api_version: String,
    /// Root marker used by upstream portable paths.
    pub root: String,
    /// Requested target path.
    pub target: String,
    /// Conventions ordered from most-specific to least-specific.
    pub norms: Vec<NormCollectedConvention>,
}

/// Stable norm-spec validation diagnostic.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NormDiagnostic {
    /// Stable machine code.
    pub code: String,
    /// Human-readable message.
    pub message: String,
    /// Affected frontmatter field when present.
    pub field: Option<String>,
    /// Actionable suggestion when present.
    pub suggestion: Option<String>,
}

/// Highest diagnostic severity for one convention.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NormValidationStatus {
    /// No findings.
    Ok,
    /// Warnings without errors.
    Warning,
    /// One or more errors.
    Error,
}

/// Validation result for one convention file.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NormValidationResult {
    /// Root-relative portable path.
    pub path: String,
    /// Highest severity.
    pub status: NormValidationStatus,
    /// Hard validation failures.
    pub errors: Vec<NormDiagnostic>,
    /// Non-fatal findings.
    pub warnings: Vec<NormDiagnostic>,
}

/// Aggregate validation counts.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NormValidationSummary {
    /// Files evaluated.
    pub files: usize,
    /// Error diagnostics.
    pub errors: usize,
    /// Warning diagnostics.
    pub warnings: usize,
}

/// Completed norm-spec validation response.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormValidateResponse {
    /// Validate response protocol.
    #[serde(rename = "apiVersion")]
    pub api_version: String,
    /// Root marker used by upstream portable paths.
    pub root: String,
    /// Deterministically ordered file results.
    pub results: Vec<NormValidationResult>,
    /// Aggregate counts.
    pub summary: NormValidationSummary,
}

/// One traversed directory summarized by a norm-spec scan.
///
/// The `norm-spec/scan/v1` wire format spells multi-word fields in
/// `snake_case` (D014), so this mirror carries no camelCase rename.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NormScannedDirectory {
    /// Path relative to the scan root.
    pub path: String,
    /// Number of path components below the scan root.
    pub depth: usize,
    /// Number of visible regular files, excluding `.norm` and other dotfiles.
    pub file_count: usize,
    /// Whether the directory contains a regular `.norm` file.
    pub has_norm: bool,
}

/// Kind of symbolic link observed without traversal.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NormScanSymlinkKind {
    /// Link target is a directory.
    Directory,
    /// Link target is a regular file.
    File,
    /// Link target is unavailable or another filesystem object.
    Other,
}

/// Action taken for an observed symbolic link.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum NormScanSymlinkAction {
    /// The scanner reported the link without following it.
    NotFollowed,
}

/// Portable symbolic-link observation in a norm-spec scan response.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NormScanSymlink {
    /// Path relative to the scan root.
    pub path: String,
    /// Observed target kind.
    pub kind: NormScanSymlinkKind,
    /// Explicit no-follow action.
    pub action: NormScanSymlinkAction,
}

/// Naming-style counts collected from directories and visible files.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NormScanNaming {
    /// Counts for non-root directories, including untraversed directory links.
    pub directories: BTreeMap<String, usize>,
    /// Counts for visible regular filenames.
    pub files: BTreeMap<String, usize>,
}

/// Filename found in two or more traversed directories.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NormScanRecurringFilename {
    /// Exact filename including its extension.
    pub name: String,
    /// Number of distinct directories containing the filename.
    pub dir_count: usize,
}

/// Aggregate `.norm` coverage across traversed directories.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NormScanCoverage {
    /// Total traversed directories, including the root.
    pub total_dirs: usize,
    /// Traversed directories containing a regular `.norm` file.
    pub dirs_with_norm: usize,
    /// Coverage ratio rounded to three decimal places.
    pub ratio: f64,
}

/// Completed norm-spec structural-scan response.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NormScanResponse {
    /// Scan response protocol.
    #[serde(rename = "apiVersion")]
    pub api_version: String,
    /// Root marker for every portable path in the response.
    pub root: String,
    /// Number of traversed directories.
    pub directory_count: usize,
    /// Traversed directories ordered by portable path.
    pub directories: Vec<NormScannedDirectory>,
    /// Untraversed symbolic links ordered by portable path.
    pub symlinks: Vec<NormScanSymlink>,
    /// Deterministic naming-style counts.
    pub naming: NormScanNaming,
    /// Recurring filenames ordered by count descending and name ascending.
    pub recurring_filenames: Vec<NormScanRecurringFilename>,
    /// Aggregate convention-file coverage.
    pub norm_coverage: NormScanCoverage,
}

/// Stable detail carried by a norm-spec error response.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NormErrorDetail {
    /// Stable machine code.
    pub code: String,
    /// Human-readable message.
    pub message: String,
    /// Associated portable path when present.
    pub path: Option<String>,
    /// Associated command field when present.
    pub field: Option<String>,
}

/// Machine-readable norm-spec command failure.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormErrorResponse {
    /// Shared error response protocol.
    #[serde(rename = "apiVersion")]
    pub api_version: String,
    /// Upstream command that failed.
    pub command: String,
    /// Stable error detail.
    pub error: NormErrorDetail,
}

/// Suite identity in a norm-spec conformance report.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormConformanceSuite {
    /// Suite identifier.
    pub id: String,
    /// Declared case count.
    pub case_count: usize,
    /// Exact contract digest.
    pub contract_digest: String,
}

/// Candidate identity in a conformance report.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NormConformanceCandidate {
    /// Candidate product name when discovery succeeded.
    pub name: Option<String>,
    /// Candidate product version when discovery succeeded.
    pub version: Option<String>,
    /// Compatibility classification.
    pub compatibility: String,
}

/// Aggregate conformance execution counts.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormConformanceSummary {
    /// Declared cases.
    pub declared: usize,
    /// Executed cases.
    pub executed: usize,
    /// Passing cases.
    pub passed: usize,
    /// Failing cases.
    pub failed: usize,
    /// Cases that did not execute.
    pub not_executed: usize,
}

/// Stable conformance issue.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NormConformanceIssue {
    /// Stable issue code.
    pub code: String,
    /// Human-readable detail.
    pub message: String,
}

/// One failed conformance case.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormConformanceFailure {
    /// Stable case identifier.
    pub case_id: String,
    /// Checks that failed.
    pub checks: Vec<String>,
}

/// Complete norm-spec arbitrary-candidate conformance report.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormConformanceReport {
    /// Conformance report protocol.
    #[serde(rename = "apiVersion")]
    pub api_version: String,
    /// Frozen suite identity.
    pub suite: NormConformanceSuite,
    /// Candidate identity.
    pub candidate: NormConformanceCandidate,
    /// Overall report status.
    pub status: String,
    /// Whether every declared case executed.
    pub complete: bool,
    /// Aggregate execution counts.
    pub summary: NormConformanceSummary,
    /// Preflight or execution issues.
    pub issues: Vec<NormConformanceIssue>,
    /// Failed case details.
    pub failures: Vec<NormConformanceFailure>,
}

#[cfg(test)]
mod tests {
    use super::NormScanResponse;

    #[test]
    fn scan_response_parses_the_snake_case_wire_format() {
        let raw = r#"{
            "apiVersion": "norm-spec/scan/v1",
            "root": ".",
            "directory_count": 2,
            "directories": [
                {"path": ".", "depth": 0, "file_count": 1, "has_norm": true},
                {"path": "docs", "depth": 1, "file_count": 0, "has_norm": false}
            ],
            "symlinks": [
                {"path": "link", "kind": "directory", "action": "not-followed"}
            ],
            "naming": {"directories": {"kebab-case": 1}, "files": {"README.md": 1}},
            "recurring_filenames": [{"name": "main.rs", "dir_count": 2}],
            "norm_coverage": {"total_dirs": 2, "dirs_with_norm": 1, "ratio": 0.5}
        }"#;
        let response: NormScanResponse = serde_json::from_str(raw)
            .unwrap_or_else(|error| panic!("scan response should parse: {error}"));
        assert_eq!(response.api_version, "norm-spec/scan/v1");
        assert_eq!(response.root, ".");
        assert_eq!(response.directory_count, 2);
        assert!(response.directories[0].has_norm);
        assert_eq!(
            response.symlinks[0].kind,
            super::NormScanSymlinkKind::Directory
        );
        assert_eq!(
            response.symlinks[0].action,
            super::NormScanSymlinkAction::NotFollowed
        );
        assert_eq!(response.norm_coverage.dirs_with_norm, 1);
    }

    #[test]
    fn scan_response_rejects_camel_case_drift() {
        let raw = r#"{
            "apiVersion": "norm-spec/scan/v1",
            "root": ".",
            "directoryCount": 1,
            "directories": [],
            "symlinks": [],
            "naming": {"directories": {}, "files": {}},
            "recurringFilenames": [],
            "norm_coverage": {"totalDirs": 0, "dirs_with_norm": 0, "ratio": 0.0}
        }"#;
        assert!(serde_json::from_str::<NormScanResponse>(raw).is_err());
    }
}
