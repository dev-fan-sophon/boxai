//! Built-in BoxAI MCP servers.
//!
//! On sign-in Connect seeds the official media MCP endpoint so coding agents
//! can call image/video tools with the same sk- key already written into their
//! provider config. On sign-out those entries are withdrawn.
//!
//! Users can still add their own MCP servers — upstream's MCP panel is
//! untouched. Only the *seeded* set is managed here.

use serde_json::json;

use crate::app_config::{McpApps, McpServer};
use crate::error::AppError;
use crate::services::mcp::McpService;
use crate::store::AppState;

use super::provider_seed::{Provisioning, SUPPORTED_APPS};

/// Ids Connect owns. Anything listed here is withdrawn on sign-out, so an id
/// must never be removed from this list without also being removed from every
/// client that ever received it.
const ALL_SERVER_IDS: [&str; 1] = ["boxai-media"];

const MEDIA_SERVER_ID: &str = "boxai-media";

fn seeded_apps(provisioning: Option<&Provisioning>) -> McpApps {
    let mut apps = McpApps::default();
    for app in SUPPORTED_APPS {
        let enabled = provisioning.is_none_or(|policy| {
            !policy.agents_present
                || policy
                    .agents
                    .get(app.as_str())
                    .is_some_and(|agent| agent.enabled)
        });
        apps.set_enabled_for(&app, enabled);
    }
    apps
}

/// Default MCP URL when provisioning did not return one (offline / older
/// gateway). Release builds always talk to you-box.com.
fn default_mcp_endpoint() -> String {
    format!("{}/mcp", super::gateway_auth::portal_host())
}

/// The MCP servers a signed-in account should have.
///
/// `secret` is the account's relay key, carried as the Authorization header so
/// the gateway authenticates the tool call the same way it authenticates /v1.
fn definitions(secret: &str, endpoint: &str, apps: McpApps) -> [McpServer; 1] {
    [McpServer {
        id: MEDIA_SERVER_ID.to_string(),
        name: "BoxAI Media".to_string(),
        description: Some(
            "Image and video generation via BoxAI (list_media_models, generate_image, generate_video, get_video_status)."
                .into(),
        ),
        homepage: Some("https://you-box.com".into()),
        docs: Some("https://you-box.com/docs".into()),
        tags: vec![
            "boxai".into(),
            "image".into(),
            "video".into(),
            "http".into(),
        ],
        apps,
        server: json!({
            "type": "http",
            "url": endpoint,
            "headers": {
                "Authorization": format!("Bearer {secret}"),
            },
        }),
    }]
}

fn upsert_and_project(state: &AppState, desired: McpServer) -> Result<(), AppError> {
    // Re-project even when the DB row is unchanged: a previous live-file write
    // may have failed after the row was saved.
    McpService::upsert_server(state, desired)
}

/// Create or refresh every BoxAI MCP server and push them into the live
/// configuration of every enabled client. Signed out: withdraw them all.
///
/// `endpoint` comes from provisioning when available so a self-hosted gateway
/// can advertise its own URL; falls back to the compiled portal host.
pub fn sync(state: &AppState) -> Result<(), AppError> {
    sync_with_endpoint(state, None, None)
}

pub(crate) fn withdraw(state: &AppState) -> Result<(), AppError> {
    for id in ALL_SERVER_IDS {
        McpService::delete_server(state, id)?;
    }
    Ok(())
}

pub fn sync_with_endpoint(
    state: &AppState,
    endpoint: Option<&str>,
    provisioning: Option<&Provisioning>,
) -> Result<(), AppError> {
    if !super::gateway_auth::is_connected() {
        return withdraw(state);
    }
    let secret = match super::gateway_auth::api_key() {
        Ok(secret) => secret,
        Err(error) => {
            log::warn!("BoxAI MCP seed skipped: {error}");
            return Ok(());
        }
    };

    let url = endpoint
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(default_mcp_endpoint);
    let apps = seeded_apps(provisioning);
    if apps.enabled_apps().is_empty() {
        return withdraw(state);
    }

    for desired in definitions(&secret, &url, apps) {
        upsert_and_project(state, desired)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A signed-out install must withdraw exactly what a signed-in one seeds.
    #[test]
    fn every_seeded_server_is_also_withdrawn_on_sign_out() {
        let seeded: Vec<String> =
            definitions("sk-user", "https://you-box.com/mcp", seeded_apps(None))
                .into_iter()
                .map(|server| server.id)
                .collect();
        let withdrawn: Vec<String> = ALL_SERVER_IDS.iter().map(|id| id.to_string()).collect();
        assert_eq!(seeded, withdrawn);
    }

    #[test]
    fn media_server_is_http_with_bearer_auth() {
        let [server] = definitions("sk-user", "https://you-box.com/mcp", seeded_apps(None));
        assert_eq!(server.id, "boxai-media");
        assert_eq!(server.server["type"], "http");
        assert_eq!(server.server["url"], "https://you-box.com/mcp");
        assert_eq!(server.server["headers"]["Authorization"], "Bearer sk-user");
        assert!(server.apps.codex);
        assert!(server.apps.claude);
        assert!(server.apps.opencode);
        // OpenClaw has no MCP projection upstream.
        assert!(!server
            .apps
            .is_enabled_for(&crate::app_config::AppType::OpenClaw));
    }
}
