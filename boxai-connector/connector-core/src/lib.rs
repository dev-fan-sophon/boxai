//! UI-independent configuration projection core for branded Gateway Connectors.
mod discovery;
mod model;
mod transaction;

pub use discovery::{AgentInstall, Discovery};
pub use model::{
    Account, AgentId, AuthType, Billing, ConnectionManifest, MAX_SKILL_ARCHIVE_SIZE,
    McpAuthorization, Model, ModelPlaza, ModelVendor, Platform, Protocol, Provisioning, Secret,
    Skill, SkillArchiveAuthorization, Subscription, Usage, WireProtocol,
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
