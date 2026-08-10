#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use connector_app::{
    Backend, BackendError, LogoutStatus, Status,
    localization::{Locale, LocaleStore, Message, text},
    ui_state::{
        AppFrame, AuthAction, ModelFilter, Page, app_frame, auth_action, plaza_models,
        selector_models,
    },
};
use connector_core::{AgentId, AgentInstall, Change, ChangeKind, ConnectionManifest, Provisioning};
use gpui::{
    AnyElement, App, AssetSource, Bounds, Context, Entity, FontWeight, InteractiveElement,
    IntoElement, ParentElement, Render, SharedString, StatefulInteractiveElement, Styled,
    TitlebarOptions, Window, WindowAppearance, WindowBounds, WindowOptions, div, prelude::*, px,
    size, svg,
};
use gpui_kit::{
    assets::Icon,
    controls::input::{TextInput, TextInputEvent},
    prelude::{
        Badge, Button, Callout, Card, Disableable, EmptyKind, EmptyState, ListRow, Select,
        SelectEvent, SelectOption, SettingsRow, SettingsSection, Sidebar, SidebarItem,
        SidebarSection, StatusLine, Tone,
    },
    theme::{ActiveTheme, Theme},
};
use std::{borrow::Cow, collections::BTreeMap, sync::Arc};

struct ConnectorAssets;

impl AssetSource for ConnectorAssets {
    fn load(&self, path: &str) -> gpui::Result<Option<Cow<'static, [u8]>>> {
        let embedded = match path {
            "agents/claude.svg" => Some(include_bytes!("../assets/agents/claude.svg").as_slice()),
            "agents/openai.svg" => Some(include_bytes!("../assets/agents/openai.svg").as_slice()),
            "agents/gemini.svg" => Some(include_bytes!("../assets/agents/gemini.svg").as_slice()),
            "agents/grok.svg" => Some(include_bytes!("../assets/agents/grok.svg").as_slice()),
            "agents/opencode-logo-light.svg" => {
                Some(include_bytes!("../assets/agents/opencode-logo-light.svg").as_slice())
            }
            _ => None,
        };
        if let Some(bytes) = embedded {
            Ok(Some(Cow::Borrowed(bytes)))
        } else {
            gpui_kit::assets::Assets.load(path)
        }
    }

    fn list(&self, path: &str) -> gpui::Result<Vec<SharedString>> {
        let mut assets = gpui_kit::assets::Assets.list(path)?;
        assets.extend(
            AGENTS
                .map(connector_app::ui_state::agent_icon)
                .into_iter()
                .filter(|asset| asset.starts_with(path))
                .map(SharedString::from),
        );
        Ok(assets)
    }
}

const AGENTS: [AgentId; 5] = [
    AgentId::Claude,
    AgentId::Codex,
    AgentId::Gemini,
    AgentId::Grokbuild,
    AgentId::Opencode,
];

trait PagePresentation {
    fn title(self, locale: Locale) -> &'static str;
    fn subtitle(self, locale: Locale) -> &'static str;
}

impl PagePresentation for Page {
    fn title(self, locale: Locale) -> &'static str {
        match self {
            Self::Overview => text(locale, Message::Connection),
            Self::ModelPlaza => text(locale, Message::ModelPlaza),
            Self::Projection => text(locale, Message::ConfigurationPreview),
            Self::Agents => text(locale, Message::AgentClients),
            Self::Agent(agent) => agent_name(agent),
            Self::Services => text(locale, Message::GatewayServices),
            Self::Settings => text(locale, Message::SettingsDiagnostics),
        }
    }

    fn subtitle(self, locale: Locale) -> &'static str {
        match self {
            Self::Overview => text(locale, Message::OverviewSubtitle),
            Self::ModelPlaza => text(locale, Message::ServicesSubtitle),
            Self::Projection | Self::Agents | Self::Agent(_) => {
                text(locale, Message::AgentsSubtitle)
            }
            Self::Services => text(locale, Message::ServicesSubtitle),
            Self::Settings => text(locale, Message::SettingsSubtitle),
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
    language_select: Entity<Select>,
    model_search: Entity<TextInput>,
    model_query: String,
    model_filter: ModelFilter,
    locale_store: LocaleStore,
    locale: Locale,
    page: Page,
    busy: bool,
    busy_message: Option<Message>,
    error: Option<String>,
    notice: Option<(NoticeTone, String)>,
    preview: Vec<Change>,
    pending_confirmation: Option<DestructiveAction>,
}

impl GatewayKit {
    fn new(backend: Backend, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let locale_store = backend.locale_store();
        let locale = locale_store.load_system();
        let language_select = cx.new(|cx| {
            Select::new("settings.language.select", window, cx)
                .name(text(locale, Message::LanguageSelectorName))
                .options(
                    [Locale::En, Locale::Vi]
                        .map(|locale| SelectOption::new(locale.id(), locale.display_name())),
                )
                .selected(locale.id())
        });
        let model_search = cx.new(|cx| {
            TextInput::new("model-plaza.search", window, cx)
                .placeholder(text(locale, Message::SearchModels))
        });
        let mut model_selects = BTreeMap::new();
        for agent in AGENTS {
            let select = cx.new(|cx| {
                Select::new(format!("agent.{}.model", agent.as_str()), window, cx)
                    .name(locale.model_selector_name(agent_name(agent)))
                    .placeholder(text(locale, Message::ConnectLoadModels))
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
                this.run(cx, Message::SavingModel, move |backend| {
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
            language_select: language_select.clone(),
            model_search: model_search.clone(),
            model_query: String::new(),
            model_filter: ModelFilter::All,
            locale_store,
            locale,
            page: Page::Overview,
            busy: false,
            busy_message: None,
            error: None,
            notice: None,
            preview: Vec::new(),
            pending_confirmation: None,
        };
        cx.subscribe(&model_search, |this, _, event: &TextInputEvent, cx| {
            if let TextInputEvent::Change(value) = event {
                this.model_query = value.to_string();
                cx.notify();
            }
        })
        .detach();
        cx.subscribe(&language_select, |this, _, event: &SelectEvent, cx| {
            let SelectEvent::Selected(id) = event else {
                return;
            };
            let Some(locale) = Locale::from_id(id) else {
                return;
            };
            if this.locale_store.save(locale).is_err() {
                this.notice = Some((
                    NoticeTone::Danger,
                    text(this.locale, Message::PreferenceSaveFailed).into(),
                ));
                cx.notify();
                return;
            }
            this.locale = locale;
            this.notice = None;
            this.pending_confirmation = None;
            this.language_select.update(cx, |select, cx| {
                select.set_selected(Some(locale.id().into()), cx);
            });
            this.sync_select_names(cx);
            cx.notify();
        })
        .detach();
        cx.observe_window_appearance(window, |_, window, cx| {
            let theme = match window.appearance() {
                WindowAppearance::Light | WindowAppearance::VibrantLight => "studio-light",
                WindowAppearance::Dark | WindowAppearance::VibrantDark => "studio-dark",
            };
            gpui_kit::theme::activate_theme(theme, cx);
        })
        .detach();
        view.load(cx);
        view
    }

    fn run(
        &mut self,
        cx: &mut Context<Self>,
        message: Message,
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
                    Err(error) if this.status.is_none() => {
                        this.error = Some(this.locale.backend_error(&error))
                    }
                    Err(error) => {
                        this.notice = Some((NoticeTone::Danger, this.locale.backend_error(&error)));
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
                        self.locale.with_detail(Message::ConnectorAttention, &error),
                    ),
                    None => (
                        NoticeTone::Success,
                        text(self.locale, Message::ConnectedNotice).into(),
                    ),
                });
            }
            Completion::Refreshed(status) => {
                let warning = status.provisioning_error.clone();
                self.set_status(status, cx);
                self.notice = Some(match warning {
                    Some(error) => (
                        NoticeTone::Warning,
                        self.locale
                            .with_detail(Message::ProvisioningStillUnavailable, &error),
                    ),
                    None => (
                        NoticeTone::Success,
                        text(self.locale, Message::RefreshedNotice).into(),
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
                    self.locale.model_updated(agent_name(agent)),
                ));
            }
            Completion::Preview(changes) => {
                let count = changes.len();
                self.preview = changes;
                self.notice = Some((NoticeTone::Info, self.locale.previewed(count)));
            }
            Completion::Applied { changes, verified } => {
                self.preview.clear();
                self.notice = Some(if verified {
                    (NoticeTone::Success, self.locale.applied(changes))
                } else {
                    (
                        NoticeTone::Warning,
                        text(self.locale, Message::VerificationMismatch).into(),
                    )
                });
            }
            Completion::ProjectionsRemoved => {
                self.preview.clear();
                self.notice = Some((
                    NoticeTone::Success,
                    text(self.locale, Message::ProjectionsRemovedNotice).into(),
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
                        text(self.locale, Message::RevokedNotice).into(),
                    ),
                    LogoutStatus::Unsupported => (
                        NoticeTone::Warning,
                        text(self.locale, Message::LocalSignOutNotice).into(),
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
                selector_models(provisioning)
                    .into_iter()
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

    fn sync_select_names(&self, cx: &mut Context<Self>) {
        self.language_select.update(cx, |select, cx| {
            select.set_name(text(self.locale, Message::LanguageSelectorName), cx);
        });
        for (agent, select) in &self.model_selects {
            select.update(cx, |select, cx| {
                select.set_name(self.locale.model_selector_name(agent_name(*agent)), cx);
            });
        }
    }

    fn clear_connection(&mut self, cx: &mut Context<Self>) {
        if let Some(status) = self.status.as_mut() {
            status.connected = false;
            status.managed_projection = false;
            status.managed_agents.clear();
            status.pending_revocation = false;
            status.account = None;
            status.provisioning = None;
            status.provisioning_error = None;
            status.selected_models.clear();
        }
        self.sync_model_selects(cx);
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        self.run(cx, Message::CheckingGateway, |backend| {
            backend.load_status().map(Completion::Loaded)
        });
    }

    fn connect(&mut self, cx: &mut Context<Self>) {
        self.run(cx, Message::WaitingSignIn, |backend| {
            match backend.connect() {
                Ok(_) => backend.load_status().map(Completion::Connected),
                Err(connect_error) => {
                    let status = backend.load_status()?;
                    if status.connected || status.pending_revocation {
                        Ok(Completion::Connected(status))
                    } else {
                        Err(connect_error)
                    }
                }
            }
        });
    }

    fn refresh(&mut self, cx: &mut Context<Self>) {
        self.run(cx, Message::RefreshingCatalog, |backend| {
            backend.refresh_provisioning()?;
            backend.load_status().map(Completion::Refreshed)
        });
    }

    fn preview(&mut self, cx: &mut Context<Self>) {
        let Some((manifest, provisioning)) = self.connection_snapshot() else {
            return;
        };
        let installs = self.installs.clone();
        self.run(cx, Message::BuildingPreview, move |backend| {
            let plan = backend.plan(&manifest, &provisioning, installs)?;
            Ok(Completion::Preview(plan.changes.clone()))
        });
    }

    fn apply(&mut self, cx: &mut Context<Self>) {
        let Some((manifest, provisioning)) = self.connection_snapshot() else {
            return;
        };
        let installs = self.installs.clone();
        self.run(cx, Message::ApplyingConfiguration, move |backend| {
            let plan = backend.plan(&manifest, &provisioning, installs)?;
            let changes = plan.changes.len();
            backend.apply(&plan)?;
            let verified = backend.verify(&plan)?.ok;
            Ok(Completion::Applied { changes, verified })
        });
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
        self.run(cx, Message::RemovingProjections, move |backend| {
            backend.disconnect(&platform)?;
            Ok(Completion::ProjectionsRemoved)
        });
    }

    fn logout(&mut self, cx: &mut Context<Self>) {
        self.pending_confirmation = None;
        self.run(cx, Message::RevokingCredential, |backend| {
            let status = backend.logout()?;
            // Local cleanup and remote revocation have already completed. A
            // subsequent manifest outage must not turn successful sign-out
            // into an error or leave the UI claiming it is still connected.
            let current = backend.load_status().ok();
            Ok(Completion::LoggedOut { status, current })
        });
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
                    text(self.locale, Message::RemoveConfirmation)
                }
                DestructiveAction::SignOut => text(self.locale, Message::SignOutConfirmation),
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
            .section(
                SidebarSection::new("main")
                    .title(text(self.locale, Message::Connector))
                    .items([
                        SidebarItem::new("overview", text(self.locale, Message::Connection))
                            .icon(Icon::Global),
                        SidebarItem::new("model-plaza", text(self.locale, Message::ModelPlaza))
                            .icon(Icon::Magnifier),
                        SidebarItem::new(
                            "projection",
                            text(self.locale, Message::ConfigurationPreview),
                        )
                        .icon(Icon::Terminal),
                        SidebarItem::new("agents", text(self.locale, Message::AgentClients))
                            .icon(Icon::Terminal),
                        SidebarItem::new("services", text(self.locale, Message::ModelsServices))
                            .icon(Icon::Widget),
                        SidebarItem::new("settings", text(self.locale, Message::Settings))
                            .icon(Icon::Settings),
                    ]),
            )
            .footer(StatusLine::new(
                if connected {
                    text(self.locale, Message::Connected)
                } else {
                    text(self.locale, Message::NotConnected)
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

    fn compact_navigation(&self, cx: &mut Context<Self>) -> AnyElement {
        let pages = [
            Page::Overview,
            Page::ModelPlaza,
            Page::Projection,
            Page::Agents,
            Page::Services,
            Page::Settings,
        ];
        div()
            .id("compact-navigation")
            .w_full()
            .flex()
            .gap(px(6.0))
            .p(px(8.0))
            .overflow_x_scroll()
            .children(pages.into_iter().map(|page| {
                let handle = cx.entity();
                Button::new(format!("compact.{}", page.id()))
                    .label(page.title(self.locale))
                    .secondary()
                    .on_click(move |_, cx| {
                        handle.update(cx, |this, cx| {
                            this.page = page;
                            cx.notify();
                        })
                    })
            }))
            .into_any_element()
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
                .label(text(self.locale, Message::RefreshGateway))
                .secondary()
                .icon(Icon::Refresh)
                .disabled(self.busy)
                .on_click(move |_, cx| handle.update(cx, |this, cx| this.refresh(cx)))
        } else {
            Button::new("overview.connect")
                .label(text(self.locale, Message::ConnectAccount))
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
                                .child(div().font_weight(FontWeight::SEMIBOLD).child(account_name))
                                .child(
                                    div()
                                        .text_size(px(theme.typography.caption.size))
                                        .text_color(theme.colors.text_muted)
                                        .child(status.manifest.gateway.base_url.to_string()),
                                ),
                        )
                        .child(
                            Badge::new(if connected {
                                text(self.locale, Message::Connected)
                            } else {
                                text(self.locale, Message::Disconnected)
                            })
                            .tone(if connected {
                                Tone::Success
                            } else {
                                Tone::Neutral
                            }),
                        )
                        .child(action),
                ),
            )
            .child(
                Callout::new(
                    text(self.locale, Message::DirectConnectionExplanation),
                    Tone::Info,
                )
                .id("overview.direct"),
            )
            .children(status.provisioning_error.as_ref().map(|error| {
                Callout::new(
                    self.locale.with_detail(Message::ConnectorAttention, error),
                    Tone::Warning,
                )
                .id("overview.provisioning-error")
            }))
            .child(
                SettingsSection::new(
                    "overview.boundary",
                    text(self.locale, Message::ConnectionBoundary),
                )
                .description(text(self.locale, Message::BoundaryDescription))
                .row(
                    SettingsRow::new("overview.protocols", text(self.locale, Message::Protocols))
                        .value(status.manifest.gateway.protocols.join(", ")),
                )
                .row(
                    SettingsRow::new("overview.models", text(self.locale, Message::ChatModels))
                        .value(
                            status
                                .provisioning
                                .as_ref()
                                .map_or(0, |value| selector_models(value).len())
                                .to_string(),
                        ),
                )
                .row(
                    SettingsRow::new(
                        "overview.credentials",
                        text(self.locale, Message::CredentialStorage),
                    )
                    .value(text(self.locale, Message::OsVault))
                    .managed("BoxAI Connector"),
                ),
            )
            .children(status.provisioning.as_ref().map(|provisioning| {
                let account = &provisioning.account;
                let usage = &provisioning.usage;
                let billing_url = provisioning.billing.portal_url.clone();
                let backend = Arc::clone(&self.backend);
                let subscriptions = provisioning
                    .billing
                    .subscriptions
                    .iter()
                    .filter(|s| s.status == "active")
                    .count();
                let mut section = SettingsSection::new(
                    "overview.account",
                    text(self.locale, Message::AccountProfile),
                )
                .row(
                    SettingsRow::new("account.username", text(self.locale, Message::Username))
                        .value(account.username.clone()),
                )
                .row(
                    SettingsRow::new("account.email", text(self.locale, Message::Email))
                        .value(account.email.clone()),
                )
                .row(
                    SettingsRow::new("account.group", text(self.locale, Message::AccountGroup))
                        .value(account.group.clone()),
                )
                .row(
                    SettingsRow::new("usage.wallet", text(self.locale, Message::Total))
                        .value(usage.wallet_quota_remaining.to_string()),
                )
                .row(
                    SettingsRow::new("usage.lifetime", text(self.locale, Message::Used))
                        .value(usage.lifetime_quota_used.to_string()),
                )
                .row(
                    SettingsRow::new("usage.requests", text(self.locale, Message::Requests))
                        .value(usage.lifetime_request_count.to_string()),
                )
                .row(
                    SettingsRow::new(
                        "billing.subscriptions",
                        text(self.locale, Message::ActiveSubscriptions),
                    )
                    .value(if subscriptions == 0 {
                        text(self.locale, Message::NoActiveSubscriptions).into()
                    } else {
                        subscriptions.to_string()
                    }),
                )
                .row(
                    SettingsRow::new(
                        "billing.wallet-fallback",
                        text(self.locale, Message::WalletFallbackPolicy),
                    )
                    .value(if provisioning.billing.wallet_fallback_allowed {
                        text(self.locale, Message::WalletFallback)
                    } else {
                        text(self.locale, Message::SubscriptionOnly)
                    }),
                );
                for (index, subscription) in provisioning.billing.subscriptions.iter().enumerate() {
                    let quota = if subscription.unlimited {
                        text(self.locale, Message::Unlimited).into()
                    } else {
                        format!(
                            "{} / {}",
                            subscription.quota_used_current_period, subscription.quota_total
                        )
                    };
                    let value = format!(
                        "{} · {}",
                        quota,
                        if subscription.wallet_fallback {
                            text(self.locale, Message::WalletFallback)
                        } else {
                            text(self.locale, Message::SubscriptionOnly)
                        }
                    );
                    section = section.row(
                        SettingsRow::new(
                            format!("billing.subscription.{index}"),
                            format!(
                                "{} · {}",
                                text(self.locale, Message::Subscription),
                                subscription.status
                            ),
                        )
                        .description(self.locale.subscription_period(
                            subscription.current_period_start,
                            subscription.end_time,
                            subscription.next_reset_time,
                        ))
                        .value(value),
                    );
                }
                section = section.row(
                    SettingsRow::new("billing.portal", text(self.locale, Message::Billing))
                        .control(
                            Button::new("billing.open")
                                .label(text(self.locale, Message::OpenBilling))
                                .secondary()
                                .on_click(move |_, _| {
                                    let _ = backend.open_portal(&billing_url);
                                }),
                        ),
                );
                section
            }))
            .into_any_element()
    }

    fn model_plaza(&self, theme: &Theme, cx: &mut Context<Self>) -> AnyElement {
        let Some(provisioning) = self.status.as_ref().and_then(|s| s.provisioning.as_ref()) else {
            return self.unavailable(cx);
        };
        let models = plaza_models(provisioning, &self.model_query, self.model_filter);
        let handle = cx.entity();
        let mut list = Card::new();
        for (index, model) in models.iter().enumerate() {
            let metadata = [
                model.vendor.as_ref().map(|v| v.name.as_str()),
                model.description.as_deref(),
            ]
            .into_iter()
            .flatten()
            .chain(model.tags.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join(" · ");
            list = list.child(
                ListRow::new()
                    .id(format!("plaza.model.{index}"))
                    .child(
                        div()
                            .flex_1()
                            .flex()
                            .flex_col()
                            .gap(px(3.))
                            .child(model.id.clone())
                            .child(div().text_color(theme.colors.text_muted).child(metadata)),
                    )
                    .child(
                        Badge::new(if model.chat_capable {
                            text(self.locale, Message::Chat)
                        } else {
                            text(self.locale, Message::NonChatModels)
                        })
                        .neutral(),
                    ),
            );
        }
        let portal = provisioning.model_plaza.portal_url.clone();
        let backend = Arc::clone(&self.backend);
        let filters = [
            (ModelFilter::All, Message::AllModels),
            (ModelFilter::ChatCapable, Message::ChatModels),
            (ModelFilter::NonChat, Message::NonChatModels),
        ];
        div()
            .flex()
            .flex_col()
            .gap(px(theme.spacing.md))
            .child(
                div()
                    .flex()
                    .gap(px(theme.spacing.sm))
                    .child(div().flex_1().child(self.model_search.clone()))
                    .children(filters.map(|(filter, label)| {
                        let handle = handle.clone();
                        Button::new(format!("plaza.filter.{}", filter.id()))
                            .label(text(self.locale, label))
                            .when(self.model_filter == filter, |b| b.primary())
                            .when(self.model_filter != filter, |b| b.secondary())
                            .on_click(move |_, cx| {
                                handle.update(cx, |this, cx| {
                                    this.model_filter = filter;
                                    cx.notify();
                                })
                            })
                    })),
            )
            .child(if models.is_empty() {
                EmptyState::new("plaza.empty", text(self.locale, Message::NoMatchingModels))
                    .kind(EmptyKind::Empty)
                    .into_any_element()
            } else {
                list.into_any_element()
            })
            .child(
                Button::new("plaza.open")
                    .label(text(self.locale, Message::OpenModelPlaza))
                    .secondary()
                    .on_click(move |_, _| {
                        let _ = backend.open_portal(&portal);
                    }),
            )
            .into_any_element()
    }

    fn agent_page(&self, agent: AgentId, cx: &mut Context<Self>) -> AnyElement {
        let Some(status) = self.status.as_ref() else {
            return self.unavailable(cx);
        };
        let Some(install) = self.installs.iter().find(|i| i.agent == agent) else {
            return self.unavailable(cx);
        };
        let default_model = status
            .provisioning
            .as_ref()
            .map(|p| p.default_model.as_str())
            .unwrap_or(text(self.locale, Message::NoModel));
        div()
            .flex()
            .flex_col()
            .gap(px(16.0))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(12.0))
                    .child(
                        Button::new("agent.back")
                            .label(text(self.locale, Message::BackToAgentClients))
                            .secondary()
                            .on_click({
                                let handle = cx.entity();
                                move |_, cx| {
                                    handle.update(cx, |this, cx| {
                                        this.page = Page::Agents;
                                        cx.notify();
                                    })
                                }
                            }),
                    )
                    .child(
                        svg()
                            .path(connector_app::ui_state::agent_icon(agent))
                            .size(px(44.0)),
                    )
                    .child(
                        div()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(agent_name(agent)),
                    ),
            )
            .child(
                SettingsSection::new(format!("agent.{}.state", agent.as_str()), agent_name(agent))
                    .row(
                        SettingsRow::new("agent.root", text(self.locale, Message::DiscoveryRoot))
                            .value(install.root.display().to_string()),
                    )
                    .row(
                        SettingsRow::new(
                            "agent.detected",
                            text(self.locale, Message::DiscoveryState),
                        )
                        .value(text(
                            self.locale,
                            if install.detected {
                                Message::Detected
                            } else {
                                Message::NotFound
                            },
                        )),
                    )
                    .row(
                        SettingsRow::new(
                            "agent.projection",
                            text(self.locale, Message::ProjectionStatus),
                        )
                        .value(text(
                            self.locale,
                            if status.managed_agents.contains(&agent) {
                                Message::ManagedByConnector
                            } else {
                                Message::NoManagedState
                            },
                        )),
                    )
                    .row(
                        SettingsRow::new(
                            "agent.selected",
                            text(self.locale, Message::SelectedModel),
                        )
                        .control(self.model_selects[&agent].clone()),
                    )
                    .row(
                        SettingsRow::new("agent.default", text(self.locale, Message::DefaultModel))
                            .value(default_model.to_owned()),
                    ),
            )
            .into_any_element()
    }

    fn agent_index(&self, theme: &Theme, cx: &mut Context<Self>) -> AnyElement {
        let Some(status) = self.status.as_ref() else {
            return self.unavailable(cx);
        };
        let mut list = Card::new();
        for install in &self.installs {
            let agent = install.agent;
            let handle = cx.entity();
            list = list.child(
                ListRow::new()
                    .id(format!("agents.index.{}", agent.as_str()))
                    .child(
                        div()
                            .flex_1()
                            .flex()
                            .items_center()
                            .gap(px(theme.spacing.md))
                            .child(
                                svg()
                                    .path(connector_app::ui_state::agent_icon(agent))
                                    .size(px(32.0)),
                            )
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .flex()
                                    .flex_col()
                                    .gap(px(3.0))
                                    .child(
                                        div()
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .child(agent_name(agent)),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(theme.typography.caption.size))
                                            .text_color(theme.colors.text_muted)
                                            .child(install.root.display().to_string()),
                                    ),
                            )
                            .child(
                                div().w(px(88.0)).flex().justify_end().child(
                                    Badge::new(text(
                                        self.locale,
                                        if install.detected {
                                            Message::Detected
                                        } else {
                                            Message::NotFound
                                        },
                                    ))
                                    .tone(
                                        if install.detected {
                                            Tone::Success
                                        } else {
                                            Tone::Neutral
                                        },
                                    ),
                                ),
                            ),
                    )
                    .child(
                        Button::new(format!("agents.details.{}", agent.as_str()))
                            .label(text(self.locale, Message::Details))
                            .secondary()
                            .on_click(move |_, cx| {
                                handle.update(cx, |this, cx| {
                                    this.page = Page::Agent(agent);
                                    cx.notify();
                                })
                            }),
                    ),
            );
        }
        div()
            .flex()
            .flex_col()
            .gap(px(theme.spacing.lg))
            .child(Callout::new(
                self.locale.detected_count(
                    self.installs
                        .iter()
                        .filter(|install| install.detected)
                        .count(),
                    self.installs.len(),
                ),
                if status.managed_projection {
                    Tone::Success
                } else {
                    Tone::Info
                },
            ))
            .child(list)
            .into_any_element()
    }

    fn agents(&self, theme: &Theme, cx: &mut Context<Self>) -> AnyElement {
        let Some(status) = self.status.as_ref() else {
            return self.unavailable(cx);
        };
        if !status.connected {
            let handle = cx.entity();
            return EmptyState::new(
                "agents.disconnected",
                text(self.locale, Message::ConnectFirst),
            )
            .kind(EmptyKind::Unstarted)
            .detail(text(self.locale, Message::AccountScopedDetail))
            .action(
                Button::new("agents.connect")
                    .label(text(self.locale, Message::ConnectAccount))
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
                .unwrap_or_else(|| text(self.locale, Message::NoModel).into());
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
                                        svg()
                                            .path(connector_app::ui_state::agent_icon(
                                                install.agent,
                                            ))
                                            .size(px(22.0)),
                                    )
                                    .child(
                                        div()
                                            .font_weight(FontWeight::MEDIUM)
                                            .child(agent_name(install.agent)),
                                    )
                                    .child(
                                        Badge::new(if install.detected {
                                            text(self.locale, Message::Detected)
                                        } else {
                                            text(self.locale, Message::NotFound)
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
            .is_some_and(|provisioning| !selector_models(provisioning).is_empty());
        let has_preview = !self.preview.is_empty();
        let disabled_reason = if self.busy {
            self.busy_message.map(|message| text(self.locale, message))
        } else if detected == 0 {
            Some(text(self.locale, Message::InstallAgentReason))
        } else if !has_models {
            Some(text(self.locale, Message::NoVisibleModelReason))
        } else if !has_preview {
            Some(text(self.locale, Message::PreviewFirstReason))
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
                                .label(text(self.locale, Message::PreviewChanges))
                                .secondary()
                                .icon(Icon::Document)
                                .disabled(self.busy || detected == 0 || !has_models)
                                .on_click(move |_, cx| {
                                    preview_handle.update(cx, |this, cx| this.preview(cx))
                                }),
                        )
                        .child(
                            Button::new("agents.apply")
                                .label(text(self.locale, Message::ApplyAgents))
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
                                .child(self.locale.detected_count(detected, self.installs.len())),
                        ),
                )
                .children(disabled_reason.map(|reason| {
                    Callout::new(reason, Tone::Info).id("agents.action-disabled-reason")
                }))
                .child(list);
        if let Some(error) = status.provisioning_error.as_ref() {
            page = page.child(
                Callout::new(
                    self.locale
                        .with_detail(Message::ProvisioningUnavailable, error),
                    Tone::Warning,
                )
                .id("agents.provisioning-error"),
            );
        } else if !has_models {
            page = page.child(
                Callout::new(text(self.locale, Message::EmptyModelWarning), Tone::Warning)
                    .id("agents.empty-model-catalog"),
            );
        }
        if !self.preview.is_empty() {
            let mut preview = Card::new();
            for (index, change) in self.preview.iter().enumerate() {
                preview = preview.child(
                    ListRow::new()
                        .id(format!("preview.{index}"))
                        .child(Badge::new(change_kind(self.locale, change.kind.clone())).neutral())
                        .child(
                            div()
                                .min_w_0()
                                .text_size(px(theme.typography.caption.size))
                                .child(change.path.display().to_string()),
                        ),
                );
            }
            page = page
                .child(section_title(
                    theme,
                    text(self.locale, Message::ConfigurationPreview),
                ))
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
                EmptyState::new(
                    "services.failed",
                    text(self.locale, Message::ProvisioningUnavailable),
                )
                .kind(EmptyKind::Failed)
                .detail(error.clone())
                .into_any_element()
            } else {
                EmptyState::new(
                    "services.disconnected",
                    text(self.locale, Message::ServicesAfterSignIn),
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
                    .child(
                        Badge::new(if model.chat_capable {
                            text(self.locale, Message::Chat)
                        } else {
                            text(self.locale, Message::NonChatModels)
                        })
                        .when(model.chat_capable, |badge| badge.accent())
                        .when(!model.chat_capable, |badge| badge.neutral()),
                    ),
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
                    .child(Badge::new(text(self.locale, Message::RemoteBearer)).info()),
            );
        }
        let mut skills = Card::new();
        for (index, skill) in provisioning.skills.iter().enumerate() {
            skills = skills.child(
                ListRow::new()
                    .id(format!("skill.{index}"))
                    .child(div().flex_1().child(skill.name.clone()))
                    .child(Badge::new(text(self.locale, Message::Synchronized)).neutral()),
            );
        }

        div()
            .flex()
            .flex_col()
            .gap(px(theme.spacing.md))
            .child(section_title(
                theme,
                &self
                    .locale
                    .section_count(Message::Models, provisioning.models.len()),
            ))
            .child(if provisioning.models.is_empty() {
                EmptyState::new("models.empty", text(self.locale, Message::NoChatModels))
                    .kind(EmptyKind::Empty)
                    .detail(text(self.locale, Message::EmptyCatalogDetail))
                    .into_any_element()
            } else {
                models.into_any_element()
            })
            .child(section_title(
                theme,
                &self
                    .locale
                    .section_count(Message::RemoteMcp, provisioning.mcp_servers.len()),
            ))
            .child(if provisioning.mcp_servers.is_empty() {
                EmptyState::new("mcp.empty", text(self.locale, Message::NoMcp))
                    .kind(EmptyKind::Empty)
                    .into_any_element()
            } else {
                mcps.into_any_element()
            })
            .child(section_title(
                theme,
                &self
                    .locale
                    .section_count(Message::OfficialSkills, provisioning.skills.len()),
            ))
            .child(if provisioning.skills.is_empty() {
                EmptyState::new("skills.empty", text(self.locale, Message::NoSkills))
                    .kind(EmptyKind::Empty)
                    .detail(text(self.locale, Message::EmptySkillsDetail))
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
                SettingsSection::new("settings.language", text(self.locale, Message::Language))
                    .description(text(self.locale, Message::LanguageDescription))
                    .row(
                        SettingsRow::new(
                            "settings.language.row",
                            text(self.locale, Message::Language),
                        )
                        .control(self.language_select.clone()),
                    ),
            )
            .child(
                SettingsSection::new("settings.runtime", text(self.locale, Message::Runtime))
                    .row(
                        SettingsRow::new("settings.proxy", text(self.locale, Message::LocalRelay))
                            .description(text(self.locale, Message::AgentsDirectDescription))
                            .value(text(self.locale, Message::NotInstalled))
                            .managed(text(self.locale, Message::Architecture)),
                    )
                    .row(
                        SettingsRow::new(
                            "settings.callback",
                            text(self.locale, Message::LoopbackCallback),
                        )
                        .description(text(self.locale, Message::CallbackDescription))
                        .value(text(self.locale, Message::Temporary))
                        .managed(text(self.locale, Message::Authentication)),
                    )
                    .row(
                        SettingsRow::new(
                            "settings.vault",
                            text(self.locale, Message::GatewayCredential),
                        )
                        .description(text(self.locale, Message::VaultDescription))
                        .value(text(self.locale, Message::SystemVault))
                        .managed(text(self.locale, Message::OperatingSystem)),
                    ),
            )
            .child(
                SettingsSection::new("settings.actions", text(self.locale, Message::Maintenance))
                    .description(text(self.locale, Message::MaintenanceDescription))
                    .row(
                        SettingsRow::new(
                            "settings.reload",
                            text(self.locale, Message::ReloadStatus),
                        )
                        .control(
                            Button::new("settings.reload.action")
                                .label(text(self.locale, Message::Reload))
                                .secondary()
                                .disabled(self.busy)
                                .on_click(move |_, cx| {
                                    reload_handle.update(cx, |this, cx| this.load(cx))
                                }),
                        ),
                    )
                    .row(
                        SettingsRow::new(
                            "settings.remove",
                            text(self.locale, Message::RemoveConfiguration),
                        )
                        .control(
                            Button::new("settings.remove.action")
                                .label(if remove_confirmed {
                                    text(self.locale, Message::ConfirmRemoval)
                                } else {
                                    text(self.locale, Message::ReviewRemoval)
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
                        SettingsRow::new(
                            "settings.logout",
                            text(self.locale, Message::SignOutRevoke),
                        )
                        .description(text(self.locale, Message::LogoutDescription))
                        .control(
                            Button::new("settings.logout.action")
                                .label(if logout_confirmed {
                                    text(self.locale, Message::ConfirmSignOut)
                                } else {
                                    text(self.locale, Message::ReviewSignOut)
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
                Callout::new(text(self.locale, Message::NoManagedState), Tone::Info)
                    .id("settings.actions-disabled-reason")
            }))
            .into_any_element()
    }

    fn unavailable(&self, cx: &mut Context<Self>) -> AnyElement {
        let handle = cx.entity();
        EmptyState::new(
            "gateway.unavailable",
            text(self.locale, Message::GatewayUnavailable),
        )
        .kind(if self.error.is_some() {
            EmptyKind::Failed
        } else {
            EmptyKind::Unavailable
        })
        .detail(
            self.error
                .clone()
                .unwrap_or_else(|| text(self.locale, Message::LoadingManifest).into()),
        )
        .action(
            Button::new("gateway.retry")
                .label(text(self.locale, Message::Retry))
                .secondary()
                .disabled(self.busy)
                .on_click(move |_, cx| handle.update(cx, |this, cx| this.load(cx))),
        )
        .into_any_element()
    }
}

impl Render for GatewayKit {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        if app_frame(self.status.as_ref().is_some_and(|status| status.connected))
            == AppFrame::AuthOnly
        {
            let handle = cx.entity();
            let action = self.status.as_ref().map_or(AuthAction::Connect, |status| {
                auth_action(
                    status.connected,
                    status.pending_revocation,
                    status.managed_projection,
                )
            });
            let state_message = match action {
                AuthAction::RetryRevocation => text(self.locale, Message::ErrorPendingRevocation),
                AuthAction::Blocked => text(self.locale, Message::ManagedProjectionBlockedDetail),
                AuthAction::Connect => text(
                    self.locale,
                    if self.busy {
                        self.busy_message.unwrap_or(Message::CheckingGateway)
                    } else {
                        Message::ConnectFirst
                    },
                ),
            };
            return div()
                .size_full()
                .flex()
                .items_center()
                .justify_center()
                .bg(theme.colors.canvas)
                .text_color(theme.colors.text)
                .child(
                    Card::new().padded(true).child(
                        div()
                            .w_full()
                            .max_w(px(440.0))
                            .flex()
                            .flex_col()
                            .gap(px(theme.spacing.lg))
                            .child(
                                div()
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child("BoxAI Connector"),
                            )
                            .child(Callout::new(
                                self.error.clone().unwrap_or_else(|| state_message.into()),
                                if self.error.is_some() || action == AuthAction::Blocked {
                                    Tone::Danger
                                } else if action == AuthAction::RetryRevocation {
                                    Tone::Warning
                                } else {
                                    Tone::Info
                                },
                            ))
                            .child(
                                SettingsRow::new(
                                    "auth.language",
                                    text(self.locale, Message::Language),
                                )
                                .control(self.language_select.clone()),
                            )
                            .children(match action {
                                AuthAction::Connect => Some(
                                    Button::new("auth.connect")
                                        .label(text(self.locale, Message::ConnectAccount))
                                        .primary()
                                        .disabled(self.busy)
                                        .on_click(move |_, cx| {
                                            handle.update(cx, |this, cx| this.connect(cx))
                                        }),
                                ),
                                AuthAction::RetryRevocation => Some(
                                    Button::new("auth.retry-revocation")
                                        .label(text(self.locale, Message::RetryRevocation))
                                        .primary()
                                        .disabled(self.busy)
                                        .on_click(move |_, cx| {
                                            handle.update(cx, |this, cx| this.logout(cx))
                                        }),
                                ),
                                AuthAction::Blocked => None,
                            }),
                    ),
                );
        }
        let body = match self.page {
            Page::Overview => self.overview(&theme, cx),
            Page::ModelPlaza => self.model_plaza(&theme, cx),
            Page::Projection => self.agents(&theme, cx),
            Page::Agents => self.agent_index(&theme, cx),
            Page::Agent(agent) => self.agent_page(agent, cx),
            Page::Services => self.services(&theme, cx),
            Page::Settings => self.settings(&theme, cx),
        };
        let compact = window.viewport_size().width < px(800.0);
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(theme.colors.canvas)
            .font_family(theme.typography.sans.clone())
            .text_color(theme.colors.text)
            .children(compact.then(|| self.compact_navigation(cx)))
            .child(
                div()
                    .id("gateway.content")
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .children((!compact).then(|| self.navigation(cx)))
                    .child(
                        div()
                            .id("gateway.page")
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
                                                            .text_size(px(theme
                                                                .typography
                                                                .title
                                                                .size))
                                                            .font_weight(FontWeight::SEMIBOLD)
                                                            .child(self.page.title(self.locale)),
                                                    )
                                                    .child(
                                                        div()
                                                            .text_size(px(theme
                                                                .typography
                                                                .body
                                                                .size))
                                                            .text_color(theme.colors.text_muted)
                                                            .child(self.page.subtitle(self.locale)),
                                                    ),
                                            )
                                            .children(self.busy_message.map(|message| {
                                                Badge::new(text(self.locale, message)).accent()
                                            })),
                                    )
                                    .children(self.notice.as_ref().map(|(tone, message)| {
                                        Callout::new(message.clone(), tone.tone())
                                            .id("gateway.notice")
                                    }))
                                    .child(body),
                            ),
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

fn change_kind(locale: Locale, kind: ChangeKind) -> &'static str {
    match kind {
        ChangeKind::Create => text(locale, Message::Create),
        ChangeKind::Update => text(locale, Message::Update),
        ChangeKind::Remove => text(locale, Message::Remove),
        ChangeKind::ProjectSkill => text(locale, Message::Skill),
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
    let app = gpui_platform::application().with_assets(ConnectorAssets);
    app.run(|cx: &mut App| {
        gpui_kit::install(cx);
        // Keep native chrome and content in lockstep with the operating system.
        cx.set_window_appearance(None);
        let theme = match cx.window_appearance() {
            WindowAppearance::Light | WindowAppearance::VibrantLight => "studio-light",
            WindowAppearance::Dark | WindowAppearance::VibrantDark => "studio-dark",
        };
        gpui_kit::theme::activate_theme(theme, cx);
        #[cfg(windows)]
        let initial_size = size(px(620.0), px(380.0));
        #[cfg(not(windows))]
        let initial_size = size(px(1120.0), px(760.0));
        let bounds = Bounds::centered(None, initial_size, cx);
        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                titlebar: Some(TitlebarOptions {
                    title: Some("BoxAI Connector".into()),
                    appears_transparent: false,
                    ..Default::default()
                }),
                ..Default::default()
            },
            |window, cx| {
                let backend = Backend::new().expect("initialize BoxAI Connector backend");
                cx.new(|cx| GatewayKit::new(backend, window, cx))
            },
        )
        .expect("open BoxAI Connector window");
        cx.activate(true);
    });
}
