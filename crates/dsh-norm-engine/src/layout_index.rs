//! Deterministic layout-index projection for the system-prompt convention map.

use std::{error::Error, fmt};

use serde::Serialize;

use crate::{NormCollectResponse, NormScanResponse};

/// Machine API identifier for the layout-index result.
pub const LAYOUT_INDEX_API_VERSION: &str = "dsh-norm-spec/layout-index/v1";

/// Maximum UTF-8 size of one rendered layout index.
pub const MAX_LAYOUT_INDEX_BYTES: usize = 64 * 1024;

const PROMPT_HEADER: &str = "DSH_NORM_LAYOUT_INDEX_V1\n\
The project directories below declare .norm conventions. Each directory's conventions apply to that directory and are inherited from its parents; consult them before working there.\n";
const PROMPT_FOOTER: &str = "\nEND_DSH_NORM_LAYOUT_INDEX_V1";

/// Stable failure while constructing the layout index.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LayoutIndexError {
    code: &'static str,
    message: String,
}

impl LayoutIndexError {
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
}

impl fmt::Display for LayoutIndexError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for LayoutIndexError {}

/// One declaring directory in the convention map.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutIndexEntry {
    /// Root-relative directory path as reported by the scan.
    pub path: String,
    /// Frontmatter `metadata.description` when the collected `.norm` has one.
    pub description: Option<String>,
}

/// Versioned layout-index projection: the map rendered for the system prompt.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutIndex {
    /// Layout-index protocol identifier.
    #[serde(rename = "apiVersion")]
    pub api_version: &'static str,
    /// Root marker carried over from the scan response.
    pub root: String,
    /// Declaring directories in scan order.
    pub entries: Vec<LayoutIndexEntry>,
    /// Complete deterministic prompt, or `None` when nothing declares conventions.
    pub prompt: Option<String>,
}

fn description_of(directory: &str, collects: &[NormCollectResponse]) -> Option<String> {
    let norm_path = if directory == "." {
        ".norm".to_owned()
    } else {
        format!("{directory}/.norm")
    };
    let convention = collects
        .iter()
        .flat_map(|response| &response.norms)
        .find(|convention| convention.path == norm_path)?;
    let description = convention.frontmatter.get("metadata")?.get("description")?;
    description.as_str().map(str::to_owned)
}

impl LayoutIndex {
    /// Construct the layout index from one scan and the collects of its
    /// declaring directories.
    ///
    /// # Errors
    ///
    /// Returns a stable error if deterministic JSON serialization fails or
    /// the complete prompt would exceed [`MAX_LAYOUT_INDEX_BYTES`]. Content
    /// is never truncated.
    pub fn from_scan(
        root: impl Into<String>,
        scan: &NormScanResponse,
        collects: &[NormCollectResponse],
    ) -> Result<Self, LayoutIndexError> {
        let entries: Vec<LayoutIndexEntry> = scan
            .directories
            .iter()
            .filter(|directory| directory.has_norm)
            .map(|directory| LayoutIndexEntry {
                path: directory.path.clone(),
                description: description_of(&directory.path, collects),
            })
            .collect();
        if entries.is_empty() {
            return Ok(Self {
                api_version: LAYOUT_INDEX_API_VERSION,
                root: root.into(),
                entries,
                prompt: None,
            });
        }

        let mut lines = Vec::with_capacity(entries.len());
        for entry in &entries {
            match entry.description.as_deref() {
                Some(description) => lines.push(format!("- {}: {description}", entry.path)),
                None => lines.push(format!("- {}", entry.path)),
            }
        }
        let prompt = format!("{PROMPT_HEADER}{}\n{PROMPT_FOOTER}", lines.join("\n"));
        if prompt.len() > MAX_LAYOUT_INDEX_BYTES {
            return Err(LayoutIndexError {
                code: "dsh-norm-spec/layout/too-large",
                message: format!(
                    "layout index is {} bytes; maximum is {MAX_LAYOUT_INDEX_BYTES} bytes",
                    prompt.len()
                ),
            });
        }

        Ok(Self {
            api_version: LAYOUT_INDEX_API_VERSION,
            root: root.into(),
            entries,
            prompt: Some(prompt),
        })
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde_json::json;

    use super::{LAYOUT_INDEX_API_VERSION, LayoutIndex, MAX_LAYOUT_INDEX_BYTES};
    use crate::{NormCollectResponse, NormCollectedConvention, NormScanResponse};

    fn scan_with(paths: &[(&str, bool)]) -> NormScanResponse {
        NormScanResponse {
            api_version: "norm-spec/scan/v1".to_owned(),
            root: ".".to_owned(),
            directory_count: paths.len(),
            directories: paths
                .iter()
                .map(|(path, has_norm)| crate::NormScannedDirectory {
                    path: (*path).to_owned(),
                    depth: 0,
                    file_count: 0,
                    has_norm: *has_norm,
                })
                .collect(),
            symlinks: Vec::new(),
            naming: crate::NormScanNaming {
                directories: BTreeMap::new(),
                files: BTreeMap::new(),
            },
            recurring_filenames: Vec::new(),
            norm_coverage: crate::NormScanCoverage {
                total_dirs: paths.len(),
                dirs_with_norm: paths.iter().filter(|(_, has)| *has).count(),
                ratio: 0.0,
            },
        }
    }

    fn collect_for(target: &str, description: Option<&str>) -> NormCollectResponse {
        let mut frontmatter = json!({"metadata": {"layer": "demo"}});
        if let Some(description) = description {
            frontmatter["metadata"]["description"] = json!(description);
        }
        NormCollectResponse {
            api_version: "norm-spec/collect/v1".to_owned(),
            root: ".".to_owned(),
            target: target.to_owned(),
            norms: vec![NormCollectedConvention {
                path: if target == "." {
                    ".norm".to_owned()
                } else {
                    format!("{target}/.norm")
                },
                frontmatter,
                body: "# Body".to_owned(),
            }],
        }
    }

    #[test]
    fn renders_declaring_directories_with_descriptions() {
        let scan = scan_with(&[(".", true), ("crates", false), ("docs", true)]);
        let collects = vec![
            collect_for(".", Some("root governance")),
            collect_for("docs", None),
        ];
        let index = LayoutIndex::from_scan(".", &scan, &collects)
            .unwrap_or_else(|error| panic!("index should render: {error}"));
        assert_eq!(index.api_version, LAYOUT_INDEX_API_VERSION);
        assert_eq!(index.entries.len(), 2);
        assert_eq!(
            index.entries[0].description.as_deref(),
            Some("root governance")
        );
        assert_eq!(index.entries[1].description, None);
        let prompt = index
            .prompt
            .as_deref()
            .unwrap_or_else(|| panic!("non-empty map should render"));
        assert!(prompt.contains("- .: root governance"));
        assert!(prompt.contains("- docs\n"));
        assert!(prompt.contains("consult them before working there"));
    }

    #[test]
    fn empty_layout_renders_without_a_prompt() {
        let index = LayoutIndex::from_scan(".", &scan_with(&[("docs", false)]), &[])
            .unwrap_or_else(|error| panic!("empty index should render: {error}"));
        assert!(index.entries.is_empty());
        assert!(index.prompt.is_none());
    }

    #[test]
    fn oversized_index_fails_instead_of_truncating() {
        let scan = scan_with(&[(".", true)]);
        let long_description = "x".repeat(MAX_LAYOUT_INDEX_BYTES);
        let collects = vec![collect_for(".", Some(&long_description))];
        let Err(error) = LayoutIndex::from_scan(".", &scan, &collects) else {
            panic!("oversized index must fail");
        };
        assert_eq!(error.code(), "dsh-norm-spec/layout/too-large");
    }

    #[test]
    fn rendering_is_deterministic() {
        let scan = scan_with(&[(".", true), ("docs", true)]);
        let collects = vec![
            collect_for(".", Some("root")),
            collect_for("docs", Some("docs")),
        ];
        let first = LayoutIndex::from_scan(".", &scan, &collects)
            .unwrap_or_else(|error| panic!("first: {error}"));
        let second = LayoutIndex::from_scan(".", &scan, &collects)
            .unwrap_or_else(|error| panic!("second: {error}"));
        assert_eq!(first, second);
    }
}
