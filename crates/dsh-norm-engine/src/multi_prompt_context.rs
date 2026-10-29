//! dsh-norm-spec multi-target context identity over the shared family engine.

pub use norm_adapter_engine::{
    MAX_MULTI_PROMPT_BYTES, MultiPromptContext, MultiPromptContextError, MultiScopeContext,
    MultiScopeConvention,
};

/// Machine API identifier for a multi-target prompt-context result.
pub const PROMPT_CONTEXT_MULTI_API_VERSION: &str = crate::DSH_IDENTITY.prompt_context_multi_api;

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{MultiPromptContext, PROMPT_CONTEXT_MULTI_API_VERSION};
    use crate::{DSH_IDENTITY, NormCollectResponse, NormCollectedConvention};

    #[test]
    fn multi_api_version_carries_the_dsh_identity() {
        assert_eq!(
            PROMPT_CONTEXT_MULTI_API_VERSION,
            "dsh-norm-spec/prompt-context-multi/v1"
        );
    }

    #[test]
    fn shared_engine_renders_the_dsh_multi_marker() {
        let context = MultiPromptContext::from_collections(
            &DSH_IDENTITY,
            ".",
            &[NormCollectResponse {
                api_version: "norm-spec/collect/v1".to_owned(),
                root: ".".to_owned(),
                target: "docs".to_owned(),
                norms: vec![NormCollectedConvention {
                    path: "docs/.norm".to_owned(),
                    frontmatter: json!({"metadata": {"layer": "documentation"}}),
                    body: "# Documentation".to_owned(),
                }],
            }],
        )
        .unwrap_or_else(|error| panic!("dsh identity should render multi: {error}"));
        let prompt = context
            .prompt
            .unwrap_or_else(|| panic!("non-empty multi collection renders"));
        assert!(prompt.starts_with("DSH_NORM_SPEC_CONTEXT_MULTI_V1\n"));
        assert!(prompt.ends_with("\nEND_DSH_NORM_SPEC_CONTEXT_MULTI_V1"));
    }
}
