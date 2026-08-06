//! Per-Agent BoxAI configuration commands.
//!
//! Editing happens in the panel; nothing reaches a user's real client file
//! until an explicit action lands here. Each action states what it touches:
//! `apply` writes the Agent's own BoxAI configuration, `set_default` takes over
//! a client's global routing defaults, `disable` withdraws the projection while
//! keeping the user's choices, and `reset` discards them.

use super::agent_config::{AgentConfig, ModelMetaMap};
use super::provider_seed::{policy_for, provider_id, settings_key, upsert_for, AgentProvisioning};
use crate::app_config::AppType;
use crate::error::AppError;
use crate::provider::Provider;
use crate::services::provider::ProviderService;
use crate::store::AppState;
use serde::Serialize;
use serde_json::Value;

/// Where the Agent reads the configuration Connect writes.
fn live_config_path(app: &AppType) -> String {
    let path = match app {
        AppType::Claude => crate::config::get_claude_settings_path(),
        AppType::Codex => crate::codex_config::get_codex_config_path(),
        AppType::Gemini => crate::gemini_config::get_gemini_env_path(),
        AppType::GrokBuild => crate::grok_config::get_grok_config_path(),
        AppType::OpenCode => crate::opencode_config::get_opencode_config_path(),
        AppType::OpenClaw => crate::openclaw_config::get_openclaw_config_path(),
        _ => crate::hermes_config::get_hermes_config_path(),
    };
    path.to_string_lossy().into_owned()
}

/// Whether BoxAI is currently the live configuration for this Agent.
///
/// Read from the client's own state rather than a Connect-side marker: the user
/// can edit these files directly, and a panel that trusted its own bookkeeping
/// would keep claiming an Agent is configured after the entry was deleted.
fn is_projected(state: &AppState, app: &AppType) -> bool {
    let id = provider_id(app);
    if app.is_additive_mode() {
        return crate::services::provider::provider_exists_in_live_config(app, &id)
            .unwrap_or(false);
    }
    ProviderService::current(state, app.clone()).unwrap_or_default() == id
}

/// Whether the client's global routing defaults currently point at BoxAI.
///
/// Only OpenClaw and Hermes have defaults that live outside the provider entry;
/// for every other Agent the projection *is* the default.
fn owns_client_default(app: &AppType) -> bool {
    let id = provider_id(app);
    match app {
        AppType::OpenClaw => crate::openclaw_config::get_default_model()
            .ok()
            .flatten()
            .is_some_and(|model| model.primary.starts_with(&format!("{id}/"))),
        AppType::Hermes => crate::hermes_config::get_model_config()
            .ok()
            .flatten()
            .and_then(|model| model.provider)
            .is_some_and(|provider| provider == id),
        _ => false,
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentState {
    pub app: String,
    /// True when the Agent keeps other providers alongside BoxAI, which is why
    /// its actions read "add to config" rather than "switch to BoxAI".
    pub additive: bool,
    pub policy_enabled: bool,
    pub signed_in: bool,
    pub active: bool,
    pub owns_client_default: bool,
    pub configured: bool,
    /// A saved choice referenced models this account can no longer run.
    pub needs_repair: bool,
    pub status: String,
    pub config: AgentConfig,
    pub applied_config: Option<AgentConfig>,
    pub models: Vec<String>,
    pub model_meta: ModelMetaMap,
    pub recommended_model: Option<String>,
    pub locked_model: Option<String>,
    pub policy_revision: String,
    pub last_synced: Option<String>,
    pub live_config_path: String,
    pub warnings: Vec<String>,
}

fn read_config(state: &AppState, app: &AppType, key: &str) -> Option<AgentConfig> {
    let raw = state
        .db
        .get_setting(key)
        .ok()
        .flatten()
        .filter(|value| !value.trim().is_empty())?;
    match serde_json::from_str::<AgentConfig>(&raw) {
        Ok(config) if config.app() == *app => Some(config),
        Ok(_) => None,
        Err(error) => {
            log::warn!(
                "Discarding unreadable BoxAI configuration for {}: {error}",
                app.as_str()
            );
            None
        }
    }
}

fn write_config(state: &AppState, key: &str, config: &AgentConfig) -> Result<(), String> {
    let encoded = serde_json::to_string(config).map_err(|error| error.to_string())?;
    state
        .db
        .set_setting(key, &encoded)
        .map_err(|error| error.to_string())
}

/// The Agent's saved configuration, recovering a v1 install on first read.
pub(crate) fn stored_config(state: &AppState, app: &AppType) -> Option<AgentConfig> {
    if let Some(config) = read_config(state, app, &settings_key(app, "config")) {
        return Some(config);
    }
    let legacy_model = state
        .db
        .get_setting(&settings_key(app, "legacy_model"))
        .ok()
        .flatten()
        .filter(|value| !value.trim().is_empty());
    let legacy_settings = state
        .db
        .get_provider_by_id(&provider_id(app), app.as_str())
        .ok()
        .flatten()
        .map(|provider| provider.settings_config);
    if legacy_model.is_none() && legacy_settings.is_none() {
        return None;
    }
    let migrated =
        super::agent_config::from_legacy(app, legacy_model.as_deref(), legacy_settings.as_ref());
    // The v1 keys are deliberately left in place: a downgrade should still find
    // the state it wrote, and this migration can be re-run from them.
    if let Err(error) = write_config(state, &settings_key(app, "config"), &migrated) {
        log::warn!(
            "Could not persist the migrated BoxAI configuration for {}: {error}",
            app.as_str()
        );
    }
    Some(migrated)
}

pub(crate) fn agent_state(state: &AppState, app: &AppType) -> Result<AgentState, String> {
    let provisioning = super::policy_sync::current(&state.db)?;
    let policy = policy_for(&provisioning, app);
    let signed_in = super::gateway_auth::is_connected();
    let mut warnings = Vec::new();

    let mut config = stored_config(state, app).unwrap_or_else(|| AgentConfig::empty(app));
    let mut needs_repair = false;
    if policy.enabled {
        // Re-seeding replaces the models the account withdrew, but it does not
        // undo the withdrawal: staying quiet here is how a user's whole model
        // choice disappears between two launches with nothing on screen to
        // explain it.
        needs_repair = config.sanitize(&policy.models);
        if config.referenced_models().is_empty() {
            config = AgentConfig::seed(app, &policy);
        }
        if needs_repair {
            warnings.push("modelsWithdrawn".to_owned());
        }
        // Gemini's catalog is narrowed to what its CLI will honour, so an
        // account can end up with an empty picker and no visible reason.
        if *app == AppType::Gemini && policy.models.is_empty() {
            warnings.push("geminiNoCompatibleModels".to_owned());
        }
    }
    let applied_config = read_config(state, app, &settings_key(app, "applied"));
    let active = signed_in && policy.enabled && is_projected(state, app);

    let status = if !policy.enabled {
        "policyDisabled"
    } else if !signed_in {
        "signedOut"
    } else if active {
        "active"
    } else if config.is_complete() {
        "inactive"
    } else {
        "unconfigured"
    };
    Ok(AgentState {
        app: app.as_str().to_owned(),
        additive: app.is_additive_mode(),
        policy_enabled: policy.enabled,
        signed_in,
        active,
        owns_client_default: active && owns_client_default(app),
        configured: config.is_complete(),
        needs_repair,
        status: status.to_owned(),
        config,
        applied_config: if active { applied_config } else { None },
        models: policy.models,
        model_meta: provisioning.model_meta,
        recommended_model: Some(policy.recommended_model).filter(|model| !model.is_empty()),
        locked_model: policy.locked_model.filter(|model| !model.is_empty()),
        policy_revision: provisioning.revision,
        last_synced: state
            .db
            .get_setting(&settings_key(app, "synced"))
            .ok()
            .flatten()
            .filter(|value| !value.is_empty()),
        live_config_path: live_config_path(app),
        warnings,
    })
}

fn require_supported(app: &AppType) -> Result<(), String> {
    if super::provider_seed::SUPPORTED_APPS.contains(app) {
        return Ok(());
    }
    Err(format!(
        "{} is not a client BoxAI Connect configures",
        app.as_str()
    ))
}

fn checked_policy(state: &AppState, app: &AppType) -> Result<AgentProvisioning, String> {
    require_supported(app)?;
    if !super::gateway_auth::is_connected() {
        return Err("Sign in to BoxAI before configuring this agent".into());
    }
    let policy = policy_for(&super::policy_sync::current(&state.db)?, app);
    if !policy.enabled {
        return Err("This agent is disabled by BoxAI policy".into());
    }
    Ok(policy)
}

#[tauri::command]
pub async fn boxai_agent_get(
    state: tauri::State<'_, crate::store::AppState>,
    app: AppType,
) -> Result<AgentState, String> {
    agent_state(&state, &app)
}

#[tauri::command]
pub async fn boxai_agent_refresh(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::store::AppState>,
    app: AppType,
) -> Result<AgentState, String> {
    super::policy_sync::synchronize(&app_handle, &state, true).await?;
    agent_state(&state, &app)
}

/// Write the Agent's BoxAI configuration into its real config file.
///
/// For Claude / Codex / Gemini / Grok Build this replaces the active provider,
/// so the previous one is captured first. For OpenCode / OpenClaw / Hermes it
/// only adds the BoxAI provider entry: their global routing defaults belong to
/// the user until `boxai_agent_set_default` is called explicitly.
#[tauri::command]
pub async fn boxai_agent_apply(
    state: tauri::State<'_, crate::store::AppState>,
    app: AppType,
    config: AgentConfig,
) -> Result<AgentState, String> {
    let _transition = super::policy_sync::lock_account_transition().await;
    apply_config(&state, &app, config)?;
    agent_state(&state, &app)
}

fn apply_config(state: &AppState, app: &AppType, config: AgentConfig) -> Result<(), String> {
    let policy = checked_policy(state, app)?;
    if config.app() != *app {
        return Err(format!(
            "This configuration does not belong to {}",
            app.as_str()
        ));
    }
    config.validate(&policy)?;
    let provisioning = super::policy_sync::current(&state.db)?;
    let secret = super::gateway_auth::api_key()?;
    upsert_for(&state.db, app, &secret, &config, &provisioning.model_meta)
        .map_err(|error| error.to_string())?;

    capture_recovery_state(state, app)?;
    write_config(state, &settings_key(app, "config"), &config)?;
    state
        .db
        .set_setting(&settings_key(app, "revision"), &provisioning.revision)
        .map_err(|error| error.to_string())?;
    state
        .db
        .set_setting(
            &settings_key(app, "synced"),
            &chrono::Utc::now().to_rfc3339(),
        )
        .map_err(|error| error.to_string())?;

    let id = provider_id(app);
    let write_result = if app.is_additive_mode() {
        // Not ProviderService::switch: for Hermes that would also seize the
        // top-level `model:` section, which is a separate user decision here.
        let provider = state
            .db
            .get_provider_by_id(&id, app.as_str())
            .map_err(|error| error.to_string())?
            .ok_or_else(|| format!("BoxAI provider for {} is missing", app.as_str()))?;
        crate::services::provider::write_live_with_common_config(state.db.as_ref(), app, &provider)
            .and_then(|()| mark_live_managed(state, app, &id))
    } else {
        ProviderService::switch(state, app.clone(), &id).map(|_| ())
    };
    if let Err(error) = write_result {
        // The recovery snapshot and previous-provider row stay: a partial
        // external write still has to be repairable by Reset.
        let _ = state.db.set_setting(&settings_key(app, "applied"), "");
        return Err(error.to_string());
    }
    write_config(state, &settings_key(app, "applied"), &config)
}

/// Additive apps track whether a provider reached the live file, so future
/// full syncs keep including it.
fn mark_live_managed(state: &AppState, app: &AppType, id: &str) -> Result<(), AppError> {
    let Some(mut provider) = state.db.get_provider_by_id(id, app.as_str())? else {
        return Ok(());
    };
    let managed = provider
        .meta
        .as_ref()
        .and_then(|meta| meta.live_config_managed);
    if managed == Some(true) {
        return Ok(());
    }
    provider
        .meta
        .get_or_insert_with(Default::default)
        .live_config_managed = Some(true);
    state.db.save_provider(app.as_str(), &provider)
}

/// Remember what the client looked like before BoxAI, once.
///
/// Never overwritten: the first capture is the only one that describes a
/// pre-BoxAI state, and re-capturing on every apply would record BoxAI's own
/// output as the thing to restore.
fn capture_recovery_state(state: &AppState, app: &AppType) -> Result<(), String> {
    if app.is_additive_mode() {
        return Ok(());
    }
    let id = provider_id(app);
    let has_snapshot = state
        .db
        .get_setting(&settings_key(app, "live_snapshot"))
        .map_err(|error| error.to_string())?
        .is_some_and(|value| !value.is_empty());
    let has_previous = state
        .db
        .get_setting(&settings_key(app, "previous_provider"))
        .map_err(|error| error.to_string())?
        .is_some_and(|value| !value.is_empty());
    let current = ProviderService::current(state, app.clone()).unwrap_or_default();
    // v0.1.1 could leave an exclusive BoxAI provider active without the
    // recovery markers introduced later. Its live config is BoxAI's own output,
    // not a recoverable pre-BoxAI snapshot.
    let legacy_active = current == id && !has_previous && !has_snapshot;
    if !has_previous && !current.is_empty() && current != id {
        state
            .db
            .set_setting(&settings_key(app, "previous_provider"), &current)
            .map_err(|error| error.to_string())?;
        return Ok(());
    }
    if has_previous || has_snapshot || legacy_active {
        return Ok(());
    }
    let snapshot = match crate::services::provider::read_live_settings(app.clone()) {
        Ok(snapshot) => snapshot,
        Err(error) if missing_live_settings(&error) => {
            log::info!(
                "No pre-BoxAI live config for {}; Reset will restore an empty config",
                app.as_str()
            );
            empty_live_settings(app)
        }
        Err(error) => {
            return Err(format!(
                "Could not capture the pre-BoxAI configuration: {error}"
            ))
        }
    };
    state
        .db
        .set_setting(
            &settings_key(app, "live_snapshot"),
            &serde_json::to_string(&snapshot).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())
}

/// Point OpenClaw's or Hermes' global routing defaults at BoxAI.
///
/// Separate from `apply` on purpose: registering models and changing which
/// model the client starts on are different decisions, and a user who added
/// BoxAI alongside an existing setup should not lose their routing to it.
#[tauri::command]
pub async fn boxai_agent_set_default(
    state: tauri::State<'_, crate::store::AppState>,
    app: AppType,
    config: AgentConfig,
) -> Result<AgentState, String> {
    let _transition = super::policy_sync::lock_account_transition().await;
    set_default_config(&state, &app, config)?;
    agent_state(&state, &app)
}

fn set_default_config(state: &AppState, app: &AppType, config: AgentConfig) -> Result<(), String> {
    if !matches!(app, AppType::OpenClaw | AppType::Hermes) {
        return Err(format!(
            "{} has no separate default model to set",
            app.as_str()
        ));
    }
    apply_config(state, app, config.clone())?;
    capture_default_snapshot(state, app)?;
    let id = provider_id(app);
    match (app, &config) {
        (AppType::OpenClaw, AgentConfig::OpenClaw(openclaw)) => {
            let primary = openclaw
                .primary
                .clone()
                .ok_or_else(|| "Choose a primary model first".to_string())?;
            let desired = crate::openclaw_config::OpenClawDefaultModel {
                primary: format!("{id}/{primary}"),
                fallbacks: openclaw
                    .fallbacks
                    .iter()
                    .map(|model| format!("{id}/{model}"))
                    .collect(),
                extra: crate::openclaw_config::get_default_model()
                    .ok()
                    .flatten()
                    .map(|model| model.extra)
                    .unwrap_or_default(),
            };
            crate::openclaw_config::set_default_model(&desired).map_err(|e| e.to_string())?;
            remember_applied_default(state, app, &desired)?;
        }
        (AppType::Hermes, AgentConfig::Hermes(hermes)) => {
            let default = hermes
                .default_model
                .clone()
                .ok_or_else(|| "Choose a default model first".to_string())?;
            let current = crate::hermes_config::get_model_config()
                .map_err(|e| e.to_string())?
                .unwrap_or_default();
            let desired = crate::hermes_config::HermesModelConfig {
                default: Some(default),
                provider: Some(id),
                ..current
            };
            crate::hermes_config::set_model_config(&desired).map_err(|e| e.to_string())?;
            remember_applied_default(state, app, &desired)?;
        }
        _ => return Err("This configuration does not belong to this agent".into()),
    }
    Ok(())
}

/// Hand the client's global routing defaults back.
///
/// The previous value is only restored when the client still holds exactly
/// what Connect wrote. A user who re-pointed those defaults elsewhere keeps
/// their own choice, and hears about it instead of losing it silently.
#[tauri::command]
pub async fn boxai_agent_clear_default(
    state: tauri::State<'_, crate::store::AppState>,
    app: AppType,
) -> Result<AgentState, String> {
    let _transition = super::policy_sync::lock_account_transition().await;
    let warning = restore_client_default(&state, &app)?;
    let mut result = agent_state(&state, &app)?;
    result.warnings.extend(warning);
    Ok(result)
}

fn capture_default_snapshot(state: &AppState, app: &AppType) -> Result<(), String> {
    let key = settings_key(app, "default_snapshot");
    if state
        .db
        .get_setting(&key)
        .map_err(|error| error.to_string())?
        .is_some_and(|value| !value.is_empty())
    {
        return Ok(());
    }
    let snapshot = match app {
        AppType::OpenClaw => serde_json::to_value(
            crate::openclaw_config::get_default_model().map_err(|e| e.to_string())?,
        ),
        _ => serde_json::to_value(
            crate::hermes_config::get_model_config().map_err(|e| e.to_string())?,
        ),
    }
    .map_err(|error| error.to_string())?;
    state
        .db
        .set_setting(&key, &snapshot.to_string())
        .map_err(|error| error.to_string())
}

fn remember_applied_default<T: Serialize>(
    state: &AppState,
    app: &AppType,
    applied: &T,
) -> Result<(), String> {
    let encoded = serde_json::to_string(applied).map_err(|error| error.to_string())?;
    state
        .db
        .set_setting(&settings_key(app, "applied_default"), &encoded)
        .map_err(|error| error.to_string())
}

/// Returns a warning key when the client's default was left alone because the
/// user had changed it after Connect wrote it.
fn restore_client_default(state: &AppState, app: &AppType) -> Result<Option<String>, String> {
    if !matches!(app, AppType::OpenClaw | AppType::Hermes) {
        return Ok(None);
    }
    let snapshot = state
        .db
        .get_setting(&settings_key(app, "default_snapshot"))
        .map_err(|error| error.to_string())?
        .filter(|value| !value.is_empty());
    let Some(snapshot) = snapshot else {
        return Ok(None);
    };
    let applied = state
        .db
        .get_setting(&settings_key(app, "applied_default"))
        .map_err(|error| error.to_string())?
        .filter(|value| !value.is_empty())
        .and_then(|value| serde_json::from_str::<Value>(&value).ok());
    let current = match app {
        AppType::OpenClaw => serde_json::to_value(
            crate::openclaw_config::get_default_model().map_err(|e| e.to_string())?,
        ),
        _ => serde_json::to_value(
            crate::hermes_config::get_model_config().map_err(|e| e.to_string())?,
        ),
    }
    .map_err(|error| error.to_string())?;
    let clear = |state: &AppState| -> Result<(), String> {
        for key in ["default_snapshot", "applied_default"] {
            state
                .db
                .set_setting(&settings_key(app, key), "")
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    };
    if applied.as_ref() != Some(&current) {
        clear(state)?;
        return Ok(Some("clientDefaultKept".to_owned()));
    }
    let snapshot: Value = serde_json::from_str(&snapshot).map_err(|error| error.to_string())?;
    match app {
        AppType::OpenClaw => {
            if snapshot.is_null() {
                // OpenClaw has no "unset the default" writer; leaving BoxAI's
                // own entry behind would keep routing at a provider that is
                // about to be removed, so fall back to an empty primary.
                crate::openclaw_config::set_default_model(
                    &crate::openclaw_config::OpenClawDefaultModel {
                        primary: String::new(),
                        fallbacks: Vec::new(),
                        extra: Default::default(),
                    },
                )
                .map_err(|e| e.to_string())?;
            } else {
                let previous = serde_json::from_value(snapshot).map_err(|e| e.to_string())?;
                crate::openclaw_config::set_default_model(&previous).map_err(|e| e.to_string())?;
            }
        }
        _ => {
            if snapshot.is_null() {
                crate::hermes_config::remove_model_config().map_err(|e| e.to_string())?;
            } else {
                let previous = serde_json::from_value(snapshot).map_err(|e| e.to_string())?;
                crate::hermes_config::set_model_config(&previous).map_err(|e| e.to_string())?;
            }
        }
    }
    clear(state)?;
    Ok(None)
}

/// Stop projecting BoxAI into the client, keeping the user's model choices so
/// re-enabling does not mean configuring the Agent again.
#[tauri::command]
pub async fn boxai_agent_disable(
    state: tauri::State<'_, crate::store::AppState>,
    app: AppType,
) -> Result<AgentState, String> {
    let _transition = super::policy_sync::lock_account_transition().await;
    require_supported(&app)?;
    let warning = withdraw(&state, &app)?;
    state
        .db
        .set_setting(&settings_key(&app, "applied"), "")
        .map_err(|error| error.to_string())?;
    let mut result = agent_state(&state, &app)?;
    result.warnings.extend(warning);
    Ok(result)
}

/// Withdraw the projection and forget everything Connect stored for this Agent.
#[tauri::command]
pub async fn boxai_agent_reset(
    state: tauri::State<'_, crate::store::AppState>,
    app: AppType,
) -> Result<AgentState, String> {
    let _transition = super::policy_sync::lock_account_transition().await;
    withdraw_and_forget(&state, &app, false)?;
    agent_state(&state, &app)
}

/// Undo the live projection only. Recovery rows survive so a later Reset can
/// still repair a config an external edit left half-BoxAI.
fn withdraw(state: &AppState, app: &AppType) -> Result<Option<String>, String> {
    let id = provider_id(app);
    let mut warning = restore_client_default(state, app)?;
    if app.is_additive_mode() {
        if state
            .db
            .get_provider_by_id(&id, app.as_str())
            .map_err(|error| error.to_string())?
            .is_some()
        {
            ProviderService::remove_from_live_config(state, app.clone(), &id)
                .map_err(|error| error.to_string())?;
        }
        return Ok(warning);
    }
    let previous = state
        .db
        .get_setting(&settings_key(app, "previous_provider"))
        .map_err(|error| error.to_string())?
        .filter(|value| !value.is_empty());
    if let Some(previous) = previous {
        if state
            .db
            .get_provider_by_id(&previous, app.as_str())
            .map_err(|error| error.to_string())?
            .is_some()
        {
            ProviderService::switch(state, app.clone(), &previous)
                .map_err(|error| error.to_string())?;
            return Ok(warning);
        }
    }
    if let Some(snapshot) = state
        .db
        .get_setting(&settings_key(app, "live_snapshot"))
        .map_err(|error| error.to_string())?
        .filter(|value| !value.is_empty())
    {
        let settings: Value = serde_json::from_str(&snapshot).map_err(|error| error.to_string())?;
        crate::services::provider::write_live_snapshot(app, &restore_provider(app, settings))
            .map_err(|error| error.to_string())?;
        return Ok(warning);
    }
    if ProviderService::current(state, app.clone()).unwrap_or_default() == id {
        // Legacy v0.1.1 installs kept no recovery metadata. Never leave the
        // live BoxAI key in place merely because the prior config cannot be
        // reconstructed: replace it with the format's safe empty state.
        crate::services::provider::write_live_snapshot(app, &empty_state_provider(app))
            .map_err(|error| error.to_string())?;
        state
            .db
            .set_current_provider(app.as_str(), "")
            .map_err(|error| error.to_string())?;
        warning.get_or_insert_with(|| "restoredEmptyConfig".to_owned());
    }
    Ok(warning)
}

/// Withdraw one live BoxAI projection, and only then discard its stored state.
/// This deliberately touches provider config only, never sessions/history/auth.
///
/// `keep_draft` separates "this account can no longer use BoxAI here" from
/// "forget my configuration". Signing out and losing a policy must not throw
/// away the model choices a user made; only Reset does that. The provider row
/// carrying the relay key is deleted either way.
pub(crate) fn withdraw_and_forget(
    state: &AppState,
    app: &AppType,
    keep_draft: bool,
) -> Result<(), String> {
    withdraw(state, app)?;
    let drafts: &[&str] = if keep_draft {
        &[]
    } else {
        &["config", "legacy_model"]
    };
    for key in [
        "applied",
        "legacy_enabled",
        "legacy_applied_model",
        "legacy_applied_revision",
        "legacy_applied_fingerprint",
        "revision",
        "synced",
        "previous_provider",
        "live_snapshot",
        "default_snapshot",
        "applied_default",
    ]
    .iter()
    .chain(drafts)
    {
        state
            .db
            .set_setting(&settings_key(app, key), "")
            .map_err(|error| error.to_string())?;
    }
    state
        .db
        .delete_provider(app.as_str(), &provider_id(app))
        .map_err(|error| error.to_string())
}

/// Withdraw every projection after sign-out, keeping the model choices the
/// user made so signing back in does not mean configuring each Agent again.
pub(crate) fn withdraw_all(state: &AppState) -> Result<(), String> {
    let mut failures = Vec::new();
    for app in super::provider_seed::SUPPORTED_APPS {
        if let Err(error) = withdraw_and_forget(state, &app, true) {
            failures.push(format!("{}: {error}", app.as_str()));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

/// The provider that carries a captured pre-BoxAI config back to the client.
///
/// Grok Build validates a restored document as a third-party provider, but what
/// was captured may be its own official state — including the empty file of a
/// client that was never configured — which carries no model table at all.
fn restore_provider(app: &AppType, snapshot: Value) -> Provider {
    let mut restored = Provider::with_id(
        "boxai-reset-snapshot".to_string(),
        "Previous configuration".to_string(),
        snapshot,
        None,
    );
    if *app == AppType::GrokBuild
        && restored.settings_config["config"]
            .as_str()
            .is_some_and(crate::grok_config::is_official_live_config)
    {
        restored.category = Some("official".to_string());
    }
    restored
}

/// The provider that writes a client's format back to its empty state.
fn empty_state_provider(app: &AppType) -> Provider {
    let mut empty = Provider::with_id(
        "boxai-reset-empty".to_string(),
        "Empty configuration".to_string(),
        empty_live_settings(app),
        None,
    );
    // Grok Build accepts a TOML snapshot without a model table only for its
    // official state; a third-party provider must carry a complete one.
    if *app == AppType::GrokBuild {
        empty.category = Some("official".to_string());
    }
    empty
}

pub(crate) fn empty_live_settings(app: &AppType) -> Value {
    match app {
        AppType::Claude => serde_json::json!({ "env": {} }),
        AppType::Codex => serde_json::json!({ "auth": {}, "config": "" }),
        AppType::Gemini => serde_json::json!({ "env": {}, "config": {} }),
        AppType::GrokBuild => serde_json::json!({ "config": "" }),
        _ => serde_json::json!({}),
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_grok_snapshot_without_custom_models_is_restored_as_its_official_state() {
        // Verified on Windows: Grok Build had no custom model table before
        // BoxAI, so restoring the captured snapshot as a third-party provider
        // failed validation for a missing [models] and left the BoxAI key live.
        let app = AppType::GrokBuild;
        for snapshot in [
            empty_live_settings(&app),
            json!({"config": "[ui]\nscreen_mode = \"minimal\"\n"}),
        ] {
            assert_eq!(
                restore_provider(&app, snapshot).category.as_deref(),
                Some("official"),
                "Grok accepts a document without a model table only as its official state"
            );
        }

        // A real third-party configuration is handed back exactly as captured.
        let captured = json!({"config": "[models]\ndefault = \"grok-4\"\n"});
        let restored = restore_provider(&app, captured.clone());
        assert_eq!(restored.settings_config, captured);
        assert_eq!(restored.category, None);

        // Every other client's snapshot is restored untouched.
        let captured = json!({"config": "", "auth": {}});
        assert_eq!(
            restore_provider(&AppType::Codex, captured.clone()).settings_config,
            captured
        );
    }
}
