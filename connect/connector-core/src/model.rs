use crate::{Error, Result, WireProtocol};
use serde::Deserialize;
use std::{collections::BTreeSet, fmt};
use url::Url;

pub const SCHEMA_VERSION: u32 = 2;
pub const MAX_SKILL_ARCHIVE_SIZE: u64 = 64 * 1024 * 1024;
pub const MAX_SKILL_CATALOG_ARCHIVE_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_CATALOG_ENTRIES: usize = 256;
pub const MAX_USAGE_SERIES_ENTRIES: usize = 30 * 24 * 32;
pub const MAX_MODEL_CATALOG_ENTRIES: usize = 4096;
pub const MAX_MCP_DESCRIPTION_BYTES: usize = 1024;
pub const MAX_MODEL_TAGS: usize = 64;
pub const MAX_MODEL_TEXT_BYTES: usize = 4096;

#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);
impl Secret {
    pub fn new(value: impl Into<String>) -> Result<Self> {
        let value = value.into();
        if value.is_empty() || value.chars().any(char::is_control) {
            return Err(Error::Validation("invalid bearer".into()));
        }
        Ok(Self(value))
    }
    pub(crate) fn expose(&self) -> &str {
        &self.0
    }
}
impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret([REDACTED])")
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct Platform {
    pub id: String,
    pub name: String,
}
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuthType {
    BrowserPkce,
}
#[derive(Debug, Clone, Deserialize)]
pub struct Authentication {
    #[serde(rename = "type")]
    pub kind: AuthType,
    pub authorize_url: Url,
    pub token_url: Url,
}
#[derive(Debug, Clone, Deserialize)]
pub struct Gateway {
    pub base_url: Url,
    pub protocols: Vec<WireProtocol>,
}
#[derive(Debug, Clone, Deserialize)]
pub struct ConnectionManifest {
    pub schema_version: u32,
    pub platform: Platform,
    #[serde(default)]
    pub authentication: Option<Authentication>,
    pub gateway: Gateway,
    pub provisioning_url: Url,
    pub connection_bearer_origins: Vec<Url>,
}

#[derive(Deserialize)]
struct ResponseEnvelope<T> {
    success: bool,
    data: T,
}
impl ConnectionManifest {
    /// Builds a validated direct-mode contract without browser authentication,
    /// MCP servers, Skills, or inferred network endpoints.
    pub fn direct(platform: Platform, gateway: Gateway, provisioning_url: Url) -> Result<Self> {
        let origin = Url::parse(&gateway.base_url.origin().ascii_serialization())
            .map_err(|error| Error::Validation(error.to_string()))?;
        let manifest = Self {
            schema_version: SCHEMA_VERSION,
            platform,
            authentication: None,
            gateway,
            provisioning_url,
            connection_bearer_origins: vec![origin],
        };
        manifest.validate()?;
        Ok(manifest)
    }

    pub fn parse(bytes: &[u8]) -> Result<Self> {
        let envelope: ResponseEnvelope<Self> =
            serde_json::from_slice(bytes).map_err(|e| Error::Validation(e.to_string()))?;
        if !envelope.success {
            return Err(Error::Validation("unsuccessful envelope".into()));
        }
        let value = envelope.data;
        value.validate()?;
        Ok(value)
    }
    pub fn validate(&self) -> Result<()> {
        schema(self.schema_version)?;
        path_id(&self.platform.id, "platform id")?;
        if let Some(authentication) = &self.authentication {
            secure(&authentication.authorize_url)?;
            secure(&authentication.token_url)?;
        }
        secure(&self.gateway.base_url)?;
        if self.gateway.base_url.cannot_be_a_base()
            || self.gateway.base_url.query().is_some()
            || !self.gateway.base_url.username().is_empty()
            || self.gateway.base_url.password().is_some()
        {
            return Err(Error::Validation(
                "gateway base URL must be a hierarchical endpoint without userinfo, query, or fragment"
                    .into(),
            ));
        }
        secure(&self.provisioning_url)?;
        if self.connection_bearer_origins.is_empty() {
            return Err(Error::Validation(
                "connection_bearer_origins is empty".into(),
            ));
        }
        let mut bearer_origins = BTreeSet::new();
        for url in &self.connection_bearer_origins {
            secure(url)?;
            if url.cannot_be_a_base()
                || url.path() != "/"
                || url.query().is_some()
                || url.fragment().is_some()
                || !url.username().is_empty()
                || url.password().is_some()
            {
                return Err(Error::Validation(format!(
                    "connection bearer allowlist entry is not an origin: {url}"
                )));
            }
            if !bearer_origins.insert(url.origin().ascii_serialization()) {
                return Err(Error::Validation(format!(
                    "duplicate connection bearer origin {}",
                    url.origin().ascii_serialization()
                )));
            }
        }
        if !bearer_origins.contains(&self.gateway.base_url.origin().ascii_serialization()) {
            return Err(Error::Validation(
                "gateway origin is not allowed for connection bearer".into(),
            ));
        }
        if !bearer_origins.contains(&self.provisioning_url.origin().ascii_serialization()) {
            return Err(Error::Validation(
                "provisioning origin is not allowed for connection bearer".into(),
            ));
        }
        if self.gateway.protocols.is_empty() {
            return Err(Error::Validation("gateway protocols is empty".into()));
        }
        unique(
            self.gateway
                .protocols
                .iter()
                .map(|protocol| protocol.as_str()),
            "gateway protocol",
        )?;
        // Which Agents can be configured is a local capability: Kit detects the
        // installs and owns every writer. A platform constrains where the
        // credential may travel through `connection_bearer_origins`, and each
        // Agent's protocol fit is resolved per Agent when a projection is
        // planned, so one incompatible client no longer voids the manifest.
        Ok(())
    }

    pub fn api_endpoint(&self, path: &str) -> Result<Url> {
        let origin = Url::parse(&self.provisioning_url.origin().ascii_serialization())
            .map_err(|error| Error::Validation(error.to_string()))?;
        let trimmed = path.trim().trim_start_matches('/');
        if trimmed.is_empty()
            || trimmed.contains('\\')
            || trimmed.split('/').any(|segment| {
                segment.is_empty() || segment == "." || segment == ".." || segment.contains(':')
            })
        {
            return Err(Error::Validation("invalid API path".into()));
        }
        let url = origin
            .join(trimmed)
            .map_err(|error| Error::Validation(error.to_string()))?;
        secure(&url)?;
        if url.origin() != self.provisioning_url.origin() {
            return Err(Error::Validation(
                "API endpoint left the provisioning origin".into(),
            ));
        }
        Ok(url)
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct Model {
    pub id: String,
    #[serde(default)]
    pub chat_capable: bool,
    /// Gateway-authored: true for native Responses upstreams. Chat may
    /// still be advertised. Dual-tagged conversion channels such as xAI
    /// stay false even when `openai-response` appears in `endpoints`.
    #[serde(default)]
    pub responses_native: bool,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub endpoints: Vec<String>,
    #[serde(default)]
    pub supported_reasoning: Vec<String>,
    #[serde(default)]
    pub vendor: Option<ModelVendor>,
}

impl Model {
    /// Native Responses upstream. Prefer the Gateway flag; fall back to
    /// exclusive Responses endpoints when an older provisioning document
    /// omitted the field.
    pub fn is_responses_native(&self) -> bool {
        if self.responses_native {
            return true;
        }
        !self.endpoints.is_empty()
            && self.endpoints.iter().all(|endpoint| {
                endpoint == "openai-response" || endpoint == "openai-response-compact"
            })
    }

    pub fn has_responses_endpoint(&self) -> bool {
        self.endpoints
            .iter()
            .any(|endpoint| endpoint == "openai-response" || endpoint == "openai-response-compact")
    }

    /// Codex can list native models and converted models that advertise
    /// `/v1/responses`. Kit chooses among them.
    pub fn is_codex_catalog_model(&self) -> bool {
        self.is_responses_native() || self.has_responses_endpoint()
    }
}
#[derive(Debug, Clone, Deserialize)]
pub struct ModelVendor {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub icon: Option<String>,
}
/// Who the connection belongs to. Provisioning is the only account
/// projection a Connector reads; Kit never queries the console self routes.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct AccountSnapshot {
    pub id: i64,
    pub username: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub group: String,
}

/// Wallet and lifetime accounting. `wallet_quota_remaining` is a balance the
/// Gateway decrements, not a total: nothing here divides into anything else.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct UsageSnapshot {
    #[serde(default)]
    pub wallet_quota_remaining: i64,
    #[serde(default)]
    pub lifetime_quota_used: i64,
    #[serde(default)]
    pub lifetime_request_count: i64,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Billing {
    pub portal_url: Url,
    #[serde(default)]
    pub wallet_fallback_allowed: bool,
    #[serde(default)]
    pub subscriptions: Vec<SubscriptionSnapshot>,
}
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct UsageStat {
    #[serde(default)]
    pub quota: i64,
    #[serde(default)]
    pub rpm: i64,
    #[serde(default)]
    pub tpm: i64,
}
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct UsageBucket {
    #[serde(default)]
    pub model_name: String,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub token_used: i64,
    #[serde(default)]
    pub count: i64,
    #[serde(default)]
    pub quota: i64,
}
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct RequestLogEntry {
    #[serde(default)]
    pub id: i64,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub model_name: String,
    #[serde(default)]
    pub token_name: String,
    #[serde(default)]
    pub quota: i64,
    #[serde(default)]
    pub prompt_tokens: i64,
    #[serde(default)]
    pub completion_tokens: i64,
    #[serde(default)]
    pub use_time: i64,
}
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct SubscriptionSnapshot {
    pub id: i64,
    pub plan_id: i64,
    #[serde(default)]
    pub plan_title: String,
    pub status: String,
    pub unlimited: bool,
    pub quota_total: i64,
    pub quota_used_current_period: i64,
    pub current_period_start: i64,
    pub end_time: i64,
    pub next_reset_time: i64,
    pub wallet_fallback: bool,
}
#[derive(Debug, Clone, Deserialize)]
pub struct ModelPlaza {
    pub portal_url: Url,
    #[serde(default)]
    pub models: Vec<Model>,
}
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum McpAuthorization {
    ConnectionBearer,
}
#[derive(Debug, Clone, Deserialize)]
pub struct McpServer {
    pub id: String,
    pub name: String,
    pub url: Url,
    pub authorization: McpAuthorization,
    #[serde(default)]
    pub description: Option<String>,
}
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SkillArchiveAuthorization {
    None,
    ConnectionBearer,
}
#[derive(Debug, Clone, Deserialize)]
pub struct SkillArchive {
    pub url: Url,
    pub sha256: String,
    pub size_bytes: u64,
    pub format: String,
    pub authorization: SkillArchiveAuthorization,
}
#[derive(Debug, Clone, Deserialize)]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub version: String,
    pub archive: SkillArchive,
}
#[derive(Debug, Clone, Deserialize)]
pub struct Provisioning {
    pub schema_version: u32,
    #[serde(default)]
    pub account: Option<AccountSnapshot>,
    #[serde(default)]
    pub usage: Option<UsageSnapshot>,
    #[serde(default)]
    pub billing: Option<Billing>,
    #[serde(default)]
    pub model_plaza: Option<ModelPlaza>,
    pub models: Vec<Model>,
    pub default_model: String,
    pub mcp_servers: Vec<McpServer>,
    pub skills: Vec<Skill>,
}
impl Provisioning {
    /// Builds a validated direct-mode catalog without platform-only services
    /// or account data.
    pub fn direct(models: Vec<Model>, default_model: String) -> Result<Self> {
        let value = Self {
            schema_version: SCHEMA_VERSION,
            account: None,
            usage: None,
            billing: None,
            model_plaza: None,
            models,
            default_model,
            mcp_servers: Vec::new(),
            skills: Vec::new(),
        };
        value.validate()?;
        Ok(value)
    }

    pub fn parse(bytes: &[u8]) -> Result<Self> {
        let envelope: ResponseEnvelope<Self> =
            serde_json::from_slice(bytes).map_err(|e| Error::Validation(e.to_string()))?;
        if !envelope.success {
            return Err(Error::Validation("unsuccessful envelope".into()));
        }
        let value = envelope.data;
        value.validate()?;
        Ok(value)
    }
    pub fn validate(&self) -> Result<()> {
        schema(self.schema_version)?;
        if let Some(account) = &self.account {
            account.validate()?;
        }
        if let Some(usage) = &self.usage {
            usage.validate()?;
        }
        if let Some(billing) = &self.billing {
            billing.validate()?;
        }
        if let Some(model_plaza) = &self.model_plaza {
            secure(&model_plaza.portal_url)?;
            if model_plaza.models.len() > MAX_MODEL_CATALOG_ENTRIES {
                return Err(Error::Validation(format!(
                    "Model Plaza catalog exceeds {MAX_MODEL_CATALOG_ENTRIES} entries"
                )));
            }
        }
        if self.models.len() > MAX_MODEL_CATALOG_ENTRIES {
            return Err(Error::Validation(format!(
                "model catalog exceeds {MAX_MODEL_CATALOG_ENTRIES} entries"
            )));
        }
        if self.mcp_servers.len() > MAX_CATALOG_ENTRIES {
            return Err(Error::Validation(format!(
                "MCP catalog exceeds {MAX_CATALOG_ENTRIES} entries"
            )));
        }
        if self.skills.len() > MAX_CATALOG_ENTRIES {
            return Err(Error::Validation(format!(
                "Skill catalog exceeds {MAX_CATALOG_ENTRIES} entries"
            )));
        }
        if self
            .skills
            .iter()
            .try_fold(0u64, |total, skill| {
                total.checked_add(skill.archive.size_bytes)
            })
            .is_none_or(|total| total > MAX_SKILL_CATALOG_ARCHIVE_BYTES)
        {
            return Err(Error::Validation(
                "Skill catalog archive size exceeds 256 MiB".into(),
            ));
        }
        let ids = validate_models(&self.models, true)?;
        if let Some(model_plaza) = &self.model_plaza {
            let plaza_ids = validate_models(&model_plaza.models, false)?;
            for model in &self.models {
                if !plaza_ids.contains(model.id.as_str())
                    || !model_plaza
                        .models
                        .iter()
                        .any(|plaza| plaza.id == model.id && plaza.chat_capable)
                {
                    return Err(Error::Validation(
                        "Agent model is missing from the chat-capable Model Plaza catalog".into(),
                    ));
                }
            }
        }
        if ids.is_empty() && !self.default_model.is_empty() {
            return Err(Error::Validation(
                "catalog without a chat-capable model requires empty default_model".into(),
            ));
        }
        if !ids.is_empty() && !ids.contains(self.default_model.as_str()) {
            return Err(Error::Validation(
                "default_model is not a chat-capable catalog model".into(),
            ));
        }
        let mut mcp_ids = BTreeSet::new();
        for m in &self.mcp_servers {
            id(&m.id, "MCP id")?;
            name(&m.name, "MCP name")?;
            if m.description.as_ref().is_some_and(|description| {
                description.len() > MAX_MCP_DESCRIPTION_BYTES
                    || description.chars().any(char::is_control)
            }) {
                return Err(Error::Validation("invalid MCP description".into()));
            }
            if m.url.scheme() != "https" {
                return Err(Error::Validation("MCP URL must use HTTPS".into()));
            }
            if !mcp_ids.insert(&m.id) {
                return Err(Error::Validation(format!("duplicate MCP id {}", m.id)));
            }
        }
        let mut skill_ids = BTreeSet::new();
        for s in &self.skills {
            path_id(&s.id, "skill id")?;
            name(&s.name, "skill name")?;
            version(&s.version)?;
            secure(&s.archive.url)?;
            if s.archive.sha256.len() != 64
                || !s
                    .archive
                    .sha256
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err(Error::Validation("invalid Skill SHA-256".into()));
            }
            if s.archive.size_bytes == 0 || s.archive.size_bytes > MAX_SKILL_ARCHIVE_SIZE {
                return Err(Error::Validation("invalid Skill archive size".into()));
            }
            if s.archive.format != "zip" {
                return Err(Error::Validation("Skill archive format must be zip".into()));
            }
            if !skill_ids.insert(&s.id) {
                return Err(Error::Validation(format!("duplicate skill id {}", s.id)));
            }
        }
        Ok(())
    }

    pub fn validate_for(&self, manifest: &ConnectionManifest) -> Result<()> {
        self.validate()?;
        let allowed: BTreeSet<String> = manifest
            .connection_bearer_origins
            .iter()
            .map(|url| url.origin().ascii_serialization())
            .collect();
        for server in &self.mcp_servers {
            if !allowed.contains(&server.url.origin().ascii_serialization()) {
                return Err(Error::Validation(format!(
                    "authenticated MCP origin is not allowed: {}",
                    server.url.origin().ascii_serialization()
                )));
            }
        }
        for skill in &self.skills {
            if skill.archive.authorization == SkillArchiveAuthorization::ConnectionBearer
                && !allowed.contains(&skill.archive.url.origin().ascii_serialization())
            {
                return Err(Error::Validation(
                    "authenticated Skill archive origin is not allowed".into(),
                ));
            }
        }
        Ok(())
    }
}
fn validate_models(models: &[Model], require_chat: bool) -> Result<BTreeSet<&str>> {
    let mut ids = BTreeSet::new();
    for model in models {
        model_id(&model.id)?;
        if require_chat && !model.chat_capable {
            return Err(Error::Validation(format!(
                "Agent model {} is not chat-capable",
                model.id
            )));
        }
        if model.description.as_ref().is_some_and(|value| {
            value.len() > MAX_MODEL_TEXT_BYTES || value.chars().any(char::is_control)
        }) {
            return Err(Error::Validation("invalid model description".into()));
        }
        if let Some(icon) = &model.icon {
            bounded_text(icon, "model icon", MAX_MODEL_TEXT_BYTES, false)?;
        }
        if model.tags.len() > MAX_MODEL_TAGS {
            return Err(Error::Validation("model has too many tags".into()));
        }
        for tag in &model.tags {
            bounded_text(tag, "model tag", 128, false)?;
        }
        unique(model.tags.iter().map(String::as_str), "model tag")?;
        if model.endpoints.len() > 32 {
            return Err(Error::Validation("model has too many endpoints".into()));
        }
        for endpoint in &model.endpoints {
            bounded_text(endpoint, "model endpoint", 64, false)?;
        }
        unique(model.endpoints.iter().map(String::as_str), "model endpoint")?;
        if model.supported_reasoning.len() > 16 {
            return Err(Error::Validation(
                "model has too many reasoning levels".into(),
            ));
        }
        for effort in &model.supported_reasoning {
            bounded_text(effort, "model reasoning level", 32, false)?;
        }
        unique(
            model.supported_reasoning.iter().map(String::as_str),
            "model reasoning level",
        )?;
        if let Some(vendor) = &model.vendor {
            if vendor.id <= 0 {
                return Err(Error::Validation("invalid model vendor id".into()));
            }
            name(&vendor.name, "model vendor name")?;
            if let Some(icon) = &vendor.icon {
                bounded_text(icon, "model vendor icon", MAX_MODEL_TEXT_BYTES, false)?;
            }
        }
        if !ids.insert(model.id.as_str()) {
            return Err(Error::Validation(format!(
                "duplicate model id {}",
                model.id
            )));
        }
    }
    Ok(ids)
}
fn parse_envelope<T: for<'de> Deserialize<'de>>(bytes: &[u8]) -> Result<T> {
    let envelope: ResponseEnvelope<T> =
        serde_json::from_slice(bytes).map_err(|error| Error::Validation(error.to_string()))?;
    if !envelope.success {
        return Err(Error::Validation("unsuccessful envelope".into()));
    }
    Ok(envelope.data)
}

impl AccountSnapshot {
    pub fn validate(&self) -> Result<()> {
        if self.id <= 0 {
            return Err(Error::Validation("invalid account snapshot".into()));
        }
        bounded_text(&self.username, "account username", 256, false)?;
        bounded_text(&self.display_name, "account display name", 256, true)?;
        bounded_text(&self.email, "account email", 320, true)?;
        bounded_text(&self.group, "account group", 128, true)
    }
}

impl UsageSnapshot {
    pub fn validate(&self) -> Result<()> {
        if self.wallet_quota_remaining < 0
            || self.lifetime_quota_used < 0
            || self.lifetime_request_count < 0
        {
            return Err(Error::Validation("invalid usage snapshot".into()));
        }
        Ok(())
    }
}

impl Billing {
    pub fn validate(&self) -> Result<()> {
        secure(&self.portal_url)?;
        if self.subscriptions.len() > MAX_CATALOG_ENTRIES {
            return Err(Error::Validation(format!(
                "subscription catalog exceeds {MAX_CATALOG_ENTRIES} entries"
            )));
        }
        for subscription in &self.subscriptions {
            subscription.validate()?;
        }
        Ok(())
    }
}

impl UsageStat {
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        let value: Self = parse_envelope(bytes)?;
        value.validate()?;
        Ok(value)
    }
    pub fn validate(&self) -> Result<()> {
        if self.quota < 0 || self.rpm < 0 || self.tpm < 0 {
            return Err(Error::Validation("invalid usage stat".into()));
        }
        Ok(())
    }
}

impl UsageBucket {
    pub fn parse_series(bytes: &[u8]) -> Result<Vec<Self>> {
        let values: Vec<Self> = parse_envelope(bytes)?;
        if values.len() > MAX_USAGE_SERIES_ENTRIES {
            return Err(Error::Validation(format!(
                "usage series exceeds {MAX_USAGE_SERIES_ENTRIES} entries"
            )));
        }
        for bucket in &values {
            bucket.validate()?;
        }
        Ok(values)
    }
    pub fn validate(&self) -> Result<()> {
        bounded_text(&self.model_name, "usage model", 255, true)?;
        if self.created_at < 0 || self.token_used < 0 || self.count < 0 || self.quota < 0 {
            return Err(Error::Validation("invalid usage bucket".into()));
        }
        Ok(())
    }
}

#[derive(Deserialize)]
struct LogPage {
    #[serde(default)]
    items: Vec<RequestLogEntry>,
}

impl RequestLogEntry {
    pub fn parse_page(bytes: &[u8]) -> Result<Vec<Self>> {
        let page: LogPage = parse_envelope(bytes)?;
        if page.items.len() > MAX_CATALOG_ENTRIES {
            return Err(Error::Validation(format!(
                "request log exceeds {MAX_CATALOG_ENTRIES} entries"
            )));
        }
        for entry in &page.items {
            entry.validate()?;
        }
        Ok(page.items)
    }
    pub fn validate(&self) -> Result<()> {
        bounded_text(&self.model_name, "log model", 255, true)?;
        bounded_text(&self.token_name, "log token", 128, true)?;
        if self.id < 0
            || self.created_at < 0
            || self.quota < 0
            || self.prompt_tokens < 0
            || self.completion_tokens < 0
            || self.use_time < 0
        {
            return Err(Error::Validation("invalid request log".into()));
        }
        Ok(())
    }
}

impl SubscriptionSnapshot {
    pub fn validate(&self) -> Result<()> {
        bounded_text(&self.status, "subscription status", 128, false)?;
        bounded_text(&self.plan_title, "subscription title", 128, true)?;
        if self.id <= 0
            || self.plan_id <= 0
            || self.quota_total < 0
            || self.quota_used_current_period < 0
            || self.current_period_start < 0
            || self.end_time < 0
            || self.next_reset_time < 0
            || (!self.unlimited && self.quota_used_current_period > self.quota_total)
        {
            return Err(Error::Validation("invalid subscription usage".into()));
        }
        Ok(())
    }
}
fn bounded_text(value: &str, label: &str, max: usize, empty: bool) -> Result<()> {
    if value.len() <= max
        && (empty || !value.trim().is_empty())
        && !value.chars().any(char::is_control)
    {
        Ok(())
    } else {
        Err(Error::Validation(format!("invalid {label}")))
    }
}
fn unique<'a>(values: impl Iterator<Item = &'a str>, label: &str) -> Result<()> {
    let mut seen = BTreeSet::new();
    for value in values {
        if !seen.insert(value) {
            return Err(Error::Validation(format!("duplicate {label} {value}")));
        }
    }
    Ok(())
}
fn schema(v: u32) -> Result<()> {
    if v == SCHEMA_VERSION {
        Ok(())
    } else {
        Err(Error::Validation(format!("unsupported schema version {v}")))
    }
}
fn id(v: &str, label: &str) -> Result<()> {
    if !v.trim().is_empty()
        && v.len() <= 128
        && v.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        Ok(())
    } else {
        Err(Error::Validation(format!("invalid {label}")))
    }
}
fn path_id(value: &str, label: &str) -> Result<()> {
    let bytes = value.as_bytes();
    let endpoint = |byte: u8| byte.is_ascii_lowercase() || byte.is_ascii_digit();
    let portable = !bytes.is_empty()
        && bytes.len() <= 64
        && endpoint(bytes[0])
        && endpoint(bytes[bytes.len() - 1])
        && bytes.iter().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-')
        })
        && !windows_reserved_component(value);
    if portable {
        Ok(())
    } else {
        Err(Error::Validation(format!("invalid {label}")))
    }
}
fn windows_reserved_component(component: &str) -> bool {
    let stem = component
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || stem
            .strip_prefix("COM")
            .or_else(|| stem.strip_prefix("LPT"))
            .is_some_and(|suffix| {
                matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
            })
}
fn name(value: &str, label: &str) -> Result<()> {
    if !value.trim().is_empty() && value.len() <= 128 && !value.chars().any(char::is_control) {
        Ok(())
    } else {
        Err(Error::Validation(format!("invalid {label}")))
    }
}
fn version(value: &str) -> Result<()> {
    if !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '+'))
        && value
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphanumeric())
        && value
            .chars()
            .last()
            .is_some_and(|c| c.is_ascii_alphanumeric())
    {
        Ok(())
    } else {
        Err(Error::Validation("invalid skill version".into()))
    }
}
fn model_id(value: &str) -> Result<()> {
    // Model IDs are opaque Gateway catalog values, not local path or table
    // keys. Providers commonly use names such as `openai/gpt-5` and
    // `publisher:model`; reject only values that cannot be projected safely.
    if !value.trim().is_empty() && value.len() <= 255 && !value.chars().any(char::is_control) {
        Ok(())
    } else {
        Err(Error::Validation("invalid model id".into()))
    }
}
fn secure(url: &Url) -> Result<()> {
    let secure_transport = url.scheme() == "https"
        || (url.scheme() == "http"
            && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1")));
    if secure_transport
        && url.host().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
    {
        Ok(())
    } else {
        Err(Error::Validation(format!("insecure endpoint {url}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provisioning_rejects_excessive_aggregate_skill_downloads() {
        let skills: Vec<_> = (0..5)
            .map(|index| {
                serde_json::json!({
                    "id":format!("skill-{index}"),
                    "name":format!("Skill {index}"),
                    "version":"1.0.0",
                    "archive":{
                        "url":format!("https://gateway.example/skill-{index}.zip"),
                        "sha256":"0000000000000000000000000000000000000000000000000000000000000000",
                        "size_bytes":MAX_SKILL_ARCHIVE_SIZE,
                        "format":"zip",
                        "authorization":"none"
                    }
                })
            })
            .collect();
        let bytes = serde_json::to_vec(&serde_json::json!({"success":true,"data":{
            "schema_version":2,
            "models":[{"id":"model-a","chat_capable":true}],
            "default_model":"model-a",
            "mcp_servers":[],
            "skills":skills
        }}))
        .expect("provisioning JSON");
        let error = Provisioning::parse(&bytes).expect_err("aggregate budget must be enforced");
        assert!(error.to_string().contains("256 MiB"));
    }

    #[test]
    fn provisioning_carries_the_account_projection() {
        let document = |usage: serde_json::Value| {
            serde_json::to_vec(&serde_json::json!({"success":true,"data":{
                "schema_version":2,
                "account":{"id":7,"username":"maker","display_name":"Maker","email":"maker@example.test","group":"pro"},
                "usage":usage,
                "billing":{
                    "portal_url":"https://gateway.example.test/dashboard/usage",
                    "wallet_fallback_allowed":true,
                    "subscriptions":[{
                        "id":11,"plan_id":3,"plan_title":"Pro","status":"active","unlimited":false,
                        "quota_total":100,"quota_used_current_period":25,
                        "current_period_start":1,"end_time":3,"next_reset_time":2,"wallet_fallback":true
                    }]
                },
                "models":[{"id":"model-a","chat_capable":true}],
                "default_model":"model-a",
                "mcp_servers":[],
                "skills":[]
            }}))
            .expect("provisioning JSON")
        };

        let provisioning = Provisioning::parse(&document(
            serde_json::json!({"wallet_quota_remaining":75,"lifetime_quota_used":25,"lifetime_request_count":9}),
        ))
        .expect("provisioning");
        let account = provisioning.account.expect("account");
        assert_eq!(account.username, "maker");
        let usage = provisioning.usage.expect("usage");
        assert_eq!(usage.wallet_quota_remaining, 75);
        assert_eq!(usage.lifetime_quota_used, 25);
        assert_eq!(usage.lifetime_request_count, 9);
        let billing = provisioning.billing.expect("billing");
        assert_eq!(billing.subscriptions[0].plan_title, "Pro");
        assert_eq!(billing.subscriptions[0].quota_used_current_period, 25);

        let error = Provisioning::parse(&document(
            serde_json::json!({"wallet_quota_remaining":-1,"lifetime_quota_used":0,"lifetime_request_count":0}),
        ))
        .expect_err("negative wallet balance must be rejected");
        assert!(error.to_string().contains("invalid usage snapshot"));

        assert!(
            Provisioning::direct(
                vec![Model {
                    id: "model-a".into(),
                    chat_capable: true,
                    responses_native: false,
                    description: None,
                    icon: None,
                    tags: Vec::new(),
                    endpoints: Vec::new(),
                    supported_reasoning: Vec::new(),
                    vendor: None,
                }],
                "model-a".into(),
            )
            .expect("direct provisioning")
            .account
            .is_none()
        );
    }

    #[test]
    fn responses_native_uses_flag_then_response_only_endpoints() {
        let flagged = Model {
            id: "gpt-5.6-sol".into(),
            chat_capable: true,
            responses_native: true,
            description: None,
            icon: None,
            tags: Vec::new(),
            endpoints: vec!["openai".into()],
            supported_reasoning: Vec::new(),
            vendor: None,
        };
        assert!(flagged.is_responses_native());

        let response_only = Model {
            id: "o3-pro".into(),
            chat_capable: true,
            responses_native: false,
            description: None,
            icon: None,
            tags: Vec::new(),
            endpoints: vec!["openai-response".into()],
            supported_reasoning: Vec::new(),
            vendor: None,
        };
        assert!(response_only.is_responses_native());

        let xai = Model {
            id: "grok-4.6".into(),
            chat_capable: true,
            responses_native: false,
            description: None,
            icon: None,
            tags: Vec::new(),
            endpoints: vec!["openai".into(), "openai-response".into()],
            supported_reasoning: Vec::new(),
            vendor: None,
        };
        assert!(!xai.is_responses_native());
        assert!(xai.is_codex_catalog_model());
        assert!(flagged.is_codex_catalog_model());
        assert!(response_only.is_codex_catalog_model());
    }

    #[test]
    fn api_endpoint_stays_on_the_provisioning_origin() {
        let manifest = ConnectionManifest::direct(
            Platform {
                id: "example".into(),
                name: "Example".into(),
            },
            Gateway {
                base_url: Url::parse("https://api.example.test").expect("base URL"),
                protocols: vec![crate::WireProtocol::OpenaiChat],
            },
            Url::parse("https://api.example.test/api/connector/provisioning")
                .expect("provisioning URL"),
        )
        .expect("manifest");
        assert_eq!(
            manifest
                .api_endpoint("api/user/self")
                .expect("endpoint")
                .as_str(),
            "https://api.example.test/api/user/self"
        );
        assert!(manifest.api_endpoint("../secret").is_err());
        assert!(manifest.api_endpoint("https://evil.test/x").is_err());
    }

    #[test]
    fn usage_window_snapshots_validate_bounds() {
        let stat = UsageStat::parse(br#"{"success":true,"data":{"quota":12,"rpm":3,"tpm":40}}"#)
            .expect("stat");
        assert_eq!(stat.rpm, 3);
        let buckets = UsageBucket::parse_series(br#"{"success":true,"data":[{"model_name":"chat","created_at":1,"token_used":8,"count":2,"quota":4}]}"#).expect("buckets");
        assert_eq!(buckets[0].count, 2);
        let month = usage_series_json(30 * 24 * 20, 20);
        let parsed = UsageBucket::parse_series(&month).expect("30-day series for 20 models");
        assert_eq!(parsed.len(), 30 * 24 * 20);
        let oversized = usage_series_json(MAX_USAGE_SERIES_ENTRIES + 1, 1);
        let error = UsageBucket::parse_series(&oversized).expect_err("series bound");
        assert!(
            error
                .to_string()
                .contains(&format!("usage series exceeds {MAX_USAGE_SERIES_ENTRIES}"))
        );
        let logs = RequestLogEntry::parse_page(br#"{"success":true,"data":{"page":1,"page_size":1,"total":1,"items":[{"id":9,"created_at":2,"model_name":"chat","token_name":"kit","quota":4,"prompt_tokens":1,"completion_tokens":2,"use_time":3}]}}"#).expect("logs");
        assert_eq!(logs[0].model_name, "chat");
    }

    fn usage_series_json(len: usize, models: usize) -> Vec<u8> {
        let models = models.max(1);
        let buckets: Vec<_> = (0..len)
            .map(|index| {
                serde_json::json!({
                    "model_name": format!("model-{}", index % models),
                    "created_at": 1_704_067_200i64 + (index as i64 / models as i64) * 3600,
                    "token_used": 8,
                    "count": 2,
                    "quota": 4
                })
            })
            .collect();
        serde_json::to_vec(&serde_json::json!({"success":true,"data":buckets}))
            .expect("series JSON")
    }
}
