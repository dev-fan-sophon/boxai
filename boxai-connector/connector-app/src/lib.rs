//! Native, UI-independent BoxAI Connector orchestration.
pub mod backend;
pub mod localization;
pub mod ui_state;

pub use backend::{
    BOXAI_DISTRIBUTION, Backend, BackendError, CredentialStore, Distribution, HttpClient,
    HttpResponse, LoginResult, LogoutStatus, OsCredentialStore, Status, SystemBrowser,
};
pub use connector_core::Account;
