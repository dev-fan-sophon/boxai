//! The built-in BoxAI provider.
//!
//! Every supported client gets exactly one BoxAI entry whose endpoint and
//! user-owned account key point directly at BoxAI. What that entry *contains*
//! is per-client and lives in [`super::agent_config`], because the clients do
//! not share a configuration shape.
//!
//! Nothing is seeded while signed out. The entry is created when an account
//! connects and removed when it disconnects, so the panel never offers a
//! provider whose requests the Gateway would reject.
//!
//! Which models an entry may use is the gateway's answer for that account, not
//! a guess compiled into Connect.

use super::agent_config::{AgentConfig, ModelMetaMap};
use crate::app_config::AppType;
use crate::database::Database;
use crate::error::AppError;
use crate::provider::Provider;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

pub const PROVIDER_NAME: &str = "BoxAI";
pub const WEBSITE_URL: &str = "https://you-box.com";

/// Clients that can be projected at BoxAI.
///
/// Every upstream client is here except Claude Desktop, which has no chat
/// provider to point anywhere: upstream manages it through a profile library
/// and Connect's own local proxy against a fixed table of Anthropic route ids.
/// It stays visible and detectable in the panel; it is simply never seeded.
pub const SUPPORTED_APPS: [AppType; 7] = [
    AppType::Claude,
    AppType::Codex,
    AppType::Gemini,
    AppType::GrokBuild,
    AppType::OpenCode,
    AppType::OpenClaw,
    AppType::Hermes,
];

/// The model ids Gemini CLI will actually honour.
///
/// Gemini CLI checks the requested model against a fixed set (`isActiveModel`
/// over `VALID_GEMINI_MODELS`) and silently falls back to its own default for
/// anything else, whatever `GEMINI_MODEL` or `-m` says. Offering the rest of
/// the account catalog here would let a user pick a model, watch Connect write
/// it, and then have Gemini request a different model the account may not even
/// have. Keep this in step with the installed Gemini CLI release.
const GEMINI_CLI_MODELS: [&str; 11] = [
    "gemini-3-pro-preview",
    "gemini-3.1-pro-preview",
    "gemini-3.1-pro-preview-customtools",
    "gemini-3-flash-preview",
    "gemini-3.5-flash",
    "gemini-3-flash",
    "gemini-3.1-flash-lite",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemma-4-31b-it",
    "gemma-4-26b-a4b-it",
];

pub fn provider_id(app: &AppType) -> String {
    format!("boxai-{}", app.as_str())
}

/// Per-Agent settings keys.
///
/// The `legacy_*` names are the v0.1.x layout. They are still read so an
/// upgrade can recover the configuration a user already had, and still cleared
/// on reset so nothing is left pointing at a withdrawn account.
pub fn settings_key(app: &AppType, field: &str) -> String {
    let app = app.as_str();
    match field {
        "legacy_model" => format!("boxai_model_{app}"),
        "legacy_enabled" => format!("boxai_agent_enabled_{app}"),
        "legacy_applied_model" => format!("boxai_agent_applied_model_{app}"),
        "legacy_applied_revision" => format!("boxai_agent_applied_revision_{app}"),
        "legacy_applied_fingerprint" => format!("boxai_agent_applied_fingerprint_{app}"),
        other => format!("boxai_agent_{other}_{app}"),
    }
}

fn next_sort_index(db: &Database, app_type: &str) -> usize {
    db.get_all_providers(app_type)
        .map(|providers| providers.len())
        .unwrap_or(0)
}

/// Create or refresh the BoxAI provider row for one client.
///
/// `save_provider` is an UPSERT that preserves `is_current`, so refreshing a
/// rotated secret never silently deactivates the user's selection.
pub fn upsert_for(
    db: &Database,
    app: &AppType,
    secret: &str,
    config: &AgentConfig,
    meta: &ModelMetaMap,
) -> Result<bool, AppError> {
    let app_type = app.as_str();
    let id = provider_id(app);
    let desired = config.settings_config(secret, meta);

    let existing = db.get_provider_by_id(&id, app_type)?;
    if let Some(current) = &existing {
        if current.settings_config == desired {
            return Ok(false);
        }
    }

    let mut provider = Provider::with_id(
        id,
        PROVIDER_NAME.to_string(),
        desired,
        Some(WEBSITE_URL.to_string()),
    );
    // Not "official": upstream reads that category as "an official OAuth login
    // with no base_url a local proxy could take over" and badges the card
    // "no routing support". This provider is a relayed endpoint.
    provider.category = Some("third_party".to_string());
    provider.icon = Some("openai".to_string());
    provider.icon_color = Some("#6575ff".to_string());
    provider.meta = existing.as_ref().and_then(|p| p.meta.clone());
    provider.sort_index = existing
        .as_ref()
        .and_then(|p| p.sort_index)
        .or_else(|| Some(next_sort_index(db, app_type)));
    provider.created_at = existing
        .as_ref()
        .and_then(|p| p.created_at)
        .or_else(|| Some(chrono::Utc::now().timestamp_millis()));

    db.save_provider(app_type, &provider)?;
    Ok(true)
}

/// The account-scoped configuration BoxAI issues after sign-in.
///
/// Connect owns none of it. Which models exist is per-account, and which one a
/// fresh install should select is an operator decision, so both answers arrive
/// from the server rather than being decided by the desktop build.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AgentProvisioning {
    pub enabled: bool,
    pub models: Vec<String>,
    pub recommended_model: String,
    #[serde(default)]
    pub locked_model: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Provisioning {
    pub revision: String,
    pub refresh_after_seconds: u64,
    pub agents: HashMap<String, AgentProvisioning>,
    /// False only for legacy servers which do not return `agents` at all.
    pub agents_present: bool,
    pub chat_models: Vec<String>,
    /// What BoxAI documents about each chat model. Absent entries are normal:
    /// the clients then fall back to the bare model id.
    #[serde(default)]
    pub model_meta: ModelMetaMap,
    pub default_model: Option<String>,
    pub image_models: Vec<String>,
    pub video_models: Vec<String>,
    pub default_image_model: Option<String>,
    pub default_video_model: Option<String>,
    /// Absolute URL of the BoxAI media MCP endpoint (Streamable HTTP).
    pub mcp_endpoint: Option<String>,
    pub account: Option<super::gateway_auth::Account>,
}

/// The policy for one Agent, defaulting to "everything this account can run"
/// only for legacy servers that do not publish per-Agent policy at all.
pub fn policy_for(provisioning: &Provisioning, app: &AppType) -> AgentProvisioning {
    let mut policy = provisioning
        .agents
        .get(app.as_str())
        .cloned()
        .unwrap_or_else(|| AgentProvisioning {
            enabled: !provisioning.agents_present,
            models: if provisioning.agents_present {
                Vec::new()
            } else {
                provisioning.chat_models.clone()
            },
            ..Default::default()
        });
    if *app == AppType::Gemini {
        policy
            .models
            .retain(|model| GEMINI_CLI_MODELS.contains(&model.as_str()));
        if !policy.models.contains(&policy.recommended_model) {
            policy.recommended_model = String::new();
        }
    }
    policy
}

fn string_list(value: &Value) -> Vec<String> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|model| model.as_str().map(str::to_owned))
        .filter(|model| !model.trim().is_empty())
        .collect()
}

fn optional_string(value: &Value) -> Option<String> {
    value
        .as_str()
        .filter(|model| !model.is_empty())
        .map(str::to_owned)
}

pub fn parse_provisioning(body: &Value) -> Result<Provisioning, String> {
    if body.get("success").and_then(Value::as_bool) == Some(false) {
        return Err(body["message"]
            .as_str()
            .unwrap_or("BoxAI provisioning was rejected")
            .to_owned());
    }
    let data = &body["data"];
    let (agents, agents_present) = match data.get("agents") {
        Some(value) => {
            let agents: HashMap<String, AgentProvisioning> = serde_json::from_value(value.clone())
                .map_err(|error| format!("BoxAI returned invalid agent provisioning: {error}"))?;
            for app in SUPPORTED_APPS {
                if !agents.contains_key(app.as_str()) {
                    return Err(format!(
                        "BoxAI returned invalid agent provisioning: missing {} policy",
                        app.as_str()
                    ));
                }
            }
            (agents, true)
        }
        None => (HashMap::new(), false),
    };
    // Metadata is decoration for catalog entries, never an authorization
    // answer, so an unreadable map degrades to "nothing documented" rather
    // than failing a sync that would otherwise have worked.
    let model_meta = data
        .get("model_meta")
        .map(|value| serde_json::from_value(value.clone()).unwrap_or_default())
        .unwrap_or_default();
    Ok(Provisioning {
        revision: data["revision"].as_str().unwrap_or_default().to_owned(),
        refresh_after_seconds: data["refresh_after_seconds"].as_u64().unwrap_or(60).max(1),
        agents,
        agents_present,
        chat_models: string_list(&data["chat_models"]),
        model_meta,
        default_model: optional_string(&data["default_model"]),
        image_models: string_list(&data["image_models"]),
        video_models: string_list(&data["video_models"]),
        default_image_model: optional_string(&data["default_image_model"]),
        default_video_model: optional_string(&data["default_video_model"]),
        mcp_endpoint: optional_string(&data["mcp_endpoint"]),
        account: serde_json::from_value(data["account"].clone()).ok(),
    })
}

/// Result of reconciling BoxAI providers after sign-in / startup.
pub struct SyncOutcome {
    pub providers_changed: usize,
    /// MCP endpoint advertised by provisioning, when present.
    pub mcp_endpoint: Option<String>,
    pub changed_agents: Vec<String>,
}

/// Refresh the stored BoxAI provider row for every supported client.
///
/// This only maintains Connect's own template: rotating a key or a changed
/// catalog must not rewrite a file the user is currently working against. The
/// live config follows on the next explicit apply.
///
/// Does nothing while signed out, and removes any existing entries: an account
/// that is not connected must not leave behind a provider that authorizes
/// nothing.
pub fn reconcile(state: &crate::store::AppState, provisioning: &Provisioning) -> SyncOutcome {
    let db = &state.db;
    let idle = SyncOutcome {
        providers_changed: 0,
        mcp_endpoint: None,
        changed_agents: Vec::new(),
    };
    if !super::gateway_auth::is_connected() {
        if let Err(error) = super::agent_commands::withdraw_all(state) {
            log::warn!("Could not withdraw signed-out BoxAI providers: {error}");
        }
        return idle;
    }
    let secret = match super::gateway_auth::api_key() {
        Ok(secret) => secret,
        Err(error) => {
            log::warn!("BoxAI provider seed skipped: {error}");
            return idle;
        }
    };
    // The same call that answers "which models" also answers "who is this",
    // so the account dialog can render an identity without its own request.
    super::gateway_auth::remember_account(provisioning.account.clone());
    let mut changed = 0;
    let mut changed_agents = Vec::new();
    for app in SUPPORTED_APPS {
        let policy = policy_for(provisioning, &app);
        if !policy.enabled {
            let configured = db
                .get_setting(&settings_key(&app, "config"))
                .ok()
                .flatten()
                .is_some_and(|value| !value.is_empty());
            let existed = db
                .get_provider_by_id(&provider_id(&app), app.as_str())
                .ok()
                .flatten()
                .is_some();
            // Withdraw before deleting the row: dropping the DB entry first
            // would orphan the live BoxAI configuration it describes.
            if existed || configured {
                // The draft survives: a policy that comes back must not have
                // cost the user the configuration they had.
                match super::agent_commands::withdraw_and_forget(state, &app, true) {
                    Ok(()) => changed_agents.push(app.as_str().to_owned()),
                    Err(error) => log::warn!(
                        "✗ Failed to withdraw disabled BoxAI agent {}: {error}",
                        app.as_str()
                    ),
                }
            }
            continue;
        }
        let Some(mut config) = super::agent_commands::stored_config(state, &app) else {
            continue;
        };
        config.sanitize(&policy.models);
        if !config.is_complete() {
            log::warn!(
                "BoxAI agent {} is unconfigured; no model was selected",
                app.as_str()
            );
            continue;
        }
        let _ = db.set_setting(&settings_key(&app, "revision"), &provisioning.revision);
        match upsert_for(db, &app, &secret, &config, &provisioning.model_meta) {
            Ok(true) => {
                changed += 1;
                changed_agents.push(app.as_str().to_owned());
                log::info!("✓ Reconciled BoxAI provider for {}", app.as_str());
            }
            Ok(false) => {}
            Err(error) => log::warn!(
                "✗ Failed to seed BoxAI provider for {}: {error}",
                app.as_str()
            ),
        }
    }
    SyncOutcome {
        providers_changed: changed,
        mcp_endpoint: provisioning.mcp_endpoint.clone(),
        changed_agents,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Shaped after a real `GET /api/connect/provisioning` response.
    fn provisioning_response() -> Value {
        json!({"success": true, "data": {
            "chat_models": ["deepseek-v4-pro", "gpt-5.6-sol", "kimi-k2.7-code"],
            "default_model": "gpt-5.6-sol",
            "model_meta": {
                "gpt-5.6-sol": {
                    "display_name": "GPT-5.6 Sol",
                    "context_length": 400000,
                    "max_output_tokens": 128000,
                    "input_modalities": ["text", "image"],
                    "reasoning_efforts": ["low", "high"],
                },
            },
            "image_models": ["gpt-image-2", "grok-imagine-image"],
            "video_models": ["seedance-2-0"],
            "default_image_model": "gpt-image-2",
            "default_video_model": "seedance-2-0",
            "mcp_endpoint": "https://you-box.com/mcp",
            "account": {
                "id": 7,
                "username": "ada",
                "display_name": "Ada",
                "email": "ada@example.com",
                "quota": 12345,
            },
        }})
    }

    #[test]
    fn the_model_catalog_comes_from_the_server() {
        let parsed = parse_provisioning(&provisioning_response()).unwrap();
        assert_eq!(
            parsed.chat_models,
            ["deepseek-v4-pro", "gpt-5.6-sol", "kimi-k2.7-code"]
        );
        assert_eq!(parsed.default_model.as_deref(), Some("gpt-5.6-sol"));
        assert_eq!(parsed.image_models, ["gpt-image-2", "grok-imagine-image"]);
        assert_eq!(parsed.video_models, ["seedance-2-0"]);
        assert_eq!(parsed.default_image_model.as_deref(), Some("gpt-image-2"));
        assert_eq!(
            parsed.mcp_endpoint.as_deref(),
            Some("https://you-box.com/mcp")
        );
    }

    /// Client catalogs need more than an id — Grok Build refuses a profile
    /// without a context window — and Connect must never invent those values.
    #[test]
    fn documented_model_metadata_survives_the_round_trip() {
        let parsed = parse_provisioning(&provisioning_response()).unwrap();
        let documented = parsed.model_meta.get("gpt-5.6-sol").expect("metadata");
        assert_eq!(documented.display_name.as_deref(), Some("GPT-5.6 Sol"));
        assert_eq!(documented.context_length, Some(400_000));
        assert_eq!(documented.max_output_tokens, Some(128_000));
        assert_eq!(documented.input_modalities, ["text", "image"]);
        assert!(!parsed.model_meta.contains_key("deepseek-v4-pro"));

        // Metadata is decoration, not authorization: a server that sends a
        // shape Connect cannot read must not break the whole sync.
        let malformed =
            parse_provisioning(&json!({"data": {"model_meta": "unavailable"}})).unwrap();
        assert!(malformed.model_meta.is_empty());
    }

    #[test]
    fn the_same_call_carries_the_account_identity() {
        // One request answers both "which models" and "who is this", so the
        // account dialog never needs a second round trip.
        let account = parse_provisioning(&provisioning_response())
            .unwrap()
            .account
            .expect("account");
        assert_eq!(account.id, 7);
        assert_eq!(account.username, "ada");
        assert_eq!(account.quota, 12345);
    }

    #[test]
    fn an_account_with_no_chat_models_yields_no_default() {
        // Connect must not substitute a model name of its own here.
        let parsed = parse_provisioning(&json!({
            "data": {"chat_models": [], "default_model": ""}
        }))
        .unwrap();
        assert!(parsed.chat_models.is_empty());
        assert_eq!(parsed.default_model, None);
    }

    #[test]
    fn a_malformed_response_yields_nothing_rather_than_a_guess() {
        let parsed = parse_provisioning(&json!({})).unwrap();
        assert!(parsed.agents.is_empty());
        assert!(!parsed.agents_present);
        assert!(parsed.chat_models.is_empty());
    }

    #[test]
    fn malformed_present_agents_are_rejected() {
        for agents in [
            json!(null),
            json!([]),
            json!("disabled"),
            json!({}),
            json!({"claude": null}),
            json!({"claude": {"enabled": true, "models": [], "recommended_model": "model"}}),
        ] {
            let error = parse_provisioning(&json!({"data": {"agents": agents}})).unwrap_err();
            assert!(error.starts_with("BoxAI returned invalid agent provisioning:"));
        }
    }

    #[test]
    fn present_agents_require_all_fields_with_exact_types() {
        let valid_policy = json!({
            "enabled": true,
            "models": ["model-a"],
            "recommended_model": "model-a"
        });
        let mut agents = serde_json::Map::new();
        for app in SUPPORTED_APPS {
            agents.insert(app.as_str().to_owned(), valid_policy.clone());
        }
        assert!(parse_provisioning(&json!({"data": {"agents": agents.clone()}})).is_ok());

        for invalid in [
            json!({"models": ["model-a"], "recommended_model": "model-a"}),
            json!({"enabled": "yes", "models": ["model-a"], "recommended_model": "model-a"}),
            json!({"enabled": true, "models": [1], "recommended_model": "model-a"}),
            json!({"enabled": true, "models": ["model-a"]}),
            json!({"enabled": true, "models": ["model-a"], "recommended_model": 1}),
            json!({"enabled": true, "models": ["model-a"], "recommended_model": "model-a", "locked_model": false}),
        ] {
            let mut malformed = agents.clone();
            malformed.insert("claude".to_owned(), invalid);
            assert!(parse_provisioning(&json!({"data": {"agents": malformed}})).is_err());
        }
    }

    #[test]
    fn an_explicitly_failed_response_is_rejected() {
        let error = parse_provisioning(&json!({
            "success": false,
            "message": "account disabled",
            "data": {}
        }))
        .unwrap_err();
        assert_eq!(error, "account disabled");
    }

    #[test]
    fn a_server_without_agent_policy_still_offers_the_account_catalog() {
        // Older gateways published no per-Agent policy at all; refusing every
        // Agent there would break clients that used to work.
        let legacy = parse_provisioning(&json!({"data": {"chat_models": ["model-a"]}})).unwrap();
        let policy = policy_for(&legacy, &AppType::Codex);
        assert!(policy.enabled);
        assert_eq!(policy.models, ["model-a"]);

        // A gateway that does publish policy is authoritative, including its
        // silence about an Agent it does not list.
        let scoped = parse_provisioning(&json!({"data": {"agents": {
            "claude": {"enabled": true, "models": ["model-a"], "recommended_model": ""},
            "codex": {"enabled": true, "models": ["model-a"], "recommended_model": ""},
            "gemini": {"enabled": true, "models": ["model-a"], "recommended_model": ""},
            "grokbuild": {"enabled": true, "models": ["model-a"], "recommended_model": ""},
            "opencode": {"enabled": true, "models": ["model-a"], "recommended_model": ""},
            "openclaw": {"enabled": true, "models": ["model-a"], "recommended_model": ""},
            "hermes": {"enabled": false, "models": [], "recommended_model": ""},
        }}}))
        .unwrap();
        assert!(!policy_for(&scoped, &AppType::Hermes).enabled);
        assert!(policy_for(&scoped, &AppType::ClaudeDesktop)
            .models
            .is_empty());
    }

    #[test]
    fn gemini_is_only_offered_models_its_cli_will_honour() {
        // Verified against Gemini CLI 0.54 on Windows: with `gemini-3.6-flash`
        // selected it requested `gemini-3.5-flash` instead, and the account had
        // no such model. Offering it at all is what makes that possible.
        let catalog = json!({
            "enabled": true,
            "models": ["gemini-3.6-flash", "gemini-3.1-pro-preview", "gpt-5.6"],
            "recommended_model": "gemini-3.6-flash",
        });
        let provisioning = parse_provisioning(&json!({"data": {"agents": {
            "claude": catalog,
            "codex": catalog,
            "gemini": catalog,
            "grokbuild": catalog,
            "opencode": catalog,
            "openclaw": catalog,
            "hermes": catalog,
        }}}))
        .unwrap();

        let gemini = policy_for(&provisioning, &AppType::Gemini);
        assert_eq!(gemini.models, ["gemini-3.1-pro-preview"]);
        assert_eq!(
            gemini.recommended_model, "",
            "a recommendation Gemini would discard must not seed the config"
        );

        // The constraint belongs to Gemini alone; every other client takes the
        // account catalog as the gateway published it.
        let codex = policy_for(&provisioning, &AppType::Codex);
        assert_eq!(
            codex.models,
            ["gemini-3.6-flash", "gemini-3.1-pro-preview", "gpt-5.6"]
        );
        assert_eq!(codex.recommended_model, "gemini-3.6-flash");
    }

    #[test]
    fn provider_ids_are_namespaced_per_client() {
        assert_eq!(provider_id(&AppType::Claude), "boxai-claude");
        assert_eq!(provider_id(&AppType::OpenCode), "boxai-opencode");
    }

    #[test]
    fn settings_keys_keep_the_v1_names_they_have_to_read() {
        // These four keys exist in shipped installs; renaming them would
        // strand a user's configuration instead of upgrading it.
        assert_eq!(
            settings_key(&AppType::Codex, "legacy_model"),
            "boxai_model_codex"
        );
        assert_eq!(
            settings_key(&AppType::Codex, "legacy_enabled"),
            "boxai_agent_enabled_codex"
        );
        assert_eq!(
            settings_key(&AppType::Codex, "live_snapshot"),
            "boxai_agent_live_snapshot_codex"
        );
        assert_eq!(
            settings_key(&AppType::Codex, "previous_provider"),
            "boxai_agent_previous_provider_codex"
        );
    }
}
