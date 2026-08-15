//! Verified norm-spec payload resolution and invocation.

use std::{
    collections::BTreeSet,
    fmt, fs,
    path::{Component, Path, PathBuf},
    process::{Command, Output},
};

use dsh_norm_engine::{
    NORM_COLLECT_API, NORM_CONFORMANCE_API, NORM_CONTRACT_BUNDLE_API, NORM_ERROR_API,
    NORM_VALIDATE_API, NormCollectResponse, NormCompatibility, NormConformanceReport,
    NormErrorResponse, NormValidateResponse, RELEASE_ARTIFACT_API, UPSTREAM_CHECKSUM_FILE,
    UPSTREAM_PIN_API, UpstreamAssetPin, UpstreamPin, native_rust_target,
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha2::{Digest, Sha256};

use crate::process::{CancellationToken, ProcessOutcome, run_cancellable};

/// Sealed payload lock protocol.
pub const PAYLOAD_LOCK_API: &str = "dsh-norm-spec/upstream-payload/v1";
/// Repository-owned filename for a sealed payload lock.
pub const PAYLOAD_LOCK_FILE: &str = "dsh-norm-spec-payload.lock.json";

const MAX_MACHINE_OUTPUT_BYTES: usize = 16 * 1024 * 1024;
const MANIFEST_FILE: &str = "release-manifest.json";
const CONTRACT_LOCK_FILE: &str = "contract/bundle.lock.json";

/// Stable payload or upstream process failure.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpstreamError {
    code: &'static str,
    message: String,
    path: Option<String>,
}

impl UpstreamError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            path: None,
        }
    }

    /// Construct a stable error at an external command boundary.
    #[must_use]
    pub fn external(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(code, message)
    }

    fn with_path(mut self, path: &Path) -> Self {
        self.path = Some(path.to_string_lossy().into_owned());
        self
    }

    /// Stable machine-readable error code.
    #[must_use]
    pub const fn code(&self) -> &'static str {
        self.code
    }

    /// Human-readable diagnostic.
    #[must_use]
    pub fn message(&self) -> &str {
        &self.message
    }

    /// Relevant local path when available.
    #[must_use]
    pub fn path(&self) -> Option<&str> {
        self.path.as_deref()
    }
}

impl fmt::Display for UpstreamError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for UpstreamError {}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct ReleaseProduct {
    name: String,
    version: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct ReleaseExecutables {
    norm: String,
    conformance: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReleaseContract {
    path: String,
    bundle_api: String,
    report_api: String,
    suite: String,
    case_count: usize,
    contract_digest: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct ReleaseSkill {
    path: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReleaseManifest {
    #[serde(rename = "apiVersion")]
    api_version: String,
    product: ReleaseProduct,
    target: String,
    source_revision: String,
    executables: ReleaseExecutables,
    compatibility_api: String,
    contract: ReleaseContract,
    skill: ReleaseSkill,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct ContractFile {
    path: String,
    sha256: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ContractLock {
    #[serde(rename = "apiVersion")]
    api_version: String,
    suite: String,
    case_count: usize,
    contract_digest: String,
    files: Vec<ContractFile>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct PayloadFileLock {
    path: String,
    sha256: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PayloadLock {
    #[serde(rename = "apiVersion")]
    api_version: String,
    repository: String,
    tag: String,
    source_revision: String,
    asset: UpstreamAssetPin,
    files: Vec<PayloadFileLock>,
}

/// Exact identity of one resolved upstream payload.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PayloadIdentity {
    /// Exact upstream repository.
    pub repository: String,
    /// Exact release tag.
    pub tag: String,
    /// Exact release source revision.
    pub source_revision: String,
    /// Native Rust target.
    pub target: String,
    /// Exact release archive name.
    pub asset_name: String,
    /// Exact release archive SHA-256.
    pub asset_sha256: String,
    /// Exact contract-bundle digest.
    pub contract_digest: String,
}

/// A sealed and content-verified norm-spec payload.
#[derive(Clone, Debug)]
pub struct ResolvedPayload {
    root: PathBuf,
    norm: PathBuf,
    conformance: PathBuf,
    contract: PathBuf,
    identity: PayloadIdentity,
}

impl ResolvedPayload {
    /// Resolve and verify a sealed payload for the current native target.
    ///
    /// # Errors
    ///
    /// Returns a stable error for missing, unsafe, altered, or incompatible
    /// payload contents.
    pub fn open(root: impl AsRef<Path>) -> Result<Self, UpstreamError> {
        let root = root.as_ref();
        reject_symlink(root)?;
        let root = fs::canonicalize(root).map_err(|error| {
            UpstreamError::new(
                "dsh-norm-spec/payload/unavailable",
                format!("payload root is unavailable: {error}"),
            )
            .with_path(root)
        })?;
        if !root.is_dir() {
            return Err(UpstreamError::new(
                "dsh-norm-spec/payload/not-directory",
                "payload root is not a directory",
            )
            .with_path(&root));
        }

        let pin = embedded_pin()?;
        let target = native_rust_target().ok_or_else(|| {
            UpstreamError::new(
                "dsh-norm-spec/payload/unsupported-platform",
                "the current bridge target has no pinned norm-spec payload",
            )
        })?;
        let asset = pin.asset_for_target(target).ok_or_else(|| {
            UpstreamError::new(
                "dsh-norm-spec/payload/unsupported-platform",
                format!("the upstream pin has no asset for {target}"),
            )
        })?;
        let payload_lock: PayloadLock = read_json(&root.join(PAYLOAD_LOCK_FILE))?;
        validate_payload_lock(&payload_lock, &pin, asset)?;
        validate_locked_inventory(&root, &payload_lock)?;
        let manifest = validate_release_layout(&root, &pin, asset, true)?;

        Ok(Self {
            norm: root.join(&manifest.executables.norm),
            conformance: root.join(&manifest.executables.conformance),
            contract: root.join(&manifest.contract.path),
            identity: payload_identity(&pin, asset, &manifest),
            root,
        })
    }

    /// Canonical payload root.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Verified upstream `norm` executable.
    #[must_use]
    pub fn norm_executable(&self) -> &Path {
        &self.norm
    }

    /// Verified upstream conformance executable.
    #[must_use]
    pub fn conformance_executable(&self) -> &Path {
        &self.conformance
    }

    /// Verified exact contract directory.
    #[must_use]
    pub fn contract_dir(&self) -> &Path {
        &self.contract
    }

    /// Exact payload identity.
    #[must_use]
    pub const fn identity(&self) -> &PayloadIdentity {
        &self.identity
    }
}

/// Seal a freshly extracted upstream release after its original checksum was
/// verified and copied beside the payload.
///
/// # Errors
///
/// Returns a stable error if the directory is not the exact pinned release
/// layout, contains unsafe entries, or already contains a payload lock.
pub fn seal_payload(root: impl AsRef<Path>) -> Result<PayloadIdentity, UpstreamError> {
    let root = root.as_ref();
    reject_symlink(root)?;
    let root = fs::canonicalize(root).map_err(|error| {
        UpstreamError::new(
            "dsh-norm-spec/payload/unavailable",
            format!("payload root is unavailable: {error}"),
        )
        .with_path(root)
    })?;
    let lock_path = root.join(PAYLOAD_LOCK_FILE);
    if lock_path.exists() {
        return Err(UpstreamError::new(
            "dsh-norm-spec/payload/already-sealed",
            "payload lock already exists",
        )
        .with_path(&lock_path));
    }

    let pin = embedded_pin()?;
    let manifest: ReleaseManifest = read_json(&root.join(MANIFEST_FILE))?;
    let asset = pin.asset_for_target(&manifest.target).ok_or_else(|| {
        UpstreamError::new(
            "dsh-norm-spec/payload/unsupported-platform",
            format!("the upstream pin has no asset for {}", manifest.target),
        )
    })?;
    let manifest = validate_release_layout(&root, &pin, asset, false)?;
    let files = collect_inventory(&root)?
        .into_iter()
        .map(|path| {
            let absolute = root.join(&path);
            sha256_file(&absolute).map(|sha256| PayloadFileLock { path, sha256 })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let lock = PayloadLock {
        api_version: PAYLOAD_LOCK_API.to_owned(),
        repository: pin.repository.clone(),
        tag: pin.tag.clone(),
        source_revision: pin.source_revision.clone(),
        asset: asset.clone(),
        files,
    };
    let serialized = serde_json::to_vec_pretty(&lock).map_err(|error| {
        UpstreamError::new(
            "dsh-norm-spec/payload/lock-invalid",
            format!("payload lock could not be serialized: {error}"),
        )
    })?;
    fs::write(&lock_path, serialized).map_err(|error| {
        UpstreamError::new(
            "dsh-norm-spec/payload/lock-write",
            format!("payload lock could not be written: {error}"),
        )
        .with_path(&lock_path)
    })?;

    Ok(payload_identity(&pin, asset, &manifest))
}

/// Successful full upstream payload verification.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpstreamVerification {
    /// Sealed release and contract identity.
    pub payload: PayloadIdentity,
    /// Runtime compatibility discovery returned by `norm`.
    pub compatibility: NormCompatibility,
    /// Complete 82-case conformance report.
    pub conformance: NormConformanceReport,
}

/// Process client for one verified upstream payload.
#[derive(Clone, Debug)]
pub struct UpstreamRuntime {
    payload: ResolvedPayload,
}

/// Request-scoped outcome from an initialized upstream runtime.
pub(crate) enum UpstreamOperationError {
    /// Cancellation was requested for this request.
    Cancelled,
    /// The operation failed at the verified upstream boundary.
    Failed(UpstreamError),
}

impl From<UpstreamError> for UpstreamOperationError {
    fn from(error: UpstreamError) -> Self {
        Self::Failed(error)
    }
}

impl UpstreamRuntime {
    /// Open a sealed payload without invoking it.
    ///
    /// # Errors
    ///
    /// Returns a stable payload verification error.
    pub fn open(root: impl AsRef<Path>) -> Result<Self, UpstreamError> {
        ResolvedPayload::open(root).map(|payload| Self { payload })
    }

    /// Return the verified payload.
    #[must_use]
    pub const fn payload(&self) -> &ResolvedPayload {
        &self.payload
    }

    /// Execute and validate exact compatibility discovery.
    ///
    /// # Errors
    ///
    /// Returns a stable error if the process fails, emits invalid JSON, writes
    /// unexpected stderr, or reports any identity other than the compiled pin.
    pub fn handshake(&self) -> Result<NormCompatibility, UpstreamError> {
        let output = run_command(
            self.payload.norm_executable(),
            &["compatibility"],
            self.payload.root(),
            "compatibility",
        )?;
        require_success(&output, "compatibility")?;
        let response: NormCompatibility = parse_stdout(&output, "compatibility")?;
        let pin = embedded_pin()?;
        validate_compatibility(&response, &pin)?;
        Ok(response)
    }

    /// Run the exact locked upstream conformance suite.
    ///
    /// # Errors
    ///
    /// Returns a stable error unless all 82 cases execute and pass with the
    /// pinned protocol and digest.
    pub fn conformance(&self) -> Result<NormConformanceReport, UpstreamError> {
        let candidate = self.payload.norm_executable().as_os_str();
        let contract = self.payload.contract_dir().as_os_str();
        let output = Command::new(self.payload.conformance_executable())
            .args([
                "--candidate".as_ref(),
                candidate,
                "--contract-dir".as_ref(),
                contract,
            ])
            .current_dir(self.payload.root())
            .output()
            .map_err(|error| process_unavailable("conformance", &error))?;
        require_bounded_output(&output, "conformance")?;
        let report: NormConformanceReport = parse_stdout(&output, "conformance")?;
        let pin = embedded_pin()?;
        let expected = &pin.compatibility.conformance;
        let complete = report.api_version == NORM_CONFORMANCE_API
            && report.suite.id == expected.suite
            && report.suite.case_count == expected.case_count
            && report.suite.contract_digest == expected.contract_digest
            && report.candidate.name.as_deref() == Some(pin.compatibility.product.name.as_str())
            && report.candidate.version.as_deref()
                == Some(pin.compatibility.product.version.as_str())
            && report.candidate.compatibility == "compatible"
            && report.status == "pass"
            && report.complete
            && report.summary.declared == expected.case_count
            && report.summary.executed == expected.case_count
            && report.summary.passed == expected.case_count
            && report.summary.failed == 0
            && report.summary.not_executed == 0
            && report.issues.is_empty()
            && report.failures.is_empty();
        if !output.status.success() || !output.stderr.is_empty() || !complete {
            return Err(UpstreamError::new(
                "dsh-norm-spec/upstream/conformance-failed",
                "the pinned upstream payload did not produce a complete passing conformance report",
            ));
        }
        Ok(report)
    }

    /// Run compatibility discovery and the complete conformance suite.
    ///
    /// # Errors
    ///
    /// Returns the first payload, compatibility, or conformance failure.
    pub fn verify(&self) -> Result<UpstreamVerification, UpstreamError> {
        let compatibility = self.handshake()?;
        let conformance = self.conformance()?;
        Ok(UpstreamVerification {
            payload: self.payload.identity().clone(),
            compatibility,
            conformance,
        })
    }

    /// Collect conventions for one target through the pinned upstream engine.
    ///
    /// # Errors
    ///
    /// Returns a stable error for an incompatible runtime, invalid project
    /// root, upstream command failure, or non-collect response.
    pub fn collect(
        &self,
        project_root: impl AsRef<Path>,
        target: impl AsRef<Path>,
    ) -> Result<NormCollectResponse, UpstreamError> {
        self.handshake()?;
        match self.collect_initialized(
            project_root.as_ref(),
            target.as_ref(),
            &CancellationToken::default(),
        ) {
            Ok(response) => Ok(response),
            Err(UpstreamOperationError::Failed(error)) => Err(error),
            Err(UpstreamOperationError::Cancelled) => Err(UpstreamError::new(
                "dsh-norm-spec/upstream/cancelled",
                "norm-spec collect was cancelled",
            )),
        }
    }

    /// Strictly validate every convention through the pinned upstream engine.
    ///
    /// Exit code `1` remains a completed validation result with findings.
    ///
    /// # Errors
    ///
    /// Returns a stable error for an incompatible runtime, invalid project
    /// root, usage/process failure, or non-validate response.
    pub fn validate_all(
        &self,
        project_root: impl AsRef<Path>,
    ) -> Result<NormValidateResponse, UpstreamError> {
        self.handshake()?;
        match self.validate_all_initialized(project_root.as_ref(), &CancellationToken::default()) {
            Ok(response) => Ok(response),
            Err(UpstreamOperationError::Failed(error)) => Err(error),
            Err(UpstreamOperationError::Cancelled) => Err(UpstreamError::new(
                "dsh-norm-spec/upstream/cancelled",
                "norm-spec validation was cancelled",
            )),
        }
    }

    pub(crate) fn collect_initialized(
        &self,
        project_root: &Path,
        target: &Path,
        cancellation: &CancellationToken,
    ) -> Result<NormCollectResponse, UpstreamOperationError> {
        let root = canonical_project_root(project_root)?;
        let mut command = Command::new(self.payload.norm_executable());
        command
            .args(["collect", "--root", ".", "--target"])
            .arg(target)
            .current_dir(&root);
        let output = match run_cancellable(&mut command, "collect", cancellation)? {
            ProcessOutcome::Completed(output) => output,
            ProcessOutcome::Cancelled => return Err(UpstreamOperationError::Cancelled),
        };
        require_bounded_output(&output, "collect")?;
        if !output.status.success() {
            return Err(upstream_command_error("collect", &output).into());
        }
        require_empty_stderr(&output, "collect")?;
        let response: NormCollectResponse = parse_stdout(&output, "collect")?;
        if response.api_version != NORM_COLLECT_API {
            return Err(protocol_mismatch("collect", &response.api_version).into());
        }
        Ok(response)
    }

    pub(crate) fn validate_all_initialized(
        &self,
        project_root: &Path,
        cancellation: &CancellationToken,
    ) -> Result<NormValidateResponse, UpstreamOperationError> {
        let root = canonical_project_root(project_root)?;
        let mut command = Command::new(self.payload.norm_executable());
        command
            .args(["validate", "--all", "--root", ".", "--strict", "--json"])
            .current_dir(&root);
        let output = match run_cancellable(&mut command, "validate", cancellation)? {
            ProcessOutcome::Completed(output) => output,
            ProcessOutcome::Cancelled => return Err(UpstreamOperationError::Cancelled),
        };
        require_bounded_output(&output, "validate")?;
        if !matches!(output.status.code(), Some(0 | 1)) {
            return Err(upstream_command_error("validate", &output).into());
        }
        require_empty_stderr(&output, "validate")?;
        let response: NormValidateResponse = parse_stdout(&output, "validate")?;
        if response.api_version != NORM_VALIDATE_API {
            return Err(protocol_mismatch("validate", &response.api_version).into());
        }
        Ok(response)
    }
}

fn embedded_pin() -> Result<UpstreamPin, UpstreamError> {
    let pin = UpstreamPin::embedded().map_err(|error| {
        UpstreamError::new(
            "dsh-norm-spec/payload/pin-invalid",
            format!("compiled upstream pin is invalid: {error}"),
        )
    })?;
    if pin.api_version != UPSTREAM_PIN_API {
        return Err(UpstreamError::new(
            "dsh-norm-spec/payload/pin-invalid",
            format!("unexpected upstream pin API: {}", pin.api_version),
        ));
    }
    Ok(pin)
}

fn validate_compatibility(
    response: &NormCompatibility,
    pin: &UpstreamPin,
) -> Result<(), UpstreamError> {
    if response != &pin.compatibility {
        return Err(UpstreamError::new(
            "dsh-norm-spec/upstream/incompatible",
            "norm compatibility does not match the exact compiled upstream pin",
        ));
    }
    Ok(())
}

fn validate_payload_lock(
    lock: &PayloadLock,
    pin: &UpstreamPin,
    asset: &UpstreamAssetPin,
) -> Result<(), UpstreamError> {
    if lock.api_version != PAYLOAD_LOCK_API
        || lock.repository != pin.repository
        || lock.tag != pin.tag
        || lock.source_revision != pin.source_revision
        || &lock.asset != asset
        || lock.files.is_empty()
    {
        return Err(UpstreamError::new(
            "dsh-norm-spec/payload/lock-mismatch",
            "payload lock does not match the exact compiled release pin",
        ));
    }
    let mut paths = BTreeSet::new();
    for file in &lock.files {
        safe_relative(&file.path)?;
        if !is_sha256(&file.sha256) || !paths.insert(file.path.as_str()) {
            return Err(UpstreamError::new(
                "dsh-norm-spec/payload/lock-invalid",
                "payload lock contains an invalid digest or duplicate path",
            ));
        }
    }
    Ok(())
}

fn validate_locked_inventory(root: &Path, lock: &PayloadLock) -> Result<(), UpstreamError> {
    let actual = collect_inventory(root)?;
    let mut expected: BTreeSet<String> = lock.files.iter().map(|file| file.path.clone()).collect();
    expected.insert(PAYLOAD_LOCK_FILE.to_owned());
    if actual != expected {
        return Err(UpstreamError::new(
            "dsh-norm-spec/payload/inventory-mismatch",
            "payload inventory differs from the sealed file list",
        )
        .with_path(root));
    }
    for file in &lock.files {
        let path = root.join(&file.path);
        let actual_sha = sha256_file(&path)?;
        if actual_sha != file.sha256 {
            return Err(UpstreamError::new(
                "dsh-norm-spec/payload/content-mismatch",
                format!("payload file digest changed: {}", file.path),
            )
            .with_path(&path));
        }
    }
    Ok(())
}

fn validate_release_layout(
    root: &Path,
    pin: &UpstreamPin,
    asset: &UpstreamAssetPin,
    sealed: bool,
) -> Result<ReleaseManifest, UpstreamError> {
    let manifest: ReleaseManifest = read_json(&root.join(MANIFEST_FILE))?;
    let expected_norm = if manifest.target == "x86_64-pc-windows-msvc" {
        "bin/norm.exe"
    } else {
        "bin/norm"
    };
    let expected_conformance = if manifest.target == "x86_64-pc-windows-msvc" {
        "bin/norm-spec-conformance.exe"
    } else {
        "bin/norm-spec-conformance"
    };
    let expected = &pin.compatibility.conformance;
    if manifest.api_version != RELEASE_ARTIFACT_API
        || manifest.product
            != (ReleaseProduct {
                name: pin.compatibility.product.name.clone(),
                version: pin.compatibility.product.version.clone(),
            })
        || manifest.target != asset.target
        || manifest.source_revision != pin.source_revision
        || manifest.executables.norm != expected_norm
        || manifest.executables.conformance != expected_conformance
        || manifest.compatibility_api != pin.compatibility.api_version
        || manifest.contract.path != "contract"
        || manifest.contract.bundle_api != expected.bundle_api
        || manifest.contract.report_api != expected.report_api
        || manifest.contract.suite != expected.suite
        || manifest.contract.case_count != expected.case_count
        || manifest.contract.contract_digest != expected.contract_digest
        || manifest.skill.path != "skills/norm-spec"
    {
        return Err(UpstreamError::new(
            "dsh-norm-spec/payload/manifest-mismatch",
            "release manifest does not match the exact compiled upstream pin",
        )
        .with_path(&root.join(MANIFEST_FILE)));
    }

    let contract_lock: ContractLock = read_json(&root.join(CONTRACT_LOCK_FILE))?;
    validate_contract(root, &contract_lock, expected)?;
    validate_checksum(root, asset)?;
    let expected_inventory = release_inventory(&contract_lock, expected_norm, expected_conformance);
    let mut actual_inventory = collect_inventory(root)?;
    if sealed {
        actual_inventory.remove(PAYLOAD_LOCK_FILE);
    }
    if actual_inventory != expected_inventory {
        return Err(UpstreamError::new(
            "dsh-norm-spec/payload/release-inventory-mismatch",
            "extracted release inventory differs from the pinned artifact contract",
        )
        .with_path(root));
    }
    Ok(manifest)
}

fn validate_contract(
    root: &Path,
    lock: &ContractLock,
    expected: &dsh_norm_engine::NormConformanceIdentity,
) -> Result<(), UpstreamError> {
    if lock.api_version != NORM_CONTRACT_BUNDLE_API
        || lock.api_version != expected.bundle_api
        || lock.suite != expected.suite
        || lock.case_count != expected.case_count
        || lock.contract_digest != expected.contract_digest
        || lock.files.is_empty()
    {
        return Err(UpstreamError::new(
            "dsh-norm-spec/payload/contract-mismatch",
            "contract lock identity differs from the pinned conformance suite",
        )
        .with_path(&root.join(CONTRACT_LOCK_FILE)));
    }
    let mut seen = BTreeSet::new();
    for file in &lock.files {
        safe_relative(&file.path)?;
        if !is_sha256(&file.sha256) || !seen.insert(file.path.as_str()) {
            return Err(UpstreamError::new(
                "dsh-norm-spec/payload/contract-invalid",
                "contract lock contains an invalid digest or duplicate path",
            ));
        }
        let path = root.join("contract").join(&file.path);
        let actual = sha256_file(&path)?;
        if actual != file.sha256 {
            return Err(UpstreamError::new(
                "dsh-norm-spec/payload/contract-content-mismatch",
                format!("contract file digest changed: {}", file.path),
            )
            .with_path(&path));
        }
    }
    Ok(())
}

fn validate_checksum(root: &Path, asset: &UpstreamAssetPin) -> Result<(), UpstreamError> {
    let path = root.join(UPSTREAM_CHECKSUM_FILE);
    let checksum = fs::read_to_string(&path).map_err(|error| {
        UpstreamError::new(
            "dsh-norm-spec/payload/checksum-unavailable",
            format!("original release checksum is unavailable: {error}"),
        )
        .with_path(&path)
    })?;
    let mut fields = checksum.split_whitespace();
    let digest = fields.next();
    let name = fields.next();
    if digest != Some(asset.sha256.as_str())
        || name != Some(asset.name.as_str())
        || fields.next().is_some()
    {
        return Err(UpstreamError::new(
            "dsh-norm-spec/payload/checksum-mismatch",
            "retained checksum line differs from the compiled asset pin",
        )
        .with_path(&path));
    }
    Ok(())
}

fn release_inventory(lock: &ContractLock, norm: &str, conformance: &str) -> BTreeSet<String> {
    let mut inventory = BTreeSet::from([
        "LICENSE".to_owned(),
        "README.md".to_owned(),
        "README.zh-CN.md".to_owned(),
        norm.to_owned(),
        conformance.to_owned(),
        CONTRACT_LOCK_FILE.to_owned(),
        MANIFEST_FILE.to_owned(),
        "skills/norm-spec/SKILL.md".to_owned(),
        "skills/norm-spec/references/authoring.md".to_owned(),
        "skills/norm-spec/references/field-reference.md".to_owned(),
        UPSTREAM_CHECKSUM_FILE.to_owned(),
    ]);
    inventory.extend(
        lock.files
            .iter()
            .map(|file| format!("contract/{}", file.path)),
    );
    inventory
}

fn payload_identity(
    pin: &UpstreamPin,
    asset: &UpstreamAssetPin,
    manifest: &ReleaseManifest,
) -> PayloadIdentity {
    PayloadIdentity {
        repository: pin.repository.clone(),
        tag: pin.tag.clone(),
        source_revision: pin.source_revision.clone(),
        target: asset.target.clone(),
        asset_name: asset.name.clone(),
        asset_sha256: asset.sha256.clone(),
        contract_digest: manifest.contract.contract_digest.clone(),
    }
}

fn canonical_project_root(path: &Path) -> Result<PathBuf, UpstreamError> {
    let root = fs::canonicalize(path).map_err(|error| {
        UpstreamError::new(
            "dsh-norm-spec/project/root-unavailable",
            format!("project root is unavailable: {error}"),
        )
        .with_path(path)
    })?;
    if !root.is_dir() {
        return Err(UpstreamError::new(
            "dsh-norm-spec/project/root-not-directory",
            "project root is not a directory",
        )
        .with_path(&root));
    }
    Ok(root)
}

fn run_command(
    program: &Path,
    arguments: &[&str],
    current_dir: &Path,
    operation: &str,
) -> Result<Output, UpstreamError> {
    let output = Command::new(program)
        .args(arguments)
        .current_dir(current_dir)
        .output()
        .map_err(|error| process_unavailable(operation, &error))?;
    require_bounded_output(&output, operation)?;
    Ok(output)
}

fn process_unavailable(operation: &str, error: &std::io::Error) -> UpstreamError {
    UpstreamError::new(
        "dsh-norm-spec/upstream/unavailable",
        format!("norm-spec {operation} process is unavailable: {error}"),
    )
}

fn require_bounded_output(output: &Output, operation: &str) -> Result<(), UpstreamError> {
    if output.stdout.len() > MAX_MACHINE_OUTPUT_BYTES
        || output.stderr.len() > MAX_MACHINE_OUTPUT_BYTES
    {
        return Err(UpstreamError::new(
            "dsh-norm-spec/upstream/output-too-large",
            format!("norm-spec {operation} exceeded the machine-output limit"),
        ));
    }
    Ok(())
}

fn require_success(output: &Output, operation: &str) -> Result<(), UpstreamError> {
    if !output.status.success() {
        return Err(upstream_command_error(operation, output));
    }
    require_empty_stderr(output, operation)
}

fn require_empty_stderr(output: &Output, operation: &str) -> Result<(), UpstreamError> {
    if !output.stderr.is_empty() {
        return Err(UpstreamError::new(
            "dsh-norm-spec/upstream/unexpected-stderr",
            format!("norm-spec {operation} wrote unexpected stderr"),
        ));
    }
    Ok(())
}

fn parse_stdout<T: DeserializeOwned>(output: &Output, operation: &str) -> Result<T, UpstreamError> {
    serde_json::from_slice(&output.stdout).map_err(|error| {
        UpstreamError::new(
            "dsh-norm-spec/upstream/response-invalid",
            format!("norm-spec {operation} returned invalid machine JSON: {error}"),
        )
    })
}

fn upstream_command_error(operation: &str, output: &Output) -> UpstreamError {
    match serde_json::from_slice::<NormErrorResponse>(&output.stdout) {
        Ok(response) if response.api_version == NORM_ERROR_API => UpstreamError::new(
            "dsh-norm-spec/upstream/command-failed",
            format!(
                "norm-spec {operation} failed with {}: {}",
                response.error.code, response.error.message
            ),
        ),
        Ok(_) | Err(_) => UpstreamError::new(
            "dsh-norm-spec/upstream/command-failed",
            format!("norm-spec {operation} failed without a valid error envelope"),
        ),
    }
}

fn protocol_mismatch(operation: &str, actual: &str) -> UpstreamError {
    UpstreamError::new(
        "dsh-norm-spec/upstream/protocol-mismatch",
        format!("norm-spec {operation} returned unexpected API {actual}"),
    )
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, UpstreamError> {
    let bytes = fs::read(path).map_err(|error| {
        UpstreamError::new(
            "dsh-norm-spec/payload/file-unavailable",
            format!("payload JSON is unavailable: {error}"),
        )
        .with_path(path)
    })?;
    if bytes.len() > MAX_MACHINE_OUTPUT_BYTES {
        return Err(UpstreamError::new(
            "dsh-norm-spec/payload/file-too-large",
            "payload JSON exceeds the input limit",
        )
        .with_path(path));
    }
    serde_json::from_slice(&bytes).map_err(|error| {
        UpstreamError::new(
            "dsh-norm-spec/payload/json-invalid",
            format!("payload JSON is invalid: {error}"),
        )
        .with_path(path)
    })
}

fn safe_relative(path: &str) -> Result<(), UpstreamError> {
    let candidate = Path::new(path);
    if path.is_empty()
        || candidate.is_absolute()
        || candidate
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(UpstreamError::new(
            "dsh-norm-spec/payload/unsafe-path",
            format!("payload path is not safe and relative: {path}"),
        ));
    }
    Ok(())
}

fn reject_symlink(path: &Path) -> Result<(), UpstreamError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        UpstreamError::new(
            "dsh-norm-spec/payload/unavailable",
            format!("payload path is unavailable: {error}"),
        )
        .with_path(path)
    })?;
    if metadata.file_type().is_symlink() {
        return Err(UpstreamError::new(
            "dsh-norm-spec/payload/symlink",
            "payload root must not be a symbolic link",
        )
        .with_path(path));
    }
    Ok(())
}

fn collect_inventory(root: &Path) -> Result<BTreeSet<String>, UpstreamError> {
    let mut inventory = BTreeSet::new();
    collect_directory(root, root, &mut inventory)?;
    Ok(inventory)
}

fn collect_directory(
    root: &Path,
    directory: &Path,
    inventory: &mut BTreeSet<String>,
) -> Result<(), UpstreamError> {
    let entries = fs::read_dir(directory).map_err(|error| {
        UpstreamError::new(
            "dsh-norm-spec/payload/read-directory",
            format!("payload directory could not be read: {error}"),
        )
        .with_path(directory)
    })?;
    for entry in entries {
        let entry = entry.map_err(|error| {
            UpstreamError::new(
                "dsh-norm-spec/payload/read-directory",
                format!("payload directory entry could not be read: {error}"),
            )
            .with_path(directory)
        })?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|error| {
            UpstreamError::new(
                "dsh-norm-spec/payload/metadata",
                format!("payload entry metadata is unavailable: {error}"),
            )
            .with_path(&path)
        })?;
        if metadata.file_type().is_symlink() {
            return Err(UpstreamError::new(
                "dsh-norm-spec/payload/symlink",
                "payload must not contain symbolic links",
            )
            .with_path(&path));
        }
        if metadata.is_dir() {
            collect_directory(root, &path, inventory)?;
        } else if metadata.is_file() {
            let relative = path.strip_prefix(root).map_err(|error| {
                UpstreamError::new(
                    "dsh-norm-spec/payload/unsafe-path",
                    format!("payload entry escaped its root: {error}"),
                )
                .with_path(&path)
            })?;
            let portable = relative
                .components()
                .map(|component| component.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            inventory.insert(portable);
        } else {
            return Err(UpstreamError::new(
                "dsh-norm-spec/payload/unsupported-entry",
                "payload contains a non-file, non-directory entry",
            )
            .with_path(&path));
        }
    }
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String, UpstreamError> {
    let bytes = fs::read(path).map_err(|error| {
        UpstreamError::new(
            "dsh-norm-spec/payload/file-unavailable",
            format!("payload file could not be read: {error}"),
        )
        .with_path(path)
    })?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(test)]
mod tests {
    use std::{fs, io};

    use dsh_norm_engine::{UpstreamPin, native_rust_target};
    use tempfile::TempDir;

    use super::{
        CONTRACT_LOCK_FILE, ContractFile, ContractLock, MANIFEST_FILE, PAYLOAD_LOCK_FILE,
        ReleaseContract, ReleaseExecutables, ReleaseManifest, ReleaseProduct, ReleaseSkill,
        ResolvedPayload, UPSTREAM_CHECKSUM_FILE, seal_payload, sha256_file, validate_compatibility,
    };

    #[test]
    fn sealed_payload_detects_post_seal_changes() -> Result<(), Box<dyn std::error::Error>> {
        let fixture = payload_fixture()?;
        let identity = seal_payload(fixture.path())?;
        let resolved = ResolvedPayload::open(fixture.path())?;
        assert_eq!(resolved.identity(), &identity);

        fs::write(fixture.path().join("README.md"), "changed")?;
        let Err(error) = ResolvedPayload::open(fixture.path()) else {
            return Err("tampered payload unexpectedly resolved".into());
        };
        assert_eq!(error.code(), "dsh-norm-spec/payload/content-mismatch");
        Ok(())
    }

    #[test]
    fn sealing_rejects_unpinned_checksum() -> Result<(), Box<dyn std::error::Error>> {
        let fixture = payload_fixture()?;
        fs::write(
            fixture.path().join(UPSTREAM_CHECKSUM_FILE),
            "0000000000000000000000000000000000000000000000000000000000000000  wrong.tar.gz\n",
        )?;
        let Err(error) = seal_payload(fixture.path()) else {
            return Err("payload with wrong checksum unexpectedly sealed".into());
        };
        assert_eq!(error.code(), "dsh-norm-spec/payload/checksum-mismatch");
        assert!(!fixture.path().join(PAYLOAD_LOCK_FILE).exists());
        Ok(())
    }

    #[test]
    fn compatibility_mismatch_is_a_stable_failure() -> Result<(), Box<dyn std::error::Error>> {
        let pin = UpstreamPin::embedded()?;
        let mut incompatible = pin.compatibility.clone();
        incompatible
            .machine_apis
            .retain(|api| api != "norm-spec/collect/v1");
        let Err(error) = validate_compatibility(&incompatible, &pin) else {
            return Err("incompatible upstream identity unexpectedly passed".into());
        };
        assert_eq!(error.code(), "dsh-norm-spec/upstream/incompatible");
        Ok(())
    }

    fn payload_fixture() -> Result<TempDir, Box<dyn std::error::Error>> {
        let fixture = tempfile::tempdir()?;
        let root = fixture.path();
        let pin = UpstreamPin::embedded()?;
        let target = native_rust_target()
            .ok_or_else(|| io::Error::other("test target has no upstream asset"))?;
        let asset = pin
            .asset_for_target(target)
            .ok_or_else(|| io::Error::other("embedded pin omitted test target"))?;
        let executable_suffix = if target == "x86_64-pc-windows-msvc" {
            ".exe"
        } else {
            ""
        };
        let norm = format!("bin/norm{executable_suffix}");
        let conformance = format!("bin/norm-spec-conformance{executable_suffix}");

        for directory in ["bin", "contract/fixtures", "skills/norm-spec/references"] {
            fs::create_dir_all(root.join(directory))?;
        }
        fs::write(root.join(&norm), "fixture norm")?;
        fs::write(root.join(&conformance), "fixture conformance")?;
        fs::write(root.join("LICENSE"), "fixture license")?;
        fs::write(root.join("README.md"), "fixture readme")?;
        fs::write(root.join("README.zh-CN.md"), "fixture readme zh")?;
        fs::write(root.join("skills/norm-spec/SKILL.md"), "fixture skill")?;
        fs::write(
            root.join("skills/norm-spec/references/authoring.md"),
            "fixture authoring",
        )?;
        fs::write(
            root.join("skills/norm-spec/references/field-reference.md"),
            "fixture fields",
        )?;
        fs::write(root.join("contract/fixtures/example.txt"), "fixture")?;
        let contract_sha = sha256_file(&root.join("contract/fixtures/example.txt"))?;
        let expected = &pin.compatibility.conformance;
        let contract_lock = ContractLock {
            api_version: expected.bundle_api.clone(),
            suite: expected.suite.clone(),
            case_count: expected.case_count,
            contract_digest: expected.contract_digest.clone(),
            files: vec![ContractFile {
                path: "fixtures/example.txt".to_owned(),
                sha256: contract_sha,
            }],
        };
        fs::write(
            root.join(CONTRACT_LOCK_FILE),
            serde_json::to_vec_pretty(&contract_lock)?,
        )?;

        let manifest = ReleaseManifest {
            api_version: dsh_norm_engine::RELEASE_ARTIFACT_API.to_owned(),
            product: ReleaseProduct {
                name: pin.compatibility.product.name.clone(),
                version: pin.compatibility.product.version.clone(),
            },
            target: target.to_owned(),
            source_revision: pin.source_revision.clone(),
            executables: ReleaseExecutables { norm, conformance },
            compatibility_api: pin.compatibility.api_version.clone(),
            contract: ReleaseContract {
                path: "contract".to_owned(),
                bundle_api: expected.bundle_api.clone(),
                report_api: expected.report_api.clone(),
                suite: expected.suite.clone(),
                case_count: expected.case_count,
                contract_digest: expected.contract_digest.clone(),
            },
            skill: ReleaseSkill {
                path: "skills/norm-spec".to_owned(),
            },
        };
        fs::write(
            root.join(MANIFEST_FILE),
            serde_json::to_vec_pretty(&manifest)?,
        )?;
        fs::write(
            root.join(UPSTREAM_CHECKSUM_FILE),
            format!("{}  {}\n", asset.sha256, asset.name),
        )?;
        Ok(fixture)
    }
}
