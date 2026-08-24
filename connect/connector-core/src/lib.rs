//! Product-neutral profiles and transactional Agent configuration projection.

mod discovery;
mod model;
mod profile;
mod transaction;

pub use discovery::{AgentInstall, Discovery, FixedAgentRoots};
pub use model::{
    AccountSnapshot, AuthType, Authentication, Billing, ConnectionManifest, Gateway,
    MAX_CATALOG_ENTRIES, MAX_MCP_DESCRIPTION_BYTES, MAX_MODEL_CATALOG_ENTRIES, MAX_MODEL_TAGS,
    MAX_MODEL_TEXT_BYTES, MAX_SKILL_ARCHIVE_SIZE, MAX_SKILL_CATALOG_ARCHIVE_BYTES,
    MAX_USAGE_SERIES_ENTRIES, McpAuthorization, McpServer, Model, ModelPlaza, ModelVendor,
    Platform, Provisioning, RequestLogEntry, Secret, Skill, SkillArchive,
    SkillArchiveAuthorization, SubscriptionSnapshot, UsageBucket, UsageSnapshot, UsageStat,
};
pub use profile::{
    AgentId, AgentSelection, CanonicalBaseUrl, CodexApprovalPolicy, CodexReasoningEffort,
    CodexReasoningSummary, CodexSandboxMode, CodexSettings, CodexVerbosity, CodexWebSearch,
    ConnectionMode, ConnectionProfile, CredentialKind, CredentialRef, ProfileError, ProfileId,
    Protocol, WireProtocol,
};
pub use transaction::{
    ApplyInput, Change, ChangeKind, Connector, EffectiveAgentSelection, Plan, Verification,
};

use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("invalid connector data: {0}")]
    Validation(String),
    #[error("invalid configuration at {path}: {message}")]
    Config {
        path: std::path::PathBuf,
        message: String,
    },
    #[error("I/O error at {path}: {source}")]
    Io {
        path: std::path::PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("transaction failed: {0}")]
    Transaction(String),
}

pub type Result<T> = std::result::Result<T, Error>;

fn io(path: &std::path::Path, source: std::io::Error) -> Error {
    Error::Io {
        path: path.into(),
        source,
    }
}
