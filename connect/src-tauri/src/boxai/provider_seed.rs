//! The built-in BoxAI provider.
//!
//! Every supported client gets exactly one BoxAI entry whose endpoint and
//! user-owned account key point directly at BoxAI.
//!
//! Nothing is seeded while signed out. The entry is created when an account
//! connects and removed when it disconnects, so the panel never offers a
//! provider whose requests the Gateway would reject.
//!
//! Which models an entry may use is the gateway's answer for that account, not
//! a guess compiled into Connect.

use crate::app_config::AppType;
use crate::database::Database;
use crate::error::AppError;
use crate::provider::Provider;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
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

pub fn provider_id(app: &AppType) -> String {
    format!("boxai-{}", app.as_str())
}

fn model_setting_key(app: &AppType) -> String {
    format!("boxai_model_{}", app.as_str())
}

fn enabled_setting_key(app: &AppType) -> String {
    format!("boxai_agent_enabled_{}", app.as_str())
}

fn revision_setting_key(app: &AppType) -> String {
    format!("boxai_agent_revision_{}", app.as_str())
}

fn synced_setting_key(app: &AppType) -> String {
    format!("boxai_agent_synced_{}", app.as_str())
}

fn applied_model_setting_key(app: &AppType) -> String {
    format!("boxai_agent_applied_model_{}", app.as_str())
}

fn applied_revision_setting_key(app: &AppType) -> String {
    format!("boxai_agent_applied_revision_{}", app.as_str())
}

fn applied_fingerprint_setting_key(app: &AppType) -> String {
    format!("boxai_agent_applied_fingerprint_{}", app.as_str())
}

fn previous_provider_setting_key(app: &AppType) -> String {
    format!("boxai_agent_previous_provider_{}", app.as_str())
}

fn live_snapshot_setting_key(app: &AppType) -> String {
    format!("boxai_agent_live_snapshot_{}", app.as_str())
}

fn clear_setting(db: &Database, key: &str) -> Result<(), AppError> {
    db.set_setting(key, "")
}

fn empty_live_settings(app: &AppType) -> Value {
    match app {
        AppType::Claude => json!({ "env": {} }),
        AppType::Codex => json!({ "auth": {}, "config": "" }),
        AppType::Gemini => json!({ "env": {}, "config": {} }),
        AppType::GrokBuild => json!({ "config": "" }),
        _ => json!({}),
    }
}

fn missing_live_settings(error: &AppError) -> bool {
    matches!(
        error,
        AppError::Localized {
            key: "claude.live.missing"
                | "codex.live.missing"
                | "gemini.env.missing"
                | "grokbuild.config.missing",
            ..
        }
    )
}

/// The model the user picked for a client, if any.
///
/// There is deliberately no compiled-in fallback: Connect cannot know which
/// models an account may use, and naming one it cannot reach produces a client
/// that fails on its first request.
pub fn selected_model(db: &Database, app: &AppType) -> Option<String> {
    db.get_setting(&model_setting_key(app))
        .ok()
        .flatten()
        .filter(|value| !value.trim().is_empty())
}

pub fn set_selected_model(db: &Database, app: &AppType, model: &str) -> Result<(), AppError> {
    db.set_setting(&model_setting_key(app), model)
}

fn toml_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| format!("\"{value}\""))
}

fn codex_style_config(model: &str, base_url: &str) -> String {
    format!(
        "model_provider = \"boxai\"\n\
         model = {model}\n\
         model_reasoning_effort = \"high\"\n\
         disable_response_storage = true\n\
         \n\
         [model_providers.boxai]\n\
         name = {name}\n\
         base_url = {base_url}\n\
         wire_api = \"responses\"\n\
         requires_openai_auth = true",
        model = toml_string(model),
        name = toml_string(PROVIDER_NAME),
        base_url = toml_string(&format!("{base_url}/v1")),
    )
}

fn safe_profile_id(model: &str) -> String {
    let slug = model
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let hash = model
        .as_bytes()
        .iter()
        .fold(0xcbf29ce484222325u64, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
        });
    format!(
        "boxai-{}-{hash:016x}",
        if slug.is_empty() { "model" } else { &slug }
    )
}

fn grok_config(selected: &str, secret: &str, base_url: &str, models: &[String]) -> String {
    let catalog = chat_model_catalog(selected, models);
    let profiles: Vec<_> = catalog
        .iter()
        .map(|model| (safe_profile_id(model), model))
        .collect();
    let default_profile = profiles
        .iter()
        .find(|(_, model)| model.as_str() == selected)
        .map(|(profile, _)| profile.as_str())
        .unwrap_or("boxai-model-0");
    let mut output = format!("[models]\ndefault = {}\n", toml_string(default_profile));
    for (profile, model) in profiles {
        output.push_str(&format!(
            "\n[model.{}]\nname = {}\nmodel = {}\nbase_url = {}\napi_key = {}\napi_backend = \"responses\"\ncontext_window = 500000\n",
            toml_string(&profile),
            toml_string(model),
            toml_string(model),
            toml_string(base_url),
            toml_string(secret),
        ));
    }
    output
}

/// Build the multi-model catalog clients that accept a list can switch between.
///
/// `selected` is always included even if somehow missing from `chat_models`, so
/// a just-picked model is never dropped from the live file between refreshes.
fn chat_model_catalog(selected: &str, chat_models: &[String]) -> Vec<String> {
    let mut out = Vec::with_capacity(chat_models.len() + 1);
    if !selected.trim().is_empty() {
        out.push(selected.to_string());
    }
    for model in chat_models {
        if !model.trim().is_empty() && !out.iter().any(|m| m == model) {
            out.push(model.clone());
        }
    }
    if out.is_empty() && !selected.trim().is_empty() {
        out.push(selected.to_string());
    }
    out
}

fn opencode_models_object(selected: &str, chat_models: &[String]) -> Value {
    let mut map = serde_json::Map::new();
    for model in chat_model_catalog(selected, chat_models) {
        map.insert(model.clone(), json!({ "name": model }));
    }
    Value::Object(map)
}

fn listed_models(selected: &str, chat_models: &[String]) -> Value {
    Value::Array(
        chat_model_catalog(selected, chat_models)
            .into_iter()
            .map(|model| json!({ "id": model, "name": model }))
            .collect(),
    )
}

fn codex_model_catalog(selected: &str, chat_models: &[String]) -> Value {
    json!({
        "models": chat_model_catalog(selected, chat_models)
            .into_iter()
            .map(|model| json!({ "model": model }))
            .collect::<Vec<_>>(),
    })
}

/// The settings payload upstream writes into a client's live config when this
/// provider is activated. Shapes mirror `src/config/*ProviderPresets.ts`.
///
/// `chat_models` is the full account catalog: clients that can hold more than
/// one model (OpenCode / OpenClaw / Hermes / Codex catalog) get every entry so
/// the agent can switch without another Connect round-trip. Clients that only
/// take a single default (`model` / env) still get `selected` as that default.
pub fn settings_config(app: &AppType, secret: &str, model: &str, chat_models: &[String]) -> Value {
    // Claude Code appends `/v1/messages` itself, so it gets the bare origin;
    // the OpenAI-compatible clients get the `/v1` form the gateway reported.
    let base = super::gateway_auth::relay_origin_url();
    let v1 = super::gateway_auth::relay_v1_url();
    match app {
        AppType::Claude => json!({
            "env": {
                "ANTHROPIC_BASE_URL": base,
                "ANTHROPIC_AUTH_TOKEN": secret,
                "ANTHROPIC_MODEL": model,
            }
        }),
        AppType::Codex => json!({
            "auth": { "OPENAI_API_KEY": secret },
            "config": codex_style_config(model, &base),
            // Upstream projects this into ~/.codex/cc-switch-model-catalog.json
            // and points config.toml at it, so Codex can list every chat model.
            "modelCatalog": codex_model_catalog(model, chat_models),
        }),
        AppType::GrokBuild => json!({
            "config": grok_config(model, secret, &v1, chat_models),
        }),
        AppType::Gemini => json!({
            "env": {
                "GOOGLE_GEMINI_BASE_URL": base,
                "GEMINI_API_KEY": secret,
                "GEMINI_MODEL": model,
            },
            "config": {}
        }),
        AppType::OpenCode => json!({
            "npm": "@ai-sdk/openai-compatible",
            "name": PROVIDER_NAME,
            "options": { "baseURL": v1, "apiKey": secret },
            "models": opencode_models_object(model, chat_models),
        }),
        // Deserialized into `OpenClawProviderConfig`, which is camelCase.
        AppType::OpenClaw => json!({
            "baseUrl": v1,
            "apiKey": secret,
            "api": "openai-completions",
            "models": listed_models(model, chat_models),
        }),
        // Written into `custom_providers:`; upstream normalizes camelCase to
        // snake_case, but writing the YAML shape directly keeps the stored
        // value and the live file identical. `api_mode` must be set: the BoxAI
        // relay speaks OpenAI chat completions under /v1.
        AppType::Hermes => json!({
            "name": provider_id(app),
            "base_url": v1,
            "api_key": secret,
            "api_mode": "chat_completions",
            "models": listed_models(model, chat_models),
        }),
        // Detection only; never seeded. See SUPPORTED_APPS.
        AppType::ClaudeDesktop => json!({}),
    }
}

fn next_sort_index(db: &Database, app_type: &str) -> usize {
    db.get_all_providers(app_type)
        .map(|providers| providers.len())
        .unwrap_or(0)
}

/// Create or refresh the BoxAI provider for one client.
///
/// `save_provider` is an UPSERT that preserves `is_current`, so refreshing a
/// rotated secret never silently deactivates the user's selection.
pub fn upsert_for(
    db: &Database,
    app: &AppType,
    secret: &str,
    model: &str,
    chat_models: &[String],
) -> Result<bool, AppError> {
    let app_type = app.as_str();
    let id = provider_id(app);
    let desired = settings_config(app, secret, model, chat_models);

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
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(default)]
    pub recommended_model: String,
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
    pub default_model: Option<String>,
    pub image_models: Vec<String>,
    pub video_models: Vec<String>,
    pub default_image_model: Option<String>,
    pub default_video_model: Option<String>,
    /// Absolute URL of the BoxAI media MCP endpoint (Streamable HTTP).
    pub mcp_endpoint: Option<String>,
    pub account: Option<super::gateway_auth::Account>,
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
    Ok(Provisioning {
        revision: data["revision"].as_str().unwrap_or_default().to_owned(),
        refresh_after_seconds: data["refresh_after_seconds"].as_u64().unwrap_or(60).max(1),
        agents: serde_json::from_value(data["agents"].clone()).unwrap_or_default(),
        agents_present: data.get("agents").is_some(),
        chat_models: string_list(&data["chat_models"]),
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

/// Create the BoxAI provider for every supported client, using the model
/// catalog BoxAI reports for this account.
///
/// Does nothing while signed out, and removes any existing entries: an account
/// that is not connected must not leave behind a provider that authorizes
/// nothing.
pub fn reconcile(state: &crate::store::AppState, provisioning: &Provisioning) -> SyncOutcome {
    let db = &state.db;
    if !super::gateway_auth::is_connected() {
        if let Err(error) = withdraw_all(state) {
            log::warn!("Could not withdraw signed-out BoxAI providers: {error}");
        }
        return SyncOutcome {
            providers_changed: 0,
            mcp_endpoint: None,
            changed_agents: Vec::new(),
        };
    }
    let secret = match super::gateway_auth::api_key() {
        Ok(secret) => secret,
        Err(error) => {
            log::warn!("BoxAI provider seed skipped: {error}");
            return SyncOutcome {
                providers_changed: 0,
                mcp_endpoint: None,
                changed_agents: Vec::new(),
            };
        }
    };
    // The same call that answers "which models" also answers "who is this",
    // so the account dialog can render an identity without its own request.
    super::gateway_auth::remember_account(provisioning.account.clone());
    let mcp_endpoint = provisioning.mcp_endpoint.clone();
    let mut changed = 0;
    let mut changed_agents = Vec::new();
    for app in SUPPORTED_APPS {
        let policy = provisioning
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
        let catalog = &policy.models;
        if !policy.enabled {
            let locally_enabled = db
                .get_setting(&enabled_setting_key(&app))
                .ok()
                .flatten()
                .is_some_and(|value| value == "true");
            let existed = db
                .get_provider_by_id(&provider_id(&app), app.as_str())
                .ok()
                .flatten()
                .is_some();
            // Keep an applied template until Reset can remove it from additive
            // live configs or restore the previous exclusive provider. Deleting
            // the DB row first would orphan the live BoxAI entry.
            if existed || locally_enabled {
                match withdraw_and_remove(state, &app) {
                    Ok(()) => changed_agents.push(app.as_str().to_owned()),
                    Err(error) => log::warn!(
                        "✗ Failed to withdraw disabled BoxAI agent {}: {error}",
                        app.as_str()
                    ),
                }
            }
            continue;
        }
        let model = policy
            .locked_model
            .clone()
            .or_else(|| selected_model(db, &app).filter(|model| catalog.contains(model)));
        let Some(model) = model else {
            log::warn!(
                "BoxAI agent {} is unconfigured; no model was selected",
                app.as_str()
            );
            continue;
        };
        let _ = db.set_setting(&revision_setting_key(&app), &provisioning.revision);
        let _ = db.set_setting(&synced_setting_key(&app), &chrono::Utc::now().to_rfc3339());
        let reconciled = match upsert_for(db, &app, &secret, &model, catalog) {
            Ok(true) => {
                changed += 1;
                changed_agents.push(app.as_str().to_owned());
                log::info!("✓ Reconciled BoxAI provider for {}", app.as_str());
                true
            }
            Ok(false) => true,
            Err(error) => {
                log::warn!(
                    "✗ Failed to seed BoxAI provider for {}: {error}",
                    app.as_str()
                );
                false
            }
        };
        let _ = reconciled;
    }
    SyncOutcome {
        providers_changed: changed,
        mcp_endpoint,
        changed_agents,
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientModel {
    app: String,
    selected: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProfiles {
    available: Vec<String>,
    clients: Vec<ClientModel>,
}

/// What the account may run, and what each client is currently set to.
///
/// One call rather than one per client: the catalog is account-scoped, so
/// asking the Gateway once per client would repeat the same answer.
#[tauri::command]
pub async fn boxai_model_profiles(
    state: tauri::State<'_, crate::store::AppState>,
) -> Result<ModelProfiles, String> {
    let provisioning = super::policy_sync::current(&state.db)?;
    let clients = SUPPORTED_APPS
        .iter()
        .map(|app| ClientModel {
            app: app.as_str().to_string(),
            selected: selected_model(&state.db, app),
        })
        .collect();
    Ok(ModelProfiles {
        available: provisioning.chat_models,
        clients,
    })
}

/// Pick a model and immediately refresh the DB-only provider template. This
/// deliberately does not switch providers or write an external live config.
#[tauri::command]
pub async fn boxai_model_select(
    state: tauri::State<'_, crate::store::AppState>,
    app: AppType,
    model: String,
) -> Result<(), String> {
    let _transition = super::policy_sync::lock_account_transition().await;
    if !SUPPORTED_APPS.contains(&app) {
        return Err(format!(
            "{} is not a client BoxAI Connect manages",
            app.as_str()
        ));
    }
    // Validate against the Gateway rather than trusting the renderer: a model
    // this account cannot use would be written into a real client config file.
    let provisioning = super::policy_sync::current(&state.db)?;
    let policy = policy_for(&provisioning, &app);
    if !policy.enabled || policy.locked_model.is_some() || !policy.models.contains(&model) {
        return Err(format!("BoxAI does not offer {model} to this account"));
    }
    set_selected_model(&state.db, &app, &model).map_err(|e| e.to_string())?;
    state
        .db
        .set_setting(&revision_setting_key(&app), &provisioning.revision)
        .map_err(|e| e.to_string())?;
    let secret = super::gateway_auth::api_key()?;
    upsert_for(&state.db, &app, &secret, &model, &policy.models).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentState {
    app: String,
    enabled: bool,
    policy_enabled: bool,
    configured: bool,
    pending_changes: bool,
    status: String,
    selected_model: Option<String>,
    policy_revision: String,
    last_synced: Option<String>,
    models: Vec<String>,
    recommended_model: Option<String>,
    locked_model: Option<String>,
}

fn policy_for(provisioning: &Provisioning, app: &AppType) -> AgentProvisioning {
    provisioning
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
        })
}

fn effective_fingerprint(selected: Option<&str>, policy: &AgentProvisioning) -> String {
    let payload = serde_json::to_vec(&json!({
        "selected": selected,
        "models": policy.models,
        "lockedModel": policy.locked_model,
    }))
    .expect("serializing BoxAI effective policy cannot fail");
    format!("{:x}", Sha256::digest(payload))
}

fn agent_state(db: &Database, app: &AppType) -> Result<AgentState, String> {
    let provisioning = super::policy_sync::current(db)?;
    let policy = policy_for(&provisioning, app);
    let models = policy.models.clone();
    let selected = policy
        .locked_model
        .clone()
        .or_else(|| selected_model(db, app).filter(|m| models.contains(m)));
    let locally_enabled = db
        .get_setting(&enabled_setting_key(app))
        .ok()
        .flatten()
        .is_some_and(|v| v == "true");
    let configured = selected.is_some();
    let enabled =
        policy.enabled && locally_enabled && configured && super::gateway_auth::is_connected();
    let applied_model = db
        .get_setting(&applied_model_setting_key(app))
        .ok()
        .flatten()
        .filter(|value| !value.is_empty());
    let applied_fingerprint = db
        .get_setting(&applied_fingerprint_setting_key(app))
        .ok()
        .flatten()
        .filter(|value| !value.is_empty());
    let fingerprint = effective_fingerprint(selected.as_deref(), &policy);
    let pending_changes = enabled
        && (selected != applied_model || applied_fingerprint.as_deref() != Some(&fingerprint));
    Ok(AgentState {
        app: app.as_str().to_owned(),
        enabled,
        policy_enabled: policy.enabled,
        configured,
        pending_changes,
        status: if !policy.enabled {
            "policyDisabled"
        } else if !configured {
            "unconfigured"
        } else if enabled {
            "enabled"
        } else {
            "disabled"
        }
        .to_owned(),
        selected_model: selected,
        policy_revision: provisioning.revision,
        last_synced: db.get_setting(&synced_setting_key(app)).ok().flatten(),
        models,
        recommended_model: (!policy.recommended_model.is_empty())
            .then_some(policy.recommended_model),
        locked_model: policy.locked_model,
    })
}

#[tauri::command]
pub async fn boxai_agent_get(
    state: tauri::State<'_, crate::store::AppState>,
    app: AppType,
) -> Result<AgentState, String> {
    agent_state(&state.db, &app)
}

#[tauri::command]
pub async fn boxai_agent_enable(
    state: tauri::State<'_, crate::store::AppState>,
    app: AppType,
    enabled: bool,
) -> Result<AgentState, String> {
    let _transition = super::policy_sync::lock_account_transition().await;
    if !enabled {
        withdraw_and_remove(&state, &app)?;
        return agent_state(&state.db, &app);
    }
    let provisioning = super::policy_sync::current(&state.db)?;
    let policy = policy_for(&provisioning, &app);
    let model = policy
        .locked_model
        .clone()
        .or_else(|| selected_model(&state.db, &app).filter(|model| policy.models.contains(model)));
    if enabled {
        if !super::gateway_auth::is_connected() {
            return Err("Sign in to BoxAI before enabling this agent".into());
        }
        if !policy.enabled {
            return Err("This agent is disabled by BoxAI policy".into());
        }
        let model = model.ok_or_else(|| "Select a model before enabling this agent".to_string())?;
        let secret = super::gateway_auth::api_key()?;
        upsert_for(&state.db, &app, &secret, &model, &policy.models).map_err(|e| e.to_string())?;

        let id = provider_id(&app);
        // Capture recovery before any live write, for both exclusive and
        // additive formats. Never overwrite the first pre-BoxAI state.
        let has_snapshot = state
            .db
            .get_setting(&live_snapshot_setting_key(&app))
            .map_err(|e| e.to_string())?
            .is_some_and(|value| !value.is_empty());
        let has_previous = state
            .db
            .get_setting(&previous_provider_setting_key(&app))
            .map_err(|e| e.to_string())?
            .is_some_and(|value| !value.is_empty());
        let current = crate::services::provider::ProviderService::current(&state, app.clone())
            .unwrap_or_default();
        if !app.is_additive_mode() && !has_previous && !current.is_empty() && current != id {
            state
                .db
                .set_setting(&previous_provider_setting_key(&app), &current)
                .map_err(|e| e.to_string())?;
        }
        let has_previous = has_previous || (!current.is_empty() && current != id);
        let needs_snapshot = (!app.is_additive_mode() && !has_previous) || app == AppType::Hermes;
        if needs_snapshot && !has_snapshot {
            let snapshot = if app == AppType::Hermes {
                serde_json::to_value(crate::hermes_config::get_model_config()?)
                    .map_err(|e| e.to_string())?
            } else {
                match crate::services::provider::read_live_settings(app.clone()) {
                    Ok(snapshot) => snapshot,
                    Err(error) if missing_live_settings(&error) => {
                        log::info!(
                            "No pre-BoxAI live config for {}; Reset will restore an empty config",
                            app.as_str()
                        );
                        empty_live_settings(&app)
                    }
                    Err(error) => {
                        return Err(format!(
                            "Could not capture the pre-BoxAI configuration: {error}"
                        ));
                    }
                }
            };
            state
                .db
                .set_setting(
                    &live_snapshot_setting_key(&app),
                    &serde_json::to_string(&snapshot).map_err(|e| e.to_string())?,
                )
                .map_err(|e| e.to_string())?;
        }
        // Commit the intended state before touching the live file. If the
        // writer fails, clear the applied markers while retaining the recovery
        // snapshot/provider row so Reset can repair a partial external write.
        let fingerprint = effective_fingerprint(Some(&model), &policy);
        for (key, value) in [
            (enabled_setting_key(&app), "true"),
            (applied_model_setting_key(&app), model.as_str()),
            (
                applied_revision_setting_key(&app),
                provisioning.revision.as_str(),
            ),
            (applied_fingerprint_setting_key(&app), fingerprint.as_str()),
        ] {
            if let Err(error) = state.db.set_setting(&key, value) {
                let _ = clear_setting(&state.db, &enabled_setting_key(&app));
                let _ = clear_setting(&state.db, &applied_model_setting_key(&app));
                let _ = clear_setting(&state.db, &applied_revision_setting_key(&app));
                let _ = clear_setting(&state.db, &applied_fingerprint_setting_key(&app));
                return Err(error.to_string());
            }
        }
        if let Err(error) =
            crate::services::provider::ProviderService::switch(&state, app.clone(), &id)
        {
            let _ = clear_setting(&state.db, &enabled_setting_key(&app));
            let _ = clear_setting(&state.db, &applied_model_setting_key(&app));
            let _ = clear_setting(&state.db, &applied_revision_setting_key(&app));
            let _ = clear_setting(&state.db, &applied_fingerprint_setting_key(&app));
            return Err(error.to_string());
        }
    }
    state
        .db
        .set_setting(
            &enabled_setting_key(&app),
            if enabled { "true" } else { "false" },
        )
        .map_err(|e| e.to_string())?;
    agent_state(&state.db, &app)
}

#[tauri::command]
pub async fn boxai_agent_reset(
    state: tauri::State<'_, crate::store::AppState>,
    app: AppType,
) -> Result<AgentState, String> {
    let _transition = super::policy_sync::lock_account_transition().await;
    withdraw_and_remove(&state, &app)?;
    agent_state(&state.db, &app)
}

/// Withdraw one live BoxAI projection, and only then discard its recovery row.
/// This deliberately touches provider config only, never sessions/history/auth.
pub(crate) fn withdraw_and_remove(
    state: &crate::store::AppState,
    app: &AppType,
) -> Result<(), String> {
    let id = provider_id(&app);
    if app.is_additive_mode() {
        if state
            .db
            .get_provider_by_id(&id, app.as_str())
            .map_err(|e| e.to_string())?
            .is_some()
        {
            crate::services::provider::ProviderService::remove_from_live_config(
                &state,
                app.clone(),
                &id,
            )
            .map_err(|e| e.to_string())?;
        }
        // Removing Hermes' custom provider does not restore the top-level
        // model/default fields changed by activation. Its live snapshot does.
        if *app == AppType::Hermes {
            if let Some(snapshot) = state
                .db
                .get_setting(&live_snapshot_setting_key(app))
                .map_err(|e| e.to_string())?
                .filter(|value| !value.is_empty())
            {
                let model: Option<crate::hermes_config::HermesModelConfig> =
                    serde_json::from_str(&snapshot).map_err(|e| e.to_string())?;
                if let Some(model) = model {
                    crate::hermes_config::set_model_config(&model).map_err(|e| e.to_string())?;
                } else {
                    crate::hermes_config::remove_model_config().map_err(|e| e.to_string())?;
                }
            }
        }
    } else {
        let previous = state
            .db
            .get_setting(&previous_provider_setting_key(&app))
            .map_err(|e| e.to_string())?
            .filter(|value| !value.is_empty());
        let mut restored = false;
        if let Some(previous) = previous {
            if state
                .db
                .get_provider_by_id(&previous, app.as_str())
                .map_err(|e| e.to_string())?
                .is_some()
            {
                crate::services::provider::ProviderService::switch(&state, app.clone(), &previous)
                    .map_err(|e| e.to_string())?;
                restored = true;
            }
        }
        if !restored {
            if let Some(snapshot) = state
                .db
                .get_setting(&live_snapshot_setting_key(&app))
                .map_err(|e| e.to_string())?
                .filter(|value| !value.is_empty())
            {
                let settings = serde_json::from_str(&snapshot).map_err(|e| e.to_string())?;
                let snapshot_provider = Provider::with_id(
                    "boxai-reset-snapshot".to_string(),
                    "Previous configuration".to_string(),
                    settings,
                    None,
                );
                crate::services::provider::write_live_snapshot(&app, &snapshot_provider)
                    .map_err(|e| e.to_string())?;
                restored = true;
            }
        }
        if !restored
            && crate::services::provider::ProviderService::current(state, app.clone())
                .map_err(|e| e.to_string())?
                == id
        {
            return Err(format!(
                "Cannot withdraw BoxAI for {} without a recovery snapshot",
                app.as_str()
            ));
        }
    }
    clear_setting(&state.db, &model_setting_key(&app)).map_err(|e| e.to_string())?;
    clear_setting(&state.db, &enabled_setting_key(&app)).map_err(|e| e.to_string())?;
    clear_setting(&state.db, &revision_setting_key(&app)).map_err(|e| e.to_string())?;
    clear_setting(&state.db, &synced_setting_key(&app)).map_err(|e| e.to_string())?;
    clear_setting(&state.db, &applied_model_setting_key(&app)).map_err(|e| e.to_string())?;
    clear_setting(&state.db, &applied_revision_setting_key(&app)).map_err(|e| e.to_string())?;
    clear_setting(&state.db, &applied_fingerprint_setting_key(&app)).map_err(|e| e.to_string())?;
    clear_setting(&state.db, &previous_provider_setting_key(&app)).map_err(|e| e.to_string())?;
    clear_setting(&state.db, &live_snapshot_setting_key(&app)).map_err(|e| e.to_string())?;
    state
        .db
        .delete_provider(app.as_str(), &provider_id(&app))
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn withdraw_all(state: &crate::store::AppState) -> Result<(), String> {
    let mut failures = Vec::new();
    for app in SUPPORTED_APPS {
        if let Err(error) = withdraw_and_remove(state, &app) {
            failures.push(format!("{}: {error}", app.as_str()));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

#[tauri::command]
pub async fn boxai_agent_refresh(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::store::AppState>,
    app: AppType,
) -> Result<AgentState, String> {
    super::policy_sync::synchronize(&app_handle, &state, true).await?;
    agent_state(&state.db, &app)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Shaped after a real `GET /api/connect/provisioning` response.
    fn provisioning_response() -> Value {
        json!({"success": true, "data": {
            "chat_models": ["deepseek-v4-pro", "gpt-5.6-sol", "kimi-k2.7-code"],
            "default_model": "gpt-5.6-sol",
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

    fn sample_chat_models() -> Vec<String> {
        vec![
            "deepseek-v4-pro".into(),
            "gpt-5.6-sol".into(),
            "kimi-k2.7-code".into(),
        ]
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
    fn effective_fingerprint_tracks_catalog_and_locked_model() {
        let base = AgentProvisioning {
            enabled: true,
            models: vec!["model-a".into(), "model-b".into()],
            ..Default::default()
        };
        let original = effective_fingerprint(Some("model-a"), &base);

        let mut catalog_changed = base.clone();
        catalog_changed.models.push("model-c".into());
        assert_ne!(
            original,
            effective_fingerprint(Some("model-a"), &catalog_changed)
        );

        let mut policy_changed = base.clone();
        policy_changed.locked_model = Some("model-b".into());
        assert_ne!(
            original,
            effective_fingerprint(Some("model-a"), &policy_changed)
        );
    }

    #[test]
    fn every_supported_client_points_at_the_gateway_with_the_user_key() {
        let catalog = sample_chat_models();
        for app in SUPPORTED_APPS {
            let rendered = settings_config(&app, "sk-user", "some-model", &catalog).to_string();
            assert!(
                rendered.contains("you-box.com"),
                "{} must target BoxAI: {rendered}",
                app.as_str()
            );
            assert!(
                rendered.contains("sk-user"),
                "{} must carry the user's account key: {rendered}",
                app.as_str()
            );
            assert!(
                rendered.contains("some-model"),
                "{} must carry the selected model: {rendered}",
                app.as_str()
            );
        }
    }

    /// Claude Code appends `/v1/messages` to ANTHROPIC_BASE_URL. Handing it the
    /// `/v1` form yields `/v1/v1/messages` and every request 404s, while the
    /// OpenAI-compatible clients need exactly the `/v1` form.
    #[test]
    fn claude_gets_the_bare_origin_and_the_openai_clients_get_v1() {
        let catalog = sample_chat_models();
        let claude = settings_config(&AppType::Claude, "sk-user", "m", &catalog);
        assert_eq!(
            claude["env"]["ANTHROPIC_BASE_URL"].as_str(),
            Some("https://you-box.com")
        );

        let opencode = settings_config(&AppType::OpenCode, "sk-user", "m", &catalog);
        assert_eq!(
            opencode["options"]["baseURL"].as_str(),
            Some("https://you-box.com/v1")
        );
        let openclaw = settings_config(&AppType::OpenClaw, "sk-user", "m", &catalog);
        assert_eq!(openclaw["baseUrl"].as_str(), Some("https://you-box.com/v1"));
        let hermes = settings_config(&AppType::Hermes, "sk-user", "m", &catalog);
        assert_eq!(hermes["base_url"].as_str(), Some("https://you-box.com/v1"));
    }

    /// OpenClaw and Hermes each deserialize this payload into their own typed
    /// config before it reaches the user's real file, so the key casing is a
    /// contract, not a style choice.
    #[test]
    fn additive_clients_use_the_key_names_their_own_writers_expect() {
        let catalog = sample_chat_models();
        let openclaw = settings_config(&AppType::OpenClaw, "sk-user", "m", &catalog);
        assert_eq!(openclaw["apiKey"].as_str(), Some("sk-user"));
        // Selected model is first so a just-picked id is never dropped.
        assert_eq!(openclaw["models"][0]["id"].as_str(), Some("m"));
        assert!(openclaw["models"].as_array().unwrap().len() >= catalog.len());

        let hermes = settings_config(&AppType::Hermes, "sk-user", "m", &catalog);
        assert_eq!(hermes["api_key"].as_str(), Some("sk-user"));
        // Without api_mode Hermes cannot tell which wire format to speak.
        assert_eq!(hermes["api_mode"].as_str(), Some("chat_completions"));
        assert_eq!(hermes["models"][0]["id"].as_str(), Some("m"));
    }

    #[test]
    fn multi_model_clients_receive_the_full_chat_catalog() {
        let catalog = sample_chat_models();
        let opencode = settings_config(&AppType::OpenCode, "sk-user", "gpt-5.6-sol", &catalog);
        let models = opencode["models"].as_object().expect("opencode models map");
        for name in &catalog {
            assert!(models.contains_key(name), "missing {name}");
        }

        let codex = settings_config(&AppType::Codex, "sk-user", "gpt-5.6-sol", &catalog);
        let catalog_models = codex["modelCatalog"]["models"]
            .as_array()
            .expect("codex modelCatalog");
        assert_eq!(catalog_models.len(), catalog.len());
        assert_eq!(catalog_models[0]["model"].as_str(), Some("gpt-5.6-sol"));
    }

    #[test]
    fn claude_desktop_renders_nothing_to_project() {
        // It has no chat provider concept: upstream drives it through a profile
        // library and the local proxy instead.
        assert_eq!(
            settings_config(&AppType::ClaudeDesktop, "sk-user", "m", &[]),
            json!({})
        );
        assert!(!SUPPORTED_APPS.contains(&AppType::ClaudeDesktop));
    }

    #[test]
    fn provider_ids_are_namespaced_per_client() {
        assert_eq!(provider_id(&AppType::Claude), "boxai-claude");
        assert_eq!(provider_id(&AppType::OpenCode), "boxai-opencode");
    }

    #[test]
    fn codex_carrier_is_parseable_toml_naming_the_boxai_provider() {
        let config = codex_style_config("gpt-5.5", "https://you-box.com");
        let document: toml_edit::DocumentMut = config.parse().expect("valid TOML");
        assert_eq!(
            document["model_provider"].as_str(),
            Some("boxai"),
            "{config}"
        );
        assert_eq!(document["model"].as_str(), Some("gpt-5.5"));
        assert_eq!(
            document["model_providers"]["boxai"]["base_url"].as_str(),
            Some("https://you-box.com/v1")
        );
    }

    #[test]
    fn grok_carrier_is_native_toml_with_the_complete_catalog() {
        let catalog = vec![
            "gpt/odd model".into(),
            "grok-4".into(),
            "claude-sonnet".into(),
        ];
        let settings = settings_config(&AppType::GrokBuild, "sk-user", "grok-4", &catalog);
        let config = settings["config"].as_str().expect("config TOML");
        crate::grok_config::validate_config_toml(config).expect("valid Grok config");
        let document: toml::Value = config.parse().expect("parse TOML");
        let entries = document["model"].as_table().expect("model profiles");
        assert_eq!(entries.len(), catalog.len());
        for model in catalog {
            assert!(
                entries
                    .values()
                    .any(|entry| entry["model"].as_str() == Some(&model)),
                "missing {model}"
            );
        }
        let default = document["models"]["default"]
            .as_str()
            .expect("default profile");
        assert_eq!(entries[default]["model"].as_str(), Some("grok-4"));
    }
}
