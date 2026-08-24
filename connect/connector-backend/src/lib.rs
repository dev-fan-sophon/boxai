//! Network, local profile/credential config, and projection backend.

mod backend;
mod catalog;
mod discovery;
mod distribution;
mod install;
mod pkce;
mod profile_store;
mod update;
mod vault;

pub use backend::{
    BackendError, BrowserLoginOffer, ConnectRequest, ConnectRequestWithoutCredential,
    ConnectionResult, ConnectorBackend, ProbeResult,
};
pub use discovery::{
    DiscoveredManifest, DiscoveryError, GatewayClient, ModelCapability, ModelDescriptor, Overview,
};
pub use distribution::{
    AssetIdentity, Distribution, DistributionError, GENERIC_DISTRIBUTION, ReleaseMetadata,
};
pub use install::{
    INSTALL_DIRECTORY_NAME, InstallError, InstallPlan, NotInstalledReason, SHORTCUT_NAME,
    ShellIntegration, UNINSTALL_KEY_NAME, classify as classify_install, install, install_root,
    plan as plan_install, system_shell, uninstall,
};
pub use pkce::{Browser, PkceError, PkceFlow, SystemBrowser};
pub use profile_store::{InMemoryProfileStore, JsonProfileStore, ProfileStore, StoreError};
pub use update::{
    CONNECTOR_UPDATE_PUBLIC_KEY, ConnectorUpdateTarget, InstallKind, PackagedInstall, ReleaseFile,
    SignedUpdate, UpdateCheck, UpdateError, apply_signed_update, check_updates, is_newer,
    open_download_page, packaged_install, portal_origin, verify_artifact,
};
pub use vault::{
    ApiKey, CredentialStore, InMemoryCredentialStore, ProfileCredentialStore, VaultError,
};
