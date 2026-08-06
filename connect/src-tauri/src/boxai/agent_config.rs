//! Typed per-Agent BoxAI configuration.
//!
//! Every client BoxAI Connect configures has its own idea of what "using
//! BoxAI" means. Claude Code maps roles onto models, Codex keeps a catalog plus
//! one startup default, Gemini takes a single env var, Grok Build builds one
//! profile per model, and OpenCode / OpenClaw / Hermes register a provider
//! catalog that lives alongside whatever the user already had.
//!
//! Collapsing that into a single "selected model" string loses information the
//! clients genuinely need, so each Agent carries its own config shape here and
//! renders it into exactly the payload its live-config writer expects.

use super::provider_seed::{provider_id, AgentProvisioning, PROVIDER_NAME};
use crate::app_config::AppType;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

/// Context window written for a Grok Build profile when BoxAI reports no
/// documented value. Grok refuses a third-party profile without one.
const GROK_FALLBACK_CONTEXT_WINDOW: u64 = 500_000;

/// What BoxAI knows about a model beyond its id.
///
/// Client catalogs are not interchangeable — Grok Build demands a context
/// window, Codex shows a display name and reasoning levels — and Connect cannot
/// derive any of it from a model id without guessing, so it only fills in the
/// fields the server actually documented.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelMeta {
    #[serde(
        default,
        alias = "display_name",
        skip_serializing_if = "Option::is_none"
    )]
    pub display_name: Option<String>,
    #[serde(
        default,
        alias = "context_length",
        skip_serializing_if = "Option::is_none"
    )]
    pub context_length: Option<u64>,
    #[serde(
        default,
        alias = "max_output_tokens",
        skip_serializing_if = "Option::is_none"
    )]
    pub max_output_tokens: Option<u64>,
    #[serde(
        default,
        alias = "input_modalities",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub input_modalities: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capabilities: Vec<String>,
    #[serde(
        default,
        alias = "reasoning_efforts",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub reasoning_efforts: Vec<String>,
}

pub type ModelMetaMap = HashMap<String, ModelMeta>;

/// Claude Code routes each role name to its own model, falling back to
/// `ANTHROPIC_MODEL` when a role has no override. `None` means "follow the
/// fallback", which is what the panel offers as the zero-configuration choice.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ClaudeConfig {
    pub model: Option<String>,
    pub sonnet: Option<String>,
    pub opus: Option<String>,
    pub haiku: Option<String>,
    pub fable: Option<String>,
    pub subagent: Option<String>,
}

/// Codex lists `models` in its `/model` picker and starts on `default_model`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CodexConfig {
    pub models: Vec<String>,
    pub default_model: Option<String>,
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GeminiConfig {
    pub model: Option<String>,
}

/// Grok Build gets one `[model.<profile>]` table per model plus the profile
/// named by `[models].default`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GrokBuildConfig {
    pub models: Vec<String>,
    pub default_model: Option<String>,
}

/// OpenCode's provider entry is a model catalog only. Its top-level default
/// model belongs to the user's own config and Connect never writes it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OpenCodeConfig {
    pub models: Vec<String>,
}

/// OpenClaw keeps its provider catalog (`models.providers.<id>`) separate from
/// its routing defaults (`agents.defaults.model`), so registering models and
/// taking over the default are two different user decisions.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OpenClawConfig {
    pub models: Vec<String>,
    pub primary: Option<String>,
    pub fallbacks: Vec<String>,
}

/// Hermes' `custom_providers` entry carries the catalog; `default_model` is
/// the model inside it Hermes starts on, and is only promoted to the top-level
/// `model:` section when the user asks for it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HermesConfig {
    pub models: Vec<String>,
    pub default_model: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AgentConfig {
    Claude(ClaudeConfig),
    Codex(CodexConfig),
    Gemini(GeminiConfig),
    GrokBuild(GrokBuildConfig),
    OpenCode(OpenCodeConfig),
    OpenClaw(OpenClawConfig),
    Hermes(HermesConfig),
}

fn dedupe(models: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(models.len());
    for model in models {
        let trimmed = model.trim();
        if !trimmed.is_empty() && !out.iter().any(|kept| kept == trimmed) {
            out.push(trimmed.to_owned());
        }
    }
    out
}

fn retain_allowed(models: &[String], allowed: &[String]) -> Vec<String> {
    dedupe(models)
        .into_iter()
        .filter(|model| allowed.iter().any(|offered| offered == model))
        .collect()
}

fn keep_allowed(model: &Option<String>, allowed: &[String]) -> Option<String> {
    model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .filter(|value| allowed.iter().any(|offered| offered == value))
        .map(str::to_owned)
}

/// The model a list-shaped Agent should start on: the caller's choice when it
/// survived sanitising, otherwise the first entry it still has.
fn resolve_default(chosen: &Option<String>, models: &[String]) -> Option<String> {
    chosen
        .as_deref()
        .filter(|model| models.iter().any(|kept| kept == model))
        .map(str::to_owned)
        .or_else(|| models.first().cloned())
}

impl AgentConfig {
    pub fn empty(app: &AppType) -> Self {
        match app {
            AppType::Claude => AgentConfig::Claude(ClaudeConfig::default()),
            AppType::Codex => AgentConfig::Codex(CodexConfig::default()),
            AppType::Gemini => AgentConfig::Gemini(GeminiConfig::default()),
            AppType::GrokBuild => AgentConfig::GrokBuild(GrokBuildConfig::default()),
            AppType::OpenCode => AgentConfig::OpenCode(OpenCodeConfig::default()),
            AppType::OpenClaw => AgentConfig::OpenClaw(OpenClawConfig::default()),
            // Hermes and the unsupported Claude Desktop both land here; the
            // latter never reaches a caller because it is not in SUPPORTED_APPS.
            _ => AgentConfig::Hermes(HermesConfig::default()),
        }
    }

    pub fn app(&self) -> AppType {
        match self {
            AgentConfig::Claude(_) => AppType::Claude,
            AgentConfig::Codex(_) => AppType::Codex,
            AgentConfig::Gemini(_) => AppType::Gemini,
            AgentConfig::GrokBuild(_) => AppType::GrokBuild,
            AgentConfig::OpenCode(_) => AppType::OpenCode,
            AgentConfig::OpenClaw(_) => AppType::OpenClaw,
            AgentConfig::Hermes(_) => AppType::Hermes,
        }
    }

    /// Every model id this config points at, in no particular order.
    pub fn referenced_models(&self) -> Vec<String> {
        let mut models = match self {
            AgentConfig::Claude(config) => [
                &config.model,
                &config.sonnet,
                &config.opus,
                &config.haiku,
                &config.fable,
                &config.subagent,
            ]
            .into_iter()
            .flatten()
            .cloned()
            .collect(),
            AgentConfig::Codex(config) => config.models.clone(),
            AgentConfig::Gemini(config) => config.model.clone().into_iter().collect(),
            AgentConfig::GrokBuild(config) => config.models.clone(),
            AgentConfig::OpenCode(config) => config.models.clone(),
            AgentConfig::OpenClaw(config) => config.models.clone(),
            AgentConfig::Hermes(config) => config.models.clone(),
        };
        models.sort();
        models.dedup();
        models
    }

    /// Drop everything the account can no longer reach.
    ///
    /// Returns whether anything was removed, so the panel can tell a user that
    /// their saved choice needs attention instead of silently changing it.
    pub fn sanitize(&mut self, allowed: &[String]) -> bool {
        let before = self.clone();
        match self {
            AgentConfig::Claude(config) => {
                config.model = keep_allowed(&config.model, allowed);
                for role in [
                    &mut config.sonnet,
                    &mut config.opus,
                    &mut config.haiku,
                    &mut config.fable,
                    &mut config.subagent,
                ] {
                    *role = keep_allowed(role, allowed);
                }
            }
            AgentConfig::Codex(config) => {
                config.models = retain_allowed(&config.models, allowed);
                config.default_model = resolve_default(&config.default_model, &config.models);
            }
            AgentConfig::Gemini(config) => config.model = keep_allowed(&config.model, allowed),
            AgentConfig::GrokBuild(config) => {
                config.models = retain_allowed(&config.models, allowed);
                config.default_model = resolve_default(&config.default_model, &config.models);
            }
            AgentConfig::OpenCode(config) => {
                config.models = retain_allowed(&config.models, allowed)
            }
            AgentConfig::OpenClaw(config) => {
                config.models = retain_allowed(&config.models, allowed);
                config.primary = keep_allowed(&config.primary, allowed)
                    .filter(|model| config.models.iter().any(|kept| kept == model));
                config.fallbacks = retain_allowed(&config.fallbacks, &config.models.clone());
                config
                    .fallbacks
                    .retain(|model| Some(model) != config.primary.as_ref());
            }
            AgentConfig::Hermes(config) => {
                config.models = retain_allowed(&config.models, allowed);
                config.default_model = resolve_default(&config.default_model, &config.models);
            }
        }
        before != *self
    }

    /// A config the user can apply without editing anything, built from the
    /// operator's recommendation. An Agent with no recommendation stays empty
    /// rather than being handed a model Connect picked on its own.
    pub fn seed(app: &AppType, policy: &AgentProvisioning) -> Self {
        let mut config = AgentConfig::empty(app);
        let suggested = policy
            .locked_model
            .clone()
            .filter(|model| !model.is_empty())
            .or_else(|| Some(policy.recommended_model.clone()).filter(|m| !m.is_empty()));
        let Some(model) = suggested else {
            return config;
        };
        match &mut config {
            AgentConfig::Claude(claude) => claude.model = Some(model),
            AgentConfig::Codex(codex) => {
                codex.models = vec![model.clone()];
                codex.default_model = Some(model);
            }
            AgentConfig::Gemini(gemini) => gemini.model = Some(model),
            AgentConfig::GrokBuild(grok) => {
                grok.models = vec![model.clone()];
                grok.default_model = Some(model);
            }
            AgentConfig::OpenCode(opencode) => opencode.models = vec![model],
            AgentConfig::OpenClaw(openclaw) => openclaw.models = vec![model],
            AgentConfig::Hermes(hermes) => {
                hermes.models = vec![model.clone()];
                hermes.default_model = Some(model);
            }
        }
        config
    }

    /// Whether this config can be written to a client as-is.
    pub fn is_complete(&self) -> bool {
        match self {
            AgentConfig::Claude(config) => config.model.is_some(),
            AgentConfig::Codex(config) => config.default_model.is_some(),
            AgentConfig::Gemini(config) => config.model.is_some(),
            AgentConfig::GrokBuild(config) => config.default_model.is_some(),
            AgentConfig::OpenCode(config) => !config.models.is_empty(),
            AgentConfig::OpenClaw(config) => !config.models.is_empty(),
            AgentConfig::Hermes(config) => config.default_model.is_some(),
        }
    }

    /// Re-check on the Rust side what the panel already enforces.
    ///
    /// The renderer is not a trust boundary: an invalid config here becomes a
    /// broken file in the user's real client, so every model has to be one the
    /// account may call and every default has to exist in its own list.
    pub fn validate(&self, policy: &AgentProvisioning) -> Result<(), String> {
        if !policy.enabled {
            return Err("This agent is disabled by BoxAI policy".into());
        }
        for model in self.referenced_models() {
            if !policy.models.contains(&model) {
                return Err(format!("BoxAI does not offer {model} to this account"));
            }
        }
        if let Some(locked) = policy
            .locked_model
            .as_deref()
            .filter(|model| !model.is_empty())
        {
            if self.referenced_models().iter().any(|model| model != locked) {
                return Err(format!("BoxAI requires this agent to use {locked}"));
            }
        }
        let list_default = |models: &[String], default: &Option<String>, label: &str| {
            if models.is_empty() {
                return Err(format!("Choose at least one model for {label}"));
            }
            match default {
                Some(model) if models.contains(model) => Ok(()),
                Some(model) => Err(format!("{model} is not one of the configured models")),
                None => Err(format!("Choose a default model for {label}")),
            }
        };
        match self {
            AgentConfig::Claude(config) => {
                if config.model.is_none() {
                    return Err("Choose a fallback model for Claude Code".into());
                }
            }
            AgentConfig::Codex(config) => {
                list_default(&config.models, &config.default_model, "Codex")?;
                if let Some(effort) = config.reasoning_effort.as_deref() {
                    if !["minimal", "low", "medium", "high"].contains(&effort) {
                        return Err(format!("{effort} is not a Codex reasoning effort"));
                    }
                }
            }
            AgentConfig::Gemini(config) => {
                if config.model.is_none() {
                    return Err("Choose a model for Gemini CLI".into());
                }
            }
            AgentConfig::GrokBuild(config) => {
                list_default(&config.models, &config.default_model, "Grok Build")?
            }
            AgentConfig::OpenCode(config) => {
                if config.models.is_empty() {
                    return Err("Choose at least one model for OpenCode".into());
                }
            }
            AgentConfig::OpenClaw(config) => {
                if config.models.is_empty() {
                    return Err("Choose at least one model for OpenClaw".into());
                }
                if let Some(primary) = &config.primary {
                    if !config.models.contains(primary) {
                        return Err(format!("{primary} is not one of the registered models"));
                    }
                    if config.fallbacks.contains(primary) {
                        return Err("The primary model cannot also be a fallback".into());
                    }
                }
                if config.primary.is_none() && !config.fallbacks.is_empty() {
                    return Err("Choose a primary model before adding fallbacks".into());
                }
                for fallback in &config.fallbacks {
                    if !config.models.contains(fallback) {
                        return Err(format!("{fallback} is not one of the registered models"));
                    }
                }
            }
            AgentConfig::Hermes(config) => {
                list_default(&config.models, &config.default_model, "Hermes")?
            }
        }
        Ok(())
    }

    /// Render the provider settings upstream writes into the client's live
    /// config. Shapes mirror `src/config/*ProviderPresets.ts`.
    pub fn settings_config(&self, secret: &str, meta: &ModelMetaMap) -> Value {
        // Claude Code appends `/v1/messages` itself, so it gets the bare origin;
        // the OpenAI-compatible clients get the `/v1` form the gateway reported.
        let base = super::gateway_auth::relay_origin_url();
        let v1 = super::gateway_auth::relay_v1_url();
        match self {
            AgentConfig::Claude(config) => {
                let fallback = config.model.clone().unwrap_or_default();
                let mut env = Map::new();
                env.insert("ANTHROPIC_BASE_URL".into(), json!(base));
                env.insert("ANTHROPIC_AUTH_TOKEN".into(), json!(secret));
                env.insert("ANTHROPIC_MODEL".into(), json!(fallback));
                // Roles are resolved to explicit ids rather than left unset:
                // an unset role makes Claude Code ask for its own vendor model
                // name, which this account has no reason to be able to call.
                for (key, role) in [
                    ("ANTHROPIC_DEFAULT_SONNET_MODEL", &config.sonnet),
                    ("ANTHROPIC_DEFAULT_OPUS_MODEL", &config.opus),
                    ("ANTHROPIC_DEFAULT_HAIKU_MODEL", &config.haiku),
                    ("ANTHROPIC_DEFAULT_FABLE_MODEL", &config.fable),
                    ("CLAUDE_CODE_SUBAGENT_MODEL", &config.subagent),
                ] {
                    env.insert(key.into(), json!(role.clone().unwrap_or(fallback.clone())));
                }
                json!({ "env": Value::Object(env) })
            }
            AgentConfig::Codex(config) => {
                let default = config.default_model.clone().unwrap_or_default();
                json!({
                    "auth": { "OPENAI_API_KEY": secret },
                    "config": codex_config_toml(&default, &base, config.reasoning_effort.as_deref()),
                    // Upstream projects this into ~/.codex/cc-switch-model-catalog.json
                    // and points config.toml at it, so Codex's /model picker
                    // lists exactly the models chosen here.
                    "modelCatalog": codex_model_catalog(&config.models, meta),
                })
            }
            AgentConfig::Gemini(config) => json!({
                "env": {
                    "GOOGLE_GEMINI_BASE_URL": base,
                    "GEMINI_API_KEY": secret,
                    "GEMINI_MODEL": config.model.clone().unwrap_or_default(),
                },
                "config": {}
            }),
            AgentConfig::GrokBuild(config) => json!({
                "config": grok_config_toml(
                    &config.models,
                    config.default_model.as_deref().unwrap_or_default(),
                    secret,
                    &v1,
                    meta,
                ),
            }),
            AgentConfig::OpenCode(config) => json!({
                "npm": "@ai-sdk/openai-compatible",
                "name": PROVIDER_NAME,
                "options": { "baseURL": v1, "apiKey": secret },
                "models": opencode_models(&config.models, meta),
            }),
            // Deserialized into `OpenClawProviderConfig`, which is camelCase.
            AgentConfig::OpenClaw(config) => json!({
                "baseUrl": v1,
                "apiKey": secret,
                "api": "openai-completions",
                "models": openclaw_models(&config.models, meta),
            }),
            // Written into `custom_providers:`. `api_mode` must be set: the
            // BoxAI relay speaks OpenAI chat completions under /v1. The default
            // model leads the list because Hermes reads the first entry as the
            // provider's singular `model:`.
            AgentConfig::Hermes(config) => {
                let mut ordered = config.models.clone();
                if let Some(default) = &config.default_model {
                    ordered.retain(|model| model != default);
                    ordered.insert(0, default.clone());
                }
                json!({
                    "name": provider_id(&AppType::Hermes),
                    "base_url": v1,
                    "api_key": secret,
                    "api_mode": "chat_completions",
                    "models": hermes_models(&ordered, meta),
                })
            }
        }
    }
}

fn toml_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| format!("\"{value}\""))
}

fn codex_config_toml(model: &str, base_url: &str, reasoning_effort: Option<&str>) -> String {
    format!(
        "model_provider = \"boxai\"\n\
         model = {model}\n\
         model_reasoning_effort = {effort}\n\
         disable_response_storage = true\n\
         \n\
         [model_providers.boxai]\n\
         name = {name}\n\
         base_url = {base_url}\n\
         wire_api = \"responses\"\n\
         requires_openai_auth = true",
        model = toml_string(model),
        effort = toml_string(reasoning_effort.unwrap_or("high")),
        name = toml_string(PROVIDER_NAME),
        base_url = toml_string(&format!("{base_url}/v1")),
    )
}

fn codex_model_catalog(models: &[String], meta: &ModelMetaMap) -> Value {
    let entries: Vec<Value> = models
        .iter()
        .map(|model| {
            let mut entry = Map::new();
            entry.insert("model".into(), json!(model));
            let Some(info) = meta.get(model) else {
                return Value::Object(entry);
            };
            if let Some(name) = &info.display_name {
                entry.insert("displayName".into(), json!(name));
            }
            if let Some(context) = info.context_length {
                entry.insert("contextWindow".into(), json!(context));
            }
            if !info.input_modalities.is_empty() {
                entry.insert("inputModalities".into(), json!(info.input_modalities));
            }
            Value::Object(entry)
        })
        .collect();
    json!({ "models": entries })
}

/// Grok Build addresses each model through a TOML table name, so the id has to
/// survive as an identifier. The hash keeps two models that slugify the same
/// from collapsing into one profile.
pub(crate) fn safe_profile_id(model: &str) -> String {
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

fn grok_config_toml(
    models: &[String],
    default_model: &str,
    secret: &str,
    base_url: &str,
    meta: &ModelMetaMap,
) -> String {
    let profiles: Vec<_> = models
        .iter()
        .map(|model| (safe_profile_id(model), model))
        .collect();
    let default_profile = profiles
        .iter()
        .find(|(_, model)| model.as_str() == default_model)
        .or_else(|| profiles.first())
        .map(|(profile, _)| profile.as_str())
        .unwrap_or("boxai-model-0");
    let mut output = format!("[models]\ndefault = {}\n", toml_string(default_profile));
    for (profile, model) in profiles {
        let context = meta
            .get(model)
            .and_then(|info| info.context_length)
            .unwrap_or(GROK_FALLBACK_CONTEXT_WINDOW);
        output.push_str(&format!(
            "\n[model.{}]\nname = {}\nmodel = {}\nbase_url = {}\napi_key = {}\napi_backend = \"responses\"\ncontext_window = {context}\n",
            toml_string(&profile),
            toml_string(meta.get(model).and_then(|info| info.display_name.as_deref()).unwrap_or(model)),
            toml_string(model),
            toml_string(base_url),
            toml_string(secret),
        ));
    }
    output
}

fn opencode_models(models: &[String], meta: &ModelMetaMap) -> Value {
    let mut map = Map::new();
    for model in models {
        let mut entry = Map::new();
        entry.insert(
            "name".into(),
            json!(meta
                .get(model)
                .and_then(|info| info.display_name.clone())
                .unwrap_or_else(|| model.clone())),
        );
        if let Some(info) = meta.get(model) {
            let mut limit = Map::new();
            if let Some(context) = info.context_length {
                limit.insert("context".into(), json!(context));
            }
            if let Some(output) = info.max_output_tokens {
                limit.insert("output".into(), json!(output));
            }
            if !limit.is_empty() {
                entry.insert("limit".into(), Value::Object(limit));
            }
        }
        map.insert(model.clone(), Value::Object(entry));
    }
    Value::Object(map)
}

fn openclaw_models(models: &[String], meta: &ModelMetaMap) -> Value {
    Value::Array(
        models
            .iter()
            .map(|model| {
                let mut entry = Map::new();
                entry.insert("id".into(), json!(model));
                entry.insert(
                    "name".into(),
                    json!(meta
                        .get(model)
                        .and_then(|info| info.display_name.clone())
                        .unwrap_or_else(|| model.clone())),
                );
                if let Some(context) = meta.get(model).and_then(|info| info.context_length) {
                    entry.insert("contextWindow".into(), json!(context));
                }
                Value::Object(entry)
            })
            .collect(),
    )
}

fn hermes_models(models: &[String], meta: &ModelMetaMap) -> Value {
    Value::Array(
        models
            .iter()
            .map(|model| {
                let mut entry = Map::new();
                entry.insert("id".into(), json!(model));
                entry.insert(
                    "name".into(),
                    json!(meta
                        .get(model)
                        .and_then(|info| info.display_name.clone())
                        .unwrap_or_else(|| model.clone())),
                );
                if let Some(info) = meta.get(model) {
                    if let Some(context) = info.context_length {
                        entry.insert("context_length".into(), json!(context));
                    }
                    if let Some(output) = info.max_output_tokens {
                        entry.insert("max_tokens".into(), json!(output));
                    }
                }
                Value::Object(entry)
            })
            .collect(),
    )
}

/// Recover a typed config from a v1 install.
///
/// v1 stored only one model id per client, but the provider row it generated
/// carried the whole account catalog. Reading the row back keeps a user's
/// Codex picker and OpenCode catalog intact across the upgrade instead of
/// silently shrinking them to a single entry; the stored id is used for the
/// answers the row cannot give (the default, and Claude's fallback).
pub fn from_legacy(
    app: &AppType,
    legacy_model: Option<&str>,
    settings: Option<&Value>,
) -> AgentConfig {
    let mut config = AgentConfig::empty(app);
    let legacy = legacy_model
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .map(str::to_owned);
    let catalog = settings
        .map(|settings| legacy_catalog(app, settings))
        .unwrap_or_default();
    let models = if catalog.is_empty() {
        legacy.clone().into_iter().collect()
    } else {
        catalog
    };
    match &mut config {
        AgentConfig::Claude(claude) => {
            claude.model = legacy.or_else(|| {
                settings
                    .and_then(|settings| settings.pointer("/env/ANTHROPIC_MODEL"))
                    .and_then(Value::as_str)
                    .filter(|model| !model.is_empty())
                    .map(str::to_owned)
            });
            for (pointer, role) in [
                ("/env/ANTHROPIC_DEFAULT_SONNET_MODEL", &mut claude.sonnet),
                ("/env/ANTHROPIC_DEFAULT_OPUS_MODEL", &mut claude.opus),
                ("/env/ANTHROPIC_DEFAULT_HAIKU_MODEL", &mut claude.haiku),
                ("/env/ANTHROPIC_DEFAULT_FABLE_MODEL", &mut claude.fable),
                ("/env/CLAUDE_CODE_SUBAGENT_MODEL", &mut claude.subagent),
            ] {
                let value = settings
                    .and_then(|settings| settings.pointer(pointer))
                    .and_then(Value::as_str)
                    .filter(|model| !model.is_empty())
                    .map(str::to_owned);
                // v1 wrote no role overrides, so a role equal to the fallback
                // stays "follow the fallback" rather than becoming a pin.
                *role = value.filter(|model| Some(model) != claude.model.as_ref());
            }
        }
        AgentConfig::Codex(codex) => {
            codex.default_model = resolve_default(&legacy, &models);
            codex.models = models;
        }
        AgentConfig::Gemini(gemini) => {
            gemini.model = legacy.or_else(|| models.first().cloned());
        }
        AgentConfig::GrokBuild(grok) => {
            grok.default_model = resolve_default(&legacy, &models);
            grok.models = models;
        }
        AgentConfig::OpenCode(opencode) => opencode.models = models,
        AgentConfig::OpenClaw(openclaw) => openclaw.models = models,
        AgentConfig::Hermes(hermes) => {
            hermes.default_model = resolve_default(&legacy, &models);
            hermes.models = models;
        }
    }
    config
}

fn legacy_catalog(app: &AppType, settings: &Value) -> Vec<String> {
    let ids = |value: Option<&Value>, key: &str| -> Vec<String> {
        value
            .and_then(Value::as_array)
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(|entry| entry.get(key).and_then(Value::as_str))
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default()
    };
    match app {
        AppType::Codex => ids(settings.pointer("/modelCatalog/models"), "model"),
        AppType::OpenCode => settings
            .get("models")
            .and_then(Value::as_object)
            .map(|models| models.keys().cloned().collect())
            .unwrap_or_default(),
        AppType::OpenClaw | AppType::Hermes => ids(settings.get("models"), "id"),
        AppType::GrokBuild => settings
            .get("config")
            .and_then(Value::as_str)
            .and_then(|config| config.parse::<toml::Value>().ok())
            .and_then(|document| {
                document
                    .get("model")
                    .and_then(toml::Value::as_table)
                    .cloned()
            })
            .map(|profiles| {
                profiles
                    .values()
                    .filter_map(|profile| profile.get("model").and_then(toml::Value::as_str))
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy(models: &[&str]) -> AgentProvisioning {
        AgentProvisioning {
            enabled: true,
            models: models.iter().map(|m| (*m).to_owned()).collect(),
            recommended_model: models.first().map(|m| (*m).to_owned()).unwrap_or_default(),
            locked_model: None,
        }
    }

    fn meta() -> ModelMetaMap {
        HashMap::from([(
            "model-a".to_owned(),
            ModelMeta {
                display_name: Some("Model A".into()),
                context_length: Some(200_000),
                max_output_tokens: Some(64_000),
                input_modalities: vec!["text".into(), "image".into()],
                ..Default::default()
            },
        )])
    }

    #[test]
    fn claude_roles_resolve_to_explicit_models() {
        // An unset role makes Claude Code request its own vendor model name,
        // which this account has no reason to be able to call.
        let config = AgentConfig::Claude(ClaudeConfig {
            model: Some("model-a".into()),
            opus: Some("model-b".into()),
            ..Default::default()
        });
        let env = config.settings_config("sk-user", &meta())["env"].clone();
        assert_eq!(env["ANTHROPIC_MODEL"], json!("model-a"));
        assert_eq!(env["ANTHROPIC_DEFAULT_OPUS_MODEL"], json!("model-b"));
        assert_eq!(env["ANTHROPIC_DEFAULT_SONNET_MODEL"], json!("model-a"));
        assert_eq!(env["CLAUDE_CODE_SUBAGENT_MODEL"], json!("model-a"));
    }

    #[test]
    fn codex_writes_only_the_chosen_models_and_the_chosen_default() {
        let config = AgentConfig::Codex(CodexConfig {
            models: vec!["model-a".into(), "model-b".into()],
            default_model: Some("model-b".into()),
            reasoning_effort: Some("low".into()),
        });
        let settings = config.settings_config("sk-user", &meta());
        let document: toml_edit::DocumentMut = settings["config"]
            .as_str()
            .expect("config TOML")
            .parse()
            .expect("valid TOML");
        assert_eq!(document["model"].as_str(), Some("model-b"));
        assert_eq!(document["model_reasoning_effort"].as_str(), Some("low"));
        let catalog = settings["modelCatalog"]["models"]
            .as_array()
            .expect("catalog");
        assert_eq!(catalog.len(), 2);
        assert_eq!(catalog[0]["displayName"], json!("Model A"));
        assert_eq!(catalog[0]["contextWindow"], json!(200_000));
        // A model with no documented metadata carries the id alone.
        assert!(catalog[1].get("contextWindow").is_none());
    }

    #[test]
    fn grok_profiles_declare_the_documented_context_window() {
        // Grok Build rejects a third-party profile without a context window,
        // and a wrong one silently truncates conversations.
        let config = AgentConfig::GrokBuild(GrokBuildConfig {
            models: vec!["model-a".into(), "model-b".into()],
            default_model: Some("model-b".into()),
        });
        let settings = config.settings_config("sk-user", &meta());
        let toml_text = settings["config"].as_str().expect("config TOML");
        crate::grok_config::validate_config_toml(toml_text).expect("valid Grok config");
        let document: toml::Value = toml_text.parse().expect("parse TOML");
        let profiles = document["model"].as_table().expect("profiles");
        assert_eq!(profiles.len(), 2);
        let default = document["models"]["default"].as_str().expect("default");
        assert_eq!(profiles[default]["model"].as_str(), Some("model-b"));
        let documented = profiles
            .values()
            .find(|profile| profile["model"].as_str() == Some("model-a"))
            .expect("model-a profile");
        assert_eq!(documented["context_window"].as_integer(), Some(200_000));
        let undocumented = profiles
            .values()
            .find(|profile| profile["model"].as_str() == Some("model-b"))
            .expect("model-b profile");
        assert_eq!(
            undocumented["context_window"].as_integer(),
            Some(GROK_FALLBACK_CONTEXT_WINDOW as i64)
        );
    }

    #[test]
    fn opencode_registers_a_catalog_and_nothing_else() {
        // OpenCode's top-level default model belongs to the user's own config.
        let settings = AgentConfig::OpenCode(OpenCodeConfig {
            models: vec!["model-a".into()],
        })
        .settings_config("sk-user", &meta());
        assert!(settings.get("model").is_none());
        assert_eq!(
            settings["models"]["model-a"]["limit"]["context"],
            json!(200_000)
        );
        assert_eq!(
            settings["models"]["model-a"]["limit"]["output"],
            json!(64_000)
        );
    }

    #[test]
    fn hermes_leads_with_the_chosen_default_model() {
        // Hermes reads the first catalog entry as the provider's singular
        // `model:`, so the user's default has to come first.
        let settings = AgentConfig::Hermes(HermesConfig {
            models: vec!["model-a".into(), "model-b".into()],
            default_model: Some("model-b".into()),
        })
        .settings_config("sk-user", &meta());
        assert_eq!(settings["models"][0]["id"], json!("model-b"));
        assert_eq!(settings["api_mode"], json!("chat_completions"));
    }

    #[test]
    fn every_client_targets_boxai_with_the_account_key() {
        for app in super::super::provider_seed::SUPPORTED_APPS {
            let mut config = AgentConfig::seed(&app, &policy(&["model-a"]));
            if let AgentConfig::OpenClaw(openclaw) = &mut config {
                openclaw.primary = Some("model-a".into());
            }
            let rendered = config.settings_config("sk-user", &meta()).to_string();
            assert!(
                rendered.contains("you-box.com"),
                "{} must target BoxAI: {rendered}",
                app.as_str()
            );
            assert!(
                rendered.contains("sk-user"),
                "{} must carry the account key: {rendered}",
                app.as_str()
            );
            assert!(
                rendered.contains("model-a"),
                "{} must carry the configured model: {rendered}",
                app.as_str()
            );
        }
    }

    #[test]
    fn claude_gets_the_bare_origin_and_the_openai_clients_get_v1() {
        // Claude Code appends `/v1/messages`; the `/v1` form would 404.
        let claude = AgentConfig::Claude(ClaudeConfig {
            model: Some("model-a".into()),
            ..Default::default()
        })
        .settings_config("sk-user", &meta());
        assert_eq!(
            claude["env"]["ANTHROPIC_BASE_URL"].as_str(),
            Some("https://you-box.com")
        );
        let opencode = AgentConfig::OpenCode(OpenCodeConfig {
            models: vec!["model-a".into()],
        })
        .settings_config("sk-user", &meta());
        assert_eq!(
            opencode["options"]["baseURL"].as_str(),
            Some("https://you-box.com/v1")
        );
    }

    #[test]
    fn validation_rejects_what_the_account_cannot_run() {
        let policy = policy(&["model-a", "model-b"]);
        let unavailable = AgentConfig::Codex(CodexConfig {
            models: vec!["model-z".into()],
            default_model: Some("model-z".into()),
            reasoning_effort: None,
        });
        assert!(unavailable.validate(&policy).is_err());

        let default_outside_catalog = AgentConfig::Codex(CodexConfig {
            models: vec!["model-a".into()],
            default_model: Some("model-b".into()),
            reasoning_effort: None,
        });
        assert!(default_outside_catalog.validate(&policy).is_err());

        let mut locked = policy.clone();
        locked.locked_model = Some("model-a".into());
        let ignores_lock = AgentConfig::Gemini(GeminiConfig {
            model: Some("model-b".into()),
        });
        assert!(ignores_lock.validate(&locked).is_err());
        assert!(AgentConfig::Gemini(GeminiConfig {
            model: Some("model-a".into())
        })
        .validate(&locked)
        .is_ok());

        let mut disabled = policy.clone();
        disabled.enabled = false;
        assert!(AgentConfig::Gemini(GeminiConfig {
            model: Some("model-a".into())
        })
        .validate(&disabled)
        .is_err());
    }

    #[test]
    fn openclaw_fallbacks_must_be_registered_and_distinct() {
        let policy = policy(&["model-a", "model-b"]);
        assert!(AgentConfig::OpenClaw(OpenClawConfig {
            models: vec!["model-a".into()],
            primary: Some("model-a".into()),
            fallbacks: vec!["model-a".into()],
        })
        .validate(&policy)
        .is_err());
        assert!(AgentConfig::OpenClaw(OpenClawConfig {
            models: vec!["model-a".into()],
            primary: Some("model-a".into()),
            fallbacks: vec!["model-b".into()],
        })
        .validate(&policy)
        .is_err());
        assert!(AgentConfig::OpenClaw(OpenClawConfig {
            models: vec!["model-a".into(), "model-b".into()],
            primary: Some("model-a".into()),
            fallbacks: vec!["model-b".into()],
        })
        .validate(&policy)
        .is_ok());
    }

    #[test]
    fn sanitizing_drops_withdrawn_models_and_repoints_the_default() {
        let mut config = AgentConfig::Codex(CodexConfig {
            models: vec!["model-a".into(), "model-gone".into()],
            default_model: Some("model-gone".into()),
            reasoning_effort: None,
        });
        assert!(config.sanitize(&["model-a".to_owned()]));
        assert_eq!(
            config,
            AgentConfig::Codex(CodexConfig {
                models: vec!["model-a".into()],
                default_model: Some("model-a".into()),
                reasoning_effort: None,
            })
        );
        assert!(!config.sanitize(&["model-a".to_owned()]));
    }

    #[test]
    fn migrating_a_v1_install_keeps_the_catalog_it_had() {
        // v1 wrote the whole account catalog into the provider row while
        // storing one model id. Reading only the id would shrink a user's
        // Codex picker from every model to one.
        let settings = json!({
            "modelCatalog": { "models": [{ "model": "model-a" }, { "model": "model-b" }] }
        });
        assert_eq!(
            from_legacy(&AppType::Codex, Some("model-b"), Some(&settings)),
            AgentConfig::Codex(CodexConfig {
                models: vec!["model-a".into(), "model-b".into()],
                default_model: Some("model-b".into()),
                reasoning_effort: None,
            })
        );

        let opencode = json!({ "models": { "model-a": {}, "model-b": {} } });
        let AgentConfig::OpenCode(migrated) =
            from_legacy(&AppType::OpenCode, Some("model-a"), Some(&opencode))
        else {
            panic!("expected an OpenCode config");
        };
        assert_eq!(migrated.models.len(), 2);
    }

    #[test]
    fn migrating_claude_keeps_role_overrides_but_not_echoes_of_the_fallback() {
        let settings = json!({"env": {
            "ANTHROPIC_MODEL": "model-a",
            "ANTHROPIC_DEFAULT_SONNET_MODEL": "model-a",
            "ANTHROPIC_DEFAULT_OPUS_MODEL": "model-b",
        }});
        assert_eq!(
            from_legacy(&AppType::Claude, Some("model-a"), Some(&settings)),
            AgentConfig::Claude(ClaudeConfig {
                model: Some("model-a".into()),
                opus: Some("model-b".into()),
                ..Default::default()
            })
        );
    }

    #[test]
    fn a_seeded_config_is_immediately_applicable() {
        for app in super::super::provider_seed::SUPPORTED_APPS {
            let policy = policy(&["model-a"]);
            let config = AgentConfig::seed(&app, &policy);
            assert!(config.is_complete(), "{} seed is incomplete", app.as_str());
            assert!(config.validate(&policy).is_ok(), "{}", app.as_str());
        }
    }

    #[test]
    fn an_agent_without_a_recommendation_is_left_unconfigured() {
        // Connect cannot invent a model the account may or may not reach.
        let mut policy = policy(&["model-a"]);
        policy.recommended_model = String::new();
        for app in super::super::provider_seed::SUPPORTED_APPS {
            assert!(
                !AgentConfig::seed(&app, &policy).is_complete(),
                "{}",
                app.as_str()
            );
        }
    }
}
