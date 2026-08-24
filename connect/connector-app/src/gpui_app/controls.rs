use gateway_connector_backend::Distribution;
use gateway_connector_core::{
    AgentId, CodexApprovalPolicy, CodexReasoningEffort, CodexReasoningSummary, CodexSandboxMode,
    CodexSettings, CodexVerbosity, CodexWebSearch, Protocol,
};
use gpui::{Context, IntoElement, Styled, Window, px};
use gpui_kit::prelude::*;

use crate::preferences::Locale;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CodexSetting {
    ReasoningEffort,
    ReasoningSummary,
    Verbosity,
    ApprovalPolicy,
    SandboxMode,
    WebSearch,
}

impl CodexSetting {
    pub(crate) const ALL: [Self; 6] = [
        Self::ReasoningEffort,
        Self::ReasoningSummary,
        Self::Verbosity,
        Self::ApprovalPolicy,
        Self::SandboxMode,
        Self::WebSearch,
    ];

    pub(crate) const fn id(self) -> &'static str {
        match self {
            Self::ReasoningEffort => "reasoning-effort",
            Self::ReasoningSummary => "reasoning-summary",
            Self::Verbosity => "verbosity",
            Self::ApprovalPolicy => "approval-policy",
            Self::SandboxMode => "sandbox-mode",
            Self::WebSearch => "web-search",
        }
    }

    pub(crate) fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|setting| setting.id() == id)
    }

    pub(crate) fn selected(self, settings: &CodexSettings) -> &'static str {
        match self {
            Self::ReasoningEffort => settings.reasoning_effort.map(|value| value.as_str()),
            Self::ReasoningSummary => settings.reasoning_summary.map(|value| value.as_str()),
            Self::Verbosity => settings.verbosity.map(|value| value.as_str()),
            Self::ApprovalPolicy => settings.approval_policy.map(|value| value.as_str()),
            Self::SandboxMode => settings.sandbox_mode.map(|value| value.as_str()),
            Self::WebSearch => settings.web_search.map(|value| value.as_str()),
        }
        .unwrap_or("inherit")
    }

    pub(crate) fn update(self, settings: &mut CodexSettings, value: &str) -> Result<(), String> {
        let value = (value != "inherit").then_some(value);
        match self {
            Self::ReasoningEffort => settings.reasoning_effort = parse_codex_choice(value)?,
            Self::ReasoningSummary => settings.reasoning_summary = parse_codex_choice(value)?,
            Self::Verbosity => settings.verbosity = parse_codex_choice(value)?,
            Self::ApprovalPolicy => settings.approval_policy = parse_codex_choice(value)?,
            Self::SandboxMode => settings.sandbox_mode = parse_codex_choice(value)?,
            Self::WebSearch => settings.web_search = parse_codex_choice(value)?,
        }
        Ok(())
    }
}

fn parse_codex_choice<T>(value: Option<&str>) -> Result<Option<T>, String>
where
    T: std::str::FromStr<Err = gateway_connector_core::ProfileError>,
{
    value
        .map(str::parse::<T>)
        .transpose()
        .map_err(|error| error.to_string())
}

pub(crate) fn agent_logo_path(agent: AgentId) -> &'static str {
    match agent {
        AgentId::Claude => "agents/claude.svg",
        AgentId::Codex => "agents/codex.svg",
        AgentId::Gemini => "agents/gemini.svg",
        AgentId::Grokbuild => "agents/grok.svg",
        AgentId::Opencode => "agents/opencode.svg",
        AgentId::Workbuddy => "agents/workbuddy.svg",
    }
}

pub(crate) fn agent_logo(
    _id: impl Into<gpui_kit::foundation::Ident>,
    agent: AgentId,
    size: f32,
) -> gpui::AnyElement {
    gpui::img(agent_logo_path(agent))
        .size(px(size))
        .into_any_element()
}

pub(crate) fn brand_mark(
    _id: impl Into<gpui_kit::foundation::Ident>,
    icon_path: &str,
    size: f32,
) -> gpui::AnyElement {
    gpui::img(icon_path.to_owned())
        .size(px(size))
        .into_any_element()
}

pub(crate) fn protocol_select(
    agent: AgentId,
    id: impl Into<gpui_kit::foundation::Ident>,
    locale: Locale,
    window: &mut Window,
    cx: &mut Context<Select>,
) -> Select {
    Select::new(id, window, cx)
        .name(locale.text("Protocol"))
        .options(agent.supported_protocols().iter().map(|protocol| {
            SelectOption::new(protocol.as_str(), locale.text(protocol.display_name()))
        }))
        .selected(Protocol::Auto.as_str())
}

pub(crate) fn codex_select(
    setting: CodexSetting,
    locale: Locale,
    window: &mut Window,
    cx: &mut Context<Select>,
) -> Select {
    Select::new(format!("connector.codex.{}", setting.id()), window, cx)
        .name(codex_setting_label(setting, locale))
        .options(codex_setting_options(setting, locale))
        .selected("inherit")
}

pub(crate) fn codex_setting_label(setting: CodexSetting, locale: Locale) -> &'static str {
    locale.text(match setting {
        CodexSetting::ReasoningEffort => "Reasoning effort",
        CodexSetting::ReasoningSummary => "Reasoning summary",
        CodexSetting::Verbosity => "Response detail",
        CodexSetting::ApprovalPolicy => "Command approvals",
        CodexSetting::SandboxMode => "Sandbox access",
        CodexSetting::WebSearch => "Web search",
    })
}

pub(crate) fn codex_setting_options(setting: CodexSetting, locale: Locale) -> Vec<SelectOption> {
    codex_setting_options_for_model(setting, locale, None)
}

pub(crate) fn codex_setting_options_for_model(
    setting: CodexSetting,
    locale: Locale,
    supported_reasoning: Option<&[String]>,
) -> Vec<SelectOption> {
    let mut options = vec![
        SelectOption::new("inherit", locale.text("Keep current"))
            .description(locale.text("BoxAI Connect will leave this value unchanged.")),
    ];
    if setting == CodexSetting::ReasoningEffort {
        let efforts = supported_reasoning
            .map(|values| values.to_vec())
            .unwrap_or_else(|| {
                CodexReasoningEffort::ALL
                    .iter()
                    .map(|value| value.as_str().to_owned())
                    .collect()
            });
        options.extend(efforts.into_iter().filter_map(|effort| {
            effort.parse::<CodexReasoningEffort>().ok().map(|value| {
                SelectOption::new(value.as_str(), locale.text(reasoning_effort_label(value)))
                    .description(locale.text("Controls how much reasoning the model performs."))
            })
        }));
        return options;
    }
    let values: Vec<(&str, &'static str, &'static str)> = match setting {
        CodexSetting::ReasoningEffort => unreachable!("reasoning options returned above"),
        CodexSetting::ReasoningSummary => CodexReasoningSummary::ALL
            .iter()
            .map(|value| {
                let label = match value {
                    CodexReasoningSummary::Auto => "Automatic",
                    CodexReasoningSummary::Concise => "Concise",
                    CodexReasoningSummary::Detailed => "Detailed",
                    CodexReasoningSummary::None => "Hidden",
                };
                (
                    value.as_str(),
                    label,
                    "Controls the reasoning summary shown by Codex.",
                )
            })
            .collect(),
        CodexSetting::Verbosity => CodexVerbosity::ALL
            .iter()
            .map(|value| {
                let label = match value {
                    CodexVerbosity::Low => "Concise",
                    CodexVerbosity::Medium => "Balanced",
                    CodexVerbosity::High => "Detailed",
                };
                (
                    value.as_str(),
                    label,
                    "Controls final-answer detail for supported models.",
                )
            })
            .collect(),
        CodexSetting::ApprovalPolicy => CodexApprovalPolicy::ALL
            .iter()
            .map(|value| {
                let (label, description) = match value {
                    CodexApprovalPolicy::Untrusted => (
                        "Ask for untrusted commands",
                        "Trusted read-only commands run automatically; other commands ask first.",
                    ),
                    CodexApprovalPolicy::OnRequest => (
                        "Ask when Codex requests it",
                        "Codex decides when an action needs your approval.",
                    ),
                    CodexApprovalPolicy::Never => {
                        ("Never ask", "Codex will not pause for command approval.")
                    }
                };
                (value.as_str(), label, description)
            })
            .collect(),
        CodexSetting::SandboxMode => CodexSandboxMode::ALL
            .iter()
            .map(|value| {
                let (label, description) = match value {
                    CodexSandboxMode::ReadOnly => (
                        "Read only",
                        "Commands can inspect files but cannot modify the workspace.",
                    ),
                    CodexSandboxMode::WorkspaceWrite => (
                        "Workspace access",
                        "Commands can modify the current workspace within the sandbox.",
                    ),
                    CodexSandboxMode::DangerFullAccess => (
                        "Full system access",
                        "Commands run without filesystem or network sandbox restrictions.",
                    ),
                };
                (value.as_str(), label, description)
            })
            .collect(),
        CodexSetting::WebSearch => CodexWebSearch::ALL
            .iter()
            .map(|value| {
                let (label, description) = match value {
                    CodexWebSearch::Disabled => ("Off", "Remove the web search tool."),
                    CodexWebSearch::Cached => (
                        "Cached index",
                        "Use OpenAI's maintained index without live external access.",
                    ),
                    CodexWebSearch::Indexed => (
                        "Indexed live access",
                        "Allow external access only when the search index requires it.",
                    ),
                    CodexWebSearch::Live => ("Live web", "Allow unrestricted live web retrieval."),
                };
                (value.as_str(), label, description)
            })
            .collect(),
    };
    options.extend(values.into_iter().map(|(id, label, description)| {
        SelectOption::new(id, locale.text(label)).description(locale.text(description))
    }));
    options
}

fn reasoning_effort_label(value: CodexReasoningEffort) -> &'static str {
    match value {
        CodexReasoningEffort::None => "None",
        CodexReasoningEffort::Minimal => "Minimal",
        CodexReasoningEffort::Low => "Low",
        CodexReasoningEffort::Medium => "Medium",
        CodexReasoningEffort::High => "High",
        CodexReasoningEffort::Xhigh => "Extra high",
        CodexReasoningEffort::Max => "Maximum",
        CodexReasoningEffort::Ultra => "Ultra",
    }
}

pub(crate) fn locale_options(distribution: &Distribution) -> Vec<SelectOption> {
    Locale::ALL
        .into_iter()
        .filter(|locale| distribution.supported_locales.contains(&locale.id()))
        .map(|locale| SelectOption::new(locale.id(), locale.display_name()))
        .collect()
}
