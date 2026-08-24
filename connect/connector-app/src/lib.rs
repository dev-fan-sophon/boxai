//! Testable application state kept independent from GPUI rendering.

use std::collections::BTreeSet;
use std::path::PathBuf;

use gateway_connector_backend::{
    BrowserLoginOffer, ConnectionResult, ModelCapability, NotInstalledReason, Overview,
    classify_install, plan_install,
};
use gateway_connector_core::{
    AgentId, AgentInstall, ConnectionMode, Model, Protocol, Provisioning,
};

pub mod app;
pub mod isolated;
#[cfg(feature = "gpui-app")]
pub mod locale;
pub mod preferences;
pub mod sign_in_progress;
pub mod theme;

#[cfg(feature = "gpui-app")]
pub mod gpui_app;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Page {
    #[default]
    Overview,
    Agents,
    Mcp,
    Skills,
    Models,
    Account,
    Settings,
}

impl Page {
    pub const fn id(self) -> &'static str {
        match self {
            Self::Overview => "overview",
            Self::Agents => "agents",
            Self::Mcp => "mcp",
            Self::Skills => "skills",
            Self::Models => "models",
            Self::Account => "account",
            Self::Settings => "settings",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Some(match id {
            "overview" => Self::Overview,
            "agents" => Self::Agents,
            "mcp" => Self::Mcp,
            "skills" => Self::Skills,
            "models" => Self::Models,
            "account" => Self::Account,
            "settings" => Self::Settings,
            other if other.starts_with("agents.") => {
                let agent = other.strip_prefix("agents.")?;
                if AgentId::ALL.iter().any(|value| value.as_str() == agent) {
                    Self::Agents
                } else {
                    return None;
                }
            }
            _ => return None,
        })
    }

    pub fn available(self, _provisioning: Option<&Provisioning>) -> bool {
        true
    }
}

pub fn agent_page_id(agent: AgentId) -> String {
    format!("agents.{}", agent.as_str())
}

pub fn parse_agent_page_id(id: &str) -> Option<AgentId> {
    let agent = id.strip_prefix("agents.")?;
    AgentId::ALL
        .iter()
        .copied()
        .find(|value| value.as_str() == agent)
}

/// Model-plaza modality buckets mapped from Gateway `endpoints`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ModelKind {
    Text,
    Image,
    Video,
    Audio,
    Embedding,
    Model3d,
    Other,
}

impl ModelKind {
    pub const PLAZA: [Self; 6] = [
        Self::Text,
        Self::Image,
        Self::Video,
        Self::Audio,
        Self::Embedding,
        Self::Model3d,
    ];
    pub const DIRECT: [Self; 2] = [Self::Text, Self::Other];

    pub const fn id(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Image => "image",
            Self::Video => "video",
            Self::Audio => "audio",
            Self::Embedding => "embedding",
            Self::Model3d => "model-3d",
            Self::Other => "other",
        }
    }

    pub const fn label(self) -> &'static str {
        match self {
            Self::Text => "Text",
            Self::Image => "Image",
            Self::Video => "Video",
            Self::Audio => "Audio",
            Self::Embedding => "Embeddings and rerank",
            Self::Model3d => "3D",
            Self::Other => "Other",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Some(match id {
            "text" => Self::Text,
            "image" => Self::Image,
            "video" => Self::Video,
            "audio" => Self::Audio,
            "embedding" => Self::Embedding,
            "model-3d" => Self::Model3d,
            "other" => Self::Other,
            _ => return None,
        })
    }
}

pub fn kind_from_endpoint(endpoint: &str) -> Option<ModelKind> {
    let value = endpoint.trim().to_ascii_lowercase();
    if matches!(
        value.as_str(),
        "openai" | "openai-response" | "openai-response-compact" | "anthropic" | "gemini"
    ) {
        return Some(ModelKind::Text);
    }
    if value == "image-generation" {
        return Some(ModelKind::Image);
    }
    if value == "openai-video" {
        return Some(ModelKind::Video);
    }
    if value.starts_with("audio") {
        return Some(ModelKind::Audio);
    }
    if matches!(
        value.as_str(),
        "embeddings" | "gemini-embedding" | "jina-rerank"
    ) {
        return Some(ModelKind::Embedding);
    }
    if value.starts_with("model-3d") {
        return Some(ModelKind::Model3d);
    }
    None
}

pub fn model_kinds(model: &Model) -> BTreeSet<ModelKind> {
    let mapped = model
        .endpoints
        .iter()
        .filter_map(|endpoint| kind_from_endpoint(endpoint))
        .collect::<BTreeSet<_>>();
    if !mapped.is_empty() {
        return mapped;
    }
    let mut kinds = BTreeSet::new();
    kinds.insert(if model.chat_capable {
        ModelKind::Text
    } else {
        ModelKind::Other
    });
    kinds
}

pub fn model_matches_kind(model: &Model, kind: ModelKind) -> bool {
    model_kinds(model).contains(&kind)
}

pub fn descriptor_matches_kind(capability: ModelCapability, kind: ModelKind) -> bool {
    match kind {
        ModelKind::Text => !matches!(capability, ModelCapability::NonChat),
        ModelKind::Other => matches!(capability, ModelCapability::NonChat),
        _ => false,
    }
}

#[derive(Debug, Default)]
pub enum AppState {
    #[default]
    Loading,
    FirstRun,
    Connecting,
    BrowserLogin(Box<BrowserLoginOffer>),
    Connected {
        connection: Box<ConnectionResult>,
        overview: Box<AsyncValue<Overview>>,
        installs: AsyncValue<Vec<AgentInstall>>,
        managed_agents: AsyncValue<BTreeSet<AgentId>>,
        projection: ProjectionLifecycle,
    },
    Failed(String),
    /// The download has not been installed yet. It still runs, but not from a
    /// place it can keep: an archive preview directory is deleted behind it,
    /// and a download folder is cleared by the people and tools that clean it.
    /// This state is the install step, offered before anything is signed in.
    NotInstalled(Box<InstallInvitation>),
}

/// The install offer, resolved once at startup so the page shows real paths
/// instead of describing what will happen in general terms.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallInvitation {
    pub reason: NotInstalledReason,
    /// Where the program is running from now.
    pub current: PathBuf,
    /// Where installing would put it.
    pub target: PathBuf,
    /// True when an earlier version already occupies the target.
    pub replaces_existing: bool,
    pub desktop_shortcut: bool,
    pub busy: bool,
    pub error: Option<String>,
}

impl InstallInvitation {
    /// `None` when this copy is already an install, or when the platform
    /// installs some other way — macOS ships a disk image whose only correct
    /// move is dragging the bundle into Applications.
    pub fn detect() -> Option<Self> {
        let current = std::env::current_exe().ok()?;
        let reason = classify_install(&current, &std::env::temp_dir())?;
        let plan = plan_install(&current).ok()?;
        Some(Self {
            reason,
            current,
            target: plan.directory.clone(),
            replaces_existing: plan.replaces_existing,
            desktop_shortcut: true,
            busy: false,
            error: None,
        })
    }
}

/// Last verified value kept separately from the request that is in flight.
#[derive(Debug, Clone, PartialEq)]
pub struct AsyncValue<T> {
    pub value: Option<T>,
    pub status: AsyncStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum AsyncStatus {
    #[default]
    Idle,
    Loading,
    Refreshing,
    Ready,
    Error(String),
}

impl<T> Default for AsyncValue<T> {
    fn default() -> Self {
        Self {
            value: None,
            status: AsyncStatus::Idle,
        }
    }
}

impl<T> AsyncValue<T> {
    pub fn ready(value: T) -> Self {
        Self {
            value: Some(value),
            status: AsyncStatus::Ready,
        }
    }

    pub fn error(error: impl Into<String>) -> Self {
        Self {
            value: None,
            status: AsyncStatus::Error(error.into()),
        }
    }

    pub fn begin_refresh(&mut self) {
        self.status = if self.value.is_some() {
            AsyncStatus::Refreshing
        } else {
            AsyncStatus::Loading
        };
    }

    pub fn finish(&mut self, result: Result<T, String>) {
        match result {
            Ok(value) => {
                self.value = Some(value);
                self.status = AsyncStatus::Ready;
            }
            Err(error) => self.status = AsyncStatus::Error(error),
        }
    }

    pub fn is_stale(&self) -> bool {
        self.value.is_some()
            && matches!(self.status, AsyncStatus::Refreshing | AsyncStatus::Error(_))
    }
}

#[derive(Debug, Default)]
pub enum ProjectionLifecycle {
    #[default]
    NotManaged,
    ManagedExisting,
    Applying,
    ApplyFailed,
    Disconnecting,
    DisconnectFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectionSemantic {
    NotManaged,
    ManagedExisting,
    Applying,
    ApplyFailed,
    Disconnecting,
    DisconnectFailed,
}

impl ProjectionLifecycle {
    pub const fn semantic(&self) -> ProjectionSemantic {
        match self {
            Self::NotManaged => ProjectionSemantic::NotManaged,
            Self::ManagedExisting => ProjectionSemantic::ManagedExisting,
            Self::Applying => ProjectionSemantic::Applying,
            Self::ApplyFailed => ProjectionSemantic::ApplyFailed,
            Self::Disconnecting => ProjectionSemantic::Disconnecting,
            Self::DisconnectFailed => ProjectionSemantic::DisconnectFailed,
        }
    }

    const fn has_projection_ownership(&self) -> bool {
        matches!(
            self,
            Self::ManagedExisting
                | Self::Applying
                | Self::ApplyFailed
                | Self::Disconnecting
                | Self::DisconnectFailed
        )
    }
}

impl ProjectionSemantic {
    pub const fn message(self) -> &'static str {
        match self {
            Self::NotManaged => "No managed Agent files yet.",
            Self::ManagedExisting => {
                "Managed files exist. Apply changes or disconnect this connection."
            }
            Self::Applying => "Applying managed files…",
            Self::ApplyFailed => "Apply failed. You can apply again.",
            Self::Disconnecting => "Disconnecting managed files…",
            Self::DisconnectFailed => "Disconnect failed. Managed files may still be present.",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpEvidence {
    AvailableFromPlatform,
    ConfiguredForAgents,
}

impl McpEvidence {
    pub const fn label(self) -> &'static str {
        match self {
            Self::AvailableFromPlatform => "Available from platform",
            Self::ConfiguredForAgents => "Configured for Agents",
        }
    }
}

impl AppState {
    pub fn connected(result: ConnectionResult) -> Self {
        Self::Connected {
            connection: Box::new(result),
            overview: Box::new(AsyncValue::default()),
            installs: AsyncValue::default(),
            managed_agents: AsyncValue::default(),
            projection: ProjectionLifecycle::NotManaged,
        }
    }

    pub fn update_protocol(&mut self, agent: AgentId, protocol: Protocol) -> Result<(), String> {
        if !agent.supported_protocols().contains(&protocol) {
            return Err(format!(
                "{} does not support {}",
                agent.display_name(),
                protocol.display_name()
            ));
        }
        if let Self::Connected { connection, .. } = self
            && let Some(manifest) = &connection.manifest
            && protocol
                .wire_protocol()
                .is_some_and(|wire| !manifest.gateway.protocols.contains(&wire))
        {
            return Err(format!(
                "The Gateway does not advertise {}",
                protocol.display_name()
            ));
        }
        if let Self::Connected {
            connection,
            managed_agents,
            projection,
            ..
        } = self
            && let Some(selection) = connection.profile.agents.get_mut(&agent)
        {
            selection.protocol = protocol;
            *projection = projection_after_edit(managed_agents);
        }
        Ok(())
    }

    pub fn update_model(&mut self, agent: AgentId, model: String) {
        if let Self::Connected {
            connection,
            managed_agents,
            projection,
            ..
        } = self
            && let Some(selection) = connection.profile.agents.get_mut(&agent)
        {
            selection.default_model = Some(model);
            *projection = projection_after_edit(managed_agents);
        }
    }

    pub fn update_codex_settings(&mut self, settings: gateway_connector_core::CodexSettings) {
        if let Self::Connected {
            connection,
            managed_agents,
            projection,
            ..
        } = self
        {
            connection
                .profile
                .agents
                .get_mut(&AgentId::Codex)
                .expect("the Codex selection always exists")
                .codex = settings;
            *projection = projection_after_edit(managed_agents);
        }
    }

    pub fn set_codex_catalog_model(&mut self, model_id: String, enabled: bool) {
        if let Self::Connected {
            connection,
            managed_agents,
            projection,
            ..
        } = self
        {
            let allowed = connection.provisioning.as_ref().is_none_or(|provisioning| {
                provisioning
                    .models
                    .iter()
                    .any(|model| model.id == model_id && model.is_codex_catalog_model())
            });
            let catalog = &mut connection
                .profile
                .agents
                .get_mut(&AgentId::Codex)
                .expect("the Codex selection always exists")
                .codex
                .catalog_models;
            if enabled {
                if allowed {
                    catalog.insert(model_id);
                }
            } else {
                catalog.remove(&model_id);
            }
            *projection = projection_after_edit(managed_agents);
        }
    }

    pub fn set_mcp_enabled(&mut self, agent: AgentId, mcp_id: String, enabled: bool) {
        if let Self::Connected {
            connection,
            managed_agents,
            projection,
            ..
        } = self
            && let Some(selection) = connection.profile.agents.get_mut(&agent)
        {
            selection.set_mcp_enabled(mcp_id, enabled);
            *projection = projection_after_edit(managed_agents);
        }
    }

    pub fn set_image_direct(&mut self, agent: AgentId, enabled: bool) {
        if !agent.image_direct_env() {
            return;
        }
        if let Self::Connected {
            connection,
            managed_agents,
            projection,
            ..
        } = self
            && let Some(selection) = connection.profile.agents.get_mut(&agent)
        {
            selection.image_direct = enabled;
            *projection = projection_after_edit(managed_agents);
        }
    }

    pub fn set_skill_enabled(&mut self, agent: AgentId, skill_id: String, enabled: bool) {
        if let Self::Connected {
            connection,
            managed_agents,
            projection,
            ..
        } = self
            && let Some(selection) = connection.profile.agents.get_mut(&agent)
        {
            selection.set_skill_enabled(skill_id, enabled);
            *projection = projection_after_edit(managed_agents);
        }
    }

    pub fn restore_agent_choices(
        &mut self,
        agents: std::collections::BTreeMap<AgentId, gateway_connector_core::AgentSelection>,
        confirmed_direct_models: BTreeSet<String>,
    ) {
        if let Self::Connected {
            connection,
            managed_agents,
            projection,
            ..
        } = self
        {
            connection.profile.agents = agents;
            connection.profile.confirmed_direct_models = confirmed_direct_models;
            *projection = projection_after_edit(managed_agents);
        }
    }

    /// Applies an explicit picker choice, including the confirmation required for an
    /// unknown-capability model in direct mode.
    pub fn select_model(&mut self, agent: AgentId, model_id: String) -> Result<(), String> {
        let Self::Connected {
            connection,
            managed_agents,
            projection,
            ..
        } = self
        else {
            return Ok(());
        };
        let capability = connection
            .models
            .iter()
            .find(|model| model.id == model_id)
            .map(|model| model.capability)
            .ok_or_else(|| format!("Model `{model_id}` is not in the catalog"))?;
        if capability == ModelCapability::NonChat {
            return Err(format!("Model `{model_id}` is not chat-capable"));
        }
        if agent == AgentId::Codex
            && connection.profile.mode == ConnectionMode::Provisioned
            && !connection
                .provisioning
                .as_ref()
                .is_some_and(|provisioning| {
                    provisioning
                        .models
                        .iter()
                        .any(|model| model.id == model_id && model.is_codex_catalog_model())
                })
        {
            return Err(format!("Model `{model_id}` is not a Codex Responses model"));
        }
        if connection.profile.mode == ConnectionMode::Direct
            && capability == ModelCapability::Unknown
        {
            connection
                .profile
                .confirm_direct_model(model_id.clone())
                .map_err(|error| error.to_string())?;
        }
        let supported_reasoning = connection
            .provisioning
            .as_ref()
            .and_then(|provisioning| {
                provisioning
                    .models
                    .iter()
                    .find(|model| model.id == model_id)
            })
            .map(|model| model.supported_reasoning.as_slice())
            .unwrap_or_default();
        let selection = connection
            .profile
            .agents
            .get_mut(&agent)
            .expect("all Agent selections exist");
        if agent == AgentId::Codex
            && !supported_reasoning.is_empty()
            && selection.codex.reasoning_effort.is_some_and(|effort| {
                !supported_reasoning
                    .iter()
                    .any(|supported| supported == effort.as_str())
            })
        {
            selection.codex.reasoning_effort = supported_reasoning
                .get((supported_reasoning.len() - 1) / 2)
                .and_then(|effort| effort.parse().ok());
        }
        selection.default_model = Some(model_id);
        *projection = projection_after_edit(managed_agents);
        Ok(())
    }

    pub fn set_projection_status(
        &mut self,
        installs: AsyncValue<Vec<AgentInstall>>,
        managed_agents: AsyncValue<BTreeSet<AgentId>>,
    ) {
        if let Self::Connected {
            installs: current_installs,
            managed_agents: current_managed,
            projection,
            ..
        } = self
        {
            let has_managed = managed_agents
                .value
                .as_ref()
                .is_some_and(|agents| !agents.is_empty());
            *current_installs = installs;
            *current_managed = managed_agents;
            if matches!(
                projection,
                ProjectionLifecycle::NotManaged | ProjectionLifecycle::ManagedExisting
            ) {
                *projection = if has_managed {
                    ProjectionLifecycle::ManagedExisting
                } else {
                    ProjectionLifecycle::NotManaged
                };
            }
        }
    }

    pub fn start_direct_apply(&mut self) -> bool {
        if let Self::Connected { projection, .. } = self {
            *projection = ProjectionLifecycle::Applying;
            true
        } else {
            false
        }
    }

    pub fn finish_apply_and_settle(&mut self) {
        if let Self::Connected { projection, .. } = self
            && matches!(projection, ProjectionLifecycle::Applying)
        {
            *projection = ProjectionLifecycle::ManagedExisting;
        }
    }

    pub fn fail_apply(&mut self) {
        if let Self::Connected { projection, .. } = self
            && matches!(projection, ProjectionLifecycle::Applying)
        {
            *projection = ProjectionLifecycle::ApplyFailed;
        }
    }

    pub fn start_disconnect(&mut self) {
        if let Self::Connected { projection, .. } = self {
            *projection = ProjectionLifecycle::Disconnecting;
        }
    }

    pub fn fail_disconnect(&mut self) {
        if let Self::Connected { projection, .. } = self
            && matches!(projection, ProjectionLifecycle::Disconnecting)
        {
            *projection = ProjectionLifecycle::DisconnectFailed;
        }
    }

    pub fn mcp_evidence(&self) -> McpEvidence {
        match self {
            Self::Connected { projection, .. } if projection.has_projection_ownership() => {
                McpEvidence::ConfiguredForAgents
            }
            _ => McpEvidence::AvailableFromPlatform,
        }
    }
}

pub(crate) fn apply_boxai_codex_defaults(result: &mut ConnectionResult) {
    if result.profile.platform_id != "boxai" {
        return;
    }
    let Some(provisioning) = result.provisioning.as_ref() else {
        return;
    };
    let available = provisioning
        .models
        .iter()
        .filter(|model| model.is_codex_catalog_model())
        .map(|model| model.id.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    let selection = result
        .profile
        .agents
        .get_mut(&AgentId::Codex)
        .expect("every profile has a GPT(Codex) selection");
    if selection
        .default_model
        .as_deref()
        .is_some_and(|model| !available.contains(model))
    {
        selection.default_model = None;
    }
    if selection.default_model.is_none() {
        selection.default_model = available
            .get(provisioning.default_model.as_str())
            .copied()
            .or_else(|| available.first().copied())
            .map(str::to_owned);
    }
    selection
        .codex
        .catalog_models
        .retain(|model| available.contains(model.as_str()));
    if selection.codex.catalog_models.is_empty() {
        selection.codex.catalog_models.extend(
            available
                .into_iter()
                .filter(|model| selection.default_model.as_deref() != Some(*model))
                .map(str::to_owned),
        );
    }
}

fn projection_after_edit(managed_agents: &AsyncValue<BTreeSet<AgentId>>) -> ProjectionLifecycle {
    if managed_agents
        .value
        .as_ref()
        .is_some_and(|agents| !agents.is_empty())
    {
        ProjectionLifecycle::ManagedExisting
    } else {
        ProjectionLifecycle::NotManaged
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gateway_connector_backend::ModelDescriptor;
    use gateway_connector_core::{CanonicalBaseUrl, ConnectionProfile, Model, Provisioning};

    #[test]
    fn selection_keeps_unmanaged_state_until_apply() {
        let profile = ConnectionProfile::new(
            "Test",
            CanonicalBaseUrl::parse("https://example.com").expect("URL"),
        )
        .expect("profile");
        let mut state = AppState::connected(ConnectionResult {
            profile,
            models: Vec::new(),
            manifest: None,
            provisioning: None,
            synchronized_skills: Default::default(),
        });
        state
            .update_protocol(AgentId::Codex, Protocol::OpenaiResponses)
            .expect("Codex protocol");
        state.update_model(AgentId::Codex, "model-a".to_owned());
        let AppState::Connected { projection, .. } = state else {
            panic!("connected state")
        };
        assert!(matches!(projection, ProjectionLifecycle::NotManaged));
    }

    #[test]
    fn codex_settings_are_staged_without_a_preview() {
        let mut state = connected_fixture(Vec::new());
        let settings = gateway_connector_core::CodexSettings {
            reasoning_effort: Some(gateway_connector_core::CodexReasoningEffort::High),
            sandbox_mode: Some(gateway_connector_core::CodexSandboxMode::WorkspaceWrite),
            ..Default::default()
        };
        state.update_codex_settings(settings.clone());
        state.set_codex_catalog_model("beta".into(), true);
        let AppState::Connected {
            connection,
            projection,
            ..
        } = state
        else {
            panic!("connected state")
        };
        assert_eq!(
            connection.profile.agents[&AgentId::Codex]
                .codex
                .reasoning_effort,
            settings.reasoning_effort
        );
        assert!(
            connection.profile.agents[&AgentId::Codex]
                .codex
                .catalog_models
                .contains("beta")
        );
        assert!(matches!(projection, ProjectionLifecycle::NotManaged));
    }

    #[test]
    fn incompatible_agent_protocol_is_rejected_without_mutating_state() {
        let mut state = connected_fixture(Vec::new());
        assert!(
            state
                .update_protocol(AgentId::Codex, Protocol::OpenaiChat)
                .is_err()
        );
        let AppState::Connected { connection, .. } = state else {
            panic!("connected")
        };
        assert_eq!(
            connection.profile.agents[&AgentId::Codex].protocol,
            Protocol::Auto
        );
    }

    #[test]
    fn unadvertised_protocol_is_rejected_without_mutating_state() {
        use gateway_connector_core::{ConnectionManifest, Gateway, Platform, WireProtocol};

        let mut state = connected_fixture(Vec::new());
        let AppState::Connected { connection, .. } = &mut state else {
            panic!("connected")
        };
        connection.manifest = Some(
            ConnectionManifest::direct(
                Platform {
                    id: "test".into(),
                    name: "Test".into(),
                },
                Gateway {
                    base_url: "https://example.com".parse().expect("URL"),
                    protocols: vec![WireProtocol::OpenaiResponses],
                },
                "https://example.com/provisioning"
                    .parse()
                    .expect("provisioning URL"),
            )
            .expect("manifest"),
        );

        assert!(
            state
                .update_protocol(AgentId::Opencode, Protocol::Anthropic)
                .is_err()
        );
        let AppState::Connected { connection, .. } = state else {
            panic!("connected")
        };
        assert_eq!(
            connection.profile.agents[&AgentId::Opencode].protocol,
            Protocol::Auto
        );
    }

    #[test]
    fn apply_does_not_require_a_preview_token() {
        let mut state = connected_fixture(Vec::new());
        assert_eq!(projection_semantic(&state), ProjectionSemantic::NotManaged);
        assert!(state.start_direct_apply());
        assert_eq!(projection_semantic(&state), ProjectionSemantic::Applying);
        state.finish_apply_and_settle();
        assert_eq!(
            projection_semantic(&state),
            ProjectionSemantic::ManagedExisting
        );
        assert_eq!(
            projection_semantic(&state).message(),
            "Managed files exist. Apply changes or disconnect this connection."
        );
        assert_eq!(state.mcp_evidence(), McpEvidence::ConfiguredForAgents);
    }

    #[test]
    fn failed_apply_and_disconnect_stay_retryable() {
        let mut state = connected_fixture(Vec::new());
        assert!(state.start_direct_apply());
        state.fail_apply();
        assert_eq!(projection_semantic(&state), ProjectionSemantic::ApplyFailed);
        assert_eq!(
            projection_semantic(&state).message(),
            "Apply failed. You can apply again."
        );
        assert!(state.start_direct_apply());
        state.finish_apply_and_settle();

        state.start_disconnect();
        state.fail_disconnect();
        assert_eq!(
            projection_semantic(&state),
            ProjectionSemantic::DisconnectFailed
        );
    }

    #[test]
    fn receipt_status_and_edits_are_managed_existing() {
        let mut state = connected_fixture(Vec::new());
        state.set_projection_status(
            AsyncValue::ready(Vec::new()),
            AsyncValue::ready(BTreeSet::from([AgentId::Codex])),
        );
        assert_eq!(
            projection_semantic(&state),
            ProjectionSemantic::ManagedExisting
        );
        assert_eq!(state.mcp_evidence(), McpEvidence::ConfiguredForAgents);

        state
            .update_protocol(AgentId::Codex, Protocol::OpenaiResponses)
            .expect("Codex protocol");
        assert_eq!(
            projection_semantic(&state),
            ProjectionSemantic::ManagedExisting
        );
        assert_ne!(projection_semantic(&state), ProjectionSemantic::NotManaged);
    }

    #[test]
    fn lifecycle_and_mcp_evidence_render_truthfully_in_both_locales() {
        use crate::preferences::Locale;

        let applied = ProjectionSemantic::ManagedExisting.message();
        assert_eq!(
            Locale::En.text(applied),
            "Managed files exist. Apply changes or disconnect this connection."
        );
        assert_eq!(
            Locale::ZhCn.text(applied),
            "已存在托管文件。请应用更改或断开此连接。"
        );
        for (evidence, english, chinese) in [
            (
                McpEvidence::AvailableFromPlatform,
                "Available from platform",
                "平台提供",
            ),
            (
                McpEvidence::ConfiguredForAgents,
                "Configured for Agents",
                "已为 Agent 配置",
            ),
        ] {
            assert_eq!(evidence.label(), english);
            assert_eq!(Locale::En.text(evidence.label()), english);
            assert_eq!(Locale::ZhCn.text(evidence.label()), chinese);
        }
    }

    #[test]
    fn catalog_pages_stay_reachable_when_empty() {
        assert!(Page::Overview.available(None));
        assert!(Page::Mcp.available(None));
        assert!(Page::Skills.available(None));
        assert!(Page::Account.available(None));
        assert!(Page::Models.available(None));
        assert!(Page::Agents.available(None));
        assert!(Page::Settings.available(None));
    }

    #[test]
    fn agent_nested_ids_route_to_the_agents_page() {
        assert_eq!(Page::from_id("overview"), Some(Page::Overview));
        assert_eq!(Page::from_id("agents"), Some(Page::Agents));
        assert_eq!(Page::from_id("agents.claude"), Some(Page::Agents));
        assert_eq!(Page::from_id("agents.codex"), Some(Page::Agents));
        assert_eq!(Page::from_id("agents.unknown"), None);
        assert_eq!(
            crate::parse_agent_page_id("agents.gemini"),
            Some(AgentId::Gemini)
        );
        assert_eq!(crate::agent_page_id(AgentId::Claude), "agents.claude");
        assert_eq!(Page::default(), Page::Overview);
    }

    #[test]
    fn overview_stays_empty_without_a_manifest() {
        let state = connected_fixture(Vec::new());
        let AppState::Connected {
            connection,
            overview,
            ..
        } = state
        else {
            panic!("connected");
        };
        assert!(connection.manifest.is_none());
        assert!(overview.value.is_none());
        assert_eq!(overview.status, AsyncStatus::Idle);
    }

    #[test]
    fn model_kinds_map_gateway_endpoints_and_direct_fallback() {
        let chat = Model {
            id: "chat".into(),
            chat_capable: true,
            responses_native: false,
            description: None,
            icon: None,
            tags: Vec::new(),
            endpoints: vec!["openai".into()],
            supported_reasoning: Vec::new(),
            vendor: None,
        };
        let image = Model {
            id: "image".into(),
            chat_capable: false,
            responses_native: false,
            description: None,
            icon: None,
            tags: Vec::new(),
            endpoints: vec!["image-generation".into()],
            supported_reasoning: Vec::new(),
            vendor: None,
        };
        let direct_other = Model {
            id: "embed".into(),
            chat_capable: false,
            responses_native: false,
            description: None,
            icon: None,
            tags: Vec::new(),
            endpoints: Vec::new(),
            supported_reasoning: Vec::new(),
            vendor: None,
        };
        assert!(crate::model_matches_kind(&chat, ModelKind::Text));
        assert!(crate::model_matches_kind(&image, ModelKind::Image));
        assert!(crate::model_matches_kind(&direct_other, ModelKind::Other));
        assert!(!crate::model_matches_kind(&chat, ModelKind::Image));
        assert!(crate::descriptor_matches_kind(
            ModelCapability::Chat,
            ModelKind::Text
        ));
        assert!(crate::descriptor_matches_kind(
            ModelCapability::NonChat,
            ModelKind::Other
        ));
    }

    #[test]
    fn projection_status_preserves_independent_errors() {
        let mut state = connected_fixture(Vec::new());
        state.set_projection_status(
            AsyncValue::error("discovery failed"),
            AsyncValue::error("coordinator failed"),
        );
        let AppState::Connected {
            installs,
            managed_agents,
            ..
        } = state
        else {
            panic!("connected")
        };
        assert!(
            matches!(installs.status, AsyncStatus::Error(ref error) if error == "discovery failed")
        );
        assert_eq!(
            managed_agents.status,
            AsyncStatus::Error("coordinator failed".into())
        );
    }

    #[test]
    fn mcp_and_skill_toggles_stage_without_writing_files() {
        let mut state = connected_fixture(Vec::new());
        state.set_mcp_enabled(AgentId::Claude, "origin-assets".into(), false);
        state.set_skill_enabled(AgentId::Claude, "deploy".into(), false);
        let AppState::Connected {
            connection,
            projection,
            ..
        } = &state
        else {
            panic!("connected")
        };
        assert!(!connection.profile.agents[&AgentId::Claude].mcp_enabled("origin-assets"));
        assert!(!connection.profile.agents[&AgentId::Claude].skill_enabled("deploy"));
        assert!(matches!(projection, ProjectionLifecycle::NotManaged));
    }

    #[test]
    fn selecting_a_codex_model_does_not_change_other_agents() {
        let mut state = connected_fixture(vec![ModelDescriptor {
            id: "codex-only".into(),
            capability: ModelCapability::Chat,
            owned_by: None,
            created: None,
            object: None,
            metadata: Default::default(),
        }]);
        state
            .select_model(AgentId::Codex, "codex-only".into())
            .expect("Codex model");
        let AppState::Connected { connection, .. } = &state else {
            panic!("connected")
        };
        assert_eq!(
            connection.profile.agents[&AgentId::Codex]
                .default_model
                .as_deref(),
            Some("codex-only")
        );
        assert_ne!(
            connection.profile.agents[&AgentId::Claude]
                .default_model
                .as_deref(),
            Some("codex-only")
        );
    }

    #[test]
    fn selecting_a_codex_model_reconciles_unsupported_reasoning_effort() {
        let mut profile = ConnectionProfile::new(
            "Test",
            CanonicalBaseUrl::parse("https://example.com").expect("URL"),
        )
        .expect("profile");
        profile
            .agents
            .get_mut(&AgentId::Codex)
            .expect("Codex profile")
            .codex
            .reasoning_effort = Some(gateway_connector_core::CodexReasoningEffort::High);
        let models = vec![ModelDescriptor {
            id: "target".into(),
            capability: ModelCapability::Chat,
            owned_by: None,
            created: None,
            object: None,
            metadata: Default::default(),
        }];
        let provisioning = Provisioning::direct(
            vec![Model {
                id: "target".into(),
                chat_capable: true,
                responses_native: true,
                description: None,
                icon: None,
                tags: Vec::new(),
                endpoints: vec!["openai-response".into()],
                supported_reasoning: vec!["none".into(), "low".into(), "medium".into()],
                vendor: None,
            }],
            "target".into(),
        )
        .expect("provisioning");
        let mut state = AppState::connected(ConnectionResult {
            profile,
            models,
            manifest: None,
            provisioning: Some(provisioning),
            synchronized_skills: Default::default(),
        });

        state
            .select_model(AgentId::Codex, "target".into())
            .expect("Codex model");

        let AppState::Connected { connection, .. } = state else {
            panic!("connected")
        };
        assert_eq!(
            connection.profile.agents[&AgentId::Codex]
                .codex
                .reasoning_effort,
            Some(gateway_connector_core::CodexReasoningEffort::Low)
        );
    }

    #[test]
    fn refresh_failure_keeps_the_last_verified_installs() {
        let mut installs = AsyncValue::ready(vec![AgentInstall {
            agent: AgentId::Codex,
            root: std::path::PathBuf::from("/tmp/codex"),
            detected: true,
        }]);
        installs.begin_refresh();
        assert!(installs.is_stale());
        installs.finish(Err("discovery failed".into()));
        assert!(installs.is_stale());
        assert_eq!(
            installs
                .value
                .as_ref()
                .expect("verified value")
                .first()
                .expect("install")
                .agent,
            AgentId::Codex
        );
        assert_eq!(
            installs.status,
            AsyncStatus::Error("discovery failed".into())
        );
    }

    #[test]
    fn explicit_unknown_selection_confirms_but_non_chat_is_rejected() {
        let models = [
            ("unknown", ModelCapability::Unknown),
            ("embedding", ModelCapability::NonChat),
        ]
        .into_iter()
        .map(|(id, capability)| ModelDescriptor {
            id: id.into(),
            capability,
            owned_by: None,
            created: None,
            object: None,
            metadata: Default::default(),
        })
        .collect();
        let mut state = connected_fixture(models);
        state
            .select_model(AgentId::Claude, "unknown".into())
            .expect("explicit confirmation");
        let AppState::Connected { connection, .. } = &state else {
            panic!("connected")
        };
        assert!(
            connection
                .profile
                .confirmed_direct_models
                .contains("unknown")
        );
        assert!(
            state
                .select_model(AgentId::Claude, "embedding".into())
                .is_err()
        );
    }

    #[test]
    fn boxai_uses_the_provisioned_codex_default_and_all_compatible_models() {
        let mut profile = ConnectionProfile::new(
            "BoxAI",
            CanonicalBaseUrl::parse("https://you-box.com").expect("URL"),
        )
        .expect("profile");
        profile.platform_id = "boxai".into();
        let provisioning = Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"models":[{"id":"gpt-5.6-sol","chat_capable":true,"responses_native":true},{"id":"gpt-5.6-terra","chat_capable":true,"responses_native":true},{"id":"gpt-5.6-luna","chat_capable":true,"responses_native":true},{"id":"grok-4.6","chat_capable":true,"endpoints":["openai","openai-response"]}],"default_model":"gpt-5.6-terra","mcp_servers":[],"skills":[]}}"#).expect("provisioning");
        let mut result = ConnectionResult {
            profile,
            models: Vec::new(),
            manifest: None,
            provisioning: Some(provisioning),
            synchronized_skills: Default::default(),
        };

        apply_boxai_codex_defaults(&mut result);

        let selection = &result.profile.agents[&AgentId::Codex];
        assert_eq!(selection.default_model.as_deref(), Some("gpt-5.6-terra"));
        assert_eq!(
            selection.codex.catalog_models,
            BTreeSet::from([
                "gpt-5.6-luna".into(),
                "gpt-5.6-sol".into(),
                "grok-4.6".into()
            ])
        );
    }

    #[test]
    fn boxai_includes_every_native_responses_model() {
        let mut profile = ConnectionProfile::new(
            "BoxAI",
            CanonicalBaseUrl::parse("https://you-box.com").expect("URL"),
        )
        .expect("profile");
        profile.platform_id = "boxai".into();
        let provisioning = Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"models":[{"id":"gpt-5.6-sol","chat_capable":true,"responses_native":true},{"id":"gpt-5.6-terra","chat_capable":true,"responses_native":true},{"id":"gpt-5.6-luna","chat_capable":true,"responses_native":true},{"id":"grok-4.6","chat_capable":true,"responses_native":true,"endpoints":["openai-response"]}],"default_model":"gpt-5.6-terra","mcp_servers":[],"skills":[]}}"#).expect("provisioning");
        let mut result = ConnectionResult {
            profile,
            models: Vec::new(),
            manifest: None,
            provisioning: Some(provisioning),
            synchronized_skills: Default::default(),
        };

        apply_boxai_codex_defaults(&mut result);

        let selection = &result.profile.agents[&AgentId::Codex];
        assert_eq!(selection.default_model.as_deref(), Some("gpt-5.6-terra"));
        assert!(selection.codex.catalog_models.contains("grok-4.6"));
        assert!(
            result
                .provisioning
                .as_ref()
                .expect("provisioning")
                .models
                .iter()
                .any(|model| model.id == "grok-4.6" && model.is_responses_native())
        );
    }

    #[test]
    fn boxai_codex_defaults_do_not_replace_an_explicit_model_choice() {
        let mut profile = ConnectionProfile::new(
            "BoxAI",
            CanonicalBaseUrl::parse("https://you-box.com").expect("URL"),
        )
        .expect("profile");
        profile.platform_id = "boxai".into();
        profile
            .agents
            .get_mut(&AgentId::Codex)
            .expect("GPT(Codex) selection")
            .default_model = Some("gpt-5.6-terra".into());
        let provisioning = Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"models":[{"id":"gpt-5.6-sol","chat_capable":true,"responses_native":true},{"id":"gpt-5.6-terra","chat_capable":true,"responses_native":true},{"id":"gpt-5.6-luna","chat_capable":true,"responses_native":true}],"default_model":"gpt-5.6-sol","mcp_servers":[],"skills":[]}}"#).expect("provisioning");
        let mut result = ConnectionResult {
            profile,
            models: Vec::new(),
            manifest: None,
            provisioning: Some(provisioning),
            synchronized_skills: Default::default(),
        };

        apply_boxai_codex_defaults(&mut result);

        let selection = &result.profile.agents[&AgentId::Codex];
        assert_eq!(selection.default_model.as_deref(), Some("gpt-5.6-terra"));
        assert_eq!(
            selection.codex.catalog_models,
            BTreeSet::from(["gpt-5.6-luna".into(), "gpt-5.6-sol".into()])
        );
    }

    fn connected_fixture(models: Vec<ModelDescriptor>) -> AppState {
        let profile = ConnectionProfile::new(
            "Test",
            CanonicalBaseUrl::parse("https://example.com").expect("URL"),
        )
        .expect("profile");
        AppState::connected(ConnectionResult {
            profile,
            models,
            manifest: None,
            provisioning: None,
            synchronized_skills: Default::default(),
        })
    }

    fn projection_semantic(state: &AppState) -> ProjectionSemantic {
        projection_lifecycle(state).semantic()
    }

    fn projection_lifecycle(state: &AppState) -> &ProjectionLifecycle {
        let AppState::Connected { projection, .. } = state else {
            panic!("connected")
        };
        projection
    }
}
