use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use connector_core::{
    AgentId, AgentInstall, ApplyInput, ConnectionManifest, Connector, Discovery,
    MAX_SKILL_ARCHIVE_SIZE, Plan, Provisioning, Secret, SkillArchiveAuthorization, Verification,
};
use directories::ProjectDirs;
use fs2::FileExt;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Read, Write},
    net::{Ipv4Addr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};
use thiserror::Error;
use url::Url;

const LOGIN_TIMEOUT: Duration = Duration::from_secs(600);
const CONTROL_RESPONSE_LIMIT: u64 = 2 * 1024 * 1024;
const MAX_ZIP_ENTRIES: usize = 4096;
const MAX_UNCOMPRESSED_SKILL_BYTES: u64 = 256 * 1024 * 1024;
const MAX_SKILLS: usize = 256;
const MAX_CATALOG_ARCHIVE_BYTES: u64 = 256 * 1024 * 1024;
const OWNER_MARKER: &str = ".gateway-connector-owner";

#[derive(Debug, Clone)]
pub struct Distribution {
    pub application_name: &'static str,
    pub expected_platform_id: &'static str,
    pub device_name: &'static str,
    pub qualifier: &'static str,
    pub organization: &'static str,
    pub state_application: &'static str,
    pub keyring_service: &'static str,
    pub default_manifest_url: &'static str,
    pub debug_manifest_env: &'static str,
}
pub const BOXAI_DISTRIBUTION: Distribution = Distribution {
    application_name: "BoxAI Connector",
    expected_platform_id: "boxai",
    device_name: "BoxAI Connector",
    qualifier: "dev",
    organization: "BoxAI",
    state_application: "BoxAI Connector",
    keyring_service: "com.you-box.connector",
    default_manifest_url: "https://you-box.com/api/v1/connector/manifest",
    debug_manifest_env: "BOXAI_CONNECTOR_MANIFEST_URL",
};

#[derive(Debug, Error)]
pub enum BackendError {
    #[error("connector data error: {0}")]
    Core(#[from] connector_core::Error),
    #[error("network request failed")]
    Network,
    #[error("gateway returned HTTP {0}")]
    Http(u16),
    #[error("invalid gateway response")]
    Response,
    #[error("sign-in timed out")]
    Timeout,
    #[error("sign-in callback state did not match")]
    StateMismatch,
    #[error("sign-in was declined: {0}")]
    LoginDenied(String),
    #[error("credential storage is unavailable")]
    Credential,
    #[error("local state error at {path}: {message}")]
    State { path: PathBuf, message: String },
    #[error("could not open the system browser")]
    Browser,
    #[error("credential could not be stored and remote revocation is still pending")]
    PendingRevocation,
}

pub type Result<T> = std::result::Result<T, BackendError>;

/// Secret wrapper used only at external-effect boundaries. Its Debug output is redacted.
#[derive(Clone)]
pub struct Bearer(String);
impl std::fmt::Debug for Bearer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Bearer([REDACTED])")
    }
}
impl Bearer {
    fn core_secret(&self) -> Result<Secret> {
        Ok(Secret::new(self.0.clone())?)
    }
}

pub trait CredentialStore: Send + Sync {
    fn get(&self, platform: &str) -> Result<Option<Bearer>>;
    fn set(&self, platform: &str, bearer: &Bearer) -> Result<()>;
    fn delete(&self, platform: &str) -> Result<()>;
}

#[derive(Debug)]
pub struct OsCredentialStore {
    service: &'static str,
}
impl OsCredentialStore {
    fn entry(&self, platform: &str) -> Result<keyring::Entry> {
        keyring::Entry::new(self.service, &format!("platform:{platform}"))
            .map_err(|_| BackendError::Credential)
    }
}
impl CredentialStore for OsCredentialStore {
    fn get(&self, platform: &str) -> Result<Option<Bearer>> {
        match self.entry(platform)?.get_password() {
            Ok(value) => Ok(Some(Bearer(value))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(BackendError::Credential),
        }
    }
    fn set(&self, platform: &str, bearer: &Bearer) -> Result<()> {
        self.entry(platform)?
            .set_password(&bearer.0)
            .map_err(|_| BackendError::Credential)
    }
    fn delete(&self, platform: &str) -> Result<()> {
        match self.entry(platform)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(BackendError::Credential),
        }
    }
}

#[derive(Debug, Clone)]
pub struct HttpResponse {
    pub status: u16,
    pub body: Vec<u8>,
    pub content_length: Option<u64>,
}
pub trait HttpClient: Send + Sync {
    fn get(&self, url: &Url, bearer: Option<&Bearer>) -> Result<HttpResponse>;
    fn get_bounded(
        &self,
        url: &Url,
        bearer: Option<&Bearer>,
        max_bytes: u64,
    ) -> Result<HttpResponse> {
        let response = self.get(url, bearer)?;
        if response
            .content_length
            .is_some_and(|length| length > max_bytes)
            || response.body.len() as u64 > max_bytes
        {
            return Err(BackendError::Response);
        }
        Ok(response)
    }
    fn post_json(&self, url: &Url, body: serde_json::Value) -> Result<HttpResponse>;
    fn post_empty(&self, url: &Url, bearer: &Bearer) -> Result<HttpResponse>;
}

struct ReqwestHttp(reqwest::blocking::Client);
impl Default for ReqwestHttp {
    fn default() -> Self {
        Self(
            reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(30))
                .redirect(reqwest::redirect::Policy::custom(|attempt| {
                    let Some(initial) = attempt.previous().first() else {
                        return attempt.stop();
                    };
                    if attempt.previous().len() >= 10 {
                        attempt.error("too many redirects")
                    } else if same_request_origin(initial, attempt.url()) {
                        attempt.follow()
                    } else {
                        attempt.stop()
                    }
                }))
                .build()
                .expect("valid HTTP client"),
        )
    }
}
fn same_request_origin(initial: &Url, destination: &Url) -> bool {
    initial.origin() == destination.origin()
}
impl ReqwestHttp {
    fn response(mut response: reqwest::blocking::Response, max_bytes: u64) -> Result<HttpResponse> {
        let status = response.status().as_u16();
        let content_length = response.content_length();
        if content_length.is_some_and(|length| length > max_bytes) {
            return Err(BackendError::Response);
        }
        let mut body = Vec::new();
        response
            .by_ref()
            .take(max_bytes + 1)
            .read_to_end(&mut body)
            .map_err(|_| BackendError::Network)?;
        if body.len() as u64 > max_bytes {
            return Err(BackendError::Response);
        }
        Ok(HttpResponse {
            status,
            body,
            content_length,
        })
    }
}
impl HttpClient for ReqwestHttp {
    fn get(&self, url: &Url, bearer: Option<&Bearer>) -> Result<HttpResponse> {
        self.get_bounded(url, bearer, CONTROL_RESPONSE_LIMIT)
    }
    fn get_bounded(
        &self,
        url: &Url,
        bearer: Option<&Bearer>,
        max_bytes: u64,
    ) -> Result<HttpResponse> {
        let mut request = self.0.get(url.clone());
        if let Some(value) = bearer {
            request = request.bearer_auth(&value.0);
        }
        Self::response(
            request.send().map_err(|_| BackendError::Network)?,
            max_bytes,
        )
    }
    fn post_json(&self, url: &Url, body: serde_json::Value) -> Result<HttpResponse> {
        Self::response(
            self.0
                .post(url.clone())
                .json(&body)
                .send()
                .map_err(|_| BackendError::Network)?,
            CONTROL_RESPONSE_LIMIT,
        )
    }
    fn post_empty(&self, url: &Url, bearer: &Bearer) -> Result<HttpResponse> {
        Self::response(
            self.0
                .post(url.clone())
                .bearer_auth(&bearer.0)
                .send()
                .map_err(|_| BackendError::Network)?,
            CONTROL_RESPONSE_LIMIT,
        )
    }
}

pub trait Browser: Send + Sync {
    fn open(&self, url: &Url) -> Result<()>;
}
#[derive(Debug, Default)]
pub struct SystemBrowser;
impl Browser for SystemBrowser {
    fn open(&self, url: &Url) -> Result<()> {
        webbrowser::open(url.as_str())
            .map(|_| ())
            .map_err(|_| BackendError::Browser)
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Account {
    pub id: i64,
    pub username: String,
    pub display_name: String,
    pub email: String,
    pub quota: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PlatformState {
    account: Option<Account>,
    models: BTreeMap<String, String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PersistedState {
    platforms: BTreeMap<String, PlatformState>,
}

#[derive(Debug)]
pub struct Status {
    pub manifest: ConnectionManifest,
    pub connected: bool,
    pub managed_projection: bool,
    pub pending_revocation: bool,
    pub account: Option<Account>,
    pub provisioning: Option<Provisioning>,
    pub provisioning_error: Option<String>,
    pub selected_models: BTreeMap<AgentId, String>,
    pub installs: Vec<AgentInstall>,
}
#[derive(Debug)]
pub struct LoginResult {
    pub account: Option<Account>,
    pub provisioning: Provisioning,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogoutStatus {
    Revoked,
    Unsupported,
}

pub struct Backend {
    distribution: Distribution,
    state_dir: PathBuf,
    projection_coordinator_dir: PathBuf,
    home: PathBuf,
    http: Arc<dyn HttpClient>,
    credentials: Arc<dyn CredentialStore>,
    browser: Arc<dyn Browser>,
    discovery: Discovery,
    pending_revocation: std::sync::Mutex<Option<(ConnectionManifest, Bearer)>>,
}
impl Backend {
    pub fn new() -> Result<Self> {
        Self::new_for_distribution(BOXAI_DISTRIBUTION)
    }
    pub fn new_for_distribution(distribution: Distribution) -> Result<Self> {
        let dirs = ProjectDirs::from(
            distribution.qualifier,
            distribution.organization,
            distribution.state_application,
        )
        .ok_or_else(|| BackendError::State {
            path: PathBuf::new(),
            message: "no standard application data directory".into(),
        })?;
        // Every independently branded Connector owns its state and vault
        // namespace, but they edit the same Agent configuration files. Keep
        // their projection lock and secret-free ownership leases in one
        // vendor-neutral per-user directory.
        let coordinator = ProjectDirs::from("dev", "GatewayConnector", "ProjectionCoordinator")
            .ok_or_else(|| BackendError::State {
                path: PathBuf::new(),
                message: "no standard projection coordinator directory".into(),
            })?;
        let home = directories::UserDirs::new()
            .map(|d| d.home_dir().to_owned())
            .ok_or_else(|| BackendError::State {
                path: PathBuf::new(),
                message: "no home directory".into(),
            })?;
        Ok(Self::with_all_dependencies(
            dirs.data_local_dir().to_owned(),
            coordinator.data_local_dir().to_owned(),
            home,
            Arc::new(ReqwestHttp::default()),
            Arc::new(OsCredentialStore {
                service: distribution.keyring_service,
            }),
            Arc::new(SystemBrowser),
            distribution,
        ))
    }
    pub fn with_dependencies(
        state_dir: PathBuf,
        home: PathBuf,
        http: Arc<dyn HttpClient>,
        credentials: Arc<dyn CredentialStore>,
        browser: Arc<dyn Browser>,
    ) -> Self {
        Self::with_distribution_dependencies(
            state_dir,
            home,
            http,
            credentials,
            browser,
            BOXAI_DISTRIBUTION,
        )
    }
    pub fn with_distribution_dependencies(
        state_dir: PathBuf,
        home: PathBuf,
        http: Arc<dyn HttpClient>,
        credentials: Arc<dyn CredentialStore>,
        browser: Arc<dyn Browser>,
        distribution: Distribution,
    ) -> Self {
        let coordinator = state_dir.join("projection-coordinator");
        Self::with_all_dependencies(
            state_dir,
            coordinator,
            home,
            http,
            credentials,
            browser,
            distribution,
        )
    }
    fn with_all_dependencies(
        state_dir: PathBuf,
        projection_coordinator_dir: PathBuf,
        home: PathBuf,
        http: Arc<dyn HttpClient>,
        credentials: Arc<dyn CredentialStore>,
        browser: Arc<dyn Browser>,
        distribution: Distribution,
    ) -> Self {
        Self {
            distribution,
            state_dir,
            projection_coordinator_dir,
            home,
            http,
            credentials,
            browser,
            discovery: Discovery::default(),
            pending_revocation: std::sync::Mutex::new(None),
        }
    }
    pub fn application_name(&self) -> &'static str {
        self.distribution.application_name
    }
    pub fn manifest_url(&self) -> Result<Url> {
        let raw = if cfg!(any(debug_assertions, test)) {
            std::env::var(self.distribution.debug_manifest_env)
                .unwrap_or_else(|_| self.distribution.default_manifest_url.into())
        } else {
            self.distribution.default_manifest_url.into()
        };
        Url::parse(&raw).map_err(|_| BackendError::Response)
    }
    pub fn fetch_manifest(&self) -> Result<ConnectionManifest> {
        let response = self.http.get(&self.manifest_url()?, None)?;
        successful(&response)?;
        let manifest = ConnectionManifest::parse(&response.body)?;
        if manifest.platform.id != self.distribution.expected_platform_id {
            return Err(connector_core::Error::Validation(format!(
                "{} cannot connect to platform {}",
                self.distribution.application_name, manifest.platform.id
            ))
            .into());
        }
        Ok(manifest)
    }
    pub fn load_status(&self) -> Result<Status> {
        let manifest = self.fetch_manifest()?;
        let bearer = self.credentials.get(&manifest.platform.id)?;
        let managed_projection = self.connector().has_receipt(&manifest.platform.id);
        let pending_revocation = self
            .pending_revocation
            .lock()
            .map_err(|_| BackendError::Credential)?
            .as_ref()
            .is_some_and(|(pending, _)| pending.platform.id == manifest.platform.id);
        let mut provisioning_error = None;
        let provisioning = match bearer.as_ref() {
            // Startup is also reconciliation: restore synchronized Skills
            // source and discard model choices the Gateway no longer offers.
            Some(value) => match self.refresh_provisioning_with(&manifest, value) {
                Ok(provisioning) => Some(provisioning),
                Err(error) => {
                    // Keep the credential reachable for retry or self-revoke.
                    // A transient provisioning outage must not strand a key in
                    // the vault behind a wholly unavailable UI.
                    provisioning_error = Some(error.to_string());
                    None
                }
            },
            None => None,
        };
        if bearer.is_none() && managed_projection {
            provisioning_error = Some(
                "Managed Agent configuration exists, but its vault credential is unavailable; automatic cleanup is blocked"
                    .into(),
            );
        } else if pending_revocation {
            provisioning_error = Some(
                "A newly minted credential could not be stored; remote revocation must be retried"
                    .into(),
            );
        }
        let state = self.load_state()?;
        let account = state
            .platforms
            .get(&manifest.platform.id)
            .and_then(|p| p.account.clone());
        let selected_models = provisioning
            .as_ref()
            .map(|p| self.reconciled_models(&manifest, p, &state))
            .unwrap_or_default();
        Ok(Status {
            manifest,
            connected: bearer.is_some(),
            managed_projection,
            pending_revocation,
            account,
            provisioning,
            provisioning_error,
            selected_models,
            installs: self.discover_clients(),
        })
    }
    pub fn connect(&self) -> Result<LoginResult> {
        let manifest = self.fetch_manifest()?;
        if self.connection_exists(&manifest.platform.id)? {
            return Err(connector_core::Error::Validation(
                "this platform is already connected; sign out before reconnecting".into(),
            )
            .into());
        }
        let listener =
            TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(state_io(&self.state_dir))?;
        let redirect = format!(
            "http://127.0.0.1:{}/callback",
            listener
                .local_addr()
                .map_err(state_io(&self.state_dir))?
                .port()
        );
        let verifier = random_urlsafe(32);
        let state = random_urlsafe(24);
        let mut authorize = manifest.authentication.authorize_url.clone();
        authorize
            .query_pairs_mut()
            .append_pair("client", "boxai-connector")
            .append_pair(
                "device_name",
                &self
                    .distribution
                    .device_name
                    .chars()
                    .take(80)
                    .collect::<String>(),
            )
            .append_pair("redirect_uri", &redirect)
            .append_pair("code_challenge", &pkce_challenge(&verifier))
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", &state);
        self.browser.open(&authorize)?;
        let code = await_callback(listener, &state, LOGIN_TIMEOUT)?;
        let lifecycle = self.lifecycle_lock()?;
        // Another process may have completed sign-in while this browser flow
        // was open. Re-check before redemption so no second key is minted.
        if self.connection_exists(&manifest.platform.id)? {
            return Err(connector_core::Error::Validation(
                "this platform was connected by another process".into(),
            )
            .into());
        }
        let response = self.http.post_json(
            &manifest.authentication.token_url,
            serde_json::json!({"code":code,"code_verifier":verifier,"redirect_uri":redirect}),
        )?;
        successful(&response)?;
        let token: TokenResponse =
            serde_json::from_slice(&response.body).map_err(|_| BackendError::Response)?;
        if !token.token_type.eq_ignore_ascii_case("bearer") {
            return Err(BackendError::Response);
        }
        let bearer = Bearer(
            token
                .access_token
                .filter(|value| !value.is_empty())
                .ok_or(BackendError::Response)?,
        );
        let _ = bearer.core_secret()?;
        if let Err(error) = self.credentials.set(&manifest.platform.id, &bearer) {
            // Redemption already minted a durable credential. If the OS vault
            // rejects it, revoke immediately rather than orphaning a usable
            // key the user cannot discover or remove from Kit.
            match self.revoke_connector_credential(&manifest, &bearer) {
                Ok(response) if confirmed_inert(response.status).is_some() => return Err(error),
                _ => {
                    *self
                        .pending_revocation
                        .lock()
                        .map_err(|_| BackendError::Credential)? = Some((manifest, bearer));
                    return Err(BackendError::PendingRevocation);
                }
            }
        }
        self.update_state(|persisted| {
            persisted
                .platforms
                .entry(manifest.platform.id.clone())
                .or_default()
                .account = token.account.clone();
        })?;
        drop(lifecycle);
        let provisioning = self.refresh_provisioning_with(&manifest, &bearer)?;
        Ok(LoginResult {
            account: token.account,
            provisioning,
        })
    }
    pub fn refresh_provisioning(&self) -> Result<Provisioning> {
        let manifest = self.fetch_manifest()?;
        let bearer = self
            .credentials
            .get(&manifest.platform.id)?
            .ok_or(BackendError::Credential)?;
        self.refresh_provisioning_with(&manifest, &bearer)
    }
    fn refresh_provisioning_with(
        &self,
        manifest: &ConnectionManifest,
        bearer: &Bearer,
    ) -> Result<Provisioning> {
        let _lifecycle = self.lifecycle_lock()?;
        if self
            .credentials
            .get(&manifest.platform.id)?
            .as_ref()
            .map(|current| current.0.as_str())
            != Some(bearer.0.as_str())
        {
            return Err(BackendError::Credential);
        }
        let value = self.fetch_provisioning(manifest, bearer)?;
        self.update_state(|state| {
            let reconciled = self.reconciled_models(manifest, &value, state);
            state
                .platforms
                .entry(manifest.platform.id.clone())
                .or_default()
                .models = model_map_to_strings(&reconciled);
        })?;
        self.synchronize_skills(manifest, &value, bearer)?;
        Ok(value)
    }
    fn fetch_provisioning(
        &self,
        manifest: &ConnectionManifest,
        bearer: &Bearer,
    ) -> Result<Provisioning> {
        let response = self.http.get(&manifest.provisioning_url, Some(bearer))?;
        successful(&response)?;
        let value = Provisioning::parse(&response.body)?;
        value.validate_for(manifest)?;
        Ok(value)
    }
    pub fn update_model_choice(
        &self,
        platform: &str,
        agent: AgentId,
        model: &str,
        provisioning: &Provisioning,
    ) -> Result<()> {
        if !provisioning.models.iter().any(|item| item.id == model) {
            return Err(connector_core::Error::Validation(
                "selected model is outside catalog".into(),
            )
            .into());
        }
        self.update_state(|state| {
            state
                .platforms
                .entry(platform.into())
                .or_default()
                .models
                .insert(agent.as_str().into(), model.into());
        })
    }
    pub fn discover_clients(&self) -> Vec<AgentInstall> {
        self.discovery.discover(&self.home)
    }
    pub fn plan(
        &self,
        manifest: &ConnectionManifest,
        provisioning: &Provisioning,
        installs: Vec<AgentInstall>,
    ) -> Result<Plan> {
        let _lifecycle = self.lifecycle_lock()?;
        let bearer = self
            .credentials
            .get(&manifest.platform.id)?
            .ok_or(BackendError::Credential)?;
        let secret = bearer.core_secret()?;
        let state = self.load_state()?;
        let models = self.reconciled_models(manifest, provisioning, &state);
        Ok(self.connector().plan(ApplyInput {
            manifest,
            provisioning,
            bearer: &secret,
            selected_models: models,
            installs,
            synchronized_skills: self.skill_paths(&manifest.platform.id, provisioning)?,
        })?)
    }
    pub fn apply(&self, plan: &Plan) -> Result<()> {
        let _lifecycle = self.lifecycle_lock()?;
        let bearer = self
            .credentials
            .get(&plan.platform_id)?
            .ok_or(BackendError::Credential)?;
        if !plan.credential_matches(&bearer.core_secret()?)? {
            return Err(connector_core::Error::Validation(
                "the Gateway credential changed after this plan was created; preview again".into(),
            )
            .into());
        }
        Ok(self.connector().apply(plan)?)
    }
    pub fn verify(&self, plan: &Plan) -> Result<Verification> {
        Ok(self.connector().verify(plan)?)
    }
    pub fn disconnect(&self, platform: &str) -> Result<()> {
        let _lifecycle = self.lifecycle_lock()?;
        let bearer = self
            .credentials
            .get(platform)?
            .ok_or(BackendError::Credential)?;
        Ok(self
            .connector()
            .disconnect(platform, &bearer.core_secret()?)?)
    }
    pub fn logout(&self) -> Result<LogoutStatus> {
        let _lifecycle = self.lifecycle_lock()?;
        let pending = self
            .pending_revocation
            .lock()
            .map_err(|_| BackendError::Credential)?
            .clone();
        let manifest = if let Some((manifest, bearer)) = pending {
            if self.credentials.set(&manifest.platform.id, &bearer).is_ok() {
                *self
                    .pending_revocation
                    .lock()
                    .map_err(|_| BackendError::Credential)? = None;
                manifest
            } else {
                let response = self.revoke_connector_credential(&manifest, &bearer)?;
                let status =
                    confirmed_inert(response.status).ok_or(BackendError::Http(response.status))?;
                *self
                    .pending_revocation
                    .lock()
                    .map_err(|_| BackendError::Credential)? = None;
                return Ok(status);
            }
        } else {
            self.fetch_manifest()?
        };
        let bearer = self.credentials.get(&manifest.platform.id)?;
        if bearer.is_none() && self.connector().has_receipt(&manifest.platform.id) {
            return Err(connector_core::Error::Validation(
                "managed Agent configuration still exists, but its vault credential is unavailable"
                    .into(),
            )
            .into());
        }
        let status = if let Some(bearer) = bearer.as_ref() {
            // Projection ownership is encrypted with this credential. Never
            // revoke or discard the only decryption key until local cleanup
            // has completed transactionally.
            self.connector()
                .disconnect(&manifest.platform.id, &bearer.core_secret()?)?;
            let response = self.revoke_connector_credential(&manifest, bearer)?;
            if let Some(status) = accepted_revoke(response.status) {
                status
            } else {
                // Keep the credential so remote revocation remains retryable.
                // Local projections are already safely gone and disconnect is
                // idempotent on the next attempt.
                return Err(BackendError::Http(response.status));
            }
        } else {
            LogoutStatus::Unsupported
        };
        self.update_state(|state| {
            state.platforms.remove(&manifest.platform.id);
        })?;
        self.credentials.delete(&manifest.platform.id)?;
        Ok(status)
    }
    fn revoke_connector_credential(
        &self,
        manifest: &ConnectionManifest,
        bearer: &Bearer,
    ) -> Result<HttpResponse> {
        let mut url = manifest.provisioning_url.clone();
        let path = url.path().trim_end_matches('/');
        let prefix = path
            .strip_suffix("/provisioning")
            .ok_or(BackendError::Response)?;
        url.set_path(&format!("{prefix}/revoke"));
        url.set_query(None);
        url.set_fragment(None);
        self.http.post_empty(&url, bearer)
    }
    fn connector(&self) -> Connector {
        Connector::with_coordinator(
            self.state_dir.join("connector"),
            self.projection_coordinator_dir.clone(),
        )
    }
    fn connection_exists(&self, platform: &str) -> Result<bool> {
        Ok(self.credentials.get(platform)?.is_some()
            || self.connector().has_receipt(platform)
            || self
                .pending_revocation
                .lock()
                .map_err(|_| BackendError::Credential)?
                .is_some())
    }
    fn lifecycle_lock(&self) -> Result<fs::File> {
        fs::create_dir_all(&self.state_dir).map_err(state_io(&self.state_dir))?;
        let path = self.state_dir.join("lifecycle.lock");
        let file = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&path)
            .map_err(state_io(&path))?;
        file.lock_exclusive().map_err(state_io(&path))?;
        Ok(file)
    }
    fn state_path(&self) -> PathBuf {
        self.state_dir.join("state.json")
    }
    fn load_state(&self) -> Result<PersistedState> {
        let path = self.state_path();
        if !path.exists() {
            return Ok(PersistedState::default());
        }
        serde_json::from_slice(&fs::read(&path).map_err(state_io(&path))?).map_err(|e| {
            BackendError::State {
                path,
                message: e.to_string(),
            }
        })
    }
    fn save_state(&self, state: &PersistedState) -> Result<()> {
        atomic_json(&self.state_path(), state)
    }
    fn update_state<T>(&self, update: impl FnOnce(&mut PersistedState) -> T) -> Result<T> {
        fs::create_dir_all(&self.state_dir).map_err(state_io(&self.state_dir))?;
        let lock_path = self.state_dir.join("state.lock");
        let lock = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&lock_path)
            .map_err(state_io(&lock_path))?;
        lock.lock_exclusive().map_err(state_io(&lock_path))?;
        let mut state = self.load_state()?;
        let result = update(&mut state);
        self.save_state(&state)?;
        Ok(result)
    }
    fn reconciled_models(
        &self,
        manifest: &ConnectionManifest,
        provisioning: &Provisioning,
        state: &PersistedState,
    ) -> BTreeMap<AgentId, String> {
        let valid: BTreeSet<&str> = provisioning.models.iter().map(|m| m.id.as_str()).collect();
        manifest
            .supported_agents
            .iter()
            .copied()
            .map(|agent| {
                let selected = state
                    .platforms
                    .get(&manifest.platform.id)
                    .and_then(|p| p.models.get(agent.as_str()))
                    .filter(|m| valid.contains(m.as_str()))
                    .cloned()
                    .unwrap_or_else(|| provisioning.default_model.clone());
                (agent, selected)
            })
            .collect()
    }
    fn synchronize_skills(
        &self,
        manifest: &ConnectionManifest,
        provisioning: &Provisioning,
        bearer: &Bearer,
    ) -> Result<()> {
        if provisioning.skills.len() > MAX_SKILLS
            || provisioning
                .skills
                .iter()
                .try_fold(0u64, |total, skill| {
                    total.checked_add(skill.archive.size_bytes)
                })
                .is_none_or(|total| total > MAX_CATALOG_ARCHIVE_BYTES)
        {
            return Err(connector_core::Error::Validation(
                "Skill catalog exceeds client limit".into(),
            )
            .into());
        }
        let root = self
            .state_dir
            .join("synchronized-skills")
            .join(&manifest.platform.id);
        reconcile_skill_staging(&root)?;
        let nonce = format!(
            "{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let staged = root.with_extension(format!("staged-{nonce}"));
        let previous = root.with_extension(format!("previous-{nonce}"));
        let result = (|| -> Result<()> {
            fs::create_dir_all(&staged).map_err(state_io(&staged))?;
            for skill in &provisioning.skills {
                if skill.archive.size_bytes > MAX_SKILL_ARCHIVE_SIZE {
                    return Err(connector_core::Error::Validation(
                        "Skill archive exceeds client download limit".into(),
                    )
                    .into());
                }
                if skill.archive.authorization == SkillArchiveAuthorization::ConnectionBearer
                    && !manifest
                        .connection_bearer_origins
                        .iter()
                        .any(|allowed| allowed.origin() == skill.archive.url.origin())
                {
                    return Err(connector_core::Error::Validation(
                        "authenticated Skill archive origin is not allowed".into(),
                    )
                    .into());
                }
                let auth = (skill.archive.authorization
                    == SkillArchiveAuthorization::ConnectionBearer)
                    .then_some(bearer);
                let response = self.http.get_bounded(
                    &skill.archive.url,
                    auth,
                    skill.archive.size_bytes.min(MAX_SKILL_ARCHIVE_SIZE),
                )?;
                verify_archive_response(skill, &response)
                    .and_then(|()| extract_skill_zip(&response.body, &staged.join(&skill.id)))?;
            }
            if root.exists() {
                fs::rename(&root, &previous).map_err(state_io(&root))?;
            }
            fs::rename(&staged, &root).map_err(state_io(&root))?;
            Ok(())
        })();
        if let Err(error) = result {
            let _ = remove_skill_tree(&staged);
            if previous.exists()
                && !root.exists()
                && let Err(restore) = fs::rename(&previous, &root)
            {
                return Err(BackendError::State {
                    path: root,
                    message: format!("{error}; restoring previous Skill catalog failed: {restore}"),
                });
            }
            return Err(error);
        }
        if previous.exists() {
            // Publication already committed. A stale backup is safe to sweep
            // on the next refresh and must not turn success into a false error.
            let _ = remove_skill_tree(&previous);
        }
        Ok(())
    }
    fn skill_paths(
        &self,
        platform: &str,
        provisioning: &Provisioning,
    ) -> Result<BTreeMap<String, PathBuf>> {
        provisioning
            .skills
            .iter()
            .map(|s| {
                let p = self
                    .state_dir
                    .join("synchronized-skills")
                    .join(platform)
                    .join(&s.id);
                Ok((s.id.clone(), p))
            })
            .collect()
    }
}

#[derive(Deserialize)]
struct TokenResponse {
    #[serde(default)]
    access_token: Option<String>,
    token_type: String,
    #[serde(default)]
    account: Option<Account>,
}
fn successful(response: &HttpResponse) -> Result<()> {
    if (200..300).contains(&response.status) {
        Ok(())
    } else {
        Err(BackendError::Http(response.status))
    }
}
fn accepted_revoke(status: u16) -> Option<LogoutStatus> {
    if (200..300).contains(&status) {
        Some(LogoutStatus::Revoked)
    } else if matches!(status, 401 | 404 | 405) {
        // 404/405 preserve compatibility with connectors without self-revoke.
        // A 401 means this credential can no longer authorize relay calls or
        // retry revocation, including after an earlier successful revoke.
        Some(LogoutStatus::Unsupported)
    } else {
        None
    }
}
fn confirmed_inert(status: u16) -> Option<LogoutStatus> {
    if (200..300).contains(&status) {
        Some(LogoutStatus::Revoked)
    } else if status == 401 {
        Some(LogoutStatus::Unsupported)
    } else {
        None
    }
}
pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}
fn random_urlsafe(bytes: usize) -> String {
    let mut value = vec![0; bytes];
    rand::rng().fill_bytes(&mut value);
    URL_SAFE_NO_PAD.encode(value)
}
fn callback_values(target: &str, expected_state: &str) -> Result<Option<String>> {
    let url =
        Url::parse(&format!("http://127.0.0.1{target}")).map_err(|_| BackendError::Response)?;
    if url.path() != "/callback" {
        return Ok(None);
    }
    let values: BTreeMap<_, _> = url.query_pairs().into_owned().collect();
    if values.get("state").map(String::as_str) != Some(expected_state) {
        return Err(BackendError::StateMismatch);
    }
    if let Some(error) = values.get("error") {
        return Err(BackendError::LoginDenied(error.clone()));
    }
    values
        .get("code")
        .filter(|v| !v.is_empty())
        .cloned()
        .map(Some)
        .ok_or(BackendError::Response)
}
fn await_callback(
    listener: TcpListener,
    expected_state: &str,
    timeout: Duration,
) -> Result<String> {
    listener
        .set_nonblocking(true)
        .map_err(state_io(Path::new("loopback callback")))?;
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => match handle_callback(&mut stream, expected_state) {
                Ok(Some(code)) => return Ok(code),
                Ok(None) | Err(BackendError::StateMismatch) => {}
                Err(error) => return Err(error),
            },
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(25))
            }
            Err(_) => return Err(BackendError::Network),
        }
    }
    Err(BackendError::Timeout)
}
fn handle_callback(stream: &mut TcpStream, expected_state: &str) -> Result<Option<String>> {
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|_| BackendError::Network)?;
    let mut bytes = [0; 8192];
    let count = stream.read(&mut bytes).map_err(|_| BackendError::Network)?;
    let line = String::from_utf8_lossy(&bytes[..count])
        .lines()
        .next()
        .unwrap_or_default()
        .to_owned();
    let target = line
        .strip_prefix("GET ")
        .and_then(|v| v.split_once(' '))
        .map(|x| x.0)
        .ok_or(BackendError::Response)?;
    let result = callback_values(target, expected_state);
    let ok = matches!(result, Ok(Some(_)));
    let body = if ok {
        "Signed in. You may close this tab."
    } else {
        "Sign-in was not completed."
    };
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    result
}
fn verify_archive_response(skill: &connector_core::Skill, response: &HttpResponse) -> Result<()> {
    successful(response)?;
    let actual = response.body.len() as u64;
    if response
        .content_length
        .is_some_and(|length| length != skill.archive.size_bytes)
        || actual != skill.archive.size_bytes
        || format!("{:x}", Sha256::digest(&response.body)) != skill.archive.sha256
    {
        return Err(connector_core::Error::Validation(
            "Skill archive size or digest mismatch".into(),
        )
        .into());
    }
    Ok(())
}

fn remove_skill_tree(path: &Path) -> std::io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
            fs::remove_dir_all(path)
        }
        Ok(_) => fs::remove_file(path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn reconcile_skill_staging(root: &Path) -> Result<()> {
    let Some(parent) = root.parent() else {
        return Ok(());
    };
    let Some(name) = root.file_name().and_then(|name| name.to_str()) else {
        return Err(connector_core::Error::Validation("invalid Skill state path".into()).into());
    };
    let entries = match fs::read_dir(parent) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(state_io(parent)(error)),
    };
    let staged_prefix = format!("{name}.staged-");
    let previous_prefix = format!("{name}.previous-");
    let mut previous = Vec::new();
    for entry in entries {
        let entry = entry.map_err(state_io(parent))?;
        let path = entry.path();
        let filename = entry.file_name();
        let filename = filename.to_string_lossy();
        if filename.starts_with(&staged_prefix) {
            remove_skill_tree(&path).map_err(state_io(&path))?;
        } else if filename.starts_with(&previous_prefix) {
            previous.push(path);
        }
    }
    previous.sort();
    if root.exists() {
        for path in previous {
            remove_skill_tree(&path).map_err(state_io(&path))?;
        }
    } else if let Some(restore) = previous.pop() {
        fs::rename(&restore, root).map_err(state_io(root))?;
        for path in previous {
            remove_skill_tree(&path).map_err(state_io(&path))?;
        }
    }
    Ok(())
}

fn extract_skill_zip(bytes: &[u8], target: &Path) -> Result<()> {
    extract_skill_zip_with_limits(bytes, target, MAX_ZIP_ENTRIES, MAX_UNCOMPRESSED_SKILL_BYTES)
}

#[derive(Debug)]
struct SkillZipEntry {
    index: usize,
    relative: PathBuf,
    key: String,
    is_dir: bool,
    mode: u32,
    size: u64,
}

fn declared_zip_entry_count(bytes: &[u8]) -> Result<usize> {
    const EOCD_SIZE: usize = 22;
    const MAX_COMMENT: usize = u16::MAX as usize;
    if bytes.len() < EOCD_SIZE {
        return Err(BackendError::Response);
    }
    let start = bytes.len().saturating_sub(EOCD_SIZE + MAX_COMMENT);
    for offset in (start..=bytes.len() - EOCD_SIZE).rev() {
        if bytes[offset..].starts_with(b"PK\x05\x06") {
            let u16_at =
                |at: usize| u16::from_le_bytes([bytes[offset + at], bytes[offset + at + 1]]);
            let u32_at = |at: usize| {
                u32::from_le_bytes([
                    bytes[offset + at],
                    bytes[offset + at + 1],
                    bytes[offset + at + 2],
                    bytes[offset + at + 3],
                ])
            };
            let comment_len = u16_at(20) as usize;
            if offset + EOCD_SIZE + comment_len != bytes.len() {
                continue;
            }
            let entries_on_disk = u16_at(8);
            let entries = u16_at(10);
            if u16_at(4) != 0
                || u16_at(6) != 0
                || entries_on_disk != entries
                || entries == u16::MAX
                || u32_at(12) == u32::MAX
                || u32_at(16) == u32::MAX
            {
                return Err(connector_core::Error::Validation(
                    "multi-disk and ZIP64 Skill archives are not supported".into(),
                )
                .into());
            }
            return Ok(entries as usize);
        }
    }
    Err(BackendError::Response)
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

fn safe_skill_zip_path(raw: &str, is_dir: bool) -> Result<(PathBuf, String)> {
    if raw.is_empty() || raw.starts_with('/') || raw.starts_with('\\') || raw.contains('\0') {
        return Err(connector_core::Error::Validation("unsafe Skill archive path".into()).into());
    }
    let normalized = raw.replace('\\', "/");
    let mut parts = normalized.split('/').collect::<Vec<_>>();
    if is_dir && parts.last() == Some(&"") {
        parts.pop();
    }
    if parts.is_empty() {
        return Err(connector_core::Error::Validation("unsafe Skill archive path".into()).into());
    }
    for component in &parts {
        if component.is_empty()
            || *component == "."
            || *component == ".."
            || !component.is_ascii()
            || component.ends_with(' ')
            || component.ends_with('.')
            || component.chars().any(|value| {
                value.is_control() || matches!(value, '<' | '>' | ':' | '"' | '|' | '?' | '*')
            })
            || windows_reserved_component(component)
        {
            return Err(connector_core::Error::Validation(
                "Skill archive path is not portable".into(),
            )
            .into());
        }
        if component.eq_ignore_ascii_case(OWNER_MARKER) {
            return Err(connector_core::Error::Validation(
                "Skill archive contains reserved ownership marker".into(),
            )
            .into());
        }
    }
    let relative = parts.iter().fold(PathBuf::new(), |mut path, component| {
        path.push(component);
        path
    });
    let key = parts.join("/").to_lowercase();
    Ok((relative, key))
}

fn extract_skill_zip_with_limits(
    bytes: &[u8],
    target: &Path,
    max_entries: usize,
    max_uncompressed_bytes: u64,
) -> Result<()> {
    use std::io::Cursor;
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| BackendError::Response)?;
    let declared_entries = declared_zip_entry_count(bytes)?;
    if declared_entries != archive.len() {
        return Err(connector_core::Error::Validation(
            "Skill archive contains duplicate entry names".into(),
        )
        .into());
    }
    if archive.len() > max_entries {
        return Err(
            connector_core::Error::Validation("Skill archive has too many entries".into()).into(),
        );
    }
    if archive
        .has_overlapping_files()
        .map_err(|_| BackendError::Response)?
    {
        return Err(connector_core::Error::Validation(
            "Skill archive contains overlapping compressed data".into(),
        )
        .into());
    }
    let mut seen = BTreeSet::new();
    let mut planned_size = 0u64;
    let mut plan = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|_| BackendError::Response)?;
        let is_dir = entry.is_dir();
        let (relative, key) = safe_skill_zip_path(entry.name(), is_dir)?;
        if !seen.insert(key.clone()) {
            return Err(
                connector_core::Error::Validation("duplicate Skill archive path".into()).into(),
            );
        }
        let mode = entry
            .unix_mode()
            .unwrap_or(if is_dir { 0o040755 } else { 0o100644 });
        let file_type = mode & 0o170000;
        if (file_type != 0 && file_type != 0o100000 && file_type != 0o040000)
            || (is_dir && file_type == 0o100000)
            || (!is_dir && file_type == 0o040000)
        {
            return Err(connector_core::Error::Validation(
                "Skill archive contains symlink or special file".into(),
            )
            .into());
        }
        planned_size = planned_size
            .checked_add(entry.size())
            .ok_or(BackendError::Response)?;
        if planned_size > max_uncompressed_bytes {
            return Err(connector_core::Error::Validation(
                "Skill archive expands beyond limit".into(),
            )
            .into());
        }
        plan.push(SkillZipEntry {
            index,
            relative,
            key,
            is_dir,
            mode,
            size: entry.size(),
        });
    }
    for entry in &plan {
        if !entry.is_dir
            && plan
                .iter()
                .any(|other| other.key.starts_with(&format!("{}/", entry.key)))
        {
            return Err(connector_core::Error::Validation(
                "Skill archive has a file and directory prefix collision".into(),
            )
            .into());
        }
    }
    if !plan
        .iter()
        .any(|entry| !entry.is_dir && entry.key == "skill.md")
    {
        return Err(connector_core::Error::Validation(
            "Skill archive must contain SKILL.md at its root".into(),
        )
        .into());
    }
    let mut expanded = 0u64;
    for planned in plan {
        let mut entry = archive
            .by_index(planned.index)
            .map_err(|_| BackendError::Response)?;
        let output = target.join(&planned.relative);
        if planned.is_dir {
            fs::create_dir_all(&output).map_err(state_io(&output))?;
            continue;
        }
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent).map_err(state_io(parent))?;
        }
        let mut file = fs::File::create(&output).map_err(state_io(&output))?;
        let remaining = max_uncompressed_bytes.saturating_sub(expanded);
        let written = std::io::copy(&mut entry.by_ref().take(remaining + 1), &mut file)
            .map_err(state_io(&output))?;
        if written != planned.size || written > remaining {
            return Err(connector_core::Error::Validation(
                "Skill archive expanded size does not match its directory".into(),
            )
            .into());
        }
        expanded += written;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&output, fs::Permissions::from_mode(planned.mode & 0o777))
                .map_err(state_io(&output))?;
        }
    }
    Ok(())
}
fn model_map_to_strings(models: &BTreeMap<AgentId, String>) -> BTreeMap<String, String> {
    models
        .iter()
        .map(|(a, m)| (a.as_str().into(), m.clone()))
        .collect()
}
fn state_io(path: &Path) -> impl FnOnce(std::io::Error) -> BackendError + '_ {
    move |e| BackendError::State {
        path: path.into(),
        message: e.to_string(),
    }
}
fn atomic_json(path: &Path, value: &impl Serialize) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(state_io(parent))?;
    }
    let temp = path.with_extension(format!(
        "tmp-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| BackendError::State {
        path: path.into(),
        message: e.to_string(),
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temp)
            .map_err(state_io(&temp))?;
        file.write_all(&bytes).map_err(state_io(&temp))?;
        file.sync_all().map_err(state_io(&temp))?;
    }
    #[cfg(not(unix))]
    {
        fs::write(&temp, bytes).map_err(state_io(&temp))?;
    }
    #[cfg(not(windows))]
    {
        fs::rename(&temp, path).map_err(state_io(path))
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
        };
        let from: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe {
            MoveFileExW(
                from.as_ptr(),
                to.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } == 0
        {
            let error = std::io::Error::last_os_error();
            let _ = fs::remove_file(&temp);
            Err(state_io(path)(error))
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::VecDeque, sync::Mutex, thread};

    #[derive(Default)]
    struct MemoryCredentials(Mutex<BTreeMap<String, Bearer>>);
    impl CredentialStore for MemoryCredentials {
        fn get(&self, platform: &str) -> Result<Option<Bearer>> {
            Ok(self.0.lock().unwrap().get(platform).cloned())
        }
        fn set(&self, platform: &str, bearer: &Bearer) -> Result<()> {
            self.0
                .lock()
                .unwrap()
                .insert(platform.into(), bearer.clone());
            Ok(())
        }
        fn delete(&self, platform: &str) -> Result<()> {
            self.0.lock().unwrap().remove(platform);
            Ok(())
        }
    }
    struct NoHttp;
    impl HttpClient for NoHttp {
        fn get(&self, _: &Url, _: Option<&Bearer>) -> Result<HttpResponse> {
            unreachable!()
        }
        fn post_json(&self, _: &Url, _: serde_json::Value) -> Result<HttpResponse> {
            unreachable!()
        }
        fn post_empty(&self, _: &Url, _: &Bearer) -> Result<HttpResponse> {
            unreachable!()
        }
    }
    struct NoBrowser;
    impl Browser for NoBrowser {
        fn open(&self, _: &Url) -> Result<()> {
            unreachable!()
        }
    }

    #[derive(Debug, Clone)]
    enum HttpCall {
        Get {
            url: String,
            bearer: Option<String>,
        },
        PostJson {
            url: String,
            body: serde_json::Value,
        },
        PostEmpty {
            url: String,
            bearer: String,
        },
    }

    struct ScriptedHttp {
        responses: Mutex<VecDeque<HttpResponse>>,
        calls: Mutex<Vec<HttpCall>>,
    }
    impl ScriptedHttp {
        fn new(responses: impl IntoIterator<Item = HttpResponse>) -> Self {
            Self {
                responses: Mutex::new(responses.into_iter().collect()),
                calls: Mutex::new(Vec::new()),
            }
        }
        fn response(&self) -> Result<HttpResponse> {
            self.responses
                .lock()
                .unwrap()
                .pop_front()
                .ok_or(BackendError::Network)
        }
        fn calls(&self) -> Vec<HttpCall> {
            self.calls.lock().unwrap().clone()
        }
    }
    impl HttpClient for ScriptedHttp {
        fn get(&self, url: &Url, bearer: Option<&Bearer>) -> Result<HttpResponse> {
            self.calls.lock().unwrap().push(HttpCall::Get {
                url: url.to_string(),
                bearer: bearer.map(|value| value.0.clone()),
            });
            self.response()
        }
        fn post_json(&self, url: &Url, body: serde_json::Value) -> Result<HttpResponse> {
            self.calls.lock().unwrap().push(HttpCall::PostJson {
                url: url.to_string(),
                body,
            });
            self.response()
        }
        fn post_empty(&self, url: &Url, bearer: &Bearer) -> Result<HttpResponse> {
            self.calls.lock().unwrap().push(HttpCall::PostEmpty {
                url: url.to_string(),
                bearer: bearer.0.clone(),
            });
            self.response()
        }
    }

    #[derive(Default)]
    struct CallbackBrowser(Mutex<Option<Url>>);
    impl CallbackBrowser {
        fn opened(&self) -> Url {
            self.0.lock().unwrap().clone().unwrap()
        }
    }
    impl Browser for CallbackBrowser {
        fn open(&self, url: &Url) -> Result<()> {
            *self.0.lock().unwrap() = Some(url.clone());
            let values: BTreeMap<_, _> = url.query_pairs().into_owned().collect();
            let redirect = values
                .get("redirect_uri")
                .ok_or(BackendError::Response)
                .and_then(|value| Url::parse(value).map_err(|_| BackendError::Response))?;
            let state = values.get("state").cloned().ok_or(BackendError::Response)?;
            thread::spawn(move || {
                let address = format!(
                    "127.0.0.1:{}",
                    redirect.port().expect("callback has an ephemeral port")
                );
                let mut stream = (0..20)
                    .find_map(|_| match TcpStream::connect(&address) {
                        Ok(stream) => Some(stream),
                        Err(_) => {
                            thread::sleep(Duration::from_millis(5));
                            None
                        }
                    })
                    .expect("callback listener accepts browser redirect");
                let target = format!("/callback?code=test-code&state={state}");
                write!(stream, "GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
            });
            Ok(())
        }
    }

    struct FailingSetCredentials;
    impl CredentialStore for FailingSetCredentials {
        fn get(&self, _: &str) -> Result<Option<Bearer>> {
            Ok(None)
        }
        fn set(&self, _: &str, _: &Bearer) -> Result<()> {
            Err(BackendError::Credential)
        }
        fn delete(&self, _: &str) -> Result<()> {
            Ok(())
        }
    }

    fn response(status: u16, value: serde_json::Value) -> HttpResponse {
        let body = serde_json::to_vec(&value).unwrap();
        HttpResponse {
            status,
            content_length: Some(body.len() as u64),
            body,
        }
    }
    fn manifest_response(platform: &str, prefix: &str) -> HttpResponse {
        response(
            200,
            serde_json::json!({"success":true,"data":{
                "schema_version":2,
                "platform":{"id":platform,"name":platform},
                "authentication":{
                    "type":"browser_pkce",
                    "authorize_url":format!("https://gateway.example{prefix}/connector/authorize"),
                    "token_url":format!("https://gateway.example{prefix}/connector/token")
                },
                "gateway":{"base_url":"https://gateway.example","protocols":["openai_responses"]},
                "provisioning_url":format!("https://gateway.example{prefix}/connector/provisioning"),
                "connection_bearer_origins":["https://gateway.example"],
                "supported_agents":["claude","codex","gemini","grokbuild","opencode"]
            }}),
        )
    }
    fn provisioning_response() -> HttpResponse {
        response(
            200,
            serde_json::json!({"success":true,"data":{
                "schema_version":2,
                "models":[{"id":"model-a","chat_capable":true}],
                "default_model":"model-a",
                "mcp_servers":[],
                "skills":[]
            }}),
        )
    }
    fn manifest() -> ConnectionManifest {
        ConnectionManifest::parse(br#"{"success":true,"data":{"schema_version":2,"platform":{"id":"origin","name":"BoxAI"},"authentication":{"type":"browser_pkce","authorize_url":"https://you-box.com/desktop/authorize","token_url":"https://you-box.com/api/token"},"gateway":{"base_url":"https://you-box.com","protocols":["openai_chat"]},"provisioning_url":"https://you-box.com/api/connector/provisioning","connection_bearer_origins":["https://you-box.com"],"supported_agents":["claude","codex"]}}"#).unwrap()
    }
    fn provisioning(default: &str, models: &[&str], skills: &[&str]) -> Provisioning {
        let models: Vec<_> = models
            .iter()
            .map(|id| serde_json::json!({"id":id,"chat_capable":true}))
            .collect();
        let skills: Vec<_> = skills
            .iter()
            .map(|id| serde_json::json!({"id":id,"name":id,"version":"1.0.0","archive":{"url":format!("https://you-box.com/skills/{id}.zip"),"sha256":"0000000000000000000000000000000000000000000000000000000000000000","size_bytes":1,"format":"zip","authorization":"none"}}))
            .collect();
        Provisioning::parse(&serde_json::to_vec(&serde_json::json!({"success":true,"data":{"schema_version":2,"models":models,"default_model":default,"mcp_servers":[],"skills":skills}})).unwrap()).unwrap()
    }
    fn skill_zip(entries: &[(&str, &[u8], u32)]) -> Vec<u8> {
        use std::io::Cursor;
        use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        for (path, bytes, mode) in entries {
            writer
                .start_file(
                    path,
                    SimpleFileOptions::default()
                        .compression_method(CompressionMethod::Deflated)
                        .unix_permissions(*mode),
                )
                .unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }
    fn exact_duplicate_skill_zip() -> Vec<u8> {
        let mut bytes = skill_zip(&[("SKILL.md", b"one", 0o644), ("SKILL.MD", b"two", 0o644)]);
        for offset in 0..=bytes.len() - b"SKILL.MD".len() {
            if &bytes[offset..offset + b"SKILL.MD".len()] == b"SKILL.MD" {
                bytes[offset..offset + b"SKILL.MD".len()].copy_from_slice(b"SKILL.md");
            }
        }
        bytes
    }
    fn symlink_skill_zip() -> Vec<u8> {
        use std::io::Cursor;
        use zip::{ZipWriter, write::SimpleFileOptions};

        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .start_file("SKILL.md", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"skill").unwrap();
        writer
            .add_symlink("escape", "../outside", SimpleFileOptions::default())
            .unwrap();
        writer.finish().unwrap().into_inner()
    }
    fn archive_response(bytes: Vec<u8>) -> HttpResponse {
        HttpResponse {
            status: 200,
            content_length: Some(bytes.len() as u64),
            body: bytes,
        }
    }
    fn set_archive(
        provisioning: &mut Provisioning,
        index: usize,
        bytes: &[u8],
        url: &str,
        authorization: SkillArchiveAuthorization,
    ) {
        let archive = &mut provisioning.skills[index].archive;
        archive.url = Url::parse(url).unwrap();
        archive.sha256 = format!("{:x}", Sha256::digest(bytes));
        archive.size_bytes = bytes.len() as u64;
        archive.authorization = authorization;
    }
    fn backend(root: &Path) -> Backend {
        Backend::with_dependencies(
            root.into(),
            root.into(),
            Arc::new(NoHttp),
            Arc::new(MemoryCredentials::default()),
            Arc::new(NoBrowser),
        )
    }
    #[test]
    fn rfc_7636_vector() {
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }
    #[test]
    fn callback_requires_exact_state() {
        assert!(matches!(
            callback_values("/callback?code=x&state=wrong", "right"),
            Err(BackendError::StateMismatch)
        ));
        assert_eq!(
            callback_values("/callback?code=x&state=right", "right").unwrap(),
            Some("x".into())
        );
    }
    #[test]
    fn model_choices_persist_and_stale_choices_reconcile_without_secrets() {
        let temp = tempfile::tempdir().unwrap();
        let backend = backend(temp.path());
        let first = provisioning("model-a", &["model-a", "model-b"], &[]);
        backend
            .update_model_choice("origin", AgentId::Claude, "model-b", &first)
            .unwrap();
        let persisted = backend.load_state().unwrap();
        let next = provisioning("model-a", &["model-a"], &[]);
        let selected = backend.reconciled_models(&manifest(), &next, &persisted);
        assert_eq!(selected.get(&AgentId::Claude).unwrap(), "model-a");
        let state_bytes = fs::read(backend.state_path()).unwrap();
        assert!(!String::from_utf8(state_bytes).unwrap().contains("Bearer"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(backend.state_path())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }
    #[test]
    fn http_boundary_rejects_error_status_before_parsing() {
        assert!(matches!(
            successful(&HttpResponse {
                status: 503,
                body: br#"{"success":true}"#.to_vec(),
                content_length: None,
            }),
            Err(BackendError::Http(503))
        ));
        assert!(
            successful(&HttpResponse {
                status: 200,
                body: Vec::new(),
                content_length: None,
            })
            .is_ok()
        );
    }

    #[test]
    fn redirects_are_limited_to_the_exact_initial_origin() {
        let initial = Url::parse("https://gateway.example/api/v1/connector/provisioning").unwrap();
        assert!(same_request_origin(
            &initial,
            &Url::parse("https://gateway.example:443/next").unwrap()
        ));
        assert!(!same_request_origin(
            &initial,
            &Url::parse("https://gateway.example:8443/next").unwrap()
        ));
        assert!(!same_request_origin(
            &Url::parse("https://gateway.example:443/start").unwrap(),
            &Url::parse("http://gateway.example:443/next").unwrap()
        ));
        assert!(same_request_origin(
            &initial,
            &Url::parse("https://gateway.example/api/v1/connector/revoke").unwrap()
        ));
    }

    fn assert_connect_token(
        platform: &str,
        prefix: &str,
        token: serde_json::Value,
        expected_bearer: &str,
        expects_account: bool,
    ) {
        let temp = tempfile::tempdir().unwrap();
        let http = Arc::new(ScriptedHttp::new([
            manifest_response(platform, prefix),
            response(200, token),
            provisioning_response(),
        ]));
        let credentials = Arc::new(MemoryCredentials::default());
        let browser = Arc::new(CallbackBrowser::default());
        let backend = Backend::with_dependencies(
            temp.path().join("state"),
            temp.path().join("home"),
            http.clone(),
            credentials.clone(),
            browser.clone(),
        );

        let login = backend.connect().unwrap();
        assert_eq!(login.account.is_some(), expects_account);
        assert_eq!(login.provisioning.default_model, "model-a");
        assert_eq!(
            credentials.get(platform).unwrap().unwrap().0,
            expected_bearer
        );
        let authorize = browser.opened();
        let values: BTreeMap<_, _> = authorize.query_pairs().into_owned().collect();
        assert_eq!(
            values.get("client").map(String::as_str),
            Some("boxai-connector")
        );
        assert_eq!(
            values.get("device_name").map(String::as_str),
            Some("BoxAI Connector")
        );
        assert!(
            values
                .get("redirect_uri")
                .is_some_and(|value| value.ends_with("/callback"))
        );
        let calls = http.calls();
        assert!(matches!(
            &calls[1],
            HttpCall::PostJson { url, body }
                if url.ends_with(&format!("{prefix}/connector/token"))
                    && body["code"] == "test-code"
                    && body["redirect_uri"].as_str().is_some_and(|value| value.ends_with("/callback"))
        ));
        assert!(matches!(
            &calls[2],
            HttpCall::Get { url, bearer: Some(value) }
                if url.ends_with(&format!("{prefix}/connector/provisioning"))
                    && value == expected_bearer
        ));
    }

    #[test]
    fn boxai_login_stores_the_durable_access_token() {
        assert_connect_token(
            "boxai",
            "/api",
            serde_json::json!({
                "access_token":"sk-boxai",
                "token_type":"Bearer",
                "account":{"id":1,"username":"boxai","display_name":"BoxAI User","email":"user@example.test","quota":10}
            }),
            "sk-boxai",
            true,
        );
    }

    #[test]
    fn boxai_login_requires_neutral_access_token() {
        let temp = tempfile::tempdir().unwrap();
        let http = Arc::new(ScriptedHttp::new([
            manifest_response("boxai", "/api"),
            response(
                200,
                serde_json::json!({"api_key":"sk-legacy","token_type":"Bearer"}),
            ),
        ]));
        let credentials = Arc::new(MemoryCredentials::default());
        let backend = Backend::with_dependencies(
            temp.path().join("state"),
            temp.path().join("home"),
            http,
            credentials.clone(),
            Arc::new(CallbackBrowser::default()),
        );

        assert!(matches!(backend.connect(), Err(BackendError::Response)));
        assert!(credentials.get("boxai").unwrap().is_none());
    }

    #[test]
    fn vault_failure_revokes_the_newly_minted_credential() {
        let temp = tempfile::tempdir().unwrap();
        let http = Arc::new(ScriptedHttp::new([
            manifest_response("boxai", "/api"),
            response(
                200,
                serde_json::json!({"access_token":"sk-orphan","token_type":"Bearer"}),
            ),
            response(204, serde_json::Value::Null),
        ]));
        let backend = Backend::with_dependencies(
            temp.path().join("state"),
            temp.path().join("home"),
            http.clone(),
            Arc::new(FailingSetCredentials),
            Arc::new(CallbackBrowser::default()),
        );

        assert!(matches!(backend.connect(), Err(BackendError::Credential)));
        assert!(matches!(
            http.calls().last().unwrap(),
            HttpCall::PostEmpty { url, bearer }
                if url.ends_with("/api/connector/revoke") && bearer == "sk-orphan"
        ));
    }

    #[test]
    fn failed_vault_storage_keeps_an_in_memory_revocation_retry() {
        let temp = tempfile::tempdir().unwrap();
        let http = Arc::new(ScriptedHttp::new([
            manifest_response("boxai", "/api"),
            response(
                200,
                serde_json::json!({"access_token":"sk-pending","token_type":"Bearer"}),
            ),
            response(503, serde_json::json!({"error":"unavailable"})),
            response(204, serde_json::Value::Null),
        ]));
        let backend = Backend::with_dependencies(
            temp.path().join("state"),
            temp.path().join("home"),
            http.clone(),
            Arc::new(FailingSetCredentials),
            Arc::new(CallbackBrowser::default()),
        );

        assert!(matches!(
            backend.connect(),
            Err(BackendError::PendingRevocation)
        ));
        assert_eq!(backend.logout().unwrap(), LogoutStatus::Revoked);
        let revoke_calls = http
            .calls()
            .into_iter()
            .filter(
                |call| matches!(call, HttpCall::PostEmpty { bearer, .. } if bearer == "sk-pending"),
            )
            .count();
        assert_eq!(revoke_calls, 2);
    }

    #[test]
    fn unsupported_revoke_never_discards_an_unstored_pending_credential() {
        let temp = tempfile::tempdir().unwrap();
        let http = Arc::new(ScriptedHttp::new([
            manifest_response("boxai", "/api"),
            response(
                200,
                serde_json::json!({"access_token":"sk-pending","token_type":"Bearer"}),
            ),
            response(405, serde_json::Value::Null),
            response(405, serde_json::Value::Null),
            response(204, serde_json::Value::Null),
        ]));
        let backend = Backend::with_dependencies(
            temp.path().join("state"),
            temp.path().join("home"),
            http,
            Arc::new(FailingSetCredentials),
            Arc::new(CallbackBrowser::default()),
        );

        assert!(matches!(
            backend.connect(),
            Err(BackendError::PendingRevocation)
        ));
        assert!(matches!(backend.logout(), Err(BackendError::Http(405))));
        assert_eq!(backend.logout().unwrap(), LogoutStatus::Revoked);
    }

    fn assert_logout(platform: &str, prefix: &str, status: u16, expected: LogoutStatus) {
        let temp = tempfile::tempdir().unwrap();
        let http = Arc::new(ScriptedHttp::new([
            manifest_response(platform, prefix),
            response(status, serde_json::Value::Null),
        ]));
        let credentials = Arc::new(MemoryCredentials::default());
        credentials
            .set(platform, &Bearer("sk-logout".into()))
            .unwrap();
        let backend = Backend::with_dependencies(
            temp.path().join("state"),
            temp.path().join("home"),
            http.clone(),
            credentials.clone(),
            Arc::new(NoBrowser),
        );

        assert_eq!(backend.logout().unwrap(), expected);
        assert!(credentials.get(platform).unwrap().is_none());
        assert!(matches!(
            http.calls().last().unwrap(),
            HttpCall::PostEmpty { url, bearer }
                if url.ends_with(&format!("{prefix}/connector/revoke"))
                    && bearer == "sk-logout"
        ));
    }

    #[test]
    fn origin_uses_the_provisioning_sibling_revoke_route() {
        assert_logout("boxai", "/api", 204, LogoutStatus::Revoked);
        assert_logout("boxai", "/api/v1", 204, LogoutStatus::Revoked);
    }

    #[test]
    fn revoke_not_found_still_removes_the_local_credential() {
        assert_logout("boxai", "/api", 404, LogoutStatus::Unsupported);
    }

    #[test]
    fn reconnect_is_rejected_before_browser_auth_when_a_credential_exists() {
        let temp = tempfile::tempdir().unwrap();
        let http = Arc::new(ScriptedHttp::new([manifest_response("boxai", "/api")]));
        let credentials = Arc::new(MemoryCredentials::default());
        credentials
            .set("boxai", &Bearer("sk-existing".into()))
            .unwrap();
        let backend = Backend::with_dependencies(
            temp.path().join("state"),
            temp.path().join("home"),
            http,
            credentials,
            Arc::new(NoBrowser),
        );

        let error = backend.connect().unwrap_err().to_string();
        assert!(error.contains("already connected"), "{error}");
    }

    #[test]
    fn apply_rejects_a_plan_after_the_vault_credential_changes() {
        let temp = tempfile::tempdir().unwrap();
        let credentials = Arc::new(MemoryCredentials::default());
        credentials
            .set("origin", &Bearer("sk-first".into()))
            .unwrap();
        let backend = Backend::with_dependencies(
            temp.path().join("state"),
            temp.path().join("home"),
            Arc::new(NoHttp),
            credentials.clone(),
            Arc::new(NoBrowser),
        );
        let root = temp.path().join("codex");
        fs::create_dir_all(&root).unwrap();
        let plan = backend
            .plan(
                &manifest(),
                &provisioning("model-a", &["model-a"], &[]),
                vec![AgentInstall {
                    agent: AgentId::Codex,
                    root: root.clone(),
                    detected: true,
                }],
            )
            .unwrap();
        credentials
            .set("origin", &Bearer("sk-second".into()))
            .unwrap();

        let error = backend.apply(&plan).unwrap_err().to_string();
        assert!(error.contains("credential changed"), "{error}");
        assert!(!root.join("config.toml").exists());
    }

    #[test]
    fn missing_vault_key_with_a_receipt_is_reported_and_never_claimed_as_logout() {
        let temp = tempfile::tempdir().unwrap();
        let first_manifest = manifest_response("boxai", "/api");
        let manifest = ConnectionManifest::parse(&first_manifest.body).unwrap();
        let http = Arc::new(ScriptedHttp::new([
            first_manifest,
            manifest_response("boxai", "/api"),
        ]));
        let credentials = Arc::new(MemoryCredentials::default());
        credentials
            .set("boxai", &Bearer("sk-owned".into()))
            .unwrap();
        let backend = Backend::with_dependencies(
            temp.path().join("state"),
            temp.path().join("home"),
            http,
            credentials.clone(),
            Arc::new(NoBrowser),
        );
        let root = temp.path().join("codex");
        fs::create_dir_all(&root).unwrap();
        let plan = backend
            .plan(
                &manifest,
                &provisioning("model-a", &["model-a"], &[]),
                vec![AgentInstall {
                    agent: AgentId::Codex,
                    root,
                    detected: true,
                }],
            )
            .unwrap();
        backend.apply(&plan).unwrap();
        credentials.delete("boxai").unwrap();

        let status = backend.load_status().unwrap();
        assert!(!status.connected);
        assert!(status.managed_projection);
        assert!(
            status
                .provisioning_error
                .as_deref()
                .is_some_and(|error| error.contains("cleanup is blocked"))
        );
        let error = backend.logout().unwrap_err().to_string();
        assert!(error.contains("vault credential is unavailable"), "{error}");
        assert!(
            temp.path()
                .join("state/connector/receipts/boxai.json")
                .exists()
        );
    }

    #[test]
    fn state_persistence_failure_does_not_delete_the_vault_key() {
        let temp = tempfile::tempdir().unwrap();
        let http = Arc::new(ScriptedHttp::new([
            manifest_response("boxai", "/api"),
            response(204, serde_json::Value::Null),
        ]));
        let credentials = Arc::new(MemoryCredentials::default());
        credentials
            .set("boxai", &Bearer("sk-retained".into()))
            .unwrap();
        let state = temp.path().join("state");
        fs::create_dir_all(state.join("state.json")).unwrap();
        let backend = Backend::with_dependencies(
            state,
            temp.path().join("home"),
            http,
            credentials.clone(),
            Arc::new(NoBrowser),
        );

        assert!(matches!(backend.logout(), Err(BackendError::State { .. })));
        assert_eq!(credentials.get("boxai").unwrap().unwrap().0, "sk-retained");
    }

    #[test]
    fn remote_revoke_failure_keeps_the_credential_retryable() {
        let temp = tempfile::tempdir().unwrap();
        let http = Arc::new(ScriptedHttp::new([
            manifest_response("boxai", "/api"),
            response(503, serde_json::json!({"error":"unavailable"})),
        ]));
        let credentials = Arc::new(MemoryCredentials::default());
        credentials
            .set("boxai", &Bearer("sk-retry".into()))
            .unwrap();
        let backend = Backend::with_dependencies(
            temp.path().join("state"),
            temp.path().join("home"),
            http,
            credentials.clone(),
            Arc::new(NoBrowser),
        );

        assert!(matches!(backend.logout(), Err(BackendError::Http(503))));
        assert_eq!(credentials.get("boxai").unwrap().unwrap().0, "sk-retry");
    }

    #[test]
    fn projection_drift_blocks_revoke_and_keeps_the_decryption_credential() {
        let temp = tempfile::tempdir().unwrap();
        let manifest_response = manifest_response("boxai", "/api");
        let manifest = ConnectionManifest::parse(&manifest_response.body).unwrap();
        let http = Arc::new(ScriptedHttp::new([manifest_response]));
        let credentials = Arc::new(MemoryCredentials::default());
        credentials
            .set("boxai", &Bearer("sk-owned".into()))
            .unwrap();
        let backend = Backend::with_dependencies(
            temp.path().join("state"),
            temp.path().join("home"),
            http.clone(),
            credentials.clone(),
            Arc::new(NoBrowser),
        );
        let root = temp.path().join("gemini");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join(".env"), "KEEP=yes\n").unwrap();
        let plan = backend
            .plan(
                &manifest,
                &provisioning("model-a", &["model-a"], &[]),
                vec![AgentInstall {
                    agent: AgentId::Gemini,
                    root: root.clone(),
                    detected: true,
                }],
            )
            .unwrap();
        backend.apply(&plan).unwrap();
        let mut env = fs::OpenOptions::new()
            .append(true)
            .open(root.join(".env"))
            .unwrap();
        writeln!(env, "USER_AFTER=yes").unwrap();

        let error = backend.logout().unwrap_err().to_string();
        assert!(error.contains("local changes"), "{error}");
        assert!(!error.contains("sk-owned"));
        assert!(credentials.get("boxai").unwrap().is_some());
        assert!(
            temp.path()
                .join("state/connector/receipts/boxai.json")
                .exists()
        );
        assert!(
            !http
                .calls()
                .iter()
                .any(|call| matches!(call, HttpCall::PostEmpty { .. }))
        );
    }

    #[test]
    fn manifest_outage_does_not_discard_the_only_credential() {
        let temp = tempfile::tempdir().unwrap();
        let http = Arc::new(ScriptedHttp::new([response(
            503,
            serde_json::json!({"error":"unavailable"}),
        )]));
        let credentials = Arc::new(MemoryCredentials::default());
        credentials
            .set("boxai", &Bearer("sk-retry".into()))
            .unwrap();
        let backend = Backend::with_dependencies(
            temp.path().join("state"),
            temp.path().join("home"),
            http,
            credentials.clone(),
            Arc::new(NoBrowser),
        );

        assert!(matches!(backend.logout(), Err(BackendError::Http(503))));
        assert!(credentials.get("boxai").unwrap().is_some());
    }

    #[test]
    fn provisioning_outage_keeps_a_stored_credential_reachable_for_retry_or_logout() {
        let temp = tempfile::tempdir().unwrap();
        let http = Arc::new(ScriptedHttp::new([
            manifest_response("boxai", "/api"),
            response(503, serde_json::json!({"error":"unavailable"})),
        ]));
        let credentials = Arc::new(MemoryCredentials::default());
        credentials
            .set("boxai", &Bearer("sk-recoverable".into()))
            .unwrap();
        let backend = Backend::with_dependencies(
            temp.path().join("state"),
            temp.path().join("home"),
            http,
            credentials,
            Arc::new(NoBrowser),
        );

        let status = backend.load_status().unwrap();
        assert!(status.connected);
        assert!(status.provisioning.is_none());
        assert_eq!(
            status.provisioning_error.as_deref(),
            Some("gateway returned HTTP 503")
        );
    }

    #[test]
    fn online_skills_sync_with_exact_digest_auth_and_executable_mode() {
        let temp = tempfile::tempdir().unwrap();
        let public = skill_zip(&[("SKILL.md", b"public", 0o644)]);
        let private = skill_zip(&[
            ("SKILL.md", b"private", 0o644),
            ("scripts/run.sh", b"#!/bin/sh\n", 0o755),
        ]);
        let mut catalog = provisioning("model-a", &["model-a"], &["public-skill", "private-skill"]);
        set_archive(
            &mut catalog,
            0,
            &public,
            "https://cdn.example.test/public.zip",
            SkillArchiveAuthorization::None,
        );
        set_archive(
            &mut catalog,
            1,
            &private,
            "https://you-box.com/skills/private.zip",
            SkillArchiveAuthorization::ConnectionBearer,
        );
        let http = Arc::new(ScriptedHttp::new([
            archive_response(public),
            archive_response(private),
        ]));
        let backend = Backend::with_dependencies(
            temp.path().join("state"),
            temp.path().join("home"),
            http.clone(),
            Arc::new(MemoryCredentials::default()),
            Arc::new(NoBrowser),
        );

        backend
            .synchronize_skills(&manifest(), &catalog, &Bearer("sk-online".into()))
            .unwrap();
        let root = temp.path().join("state/synchronized-skills/origin");
        assert_eq!(
            fs::read_to_string(root.join("public-skill/SKILL.md")).unwrap(),
            "public"
        );
        assert_eq!(
            fs::read_to_string(root.join("private-skill/SKILL.md")).unwrap(),
            "private"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_ne!(
                fs::metadata(root.join("private-skill/scripts/run.sh"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o111,
                0
            );
        }
        let calls = http.calls();
        assert!(matches!(&calls[0], HttpCall::Get { bearer: None, .. }));
        assert!(matches!(
            &calls[1],
            HttpCall::Get { bearer: Some(value), .. } if value == "sk-online"
        ));

        let empty = provisioning("model-a", &["model-a"], &[]);
        backend
            .synchronize_skills(&manifest(), &empty, &Bearer("sk-online".into()))
            .unwrap();
        assert!(root.is_dir());
        assert!(root.read_dir().unwrap().next().is_none());
    }

    #[test]
    fn authenticated_skill_archives_never_receive_bearer_cross_origin() {
        let temp = tempfile::tempdir().unwrap();
        let bytes = skill_zip(&[("SKILL.md", b"private", 0o644)]);
        let mut catalog = provisioning("model-a", &["model-a"], &["private"]);
        set_archive(
            &mut catalog,
            0,
            &bytes,
            "https://cdn.example.test/private.zip",
            SkillArchiveAuthorization::ConnectionBearer,
        );
        let http = Arc::new(ScriptedHttp::new([archive_response(bytes)]));
        let backend = Backend::with_dependencies(
            temp.path().join("state"),
            temp.path().join("home"),
            http.clone(),
            Arc::new(MemoryCredentials::default()),
            Arc::new(NoBrowser),
        );

        let error = backend
            .synchronize_skills(&manifest(), &catalog, &Bearer("must-not-leak".into()))
            .unwrap_err()
            .to_string();
        assert!(error.contains("origin is not allowed"), "{error}");
        assert!(http.calls().is_empty());
    }

    #[test]
    fn failed_skill_download_removes_staging_tree() {
        let temp = tempfile::tempdir().unwrap();
        let catalog = provisioning("model-a", &["model-a"], &["private"]);
        let backend = Backend::with_dependencies(
            temp.path().join("state"),
            temp.path().join("home"),
            Arc::new(ScriptedHttp::new(Vec::<HttpResponse>::new())),
            Arc::new(MemoryCredentials::default()),
            Arc::new(NoBrowser),
        );

        backend
            .synchronize_skills(&manifest(), &catalog, &Bearer("sk-online".into()))
            .unwrap_err();
        let parent = temp.path().join("state/synchronized-skills");
        if parent.exists() {
            assert!(parent.read_dir().unwrap().next().is_none());
        }
    }

    #[test]
    fn online_skill_response_requires_exact_size_digest_and_bound() {
        let bytes = skill_zip(&[("SKILL.md", b"skill", 0o644)]);
        let mut catalog = provisioning("model-a", &["model-a"], &["skill"]);
        set_archive(
            &mut catalog,
            0,
            &bytes,
            "https://cdn.example.test/skill.zip",
            SkillArchiveAuthorization::None,
        );
        let skill = &catalog.skills[0];
        let mut response = archive_response(bytes.clone());
        assert!(verify_archive_response(skill, &response).is_ok());
        response.content_length = Some(response.body.len() as u64 + 1);
        assert!(verify_archive_response(skill, &response).is_err());
        response.content_length = Some(response.body.len() as u64);
        response.body[0] ^= 1;
        assert!(verify_archive_response(skill, &response).is_err());

        let http = ScriptedHttp::new([archive_response(vec![0; 5])]);
        assert!(
            http.get_bounded(&Url::parse("https://cdn.example.test/x").unwrap(), None, 4)
                .is_err()
        );
    }

    #[test]
    fn skill_zip_rejects_traversal_symlink_duplicates_markers_and_wrappers() {
        let cases = [
            (
                "traversal",
                skill_zip(&[("SKILL.md", b"skill", 0o644), ("../escape", b"x", 0o644)]),
            ),
            ("symlink", symlink_skill_zip()),
            (
                "duplicate",
                skill_zip(&[("SKILL.md", b"one", 0o644), ("skill.md", b"two", 0o644)]),
            ),
            ("exact-duplicate", exact_duplicate_skill_zip()),
            (
                "windows-reserved",
                skill_zip(&[("SKILL.md", b"skill", 0o644), ("CON.txt", b"x", 0o644)]),
            ),
            (
                "unicode-normalization-alias",
                skill_zip(&[
                    ("SKILL.md", b"skill", 0o644),
                    ("\u{e9}.txt", b"nfc", 0o644),
                    ("e\u{301}.txt", b"nfd", 0o644),
                ]),
            ),
            (
                "file-prefix",
                skill_zip(&[
                    ("SKILL.md", b"skill", 0o644),
                    ("bin", b"x", 0o644),
                    ("bin/run", b"x", 0o644),
                ]),
            ),
            (
                "marker",
                skill_zip(&[
                    ("SKILL.md", b"skill", 0o644),
                    (".gateway-connector-owner", b"forged", 0o644),
                ]),
            ),
            (
                "wrapper",
                skill_zip(&[("wrapped/SKILL.md", b"skill", 0o644)]),
            ),
        ];
        let temp = tempfile::tempdir().unwrap();
        for (name, bytes) in cases {
            let error = extract_skill_zip(&bytes, &temp.path().join(name))
                .unwrap_err()
                .to_string();
            assert!(!error.is_empty(), "{name} unexpectedly accepted");
        }
    }

    #[test]
    fn skill_zip_enforces_entry_and_expanded_size_limits() {
        let bytes = skill_zip(&[("SKILL.md", b"four", 0o644), ("extra", b"x", 0o644)]);
        let temp = tempfile::tempdir().unwrap();
        let entry_error =
            extract_skill_zip_with_limits(&bytes, &temp.path().join("entries"), 1, 100)
                .unwrap_err()
                .to_string();
        assert!(entry_error.contains("too many entries"), "{entry_error}");
        let size_error = extract_skill_zip_with_limits(&bytes, &temp.path().join("size"), 10, 3)
            .unwrap_err()
            .to_string();
        assert!(size_error.contains("expands beyond limit"), "{size_error}");
    }

    #[test]
    fn distribution_controls_device_and_manifest_identity() {
        const TEST_DISTRIBUTION: Distribution = Distribution {
            application_name: "Other Gateway Kit",
            expected_platform_id: "other",
            device_name: "Other Connector Device",
            qualifier: "com",
            organization: "OtherPlatform",
            state_application: "Other Connector",
            keyring_service: "com.other.connector",
            default_manifest_url: "https://other.example/connector/manifest",
            debug_manifest_env: "OTHER_CONNECTOR_MANIFEST_URL_FOR_TEST",
        };
        let temp = tempfile::tempdir().unwrap();
        let http = Arc::new(ScriptedHttp::new([
            manifest_response("other", "/api"),
            response(
                200,
                serde_json::json!({"access_token":"sk-other","token_type":"Bearer"}),
            ),
            provisioning_response(),
        ]));
        let browser = Arc::new(CallbackBrowser::default());
        let backend = Backend::with_distribution_dependencies(
            temp.path().join("state"),
            temp.path().join("home"),
            http,
            Arc::new(MemoryCredentials::default()),
            browser.clone(),
            TEST_DISTRIBUTION,
        );

        assert_eq!(
            backend.manifest_url().unwrap().as_str(),
            TEST_DISTRIBUTION.default_manifest_url
        );
        backend.connect().unwrap();
        let query: BTreeMap<_, _> = browser.opened().query_pairs().into_owned().collect();
        assert_eq!(
            query.get("device_name").map(String::as_str),
            Some(TEST_DISTRIBUTION.device_name)
        );
        assert_ne!(
            TEST_DISTRIBUTION.keyring_service,
            BOXAI_DISTRIBUTION.keyring_service
        );

        let wrong = Backend::with_distribution_dependencies(
            temp.path().join("wrong-state"),
            temp.path().join("wrong-home"),
            Arc::new(ScriptedHttp::new([manifest_response("boxai", "/api")])),
            Arc::new(MemoryCredentials::default()),
            Arc::new(NoBrowser),
            TEST_DISTRIBUTION,
        );
        let error = wrong.fetch_manifest().unwrap_err().to_string();
        assert!(
            error.contains("cannot connect to platform boxai"),
            "{error}"
        );
    }

    #[test]
    fn callback_timeout_is_testable_without_waiting_for_the_login_deadline() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let started = Instant::now();
        assert!(matches!(
            await_callback(listener, "expected", Duration::from_millis(1)),
            Err(BackendError::Timeout)
        ));
        assert!(started.elapsed() < Duration::from_secs(1));
    }
}
