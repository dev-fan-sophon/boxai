use gateway_connector_backend::{AssetIdentity, Distribution, ReleaseMetadata};
use gateway_connector_core::AgentId;

pub const SHELL_ICON_PATH: &str = "brand/boxai-connect-mark.svg";

pub static BOXAI_DISTRIBUTION: Distribution = Distribution {
    product_id: "boxai-connect",
    product_name: "BoxAI Connect",
    expected_platform_id: Some("boxai"),
    default_gateway_url: Some("https://you-box.com"),
    manifest_url: Some("https://you-box.com/api/v1/connector/manifest"),
    allow_custom_urls: false,
    allow_isolated_root: false,
    qualifier: "com",
    organization: "you-box",
    application: "connect",
    bundle_id: "com.you-box.connect",
    supported_locales: &["vi", "en", "zh-CN"],
    supported_agents: &[
        AgentId::Claude,
        AgentId::Codex,
        AgentId::Gemini,
        AgentId::Grokbuild,
        AgentId::Opencode,
        AgentId::Workbuddy,
    ],
    asset_identity: Some(AssetIdentity {
        icon_key: "boxai-connect-shell-icon",
        icon_path: SHELL_ICON_PATH,
    }),
    release_metadata: Some(ReleaseMetadata {
        repository: "dev-fan-sophon/boxai",
        download_url: Some("https://you-box.com/connect"),
        update_feed_url: Some("https://dl.you-box.com/connect/native-latest.json"),
    }),
    pkce_client_id: "boxai-connect",
    device_name: "BoxAI Connect",
};

#[cfg(test)]
mod tests {
    use std::ffi::OsString;

    use gateway_connector_app::isolated::{IsolatedRootError, LaunchRequest};

    use super::*;

    #[test]
    fn production_distribution_is_valid_and_boxai_pinned() {
        BOXAI_DISTRIBUTION.validate().expect("BoxAI distribution");
        assert_eq!(BOXAI_DISTRIBUTION.expected_platform_id, Some("boxai"));
        assert_eq!(BOXAI_DISTRIBUTION.pkce_client_id, "boxai-connect");
        assert_eq!(
            BOXAI_DISTRIBUTION
                .asset_identity
                .expect("BoxAI shell identity")
                .icon_path,
            SHELL_ICON_PATH
        );
        assert_eq!(
            BOXAI_DISTRIBUTION.manifest_url,
            Some("https://you-box.com/api/v1/connector/manifest")
        );
        assert!(!BOXAI_DISTRIBUTION.allow_custom_urls);
        assert!(!BOXAI_DISTRIBUTION.allow_isolated_root);
        assert!(
            BOXAI_DISTRIBUTION.default_gateway_url.is_some()
                && BOXAI_DISTRIBUTION.manifest_url.is_some(),
            "BoxAI sign-in must probe the pinned Gateway and open browser PKCE"
        );
        assert_eq!(BOXAI_DISTRIBUTION.supported_locales, ["vi", "en", "zh-CN"]);
        assert_eq!(
            BOXAI_DISTRIBUTION.supported_agents,
            [
                AgentId::Claude,
                AgentId::Codex,
                AgentId::Gemini,
                AgentId::Grokbuild,
                AgentId::Opencode,
                AgentId::Workbuddy,
            ]
        );
    }

    #[test]
    fn production_distribution_rejects_isolated_root_before_touching_it() {
        let parent = tempfile::tempdir().expect("temporary parent");
        let root = parent.path().join("must-not-exist");
        let result = LaunchRequest::from_args(
            &BOXAI_DISTRIBUTION,
            [
                OsString::from("--isolated-root"),
                root.clone().into_os_string(),
            ],
        );
        assert!(matches!(result, Err(IsolatedRootError::Disabled)));
        assert!(!root.exists());
    }
}
