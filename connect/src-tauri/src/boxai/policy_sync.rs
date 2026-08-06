//! Account policy synchronization. This worker only reconciles Connect's DB
//! templates; it never switches a provider or writes an Agent's live config.

use super::provider_seed::{self, Provisioning};
use crate::{database::Database, store::AppState};
use once_cell::sync::Lazy;
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;
use tauri::Emitter;
use tokio::sync::Mutex;

const ETAG_KEY: &str = "boxai_policy_etag";
const CACHE_KEY: &str = "boxai_policy_cache";
const MIN_REFRESH_SECONDS: u64 = 15;
static SYNC_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

pub(crate) async fn lock_account_transition() -> tokio::sync::MutexGuard<'static, ()> {
    SYNC_LOCK.lock().await
}

pub(crate) fn clear_cache(db: &Database) -> Result<(), String> {
    db.set_setting(ETAG_KEY, "").map_err(|e| e.to_string())?;
    db.set_setting(CACHE_KEY, "").map_err(|e| e.to_string())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PolicyUpdated {
    revision: String,
    changed_agents: Vec<String>,
}

pub fn current(db: &Database) -> Result<Provisioning, String> {
    let raw = db
        .get_setting(CACHE_KEY)
        .map_err(|error| error.to_string())?
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "BoxAI policy has not synced yet".to_string())?;
    serde_json::from_str(&raw).map_err(|error| format!("Stored BoxAI policy is invalid: {error}"))
}

async fn fetch(db: &Database) -> Result<Option<(Provisioning, Option<String>)>, String> {
    let token = super::gateway_auth::api_key()?;
    let mut request = super::gateway_auth::http()
        .get(format!(
            "{}/api/connect/provisioning",
            super::gateway_auth::portal_host()
        ))
        .bearer_auth(token);
    if let Some(etag) = db
        .get_setting(ETAG_KEY)
        .ok()
        .flatten()
        .filter(|v| !v.is_empty())
    {
        request = request.header(reqwest::header::IF_NONE_MATCH, etag);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("BoxAI is unavailable: {error}"))?;
    if response.status() == reqwest::StatusCode::NOT_MODIFIED {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(format!(
            "BoxAI provisioning returned HTTP {}",
            response.status().as_u16()
        ));
    }
    let etag = response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("BoxAI returned an unsupported provisioning response: {error}"))?;
    Ok(Some((provider_seed::parse_provisioning(&body)?, etag)))
}

pub async fn synchronize(
    app: &tauri::AppHandle,
    state: &AppState,
    _manual: bool,
) -> Result<u64, String> {
    let _guard = SYNC_LOCK.lock().await;
    if !super::gateway_auth::is_connected() {
        let mut failures = Vec::new();
        if let Err(error) = super::agent_commands::withdraw_all(state) {
            failures.push(format!("provider cleanup: {error}"));
        }
        if let Err(error) = super::mcp_seed::withdraw(state) {
            failures.push(format!("MCP cleanup: {error}"));
        }
        return if failures.is_empty() {
            Ok(60)
        } else {
            Err(failures.join("; "))
        };
    }
    let previous = current(&state.db).ok();
    let fetched = fetch(&state.db).await?;
    let provisioning = match fetched {
        Some((policy, etag)) => {
            state
                .db
                .set_setting(
                    CACHE_KEY,
                    &serde_json::to_string(&policy).map_err(|e| e.to_string())?,
                )
                .map_err(|e| e.to_string())?;
            if let Some(etag) = etag {
                state
                    .db
                    .set_setting(ETAG_KEY, &etag)
                    .map_err(|e| e.to_string())?;
            }
            policy
        }
        None => current(&state.db)?,
    };
    let outcome = provider_seed::reconcile(state, &provisioning);
    super::mcp_seed::sync_with_endpoint(
        state,
        outcome.mcp_endpoint.as_deref(),
        Some(&provisioning),
    )
    .map_err(|e| e.to_string())?;
    let policy_changed = previous.as_ref() != Some(&provisioning);
    if policy_changed || !outcome.changed_agents.is_empty() {
        let changed_agents = if policy_changed {
            provider_seed::SUPPORTED_APPS
                .iter()
                .map(|app| app.as_str().to_owned())
                .collect()
        } else {
            outcome.changed_agents
        };
        let payload = PolicyUpdated {
            revision: provisioning.revision.clone(),
            changed_agents,
        };
        app.emit("boxai-agent-policy-updated", payload)
            .map_err(|e| e.to_string())?;
        let _ = app.emit("boxai-account-surface-updated", ());
    }
    Ok(provisioning.refresh_after_seconds.max(MIN_REFRESH_SECONDS))
}

pub fn start_worker(app: tauri::AppHandle, state: AppState) {
    tauri::async_runtime::spawn(async move {
        let mut delay = 0;
        let mut failures = 0u32;
        loop {
            if delay > 0 {
                tokio::time::sleep(Duration::from_secs(delay)).await;
            }
            match synchronize(&app, &state, false).await {
                Ok(next) => {
                    failures = 0;
                    delay = next;
                }
                Err(error) => {
                    failures = failures.saturating_add(1);
                    delay = (15u64.saturating_mul(1u64 << failures.min(5))).min(300);
                    log::warn!("BoxAI policy sync failed; retaining last policy: {error}");
                }
            }
        }
    });
}
