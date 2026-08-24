//! Host-owned actions and credential-free view facts.

use std::collections::BTreeSet;

use gateway_connector_core::{AgentId, Protocol};

use crate::ModelKind;
use crate::Page;
use crate::preferences::{DensityPreference, Locale, ThemePreference};

/// Intent emitted by views. The host maps each variant to backend work.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    SignIn,
    Connect,
    ContinueBrowserLogin,
    BackToFirstRun,
    SelectPage(Page),
    SelectAgent(AgentId),
    Refresh,
    ApplyAgent(AgentId),
    RequestSignOut,
    RequestDisconnect,
    ConfirmDestructive,
    CancelDestructive,
    SetMcp {
        agent: AgentId,
        id: String,
        enabled: bool,
    },
    SetSkill {
        agent: AgentId,
        id: String,
        enabled: bool,
    },
    SetImageDirect {
        agent: AgentId,
        enabled: bool,
    },
    ToggleAgentDetails(AgentId),
    SetLocale(Locale),
    SetTheme(ThemePreference),
    SetDensity(DensityPreference),
    SetAutoCheckUpdates(bool),
    CheckUpdates,
    OpenDownloadPage,
    InstallUpdate,
    /// Install this download into the directory the product manages.
    InstallPackage,
    SetInstallDesktopShortcut(bool),
    SetSettingsQuery(String),
    SetModelQuery(String),
    SetModelKinds(BTreeSet<ModelKind>),
    SetModelVendors(BTreeSet<String>),
    ClearModelFilters,
    SelectModel {
        agent: AgentId,
        id: String,
    },
    SelectProtocol {
        agent: AgentId,
        protocol: Protocol,
    },
    SelectCodex {
        setting: String,
        value: String,
    },
    SetCodexCatalog {
        id: String,
        enabled: bool,
    },
}

#[cfg(test)]
mod tests {
    use super::Action;
    use crate::Page;
    use gateway_connector_core::AgentId;

    #[test]
    fn page_selection_is_an_intent_not_a_success() {
        assert_eq!(
            Action::SelectPage(Page::Agents),
            Action::SelectPage(Page::Agents)
        );
        assert_ne!(Action::ApplyAgent(AgentId::Codex), Action::Refresh);
    }
}
