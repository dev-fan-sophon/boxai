//! Native, UI-independent BoxAI Connector orchestration.
pub mod backend;

pub use backend::{
    Account, BOXAI_DISTRIBUTION, Backend, BackendError, CredentialStore, Distribution, HttpClient,
    HttpResponse, LoginResult, LogoutStatus, OsCredentialStore, Status, SystemBrowser,
};
