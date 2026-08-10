use connector_core::{AgentId, AgentInstall, Model, Provisioning};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppFrame {
    AuthOnly,
    Shell,
}

pub fn app_frame(connected: bool) -> AppFrame {
    if connected {
        AppFrame::Shell
    } else {
        AppFrame::AuthOnly
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthAction {
    Connect,
    RetryRevocation,
    Blocked,
}

pub const fn auth_action(
    connected: bool,
    pending_revocation: bool,
    managed_projection: bool,
) -> AuthAction {
    if pending_revocation {
        AuthAction::RetryRevocation
    } else if !connected && managed_projection {
        AuthAction::Blocked
    } else {
        AuthAction::Connect
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelFilter {
    All,
    ChatCapable,
    NonChat,
}

impl ModelFilter {
    pub const fn id(self) -> &'static str {
        match self {
            Self::All => "all",
            Self::ChatCapable => "chat",
            Self::NonChat => "non-chat",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            "all" => Some(Self::All),
            "chat" => Some(Self::ChatCapable),
            "non-chat" => Some(Self::NonChat),
            _ => None,
        }
    }
}

pub fn selector_models(provisioning: &Provisioning) -> Vec<&Model> {
    provisioning
        .models
        .iter()
        .filter(|model| model.chat_capable)
        .collect()
}

pub fn plaza_models<'a>(
    provisioning: &'a Provisioning,
    query: &str,
    filter: ModelFilter,
) -> Vec<&'a Model> {
    let query = query.trim().to_lowercase();
    provisioning
        .model_plaza
        .models
        .iter()
        .filter(|model| match filter {
            ModelFilter::All => true,
            ModelFilter::ChatCapable => model.chat_capable,
            ModelFilter::NonChat => !model.chat_capable,
        })
        .filter(|model| {
            query.is_empty()
                || model.id.to_lowercase().contains(&query)
                || model
                    .description
                    .as_deref()
                    .is_some_and(|value| value.to_lowercase().contains(&query))
                || model
                    .vendor
                    .as_ref()
                    .is_some_and(|vendor| vendor.name.to_lowercase().contains(&query))
                || model
                    .tags
                    .iter()
                    .any(|tag| tag.to_lowercase().contains(&query))
        })
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Page {
    Overview,
    ModelPlaza,
    Projection,
    Agents,
    Agent(AgentId),
    Services,
    Settings,
}

impl Page {
    pub const fn id(self) -> &'static str {
        match self {
            Self::Overview => "overview",
            Self::ModelPlaza => "model-plaza",
            Self::Projection => "projection",
            Self::Agents => "agents",
            Self::Agent(AgentId::Claude) => "agent.claude",
            Self::Agent(AgentId::Codex) => "agent.codex",
            Self::Agent(AgentId::Gemini) => "agent.gemini",
            Self::Agent(AgentId::Grokbuild) => "agent.grokbuild",
            Self::Agent(AgentId::Opencode) => "agent.opencode",
            Self::Services => "services",
            Self::Settings => "settings",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Some(match id {
            "overview" => Self::Overview,
            "model-plaza" => Self::ModelPlaza,
            "projection" => Self::Projection,
            "agents" => Self::Agents,
            "agent.claude" => Self::Agent(AgentId::Claude),
            "agent.codex" => Self::Agent(AgentId::Codex),
            "agent.gemini" => Self::Agent(AgentId::Gemini),
            "agent.grokbuild" => Self::Agent(AgentId::Grokbuild),
            "agent.opencode" => Self::Agent(AgentId::Opencode),
            "services" => Self::Services,
            "settings" => Self::Settings,
            _ => return None,
        })
    }
}

pub const fn agent_icon(agent: AgentId) -> &'static str {
    match agent {
        AgentId::Claude => "agents/claude.svg",
        AgentId::Codex => "agents/openai.svg",
        AgentId::Gemini => "agents/gemini.svg",
        AgentId::Grokbuild => "agents/grok.svg",
        AgentId::Opencode => "agents/opencode-logo-light.svg",
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct AgentDetail<'a> {
    pub agent: AgentId,
    pub detected: bool,
    pub root: &'a std::path::Path,
    pub managed_projection: bool,
    pub selected_model: Option<&'a str>,
    pub default_model: Option<&'a str>,
}

pub fn agent_detail<'a>(
    agent: AgentId,
    installs: &'a [AgentInstall],
    provisioning: Option<&'a Provisioning>,
    selected_model: Option<&'a str>,
    managed_projection: bool,
) -> Option<AgentDetail<'a>> {
    let install = installs.iter().find(|install| install.agent == agent)?;
    Some(AgentDetail {
        agent,
        detected: install.detected,
        root: &install.root,
        managed_projection,
        selected_model,
        default_model: provisioning
            .map(|value| value.default_model.as_str())
            .filter(|value| !value.is_empty()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::BTreeSet, path::PathBuf};

    fn provisioning() -> Provisioning {
        Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"account":{"id":0,"username":"test","display_name":"","email":"","group":"default"},"usage":{"wallet_quota_remaining":0,"lifetime_quota_used":0,"lifetime_request_count":0},"billing":{"portal_url":"https://you-box.com/billing","wallet_fallback_allowed":true,"subscriptions":[]},"model_plaza":{"portal_url":"https://you-box.com/models","models":[{"id":"Claude-Chat","chat_capable":true,"description":"Fast assistant","tags":["Reasoning"],"vendor":{"id":"anthropic","name":"Anthropic"}},{"id":"embed-v1","chat_capable":false,"description":"Vectors","tags":["Embedding"],"vendor":{"id":"boxai","name":"BoxAI"}}]},"models":[{"id":"Claude-Chat","chat_capable":true,"description":"Fast assistant","tags":["Reasoning"],"vendor":{"id":"anthropic","name":"Anthropic"}}],"default_model":"Claude-Chat","mcp_servers":[],"skills":[]}}"#).unwrap()
    }

    #[test]
    fn connection_controls_the_entire_frame() {
        assert_eq!(app_frame(false), AppFrame::AuthOnly);
        assert_eq!(app_frame(true), AppFrame::Shell);
    }

    #[test]
    fn selectors_only_receive_chat_models() {
        let value = provisioning();
        assert_eq!(
            selector_models(&value)
                .iter()
                .map(|m| m.id.as_str())
                .collect::<Vec<_>>(),
            ["Claude-Chat"]
        );
    }

    #[test]
    fn plaza_searches_all_authoritative_metadata_and_filters() {
        let value = provisioning();
        for query in ["claude", "FAST", "anthropic", "reasonING"] {
            assert_eq!(
                plaza_models(&value, query, ModelFilter::All).len(),
                1,
                "{query}"
            );
        }
        assert_eq!(plaza_models(&value, "", ModelFilter::All).len(), 2);
        assert_eq!(plaza_models(&value, "", ModelFilter::ChatCapable).len(), 1);
        assert_eq!(
            plaza_models(&value, "", ModelFilter::NonChat)[0].id,
            "embed-v1"
        );
    }

    #[test]
    fn supported_agents_have_distinct_pages_and_assets() {
        let agents = [
            AgentId::Claude,
            AgentId::Codex,
            AgentId::Gemini,
            AgentId::Grokbuild,
            AgentId::Opencode,
        ];
        let pages: BTreeSet<_> = agents
            .map(|agent| Page::Agent(agent).id())
            .into_iter()
            .collect();
        let icons: BTreeSet<_> = agents.map(agent_icon).into_iter().collect();
        assert_eq!(pages.len(), agents.len());
        assert_eq!(icons.len(), agents.len());
        for agent in agents {
            assert_eq!(
                Page::from_id(Page::Agent(agent).id()),
                Some(Page::Agent(agent))
            );
        }
    }

    #[test]
    fn agents_index_has_a_stable_round_trip() {
        assert_eq!(Page::Agents.id(), "agents");
        assert_eq!(Page::from_id("agents"), Some(Page::Agents));
    }

    #[test]
    fn auth_action_distinguishes_recovery_states() {
        assert_eq!(auth_action(false, false, false), AuthAction::Connect);
        assert_eq!(auth_action(false, true, false), AuthAction::RetryRevocation);
        assert_eq!(auth_action(false, false, true), AuthAction::Blocked);
        assert_eq!(auth_action(false, true, true), AuthAction::RetryRevocation);
    }

    #[test]
    fn detail_comes_from_discovery_projection_and_model_state() {
        let value = provisioning();
        let installs = [AgentInstall {
            agent: AgentId::Codex,
            root: PathBuf::from("/canonical/codex"),
            detected: true,
        }];
        let detail = agent_detail(
            AgentId::Codex,
            &installs,
            Some(&value),
            Some("Claude-Chat"),
            true,
        )
        .unwrap();
        assert!(detail.detected && detail.managed_projection);
        assert_eq!(detail.root, std::path::Path::new("/canonical/codex"));
        assert_eq!(detail.selected_model, Some("Claude-Chat"));
        assert_eq!(detail.default_model, Some("Claude-Chat"));
    }
}
