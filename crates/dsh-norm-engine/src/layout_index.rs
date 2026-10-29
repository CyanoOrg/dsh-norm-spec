//! dsh-norm-spec layout-index identity over the shared family engine.

pub use norm_adapter_engine::{
    LayoutIndex, LayoutIndexEntry, LayoutIndexError, MAX_LAYOUT_INDEX_BYTES,
};

/// Machine API identifier for a layout-index result.
pub const LAYOUT_INDEX_API_VERSION: &str = crate::DSH_IDENTITY.layout_index_api;

#[cfg(test)]
mod tests {
    use super::LAYOUT_INDEX_API_VERSION;

    #[test]
    fn layout_api_version_carries_the_dsh_identity() {
        assert_eq!(LAYOUT_INDEX_API_VERSION, "dsh-norm-spec/layout-index/v1");
        assert_eq!(
            crate::DSH_IDENTITY.layout_index_marker,
            "DSH_NORM_LAYOUT_INDEX_V1"
        );
    }
}
