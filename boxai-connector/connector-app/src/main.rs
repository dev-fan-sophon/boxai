#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use connector_app::{Backend, BackendError, LogoutStatus, Status};
use connector_core::{AgentId, AgentInstall, Change, ChangeKind, ConnectionManifest, Provisioning};
use gpui::{
    AnyElement, App, Bounds, Context, Entity, FontWeight, IntoElement, ParentElement, Render,
    SharedString, Styled, Window, WindowBounds, WindowOptions, div, prelude::*, px, size,
};
use gpui_kit::{
    assets::Icon,
    prelude::{
        Badge, Button, Callout, Card, Disableable, EmptyKind, EmptyState, ListRow, Select,
        SelectEvent, SelectOption, SettingsRow, SettingsSection, Sidebar, SidebarItem,
        SidebarSection, StatusLine, Tone,
    },
    theme::{ActiveTheme, Theme},
};
use std::{collections::BTreeMap, sync::Arc};

const AGENTS: [AgentId; 5] = [
    AgentId::Claude,
    AgentId::Codex,
    AgentId::Gemini,
    AgentId::Grokbuild,
    AgentId::Opencode,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Page {
    Overview,
    Agents,
    Services,
    Settings,
}

impl Page {
    fn id(self) -> &'static str {
        match self {
            Self::Overview => "overview",
            Self::Agents => "agents",
            Self::Services => "services",
            Self::Settings => "settings",
        }
    }

    fn from_id(id: &str) -> Option<Self> {
        match id {
            "overview" => Some(Self::Overview),
            "agents" => Some(Self::Agents),
            "services" => Some(Self::Services),
            "settings" => Some(Self::Settings),
            _ => None,
        }
    }

    fn title(self) -> &'static str {
        match self {
            Self::Overview => "Connection",
            Self::Agents => "Agent clients",
            Self::Services => "Gateway services",
            Self::Settings => "Settings & diagnostics",
        }
    }

    fn subtitle(self) -> &'static str {
        match self {
            Self::Overview => "Connect this device directly to your platform Gateway.",
            Self::Agents => {
                "Choose a default model for each installed Agent and preview every managed change."
            }
            Self::Services => {
                "Models, remote MCP servers, and official Skills remain controlled by the Gateway."
            }
            Self::Settings => {
                "Credentials stay in the operating-system vault. No local relay runs in the background."
            }
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum NoticeTone {
    Success,
    Warning,
    Danger,
    Info,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DestructiveAction {
    RemoveProjections,
    SignOut,
}

impl NoticeTone {
    fn tone(self) -> Tone {
        match self {
            Self::Success => Tone::Success,
            Self::Warning => Tone::Warning,
            Self::Danger => Tone::Danger,
            Self::Info => Tone::Info,
        }
    }
}

enum Completion {
    Loaded(Status),
    Connected(Status),
    Refreshed(Status),
    ModelUpdated {
        agent: AgentId,
        model: String,
    },
    Preview(Vec<Change>),
    Applied {
        changes: usize,
        verified: bool,
    },
    ProjectionsRemoved,
    LoggedOut {
        status: LogoutStatus,
        current: Option<Status>,
    },
}

struct GatewayKit {
    backend: Arc<Backend>,
    status: Option<Status>,
    installs: Vec<AgentInstall>,
    model_selects: BTreeMap<AgentId, Entity<Select>>,
    page: Page,
    busy: bool,
    busy_message: Option<&'static str>,
    error: Option<String>,
    notice: Option<(NoticeTone, String)>,
    preview: Vec<Change>,
    pending_confirmation: Option<DestructiveAction>,
}

impl GatewayKit {
    fn new(backend: Backend, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let mut model_selects = BTreeMap::new();
        for agent in AGENTS {
            let select = cx.new(|cx| {
                Select::new(format!("agent.{}.model", agent.as_str()), window, cx)
                    .name(format!("{} default model", agent_name(agent)))
                    .placeholder("Connect to load models")
            });
            cx.subscribe(&select, move |this, _select, event: &SelectEvent, cx| {
                let SelectEvent::Selected(model) = event else {
                    return;
                };
                let Some(status) = this.status.as_ref() else {
                    return;
                };
                let Some(provisioning) = status.provisioning.as_ref() else {
                    return;
                };
                let platform = status.manifest.platform.id.clone();
                let provisioning = provisioning.clone();
                let model = model.to_string();
                this.run(cx, "Saving the Agent model choice…", move |backend| {
                    backend.update_model_choice(&platform, agent, &model, &provisioning)?;
                    Ok(Completion::ModelUpdated { agent, model })
                });
            })
            .detach();
            model_selects.insert(agent, select);
        }

        let mut view = Self {
            backend: Arc::new(backend),
            status: None,
            installs: Vec::new(),
            model_selects,
            page: Page::Overview,
            busy: false,
            busy_message: None,
            error: None,
            notice: None,
            preview: Vec::new(),
            pending_confirmation: None,
        };
        view.load(cx);
        view
    }

    fn run(
        &mut self,
        cx: &mut Context<Self>,
        message: &'static str,
        operation: impl FnOnce(Arc<Backend>) -> Result<Completion, BackendError> + Send + 'static,
    ) {
        if self.busy {
            return;
        }
        self.busy = true;
        self.busy_message = Some(message);
        self.error = None;
        self.notice = None;
        let backend = Arc::clone(&self.backend);
        cx.notify();
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move { operation(backend) })
                .await;
            this.update(cx, |this, cx| {
                this.busy = false;
                this.busy_message = None;
                match result {
                    Ok(completion) => this.complete(completion, cx),
                    Err(error) if this.status.is_none() => this.error = Some(error.to_string()),
                    Err(error) => {
                        this.notice = Some((NoticeTone::Danger, error.to_string()));
                        this.sync_model_selects(cx);
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn complete(&mut self, completion: Completion, cx: &mut Context<Self>) {
        match completion {
            Completion::Loaded(status) => self.set_status(status, cx),
            Completion::Connected(status) => {
                let warning = status.provisioning_error.clone();
                self.set_status(status, cx);
                self.notice = Some(match warning {
                    Some(error) => (
                        NoticeTone::Warning,
                        format!("Connector requires attention: {error}"),
                    ),
                    None => (NoticeTone::Success, "Gateway account connected.".into()),
                });
            }
            Completion::Refreshed(status) => {
                let warning = status.provisioning_error.clone();
                self.set_status(status, cx);
                self.notice = Some(match warning {
                    Some(error) => (
                        NoticeTone::Warning,
                        format!("Gateway provisioning is still unavailable: {error}"),
                    ),
                    None => (
                        NoticeTone::Success,
                        "Gateway models and services refreshed.".into(),
                    ),
                });
            }
            Completion::ModelUpdated { agent, model } => {
                if let Some(status) = self.status.as_mut() {
                    status.selected_models.insert(agent, model);
                }
                self.sync_model_selects(cx);
                self.preview.clear();
                self.notice = Some((
                    NoticeTone::Info,
                    format!(
                        "{} will use the new model after changes are applied.",
                        agent_name(agent)
                    ),
                ));
            }
            Completion::Preview(changes) => {
                let count = changes.len();
                self.preview = changes;
                self.notice = Some((
                    NoticeTone::Info,
                    format!("Previewed {count} managed change(s). Nothing was written."),
                ));
            }
            Completion::Applied { changes, verified } => {
                self.preview.clear();
                self.notice = Some(if verified {
                    (
                        NoticeTone::Success,
                        format!("Applied and verified {changes} managed change(s)."),
                    )
                } else {
                    (
                        NoticeTone::Warning,
                        "Changes were applied, but verification found a mismatch.".into(),
                    )
                });
            }
            Completion::ProjectionsRemoved => {
                self.preview.clear();
                self.notice = Some((
                    NoticeTone::Success,
                    "Managed Agent configuration and Skills were removed.".into(),
                ));
            }
            Completion::LoggedOut { status, current } => {
                if let Some(current) = current {
                    self.set_status(current, cx);
                } else {
                    self.clear_connection(cx);
                }
                self.preview.clear();
                self.notice = Some(match status {
                    LogoutStatus::Revoked => (
                        NoticeTone::Success,
                        "Signed out and revoked this Connector credential.".into(),
                    ),
                    LogoutStatus::Unsupported => (
                        NoticeTone::Warning,
                        "Signed out locally. This platform does not expose self-revocation.".into(),
                    ),
                });
            }
        }
    }

    fn set_status(&mut self, status: Status, cx: &mut Context<Self>) {
        self.installs = status.installs.clone();
        self.status = Some(status);
        self.sync_model_selects(cx);
        self.error = None;
    }

    fn sync_model_selects(&self, cx: &mut Context<Self>) {
        let Some(status) = self.status.as_ref() else {
            return;
        };
        let options = status
            .provisioning
            .as_ref()
            .map(|provisioning| {
                provisioning
                    .models
                    .iter()
                    .map(|model| SelectOption::new(model.id.clone(), model.id.clone()))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let disabled = !status.connected || options.is_empty();
        for (agent, select) in &self.model_selects {
            let selected = status.selected_models.get(agent).cloned();
            let options = options.clone();
            select.update(cx, |select, cx| {
                select.set_options(options, cx);
                select.set_selected(selected.map(SharedString::from), cx);
                select.set_disabled(disabled, cx);
            });
        }
    }

    fn clear_connection(&mut self, cx: &mut Context<Self>) {
        if let Some(status) = self.status.as_mut() {
            status.connected = false;
            status.managed_projection = false;
            status.pending_revocation = false;
            status.account = None;
            status.provisioning = None;
            status.provisioning_error = None;
            status.selected_models.clear();
        }
        self.sync_model_selects(cx);
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        self.run(cx, "Checking Gateway readiness…", |backend| {
            backend.load_status().map(Completion::Loaded)
        });
    }

    fn connect(&mut self, cx: &mut Context<Self>) {
        self.run(
            cx,
            "Waiting for browser sign-in…",
            |backend| match backend.connect() {
                Ok(_) => backend.load_status().map(Completion::Connected),
                Err(connect_error) => {
                    let status = backend.load_status()?;
                    if status.connected || status.pending_revocation {
                        Ok(Completion::Connected(status))
                    } else {
                        Err(connect_error)
                    }
                }
            },
        );
    }

    fn refresh(&mut self, cx: &mut Context<Self>) {
        self.run(cx, "Refreshing online catalog…", |backend| {
            backend.refresh_provisioning()?;
            backend.load_status().map(Completion::Refreshed)
        });
    }

    fn preview(&mut self, cx: &mut Context<Self>) {
        let Some((manifest, provisioning)) = self.connection_snapshot() else {
            return;
        };
        let installs = self.installs.clone();
        self.run(cx, "Building a read-only preview…", move |backend| {
            let plan = backend.plan(&manifest, &provisioning, installs)?;
            Ok(Completion::Preview(plan.changes.clone()))
        });
    }

    fn apply(&mut self, cx: &mut Context<Self>) {
        let Some((manifest, provisioning)) = self.connection_snapshot() else {
            return;
        };
        let installs = self.installs.clone();
        self.run(
            cx,
            "Applying and verifying Agent configuration…",
            move |backend| {
                let plan = backend.plan(&manifest, &provisioning, installs)?;
                let changes = plan.changes.len();
                backend.apply(&plan)?;
                let verified = backend.verify(&plan)?.ok;
                Ok(Completion::Applied { changes, verified })
            },
        );
    }

    fn disconnect_projections(&mut self, cx: &mut Context<Self>) {
        let Some(platform) = self
            .status
            .as_ref()
            .map(|status| status.manifest.platform.id.clone())
        else {
            return;
        };
        self.pending_confirmation = None;
        self.run(cx, "Removing managed projections…", move |backend| {
            backend.disconnect(&platform)?;
            Ok(Completion::ProjectionsRemoved)
        });
    }

    fn logout(&mut self, cx: &mut Context<Self>) {
        self.pending_confirmation = None;
        self.run(
            cx,
            "Removing projections and revoking credential…",
            |backend| {
                let status = backend.logout()?;
                // Local cleanup and remote revocation have already completed. A
                // subsequent manifest outage must not turn successful sign-out
                // into an error or leave the UI claiming it is still connected.
                let current = backend.load_status().ok();
                Ok(Completion::LoggedOut { status, current })
            },
        );
    }

    fn confirm(&mut self, action: DestructiveAction, cx: &mut Context<Self>) {
        if self.pending_confirmation == Some(action) {
            match action {
                DestructiveAction::RemoveProjections => self.disconnect_projections(cx),
                DestructiveAction::SignOut => self.logout(cx),
            }
            return;
        }
        self.pending_confirmation = Some(action);
        self.notice = Some((
            NoticeTone::Warning,
            match action {
                DestructiveAction::RemoveProjections => {
                    "Review the impact, then choose Confirm removal. Your BoxAI account remains connected."
                }
                DestructiveAction::SignOut => {
                    "Review the impact, then choose Confirm sign out. Managed projections are removed before the credential is revoked."
                }
            }
            .into(),
        ));
        cx.notify();
    }

    fn connection_snapshot(&self) -> Option<(ConnectionManifest, Provisioning)> {
        let status = self.status.as_ref()?;
        Some((
            status.manifest.clone(),
            status.provisioning.as_ref()?.clone(),
        ))
    }

    fn navigation(&self, cx: &mut Context<Self>) -> Sidebar {
        let handle = cx.entity();
        let connected = self.status.as_ref().is_some_and(|status| status.connected);
        Sidebar::new("gateway-kit.sidebar")
            .active(self.page.id())
            .header(
                div()
                    .flex()
                    .items_center()
                    .gap(px(10.0))
                    .p(px(8.0))
                    .child(gpui_kit::assets::icon(Icon::Global).size(px(18.0)))
                    .child(
                        div()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child("BoxAI Connector"),
                    ),
            )
            .section(SidebarSection::new("main").title("Connector").items([
                SidebarItem::new("overview", "Connection").icon(Icon::Global),
                SidebarItem::new("agents", "Agent clients").icon(Icon::Terminal),
                SidebarItem::new("services", "Models & services").icon(Icon::Widget),
                SidebarItem::new("settings", "Settings").icon(Icon::Settings),
            ]))
            .footer(StatusLine::new(
                if connected {
                    "Connected"
                } else {
                    "Not connected"
                },
                if connected {
                    Tone::Success
                } else {
                    Tone::Neutral
                },
            ))
            .on_select(move |id, _, cx| {
                let Some(page) = Page::from_id(id.as_ref()) else {
                    return;
                };
                handle.update(cx, |this, cx| {
                    this.page = page;
                    cx.notify();
                });
            })
    }

    fn overview(&self, theme: &Theme, cx: &mut Context<Self>) -> AnyElement {
        let Some(status) = self.status.as_ref() else {
            return self.unavailable(cx);
        };
        let handle = cx.entity();
        let platform = &status.manifest.platform;
        let connected = status.connected;
        let account_name = status
            .account
            .as_ref()
            .map(|account| {
                if account.display_name.is_empty() {
                    account.username.clone()
                } else {
                    account.display_name.clone()
                }
            })
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| platform.name.clone());
        let action = if connected {
            Button::new("overview.refresh")
                .label("Refresh from Gateway")
                .secondary()
                .icon(Icon::Refresh)
                .disabled(self.busy)
                .on_click(move |_, cx| handle.update(cx, |this, cx| this.refresh(cx)))
        } else {
            Button::new("overview.connect")
                .label("Connect account")
                .primary()
                .icon(Icon::Key)
                .disabled(self.busy)
                .on_click(move |_, cx| handle.update(cx, |this, cx| this.connect(cx)))
        };

        div()
            .flex()
            .flex_col()
            .gap(px(theme.spacing.lg))
            .child(
                Card::new().padded(true).child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(theme.spacing.lg))
                        .child(
                            div()
                                .size(px(44.0))
                                .rounded(px(theme.radii.card))
                                .bg(theme.colors.accent.opacity(0.15))
                                .flex()
                                .items_center()
                                .justify_center()
                                .child(
                                    gpui_kit::assets::icon(Icon::Global)
                                        .size(px(20.0))
                                        .text_color(theme.colors.accent),
                                ),
                        )
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .flex()
                                .flex_col()
                                .gap(px(4.0))
                                .child(
                                    div()
                                        .font_weight(FontWeight::SEMIBOLD)
                                        .child(account_name),
                                )
                                .child(
                                    div()
                                        .text_size(px(theme.typography.caption.size))
                                        .text_color(theme.colors.text_muted)
                                        .child(status.manifest.gateway.base_url.to_string()),
                                ),
                        )
                        .child(Badge::new(if connected { "Connected" } else { "Disconnected" }).tone(
                            if connected { Tone::Success } else { Tone::Neutral },
                        ))
                        .child(action),
                ),
            )
            .child(
                Callout::new(
                    "External Agents call BoxAI and remote MCP servers directly. BoxAI Connector does not start a model proxy or keep a local service running.",
                    Tone::Info,
                )
                .id("overview.direct"),
            )
            .children(status.provisioning_error.as_ref().map(|error| {
                Callout::new(
                    format!("Connector attention required: {error}"),
                    Tone::Warning,
                )
                .id("overview.provisioning-error")
            }))
            .child(
                SettingsSection::new("overview.boundary", "Connection boundary")
                    .description("The platform owns the catalog; each Agent owns its own default model.")
                    .row(
                        SettingsRow::new("overview.protocols", "Protocols")
                            .value(status.manifest.gateway.protocols.join(", ")),
                    )
                    .row(
                        SettingsRow::new("overview.models", "Chat-capable models").value(
                            status
                                .provisioning
                                .as_ref()
                                .map_or(0, |value| value.models.len())
                                .to_string(),
                        ),
                    )
                    .row(
                        SettingsRow::new("overview.credentials", "Credential storage")
                            .value("Operating-system vault")
                            .managed("BoxAI Connector"),
                    ),
            )
            .into_any_element()
    }

    fn agents(&self, theme: &Theme, cx: &mut Context<Self>) -> AnyElement {
        let Some(status) = self.status.as_ref() else {
            return self.unavailable(cx);
        };
        if !status.connected {
            let handle = cx.entity();
            return EmptyState::new("agents.disconnected", "Connect a Gateway account first")
                .kind(EmptyKind::Unstarted)
                .detail("Model choices and managed configuration are account-scoped.")
                .action(
                    Button::new("agents.connect")
                        .label("Connect account")
                        .primary()
                        .on_click(move |_, cx| handle.update(cx, |this, cx| this.connect(cx))),
                )
                .into_any_element();
        }

        let mut list = Card::new();
        for install in &self.installs {
            let selected = status
                .selected_models
                .get(&install.agent)
                .cloned()
                .unwrap_or_else(|| "No model available".into());
            list = list.child(
                ListRow::new()
                    .id(format!("agent.{}", install.agent.as_str()))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .gap(px(3.0))
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(theme.spacing.sm))
                                    .child(
                                        div()
                                            .font_weight(FontWeight::MEDIUM)
                                            .child(agent_name(install.agent)),
                                    )
                                    .child(
                                        Badge::new(if install.detected {
                                            "Detected"
                                        } else {
                                            "Not found"
                                        })
                                        .tone(
                                            if install.detected {
                                                Tone::Success
                                            } else {
                                                Tone::Neutral
                                            },
                                        ),
                                    ),
                            )
                            .child(
                                div()
                                    .text_size(px(theme.typography.caption.size))
                                    .text_color(theme.colors.text_muted)
                                    .child(install.root.display().to_string()),
                            ),
                    )
                    .child(
                        div()
                            .w(px(310.0))
                            .flex()
                            .flex_col()
                            .gap(px(3.0))
                            .child(
                                div()
                                    .text_size(px(theme.typography.caption.size))
                                    .text_color(theme.colors.text_faint)
                                    .child(selected),
                            )
                            .child(self.model_selects[&install.agent].clone()),
                    ),
            );
        }

        let preview_handle = cx.entity();
        let apply_handle = cx.entity();
        let detected = self
            .installs
            .iter()
            .filter(|install| install.detected)
            .count();
        let has_models = status
            .provisioning
            .as_ref()
            .is_some_and(|provisioning| !provisioning.models.is_empty());
        let has_preview = !self.preview.is_empty();
        let disabled_reason = if self.busy {
            self.busy_message
        } else if detected == 0 {
            Some(
                "Install or launch a supported Agent so Connector can detect its configuration root.",
            )
        } else if !has_models {
            Some(
                "No account-visible chat model is available. Refresh after an administrator enables one.",
            )
        } else if !has_preview {
            Some("Preview the managed file changes before applying them.")
        } else {
            None
        };
        let mut page =
            div()
                .flex()
                .flex_col()
                .gap(px(theme.spacing.lg))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(theme.spacing.sm))
                        .child(
                            Button::new("agents.preview")
                                .label("Preview changes")
                                .secondary()
                                .icon(Icon::Document)
                                .disabled(self.busy || detected == 0 || !has_models)
                                .on_click(move |_, cx| {
                                    preview_handle.update(cx, |this, cx| this.preview(cx))
                                }),
                        )
                        .child(
                            Button::new("agents.apply")
                                .label("Apply to detected Agents")
                                .primary()
                                .icon(Icon::Check)
                                .disabled(self.busy || detected == 0 || !has_models || !has_preview)
                                .on_click(move |_, cx| {
                                    apply_handle.update(cx, |this, cx| this.apply(cx))
                                }),
                        )
                        .child(
                            div()
                                .text_size(px(theme.typography.caption.size))
                                .text_color(theme.colors.text_muted)
                                .child(format!("{detected} of {} detected", self.installs.len())),
                        ),
                )
                .children(disabled_reason.map(|reason| {
                    Callout::new(reason, Tone::Info).id("agents.action-disabled-reason")
                }))
                .child(list);
        if let Some(error) = status.provisioning_error.as_ref() {
            page = page.child(
                Callout::new(
                    format!("Gateway provisioning is unavailable: {error}"),
                    Tone::Warning,
                )
                .id("agents.provisioning-error"),
            );
        } else if !has_models {
            page = page.child(
                Callout::new(
                    "This account currently has no callable chat model. Configuration cannot be applied until the Gateway catalog contains one.",
                    Tone::Warning,
                )
                .id("agents.empty-model-catalog"),
            );
        }
        if !self.preview.is_empty() {
            let mut preview = Card::new();
            for (index, change) in self.preview.iter().enumerate() {
                preview = preview.child(
                    ListRow::new()
                        .id(format!("preview.{index}"))
                        .child(Badge::new(change_kind(change.kind.clone())).neutral())
                        .child(
                            div()
                                .min_w_0()
                                .text_size(px(theme.typography.caption.size))
                                .child(change.path.display().to_string()),
                        ),
                );
            }
            page = page
                .child(section_title(theme, "Configuration preview"))
                .child(preview);
        }
        page.into_any_element()
    }

    fn services(&self, theme: &Theme, cx: &mut Context<Self>) -> AnyElement {
        let Some(status) = self.status.as_ref() else {
            return self.unavailable(cx);
        };
        let Some(provisioning) = status.provisioning.as_ref() else {
            return if let Some(error) = status.provisioning_error.as_ref() {
                EmptyState::new("services.failed", "Gateway provisioning is unavailable")
                    .kind(EmptyKind::Failed)
                    .detail(error.clone())
                    .into_any_element()
            } else {
                EmptyState::new(
                    "services.disconnected",
                    "Services are available after sign-in",
                )
                .kind(EmptyKind::Unstarted)
                .into_any_element()
            };
        };
        let mut models = Card::new();
        for (index, model) in provisioning.models.iter().enumerate() {
            models = models.child(
                ListRow::new()
                    .id(format!("model.{index}"))
                    .child(div().flex_1().child(model.id.clone()))
                    .child(Badge::new("Chat").accent()),
            );
        }
        let mut mcps = Card::new();
        for (index, server) in provisioning.mcp_servers.iter().enumerate() {
            mcps = mcps.child(
                ListRow::new()
                    .id(format!("mcp.{index}"))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .gap(px(3.0))
                            .child(server.name.clone())
                            .child(
                                div()
                                    .text_size(px(theme.typography.caption.size))
                                    .text_color(theme.colors.text_muted)
                                    .child(server.url.to_string()),
                            ),
                    )
                    .child(Badge::new("Remote bearer").info()),
            );
        }
        let mut skills = Card::new();
        for (index, skill) in provisioning.skills.iter().enumerate() {
            skills = skills.child(
                ListRow::new()
                    .id(format!("skill.{index}"))
                    .child(div().flex_1().child(skill.name.clone()))
                    .child(Badge::new("Synchronized").neutral()),
            );
        }

        div()
            .flex()
            .flex_col()
            .gap(px(theme.spacing.md))
            .child(section_title(
                theme,
                &format!("Models · {}", provisioning.models.len()),
            ))
            .child(if provisioning.models.is_empty() {
                EmptyState::new("models.empty", "No callable chat models")
                    .kind(EmptyKind::Empty)
                    .detail("The Gateway returned an empty account-visible catalog.")
                    .into_any_element()
            } else {
                models.into_any_element()
            })
            .child(section_title(
                theme,
                &format!("Remote MCP · {}", provisioning.mcp_servers.len()),
            ))
            .child(if provisioning.mcp_servers.is_empty() {
                EmptyState::new("mcp.empty", "No MCP services advertised")
                    .kind(EmptyKind::Empty)
                    .into_any_element()
            } else {
                mcps.into_any_element()
            })
            .child(section_title(
                theme,
                &format!("Official Skills · {}", provisioning.skills.len()),
            ))
            .child(if provisioning.skills.is_empty() {
                EmptyState::new("skills.empty", "No official Skills advertised")
                    .kind(EmptyKind::Empty)
                    .detail(
                        "BoxAI Connector does not invent a Skill catalog the platform does not own.",
                    )
                    .into_any_element()
            } else {
                skills.into_any_element()
            })
            .into_any_element()
    }

    fn settings(&self, theme: &Theme, cx: &mut Context<Self>) -> AnyElement {
        let connected = self.status.as_ref().is_some_and(|status| status.connected);
        let has_projection = self
            .status
            .as_ref()
            .is_some_and(|status| status.managed_projection);
        let has_pending_revocation = self
            .status
            .as_ref()
            .is_some_and(|status| status.pending_revocation);
        let remove_confirmed =
            self.pending_confirmation == Some(DestructiveAction::RemoveProjections);
        let logout_confirmed = self.pending_confirmation == Some(DestructiveAction::SignOut);
        let can_remove = connected || has_projection;
        let can_logout = connected || has_projection || has_pending_revocation;
        let remove_handle = cx.entity();
        let logout_handle = cx.entity();
        let reload_handle = cx.entity();
        div()
            .flex()
            .flex_col()
            .gap(px(theme.spacing.xl))
            .child(
                SettingsSection::new("settings.runtime", "Runtime")
                    .row(
                        SettingsRow::new("settings.proxy", "Local model relay")
                            .description("Agents connect to the platform Gateway directly.")
                            .value("Not installed")
                            .managed("Architecture"),
                    )
                    .row(
                        SettingsRow::new("settings.callback", "Loopback callback")
                            .description("Opened only during browser PKCE sign-in, then closed.")
                            .value("Temporary")
                            .managed("Authentication"),
                    )
                    .row(
                        SettingsRow::new("settings.vault", "Gateway credential")
                            .description("Never written into BoxAI Connector's JSON state.")
                            .value("System vault")
                            .managed("Operating system"),
                    ),
            )
            .child(
                SettingsSection::new("settings.actions", "Maintenance")
                    .description("Managed removal preserves unrelated providers, MCP servers, Skills, and config entries.")
                    .row(
                        SettingsRow::new("settings.reload", "Reload status")
                            .control(
                                Button::new("settings.reload.action")
                                    .label("Reload")
                                    .secondary()
                                    .disabled(self.busy)
                                    .on_click(move |_, cx| {
                                        reload_handle.update(cx, |this, cx| this.load(cx))
                                    }),
                            ),
                    )
                    .row(
                        SettingsRow::new("settings.remove", "Remove managed Agent configuration")
                            .control(
                                Button::new("settings.remove.action")
                                    .label(if remove_confirmed {
                                        "Confirm removal"
                                    } else {
                                        "Review removal"
                                    })
                                    .when(remove_confirmed, |button| button.danger())
                                    .when(!remove_confirmed, |button| button.secondary())
                                    .disabled(self.busy || !can_remove)
                                    .on_click(move |_, cx| {
                                        remove_handle.update(cx, |this, cx| {
                                            this.confirm(DestructiveAction::RemoveProjections, cx)
                                        })
                                    }),
                            ),
                    )
                    .row(
                        SettingsRow::new("settings.logout", "Sign out & revoke")
                            .description("Removes managed projections before clearing the OS credential.")
                            .control(
                                Button::new("settings.logout.action")
                                    .label(if logout_confirmed {
                                        "Confirm sign out"
                                    } else {
                                        "Review sign out"
                                    })
                                    .danger()
                                    .disabled(self.busy || !can_logout)
                                    .on_click(move |_, cx| {
                                        logout_handle.update(cx, |this, cx| {
                                            this.confirm(DestructiveAction::SignOut, cx)
                                        })
                                    }),
                            ),
                    ),
            )
            .children((!can_remove && !can_logout).then(|| {
                Callout::new(
                    "No managed projection or stored Connector credential is present.",
                    Tone::Info,
                )
                .id("settings.actions-disabled-reason")
            }))
            .into_any_element()
    }

    fn unavailable(&self, cx: &mut Context<Self>) -> AnyElement {
        let handle = cx.entity();
        EmptyState::new("gateway.unavailable", "Gateway status is unavailable")
            .kind(if self.error.is_some() {
                EmptyKind::Failed
            } else {
                EmptyKind::Unavailable
            })
            .detail(
                self.error
                    .clone()
                    .unwrap_or_else(|| "Loading the connector manifest…".into()),
            )
            .action(
                Button::new("gateway.retry")
                    .label("Retry")
                    .secondary()
                    .disabled(self.busy)
                    .on_click(move |_, cx| handle.update(cx, |this, cx| this.load(cx))),
            )
            .into_any_element()
    }
}

impl Render for GatewayKit {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let body = match self.page {
            Page::Overview => self.overview(&theme, cx),
            Page::Agents => self.agents(&theme, cx),
            Page::Services => self.services(&theme, cx),
            Page::Settings => self.settings(&theme, cx),
        };
        div()
            .size_full()
            .flex()
            .bg(theme.colors.canvas)
            .font_family(theme.typography.sans.clone())
            .text_color(theme.colors.text)
            .child(self.navigation(cx))
            .child(
                div()
                    .id("gateway.content")
                    .flex_1()
                    .min_w_0()
                    .h_full()
                    .overflow_y_scroll()
                    .child(
                        div()
                            .w_full()
                            .max_w(px(900.0))
                            .mx_auto()
                            .px(px(theme.spacing.xl))
                            .pt(px(theme.spacing.xxl))
                            .pb(px(64.0))
                            .flex()
                            .flex_col()
                            .gap(px(theme.spacing.lg))
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(theme.spacing.sm))
                                    .child(
                                        div()
                                            .flex_1()
                                            .flex()
                                            .flex_col()
                                            .gap(px(4.0))
                                            .child(
                                                div()
                                                    .text_size(px(theme.typography.title.size))
                                                    .font_weight(FontWeight::SEMIBOLD)
                                                    .child(self.page.title()),
                                            )
                                            .child(
                                                div()
                                                    .text_size(px(theme.typography.body.size))
                                                    .text_color(theme.colors.text_muted)
                                                    .child(self.page.subtitle()),
                                            ),
                                    )
                                    .children(
                                        self.busy_message
                                            .map(|message| Badge::new(message).accent()),
                                    ),
                            )
                            .children(self.notice.as_ref().map(|(tone, message)| {
                                Callout::new(message.clone(), tone.tone()).id("gateway.notice")
                            }))
                            .child(body),
                    ),
            )
    }
}

fn agent_name(agent: AgentId) -> &'static str {
    match agent {
        AgentId::Claude => "Claude Code",
        AgentId::Codex => "Codex CLI",
        AgentId::Gemini => "Gemini CLI",
        AgentId::Grokbuild => "Grok Build",
        AgentId::Opencode => "OpenCode",
    }
}

fn change_kind(kind: ChangeKind) -> &'static str {
    match kind {
        ChangeKind::Create => "Create",
        ChangeKind::Update => "Update",
        ChangeKind::Remove => "Remove",
        ChangeKind::ProjectSkill => "Skill",
    }
}

fn section_title(theme: &Theme, title: &str) -> impl IntoElement {
    div()
        .mt(px(theme.spacing.sm))
        .text_size(px(theme.typography.label.size))
        .font_weight(FontWeight::MEDIUM)
        .text_color(theme.colors.text_muted)
        .child(title.to_owned())
}

fn main() {
    let app = gpui_platform::application().with_assets(gpui_kit::assets::Assets);
    app.run(|cx: &mut App| {
        gpui_kit::install(cx);
        let bounds = Bounds::centered(None, size(px(1120.0), px(760.0)), cx);
        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                ..Default::default()
            },
            |window, cx| {
                window.set_window_title("BoxAI Connector");
                let backend = Backend::new().expect("initialize BoxAI Connector backend");
                cx.new(|cx| GatewayKit::new(backend, window, cx))
            },
        )
        .expect("open BoxAI Connector window");
        cx.activate(true);
    });
}
