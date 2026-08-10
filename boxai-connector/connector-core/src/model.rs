use crate::{Error, Result};
use serde::Deserialize;
use std::{collections::BTreeSet, fmt};
use url::Url;

pub const SCHEMA_VERSION: u32 = 2;
pub const MAX_SKILL_ARCHIVE_SIZE: u64 = 64 * 1024 * 1024;
pub const MAX_CATALOG_ENTRIES: usize = 256;
pub const MAX_MCP_DESCRIPTION_BYTES: usize = 1024;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentId {
    Claude,
    Codex,
    Gemini,
    Grokbuild,
    Opencode,
}
impl AgentId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Gemini => "gemini",
            Self::Grokbuild => "grokbuild",
            Self::Opencode => "opencode",
        }
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
    pub protocols: Vec<String>,
}
#[derive(Debug, Clone, Deserialize)]
pub struct ConnectionManifest {
    pub schema_version: u32,
    pub platform: Platform,
    pub authentication: Authentication,
    pub gateway: Gateway,
    pub provisioning_url: Url,
    pub connection_bearer_origins: Vec<Url>,
    pub supported_agents: Vec<AgentId>,
}

#[derive(Deserialize)]
struct ResponseEnvelope<T> {
    success: bool,
    data: T,
}
impl ConnectionManifest {
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
        secure(&self.authentication.authorize_url)?;
        secure(&self.authentication.token_url)?;
        secure(&self.gateway.base_url)?;
        secure(&self.provisioning_url)?;
        if self.gateway.base_url.origin() != self.provisioning_url.origin() {
            return Err(Error::Validation(
                "provisioning and gateway origins do not match".into(),
            ));
        }
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
        if self.supported_agents.is_empty() {
            return Err(Error::Validation("supported_agents is empty".into()));
        }
        unique(
            self.supported_agents.iter().map(|a| a.as_str()),
            "supported agent",
        )?;
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct Model {
    pub id: String,
    #[serde(default)]
    pub chat_capable: bool,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub vendor: Option<ModelVendor>,
}
#[derive(Debug, Clone, Deserialize)]
pub struct ModelVendor {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub icon: Option<String>,
}
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct Account {
    pub id: i64,
    pub username: String,
    pub display_name: String,
    pub email: String,
    pub group: String,
}
#[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq)]
pub struct Usage {
    pub wallet_quota_remaining: u64,
    pub lifetime_quota_used: u64,
    pub lifetime_request_count: u64,
}
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct Subscription {
    pub id: u64,
    pub plan_id: u64,
    pub status: String,
    pub unlimited: bool,
    pub quota_total: u64,
    pub quota_used_current_period: u64,
    pub current_period_start: u64,
    pub end_time: u64,
    pub next_reset_time: u64,
    pub wallet_fallback: bool,
}
#[derive(Debug, Clone, Deserialize)]
pub struct Billing {
    pub portal_url: Url,
    pub wallet_fallback_allowed: bool,
    pub subscriptions: Vec<Subscription>,
}
#[derive(Debug, Clone, Deserialize)]
pub struct ModelPlaza {
    pub portal_url: Url,
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
    pub account: Account,
    pub usage: Usage,
    pub billing: Billing,
    pub model_plaza: ModelPlaza,
    pub models: Vec<Model>,
    pub default_model: String,
    pub mcp_servers: Vec<McpServer>,
    pub skills: Vec<Skill>,
}
impl Provisioning {
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
        if self.account.id < 0 {
            return Err(Error::Validation("invalid account id".into()));
        }
        bounded_text(&self.account.username, "account username", 128, false)?;
        bounded_text(
            &self.account.display_name,
            "account display name",
            255,
            true,
        )?;
        bounded_text(&self.account.email, "account email", 320, true)?;
        bounded_text(&self.account.group, "account group", 128, false)?;
        secure(&self.billing.portal_url)?;
        secure(&self.model_plaza.portal_url)?;
        for subscription in &self.billing.subscriptions {
            bounded_text(&subscription.status, "subscription status", 64, false)?;
            if subscription.id == 0
                || subscription.plan_id == 0
                || subscription.unlimited != (subscription.quota_total == 0)
                || (!subscription.unlimited
                    && subscription.quota_used_current_period > subscription.quota_total)
                || subscription.current_period_start > subscription.end_time
                || (subscription.next_reset_time != 0
                    && (subscription.next_reset_time < subscription.current_period_start
                        || subscription.next_reset_time > subscription.end_time))
            {
                return Err(Error::Validation("invalid subscription".into()));
            }
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
        let mut ids = BTreeSet::new();
        for m in &self.models {
            model_id(&m.id)?;
            if !ids.insert(&m.id) {
                return Err(Error::Validation(format!("duplicate model id {}", m.id)));
            }
            if !m.chat_capable {
                return Err(Error::Validation(
                    "Agent model catalog contains a non-chat model".into(),
                ));
            }
            validate_model_metadata(m)?;
        }
        let mut plaza_ids = BTreeSet::new();
        let mut plaza_chat_ids = BTreeSet::new();
        for m in &self.model_plaza.models {
            model_id(&m.id)?;
            if !plaza_ids.insert(&m.id) {
                return Err(Error::Validation(format!(
                    "duplicate Model Plaza id {}",
                    m.id
                )));
            }
            if m.chat_capable {
                plaza_chat_ids.insert(&m.id);
            }
            validate_model_metadata(m)?;
        }
        if !ids.iter().all(|id| plaza_chat_ids.contains(id)) {
            return Err(Error::Validation(
                "Agent model catalog is inconsistent with Model Plaza".into(),
            ));
        }
        if ids.is_empty() && !self.default_model.is_empty() {
            return Err(Error::Validation(
                "empty Agent model catalog requires empty default_model".into(),
            ));
        }
        if !ids.is_empty() && !ids.contains(&self.default_model) {
            return Err(Error::Validation(
                "default_model is outside the Agent model catalog".into(),
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
fn validate_model_metadata(m: &Model) -> Result<()> {
    optional_metadata(&m.description, "model description", 2048)?;
    optional_metadata(&m.icon, "model icon", 1024)?;
    if m.tags.len() > 64 {
        return Err(Error::Validation("too many model tags".into()));
    }
    for tag in &m.tags {
        bounded_text(tag, "model tag", 128, false)?;
    }
    if let Some(vendor) = &m.vendor {
        bounded_text(&vendor.id, "vendor id", 128, false)?;
        bounded_text(&vendor.name, "vendor name", 255, false)?;
        optional_metadata(&vendor.icon, "vendor icon", 1024)?;
    }
    Ok(())
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
fn bounded_text(value: &str, label: &str, max: usize, allow_empty: bool) -> Result<()> {
    if (allow_empty || !value.trim().is_empty())
        && value.len() <= max
        && !value.chars().any(char::is_control)
    {
        Ok(())
    } else {
        Err(Error::Validation(format!("invalid {label}")))
    }
}
fn optional_metadata(value: &Option<String>, label: &str, max: usize) -> Result<()> {
    match value {
        Some(value) => bounded_text(value, label, max, true),
        None => Ok(()),
    }
}
fn secure(url: &Url) -> Result<()> {
    if url.scheme() == "https"
        || (url.scheme() == "http"
            && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1")))
    {
        Ok(())
    } else {
        Err(Error::Validation(format!("insecure endpoint {url}")))
    }
}
