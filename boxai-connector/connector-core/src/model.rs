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
            if !m.chat_capable {
                return Err(Error::Validation(format!(
                    "model {} is not chat-capable",
                    m.id
                )));
            }
            if !ids.insert(&m.id) {
                return Err(Error::Validation(format!("duplicate model id {}", m.id)));
            }
        }
        if ids.is_empty() && !self.default_model.is_empty() {
            return Err(Error::Validation(
                "empty catalog requires empty default_model".into(),
            ));
        }
        if !ids.is_empty() && !ids.contains(&self.default_model) {
            return Err(Error::Validation("default_model is outside catalog".into()));
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
    if url.scheme() == "https"
        || (url.scheme() == "http"
            && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1")))
    {
        Ok(())
    } else {
        Err(Error::Validation(format!("insecure endpoint {url}")))
    }
}
