use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
    process::{Command, Stdio},
    sync::Arc,
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

use gateway_connector_backend::{
    ApiKey, BackendError, BrowserLoginOffer, ConnectRequest, ConnectRequestWithoutCredential,
    ConnectionResult, ConnectorBackend, ConnectorUpdateTarget, Distribution, InstallError,
    ModelCapability, PkceError, ProbeResult, UpdateCheck, apply_signed_update, check_updates,
    install, open_download_page, packaged_install, plan_install, system_shell,
};
use gateway_connector_core::{
    AgentId, AgentSelection, CanonicalBaseUrl, ConnectionProfile, Protocol,
};
use gpui::{Context, Entity, Window, prelude::*};
use gpui_kit::prelude::*;
use zeroize::Zeroize;

use crate::{
    AppState, AsyncStatus, AsyncValue, ModelKind, Page, ProjectionSemantic,
    app::Action,
    apply_boxai_codex_defaults,
    isolated::IsolatedLayout,
    preferences::{DensityPreference, Locale, PreferenceStore, Preferences, ThemePreference},
    sign_in_progress::{SignInInvitation, SignInProgress},
};

use super::controls::{CodexSetting, codex_select, locale_options, protocol_select};
use super::launch::{activate_theme_for, apply_density, apply_theme};

#[derive(Default)]
pub(crate) struct ProjectionStatusGeneration(u64);

impl ProjectionStatusGeneration {
    pub(crate) fn begin(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(1);
        self.0
    }

    pub(crate) fn invalidate(&mut self) {
        self.0 = self.0.wrapping_add(1);
    }

    pub(crate) const fn accepts(&self, generation: u64) -> bool {
        self.0 == generation
    }
}

enum ConnectOutcome {
    Connected(Box<ConnectionResult>),
    Browser(Box<BrowserLoginOffer>),
    Failed(String),
}

enum SignInOutcome {
    Connected(Box<ConnectionResult>),
    /// A failure the sign-in card explains in its own words.
    Refused(SignInFailure),
    Failed(String),
}

fn relaunch_after_exit(executable: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                "Wait-Process -Id $env:BOXAI_CONNECT_PARENT_PID -ErrorAction SilentlyContinue; \
                 Start-Process -FilePath $env:BOXAI_CONNECT_RELAUNCH_EXECUTABLE",
            ])
            .env("BOXAI_CONNECT_PARENT_PID", std::process::id().to_string())
            .env("BOXAI_CONNECT_RELAUNCH_EXECUTABLE", executable)
            .current_dir(std::env::temp_dir())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
    }
    #[cfg(not(windows))]
    {
        Command::new("/bin/sh")
            .args([
                "-c",
                "while kill -0 \"$1\" 2>/dev/null; do sleep 0.1; done; exec \"$2\"",
                "boxai-connect-relaunch",
                &std::process::id().to_string(),
            ])
            .arg(executable)
            .current_dir(std::env::temp_dir())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map(|_| ())
    }
}

/// How often the window looks for the authorization URL. Short enough that the
/// link appears with the browser, long enough to cost nothing while waiting.
const SIGN_IN_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(100);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ConfirmKind {
    SignOut,
    Disconnect,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum UsageRange {
    Days7,
    Days30,
}

impl UsageRange {
    pub(crate) const fn id(self) -> &'static str {
        match self {
            Self::Days7 => "7d",
            Self::Days30 => "30d",
        }
    }

    pub(crate) const fn seconds(self) -> i64 {
        match self {
            Self::Days7 => 7 * 24 * 60 * 60,
            Self::Days30 => 30 * 24 * 60 * 60,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum UsageMetricKind {
    Quota,
    Tokens,
    Requests,
}

impl UsageMetricKind {
    pub(crate) const fn id(self) -> &'static str {
        match self {
            Self::Quota => "quota",
            Self::Tokens => "tokens",
            Self::Requests => "requests",
        }
    }

    pub(crate) const fn label(self) -> &'static str {
        match self {
            Self::Quota => "Quota",
            Self::Tokens => "Tokens",
            Self::Requests => "Requests",
        }
    }
}

/// Everything the window is handed at startup. It is one value because the
/// list only ever grows, and a positional argument list of this length is a
/// place for two of them to quietly swap.
pub(crate) struct HostSetup {
    pub(crate) backend: Arc<ConnectorBackend>,
    pub(crate) distribution: &'static Distribution,
    pub(crate) preference_store: PreferenceStore,
    pub(crate) preferences: Preferences,
    pub(crate) isolated_layout: Option<IsolatedLayout>,
    pub(crate) sign_in_progress: Arc<SignInProgress>,
}

pub(crate) struct ConnectorHost {
    pub(crate) backend: Arc<ConnectorBackend>,
    pub(crate) distribution: &'static Distribution,
    pub(crate) state: AppState,
    pub(crate) page: Page,
    pub(crate) selected_agent: AgentId,
    pub(crate) expanded_agent_details: BTreeSet<AgentId>,
    pub(crate) request_sort: (String, SortDirection),
    pub(crate) usage_range: UsageRange,
    pub(crate) usage_metric: UsageMetricKind,
    pub(crate) applied_agents: BTreeMap<AgentId, AgentSelection>,
    pub(crate) applied_confirmed: BTreeSet<String>,
    pub(crate) preference_store: PreferenceStore,
    pub(crate) preferences: Preferences,
    pub(crate) language_select: Entity<Select>,
    pub(crate) theme_select: Entity<Select>,
    pub(crate) density_select: Entity<Select>,
    pub(crate) gateway_url: Entity<TextInput>,
    pub(crate) api_key: Entity<PasswordInput>,
    pub(crate) settings_search: Entity<TextInput>,
    pub(crate) settings_query: String,
    pub(crate) model_search: Entity<TextInput>,
    pub(crate) model_query: String,
    pub(crate) model_kinds: BTreeSet<ModelKind>,
    pub(crate) model_vendors: BTreeSet<String>,
    pub(crate) model_selects: Vec<(AgentId, Entity<Select>)>,
    pub(crate) protocol_selects: Vec<(AgentId, Entity<Select>)>,
    pub(crate) codex_selects: Vec<(CodexSetting, Entity<Select>)>,
    pub(crate) toast_layer: Entity<ToastLayer>,
    pub(crate) confirm: Entity<Dialog>,
    pending_confirm: Option<ConfirmKind>,
    pub(crate) save_in_flight: bool,
    pub(crate) pending_save: Option<ConnectionProfile>,
    pub(crate) save_error: Option<String>,
    pub(crate) projection_busy: bool,
    /// When the connection document and its catalogs were last re-read, so the
    /// shell can say how old the numbers on every page are.
    pub(crate) refreshed_at: Option<i64>,
    pub(crate) projection_status_generation: ProjectionStatusGeneration,
    pub(crate) action_error: Option<String>,
    pub(crate) isolated_layout: Option<IsolatedLayout>,
    pub(crate) update_check: AsyncValue<UpdateCheck>,
    pub(crate) update_installing: bool,
    /// Written by the browser the backend opens, read while a sign-in waits.
    pub(crate) sign_in_progress: Arc<SignInProgress>,
    pub(crate) sign_in_invitation: Option<SignInInvitation>,
    /// Why the last sign-in ended, when it ended badly. The three ways a
    /// browser sign-in fails need three different things from the person, so
    /// they are kept apart instead of collapsing into one error string.
    pub(crate) sign_in_failure: Option<SignInFailure>,
}

/// What went wrong with a browser sign-in, in terms of what to do next.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SignInFailure {
    /// No browser could be opened at all.
    BrowserUnavailable,
    /// The browser opened and the loopback callback never received anything.
    CallbackNeverArrived,
    /// The account said no. Nothing is broken.
    Declined,
}

impl ConnectorHost {
    pub(crate) fn new(setup: HostSetup, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let HostSetup {
            backend,
            distribution,
            preference_store,
            preferences,
            isolated_layout,
            sign_in_progress,
        } = setup;
        let locale = preferences.locale;
        let language_select = cx.new(|cx| {
            Select::new("connector.language", window, cx)
                .name(locale.text("Language"))
                .options(locale_options(distribution))
                .selected(locale.id())
        });
        let theme_select = cx.new(|cx| {
            Select::new("connector.theme", window, cx)
                .name(locale.text("Theme"))
                .options(
                    ThemePreference::ALL
                        .map(|value| SelectOption::new(value.id(), value.display_name(locale))),
                )
                .selected(preferences.theme.id())
        });
        let density_select = cx.new(|cx| {
            Select::new("connector.density", window, cx)
                .name(locale.text("Density"))
                .options(
                    DensityPreference::ALL
                        .map(|value| SelectOption::new(value.id(), value.display_name(locale))),
                )
                .selected(preferences.density.id())
        });
        let gateway_url = cx.new(|cx| {
            let mut input = TextInput::new("connector.gateway-url", window, cx)
                .name(locale.text("Gateway base URL"))
                .placeholder(
                    locale.text("https://gateway.example.com or https://gateway.example.com/v1"),
                )
                .required(true);
            input.set_text_quietly(distribution.default_gateway_url.unwrap_or_default(), cx);
            input.set_disabled(!distribution.allow_custom_urls, cx);
            input
        });
        let api_key = cx.new(|cx| {
            PasswordInput::new("connector.api-key", window, cx)
                .name(locale.text("API key"))
                .placeholder(locale.text("API key, or leave blank for advertised browser login"))
        });
        let settings_search = cx.new(|cx| {
            TextInput::new("connector.settings.search", window, cx)
                .name(locale.text("Search settings"))
                .placeholder(locale.text("Filter settings"))
        });
        let model_search = cx.new(|cx| {
            TextInput::new("connector.model-search", window, cx)
                .name(locale.text("Search model catalog"))
                .placeholder(locale.text("Filter by model ID, provider, or tag"))
        });
        let mut model_selects = Vec::new();
        let mut protocol_selects = Vec::new();
        for &agent in distribution.supported_agents {
            let model_id = format!("connector.{}.model", agent.as_str());
            model_selects.push((
                agent,
                cx.new(|cx| {
                    Select::new(model_id, window, cx)
                        .name(format!("{} {}", agent.display_name(), locale.text("model")))
                        .placeholder(locale.text("Choose a model"))
                }),
            ));
            let protocol_id = format!("connector.{}.protocol", agent.as_str());
            protocol_selects.push((
                agent,
                cx.new(|cx| protocol_select(agent, protocol_id, locale, window, cx)),
            ));
        }
        let codex_selects = CodexSetting::ALL
            .into_iter()
            .map(|setting| {
                (
                    setting,
                    cx.new(|cx| codex_select(setting, locale, window, cx)),
                )
            })
            .collect::<Vec<_>>();
        let toast_layer = cx.new(|cx| ToastLayer::new(window, cx).corner(ToastCorner::BottomRight));
        let confirm = cx.new(|cx| {
            Dialog::new("connector.confirm", window, cx)
                .title(locale.text("Confirm"))
                .confirm_label(locale.text("Confirm"))
                .cancel_label(locale.text("Cancel"))
                .destructive(true)
        });

        for (agent, select) in &model_selects {
            let agent = *agent;
            cx.subscribe(select, move |this, select, event, cx| {
                if let SelectEvent::Selected(id) = event {
                    select.update(cx, |select, cx| select.set_selected(Some(id.clone()), cx));
                    this.dispatch(
                        Action::SelectModel {
                            agent,
                            id: id.to_string(),
                        },
                        cx,
                    );
                }
            })
            .detach();
        }
        for (agent, select) in &protocol_selects {
            let agent = *agent;
            cx.subscribe(select, move |this, select, event, cx| {
                if let SelectEvent::Selected(id) = event {
                    select.update(cx, |select, cx| select.set_selected(Some(id.clone()), cx));
                    if let Ok(protocol) = id.parse() {
                        this.dispatch(Action::SelectProtocol { agent, protocol }, cx);
                    }
                }
            })
            .detach();
        }
        for (setting, select) in &codex_selects {
            let setting = *setting;
            cx.subscribe(select, move |this, select, event, cx| {
                if let SelectEvent::Selected(id) = event {
                    select.update(cx, |select, cx| select.set_selected(Some(id.clone()), cx));
                    this.dispatch(
                        Action::SelectCodex {
                            setting: setting.id().to_owned(),
                            value: id.to_string(),
                        },
                        cx,
                    );
                }
            })
            .detach();
        }
        cx.subscribe(&model_search, |this, _, event: &TextInputEvent, cx| {
            if let TextInputEvent::Change(value) = event {
                this.dispatch(Action::SetModelQuery(value.to_string()), cx);
            }
        })
        .detach();
        cx.subscribe(&settings_search, |this, _, event: &TextInputEvent, cx| {
            if let TextInputEvent::Change(value) = event {
                this.dispatch(Action::SetSettingsQuery(value.to_string()), cx);
            }
        })
        .detach();
        cx.subscribe(&language_select, |this, _, event, cx| {
            let SelectEvent::Selected(id) = event else {
                return;
            };
            let Some(locale) = Locale::from_id(id) else {
                return;
            };
            this.dispatch(Action::SetLocale(locale), cx);
        })
        .detach();
        cx.subscribe(&theme_select, |this, _, event, cx| {
            let SelectEvent::Selected(id) = event else {
                return;
            };
            let Some(theme) = ThemePreference::from_id(id) else {
                return;
            };
            this.dispatch(Action::SetTheme(theme), cx);
        })
        .detach();
        cx.subscribe(&density_select, |this, _, event, cx| {
            let SelectEvent::Selected(id) = event else {
                return;
            };
            let Some(density) = DensityPreference::from_id(id) else {
                return;
            };
            this.dispatch(Action::SetDensity(density), cx);
        })
        .detach();
        cx.subscribe(&confirm, |this, _, event: &DialogEvent, cx| match event {
            DialogEvent::Confirmed => this.dispatch(Action::ConfirmDestructive, cx),
            DialogEvent::Cancelled | DialogEvent::Dismissed => {
                this.dispatch(Action::CancelDestructive, cx)
            }
            _ => {}
        })
        .detach();

        let mut view = Self {
            backend,
            distribution,
            state: AppState::Loading,
            page: Page::Overview,
            selected_agent: AgentId::Claude,
            expanded_agent_details: BTreeSet::new(),
            request_sort: ("time".into(), SortDirection::Descending),
            usage_range: UsageRange::Days30,
            usage_metric: UsageMetricKind::Quota,
            applied_agents: BTreeMap::new(),
            applied_confirmed: BTreeSet::new(),
            preference_store,
            preferences,
            language_select,
            theme_select,
            density_select,
            gateway_url,
            api_key,
            settings_search,
            settings_query: String::new(),
            model_search,
            model_query: String::new(),
            model_kinds: BTreeSet::new(),
            model_vendors: BTreeSet::new(),
            model_selects,
            protocol_selects,
            codex_selects,
            toast_layer,
            confirm,
            pending_confirm: None,
            save_in_flight: false,
            pending_save: None,
            save_error: None,
            projection_busy: false,
            refreshed_at: None,
            projection_status_generation: ProjectionStatusGeneration::default(),
            action_error: None,
            isolated_layout,
            update_check: AsyncValue::default(),
            update_installing: false,
            sign_in_progress,
            sign_in_invitation: None,
            sign_in_failure: None,
        };
        cx.observe_window_appearance(window, |this, window, cx| {
            if this.preferences.theme == ThemePreference::System {
                activate_theme_for(window.appearance(), cx);
            }
        })
        .detach();
        view.begin_resume(cx);
        if view.preferences.auto_check_updates {
            view.begin_check_updates(true, cx);
        }
        view
    }

    pub(crate) fn text(&self, english: &'static str) -> &'static str {
        self.preferences.locale.text(english)
    }

    fn toast_success(
        &self,
        cx: &mut Context<Self>,
        id: &'static str,
        message: impl Into<gpui::SharedString>,
    ) {
        self.toast_layer.update(cx, |layer, cx| {
            layer.push(Toast::new(id, message).tone(Tone::Success), cx)
        });
    }

    fn toast_warning(
        &self,
        cx: &mut Context<Self>,
        id: &'static str,
        message: impl Into<gpui::SharedString>,
    ) {
        self.toast_layer.update(cx, |layer, cx| {
            layer.push(Toast::new(id, message).tone(Tone::Warning), cx)
        });
    }

    fn toast_danger(
        &self,
        cx: &mut Context<Self>,
        id: &'static str,
        message: impl Into<gpui::SharedString>,
    ) {
        self.toast_layer.update(cx, |layer, cx| {
            layer.push(Toast::new(id, message).tone(Tone::Danger), cx)
        });
    }

    /// True while any part of the picture on screen is being re-read: the
    /// connection document, the catalogs, or the usage window.
    pub(crate) fn refresh_busy(&self) -> bool {
        if self.projection_busy {
            return true;
        }
        match &self.state {
            AppState::Connected { overview, .. } => matches!(
                overview.status,
                AsyncStatus::Loading | AsyncStatus::Refreshing
            ),
            _ => false,
        }
    }

    /// The single control that re-reads everything a page shows. Every page
    /// header carries the same one so refresh never means "this card only".
    pub(crate) fn refresh_button(
        &self,
        id: &'static str,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let busy = self.refresh_busy();
        let view = cx.entity().downgrade();
        Button::new(id)
            .label(self.text("Refresh"))
            .icon(gpui_kit::assets::Icon::Refresh)
            .ghost()
            .control_size(ControlSize::Sm)
            .loading(busy)
            .disabled(busy || self.save_in_flight)
            .on_click(move |_window, cx| {
                let _ = view.update(cx, |this, cx| this.dispatch(Action::Refresh, cx));
            })
            .into_any_element()
    }

    /// A page banner whose action is the shared refresh.
    pub(crate) fn page_banner(
        &self,
        theme: &gpui_kit_theme::Theme,
        title: &'static str,
        subtitle: Option<gpui::SharedString>,
        refresh_id: &'static str,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        super::chrome::page_header(
            theme,
            self.text(title),
            subtitle,
            Some(self.refresh_button(refresh_id, cx)),
        )
    }

    pub(crate) fn dispatch(&mut self, action: Action, cx: &mut Context<Self>) {
        match action {
            Action::SignIn => self.begin_sign_in(cx),
            Action::Connect => self.begin_connect(cx),
            Action::ContinueBrowserLogin => self.begin_browser_login(cx),
            Action::BackToFirstRun => {
                self.action_error = None;
                self.state = AppState::FirstRun;
            }
            Action::SelectPage(page) => self.page = page,
            Action::SelectAgent(agent) => {
                self.selected_agent = agent;
                self.page = Page::Agents;
            }
            Action::Refresh => self.begin_refresh(cx),
            Action::ApplyAgent(agent) => self.begin_apply(agent, cx),
            Action::RequestSignOut | Action::RequestDisconnect => {}
            Action::ConfirmDestructive => self.finish_confirm(cx),
            Action::CancelDestructive => self.pending_confirm = None,
            Action::SetMcp { agent, id, enabled } => {
                self.state.set_mcp_enabled(agent, id, enabled);
            }
            Action::SetSkill { agent, id, enabled } => {
                self.state.set_skill_enabled(agent, id, enabled);
            }
            Action::SetImageDirect { agent, enabled } => {
                self.state.set_image_direct(agent, enabled);
            }
            Action::ToggleAgentDetails(agent) => {
                if !self.expanded_agent_details.insert(agent) {
                    self.expanded_agent_details.remove(&agent);
                }
            }
            Action::SetLocale(locale) => self.set_locale(locale, cx),
            Action::SetTheme(theme) => self.set_theme(theme, cx),
            Action::SetDensity(density) => self.set_density(density, cx),
            Action::SetAutoCheckUpdates(enabled) => self.set_auto_check_updates(enabled, cx),
            Action::CheckUpdates => self.begin_check_updates(false, cx),
            Action::OpenDownloadPage => self.open_download_page(cx),
            Action::InstallUpdate => self.begin_install_update(cx),
            Action::InstallPackage => self.begin_install_package(cx),
            Action::SetInstallDesktopShortcut(enabled) => {
                if let AppState::NotInstalled(invitation) = &mut self.state {
                    invitation.desktop_shortcut = enabled;
                }
            }
            Action::SetSettingsQuery(query) => self.settings_query = query,
            Action::SetModelQuery(query) => {
                self.model_query = query;
                self.sync_model_selects(cx);
            }
            Action::SetModelKinds(kinds) => {
                self.model_kinds = kinds;
                self.sync_model_filters(cx);
            }
            Action::SetModelVendors(vendors) => {
                self.model_vendors = vendors;
                self.sync_model_filters(cx);
            }
            Action::ClearModelFilters => {
                self.model_query.clear();
                self.model_kinds.clear();
                self.model_vendors.clear();
                self.model_search.update(cx, |search, cx| {
                    search.set_value("", cx);
                });
                self.sync_model_filters(cx);
            }
            Action::SelectModel { agent, id } => {
                if let Err(error) = self.state.select_model(agent, id) {
                    self.toast_danger(cx, "connector.model.error", error);
                }
                self.sync_model_selects(cx);
                if agent == AgentId::Codex {
                    self.sync_codex_selects(cx);
                }
            }
            Action::SelectProtocol { agent, protocol } => {
                if let Err(error) = self.state.update_protocol(agent, protocol) {
                    self.toast_danger(cx, "connector.protocol.error", error);
                    self.sync_protocol_selects(cx);
                } else {
                    self.sync_protocol_selects(cx);
                }
            }
            Action::SelectCodex { setting, value } => {
                self.commit_codex_setting(&setting, &value, cx);
            }
            Action::SetCodexCatalog { id, enabled } => {
                self.state.set_codex_catalog_model(id, enabled);
            }
        }
        cx.notify();
    }

    pub(crate) fn request_sign_out(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.open_confirm(ConfirmKind::SignOut, window, cx);
    }

    pub(crate) fn request_disconnect(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.open_confirm(ConfirmKind::Disconnect, window, cx);
    }

    fn open_confirm(&mut self, kind: ConfirmKind, window: &mut Window, cx: &mut Context<Self>) {
        let locale = self.preferences.locale;
        let (title, description) = match kind {
            ConfirmKind::SignOut => (
                locale.text("Sign out of BoxAI Connect?"),
                locale.text("This removes managed Agent configuration and the local credential."),
            ),
            ConfirmKind::Disconnect => (
                locale.text("Disconnect managed configuration?"),
                locale.text("Agent files will no longer be managed by this connection."),
            ),
        };
        self.pending_confirm = Some(kind);
        self.confirm.update(cx, |dialog, cx| {
            dialog.set_title(title, cx);
            dialog.set_description(Some(description.into()), cx);
            dialog.open(window, cx);
        });
    }

    fn finish_confirm(&mut self, cx: &mut Context<Self>) {
        match self.pending_confirm.take() {
            Some(ConfirmKind::SignOut | ConfirmKind::Disconnect) => self.begin_disconnect(cx),
            None => {}
        }
    }

    fn set_locale(&mut self, locale: Locale, cx: &mut Context<Self>) {
        if !self.ensure_isolated_paths(false, cx) {
            return;
        }
        let mut preferences = self.preferences.clone();
        preferences.locale = locale;
        if let Err(error) = self.save_preferences(preferences, cx) {
            self.toast_danger(cx, "connector.prefs.error", error);
            return;
        }
        crate::locale::apply_box_locale(locale, cx);
        self.sync_localized_controls(cx);
        self.sync_model_filters(cx);
    }

    fn set_theme(&mut self, theme: ThemePreference, cx: &mut Context<Self>) {
        if !self.ensure_isolated_paths(false, cx) {
            return;
        }
        let mut preferences = self.preferences.clone();
        preferences.theme = theme;
        if let Err(error) = self.save_preferences(preferences, cx) {
            self.toast_danger(cx, "connector.prefs.error", error);
            return;
        }
        apply_theme(theme, cx);
        apply_density(self.preferences.density, cx);
    }

    fn set_density(&mut self, density: DensityPreference, cx: &mut Context<Self>) {
        if !self.ensure_isolated_paths(false, cx) {
            return;
        }
        let mut preferences = self.preferences.clone();
        preferences.density = density;
        if let Err(error) = self.save_preferences(preferences, cx) {
            self.toast_danger(cx, "connector.prefs.error", error);
            return;
        }
        apply_density(density, cx);
    }

    fn set_auto_check_updates(&mut self, enabled: bool, cx: &mut Context<Self>) {
        if !self.ensure_isolated_paths(false, cx) {
            return;
        }
        let mut preferences = self.preferences.clone();
        preferences.auto_check_updates = enabled;
        if let Err(error) = self.save_preferences(preferences, cx) {
            self.toast_danger(cx, "connector.prefs.error", error);
            return;
        }
        if enabled {
            self.begin_check_updates(true, cx);
        }
    }

    fn open_download_page(&mut self, cx: &mut Context<Self>) {
        if let Err(error) = open_download_page(self.distribution.release_metadata) {
            self.toast_danger(cx, "connector.update.download.error", error.to_string());
        }
    }

    fn begin_check_updates(&mut self, silent: bool, cx: &mut Context<Self>) {
        if matches!(
            self.update_check.status,
            AsyncStatus::Loading | AsyncStatus::Refreshing
        ) {
            return;
        }
        let Some(update_feed_url) = self
            .distribution
            .release_metadata
            .and_then(|metadata| metadata.update_feed_url)
        else {
            if !silent {
                self.toast_warning(
                    cx,
                    "connector.update.unavailable",
                    self.text("This distribution has no download page"),
                );
            }
            return;
        };
        let Some(target) = ConnectorUpdateTarget::current() else {
            self.update_check.status = AsyncStatus::Ready;
            if !silent {
                self.toast_warning(
                    cx,
                    "connector.update.platform",
                    self.text("This platform has no Connector package."),
                );
            }
            cx.notify();
            return;
        };
        self.update_check.status = if self.update_check.value.is_some() {
            AsyncStatus::Refreshing
        } else {
            AsyncStatus::Loading
        };
        cx.notify();
        cx.spawn(async move |this, cx| {
            let result =
                cx.background_executor()
                    .spawn(async move {
                        check_updates(update_feed_url, env!("CARGO_PKG_VERSION"), target)
                    })
                    .await;
            this.update(cx, |this, cx| {
                match result {
                    Ok(check) => {
                        this.update_check = AsyncValue::ready(check.clone());
                        if !silent {
                            let message = if check.has_signed_install() || check.has_newer_manual()
                            {
                                this.text("A newer package is available:")
                            } else {
                                this.text("You have the latest version.")
                            };
                            this.toast_success(cx, "connector.update.check.ok", message);
                        } else if check.has_signed_install() || check.has_newer_manual() {
                            this.toast_success(
                                cx,
                                "connector.update.check.available",
                                this.text("A newer package is available:"),
                            );
                        }
                    }
                    Err(error) => {
                        this.update_check.status = AsyncStatus::Error(error.to_string());
                        if !silent {
                            this.toast_danger(
                                cx,
                                "connector.update.check.error",
                                error.to_string(),
                            );
                        }
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn begin_install_update(&mut self, cx: &mut Context<Self>) {
        if self.update_installing {
            return;
        }
        let Some(update_feed_url) = self
            .distribution
            .release_metadata
            .and_then(|metadata| metadata.update_feed_url)
        else {
            return;
        };
        let Some(signed) = self
            .update_check
            .value
            .as_ref()
            .and_then(|value| value.signed.clone())
        else {
            return;
        };
        let Some(install) = packaged_install() else {
            self.toast_warning(
                cx,
                "connector.update.not-packaged",
                self.text("This build is not a packaged install. Open the download page instead."),
            );
            return;
        };
        self.update_installing = true;
        cx.notify();
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move { apply_signed_update(update_feed_url, &signed, &install) })
                .await;
            this.update(cx, |this, cx| {
                this.update_installing = false;
                match result {
                    Ok(executable) => match relaunch_after_exit(&executable) {
                        Ok(()) => {
                            this.toast_success(
                                cx,
                                "connector.update.install.ok",
                                this.text("Installing update…"),
                            );
                            cx.quit();
                        }
                        Err(error) => this.toast_danger(
                            cx,
                            "connector.update.install.error",
                            InstallError::LaunchFailed(error.to_string()).to_string(),
                        ),
                    },
                    Err(error) => {
                        this.toast_danger(cx, "connector.update.install.error", error.to_string());
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// Installs the running download and restarts from the installed copy.
    /// The program relaunches itself rather than continuing in place, because
    /// the copy that is running is the one about to be left behind.
    fn begin_install_package(&mut self, cx: &mut Context<Self>) {
        let AppState::NotInstalled(invitation) = &mut self.state else {
            return;
        };
        if invitation.busy {
            return;
        }
        invitation.busy = true;
        invitation.error = None;
        let desktop_shortcut = invitation.desktop_shortcut;
        let source = invitation.current.clone();
        cx.notify();
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    let plan = plan_install(&source)?;
                    install(&plan, system_shell().as_ref(), desktop_shortcut)
                })
                .await;
            this.update(cx, |this, cx| {
                match result {
                    Ok(executable) => match relaunch_after_exit(&executable) {
                        Ok(()) => cx.quit(),
                        Err(error) => this.fail_install(
                            InstallError::LaunchFailed(error.to_string()).to_string(),
                        ),
                    },
                    Err(error) => this.fail_install(error.to_string()),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn fail_install(&mut self, error: String) {
        if let AppState::NotInstalled(invitation) = &mut self.state {
            invitation.busy = false;
            invitation.error = Some(error);
        }
    }

    fn save_preferences(
        &mut self,
        preferences: Preferences,
        _cx: &mut Context<Self>,
    ) -> Result<(), String> {
        self.preference_store.save(&preferences).map_err(|error| {
            format!(
                "{}: {error}",
                self.preferences
                    .locale
                    .text("Preference could not be saved")
            )
        })?;
        self.preferences = preferences;
        Ok(())
    }

    fn ensure_isolated_paths(&mut self, fatal: bool, cx: &mut Context<Self>) -> bool {
        let result = self
            .isolated_layout
            .as_ref()
            .map(IsolatedLayout::revalidate)
            .transpose();
        if let Err(error) = result {
            let message = format!(
                "{} {error}",
                self.preferences
                    .locale
                    .text("Isolated mode path validation failed:")
            );
            if fatal {
                self.state = AppState::Failed(message);
            } else {
                self.toast_danger(cx, "connector.isolated.error", message);
            }
            false
        } else {
            true
        }
    }

    fn sync_localized_controls(&self, cx: &mut Context<Self>) {
        let locale = self.preferences.locale;
        self.language_select.update(cx, |select, cx| {
            select.set_name(locale.text("Language"), cx);
            select.set_options(locale_options(self.distribution), cx);
            select.set_selected(Some(locale.id().into()), cx);
        });
        self.theme_select.update(cx, |select, cx| {
            select.set_name(locale.text("Theme"), cx);
            select.set_options(
                ThemePreference::ALL
                    .map(|value| SelectOption::new(value.id(), value.display_name(locale)))
                    .to_vec(),
                cx,
            );
            select.set_selected(Some(self.preferences.theme.id().into()), cx);
        });
        self.density_select.update(cx, |select, cx| {
            select.set_name(locale.text("Density"), cx);
            select.set_options(
                DensityPreference::ALL
                    .map(|value| SelectOption::new(value.id(), value.display_name(locale)))
                    .to_vec(),
                cx,
            );
            select.set_selected(Some(self.preferences.density.id().into()), cx);
        });
        self.gateway_url.update(cx, |input, cx| {
            input.set_name(locale.text("Gateway base URL"), cx);
            input.set_placeholder(
                locale.text("https://gateway.example.com or https://gateway.example.com/v1"),
                cx,
            );
        });
        self.settings_search.update(cx, |input, cx| {
            input.set_name(locale.text("Search settings"), cx);
            input.set_placeholder(locale.text("Filter settings"), cx);
        });
        self.model_search.update(cx, |input, cx| {
            input.set_name(locale.text("Search model catalog"), cx);
            input.set_placeholder(locale.text("Filter by model ID, provider, or tag"), cx);
        });
        for (agent, select) in &self.model_selects {
            select.update(cx, |select, cx| {
                select.set_name(
                    format!("{} {}", agent.display_name(), locale.text("model")),
                    cx,
                );
            });
        }
        self.sync_protocol_selects(cx);
        for (setting, select) in &self.codex_selects {
            let selected = select.read(cx).selected_id().cloned();
            select.update(cx, |select, cx| {
                select.set_name(super::controls::codex_setting_label(*setting, locale), cx);
                select.set_options(super::controls::codex_setting_options(*setting, locale), cx);
                select.set_selected(selected, cx);
            });
        }
        self.sync_codex_selects(cx);
    }

    fn begin_resume(&mut self, cx: &mut Context<Self>) {
        if let Some(invitation) = crate::InstallInvitation::detect() {
            self.state = AppState::NotInstalled(Box::new(invitation));
            return;
        }
        if !self.ensure_isolated_paths(true, cx) {
            return;
        }
        let backend = Arc::clone(&self.backend);
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move { backend.resume_saved() })
                .await;
            this.update(cx, |this, cx| {
                match result {
                    Ok(Some(result)) => this.complete_connection(result, cx),
                    Ok(None) => this.state = AppState::FirstRun,
                    Err(error) => this.state = AppState::Failed(error.to_string()),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn begin_sign_in(&mut self, cx: &mut Context<Self>) {
        if self.distribution.allow_custom_urls {
            self.begin_connect(cx);
            return;
        }
        if matches!(self.state, AppState::Connecting) {
            return;
        }
        if !self.ensure_isolated_paths(true, cx) {
            return;
        }
        let Some(base_url) = self.distribution.default_gateway_url.map(str::to_owned) else {
            self.state = AppState::Failed(
                "This BoxAI Connect build is missing its compile-time gateway URL.".into(),
            );
            return;
        };
        let display_name = display_name(&base_url);
        let backend = Arc::clone(&self.backend);
        self.state = AppState::Connecting;
        self.action_error = None;
        self.sign_in_failure = None;
        self.sign_in_invitation = None;
        self.sign_in_progress.clear();
        self.watch_sign_in_invitation(cx);
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    match backend.sign_in(&base_url, display_name) {
                        Ok(result) => SignInOutcome::Connected(Box::new(result)),
                        Err(BackendError::ManifestHasNoBrowserAuth) => {
                            SignInOutcome::Failed("BoxAI did not advertise browser login.".into())
                        }
                        Err(BackendError::Pkce(PkceError::Browser)) => {
                            SignInOutcome::Refused(SignInFailure::BrowserUnavailable)
                        }
                        Err(BackendError::Pkce(PkceError::Timeout)) => {
                            SignInOutcome::Refused(SignInFailure::CallbackNeverArrived)
                        }
                        Err(BackendError::Pkce(PkceError::Denied(_))) => {
                            SignInOutcome::Refused(SignInFailure::Declined)
                        }
                        Err(error) => SignInOutcome::Failed(error.to_string()),
                    }
                })
                .await;
            this.update(cx, |this, cx| {
                this.sign_in_invitation = None;
                this.sign_in_progress.clear();
                match result {
                    SignInOutcome::Connected(result) => this.complete_connection(*result, cx),
                    SignInOutcome::Refused(failure) => {
                        // The sign-in card, not a bare error line, owns these:
                        // each one has its own remedy and its own retry.
                        this.sign_in_failure = Some(failure);
                        this.state = AppState::FirstRun;
                    }
                    SignInOutcome::Failed(error) => this.state = AppState::Failed(error),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// Publishes the authorization URL to the window as soon as the backend has
    /// one, so a wait that is going nowhere still offers the link to open by
    /// hand in another browser.
    fn watch_sign_in_invitation(&self, cx: &mut Context<Self>) {
        let progress = Arc::clone(&self.sign_in_progress);
        cx.spawn(async move |this, cx| {
            loop {
                let invitation = progress.read();
                let keep_waiting = this
                    .update(cx, |this, cx| {
                        if !matches!(this.state, AppState::Connecting) {
                            return false;
                        }
                        if let Some(invitation) = invitation
                            && this.sign_in_invitation.as_ref() != Some(&invitation)
                        {
                            this.sign_in_invitation = Some(invitation);
                            cx.notify();
                            return false;
                        }
                        true
                    })
                    .unwrap_or(false);
                if !keep_waiting {
                    return;
                }
                cx.background_executor().timer(SIGN_IN_POLL_INTERVAL).await;
            }
        })
        .detach();
    }

    fn begin_connect(&mut self, cx: &mut Context<Self>) {
        if matches!(self.state, AppState::Connecting) {
            return;
        }
        if !self.ensure_isolated_paths(true, cx) {
            return;
        }
        let base_url = self
            .distribution
            .default_gateway_url
            .map(str::to_owned)
            .unwrap_or_else(|| self.gateway_url.read(cx).value().to_string());
        let raw_key = self.api_key.read(cx).value(cx).to_string();
        let display_name = display_name(&base_url);
        let backend = Arc::clone(&self.backend);
        self.state = AppState::Connecting;
        self.action_error = None;
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    let mut raw_key = raw_key;
                    if raw_key.trim().is_empty() {
                        raw_key.zeroize();
                        return match backend.probe(&base_url) {
                            Ok(ProbeResult::Provisioned {
                                manifest_url,
                                manifest,
                                ..
                            }) if manifest.authentication.is_some() => {
                                ConnectOutcome::Browser(Box::new(BrowserLoginOffer {
                                    request: ConnectRequestWithoutCredential {
                                        display_name,
                                        base_url,
                                    },
                                    manifest_url,
                                    manifest: *manifest,
                                }))
                            }
                            Ok(_) => ConnectOutcome::Failed(
                                "This Gateway requires an API key; enter it and try again.".into(),
                            ),
                            Err(error) => ConnectOutcome::Failed(error.to_string()),
                        };
                    }
                    let api_key = match ApiKey::new(raw_key.clone()) {
                        Ok(api_key) => api_key,
                        Err(error) => {
                            raw_key.zeroize();
                            return ConnectOutcome::Failed(error.to_string());
                        }
                    };
                    raw_key.zeroize();
                    match backend.connect(ConnectRequest {
                        display_name,
                        base_url,
                        api_key,
                    }) {
                        Ok(result) => ConnectOutcome::Connected(Box::new(result)),
                        Err(BackendError::BrowserLoginRequired(offer)) => {
                            ConnectOutcome::Browser(offer)
                        }
                        Err(error) => ConnectOutcome::Failed(error.to_string()),
                    }
                })
                .await;
            this.update(cx, |this, cx| {
                this.api_key.update(cx, |input, cx| input.set_value("", cx));
                match result {
                    ConnectOutcome::Connected(result) => this.complete_connection(*result, cx),
                    ConnectOutcome::Browser(offer) => this.state = AppState::BrowserLogin(offer),
                    ConnectOutcome::Failed(error) => this.state = AppState::Failed(error),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn begin_browser_login(&mut self, cx: &mut Context<Self>) {
        if !self.ensure_isolated_paths(false, cx) {
            return;
        }
        let AppState::BrowserLogin(offer) = &self.state else {
            return;
        };
        let offer = offer.as_ref().clone();
        let retry = offer.clone();
        let backend = Arc::clone(&self.backend);
        self.state = AppState::Connecting;
        self.action_error = None;
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move { backend.browser_login(offer) })
                .await;
            this.update(cx, |this, cx| {
                match result {
                    Ok(result) => this.complete_connection(result, cx),
                    Err(error) => {
                        this.state = AppState::BrowserLogin(Box::new(retry));
                        this.action_error = Some(error.to_string());
                        this.toast_danger(cx, "connector.browser-login.error", error.to_string());
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn complete_connection(&mut self, mut result: ConnectionResult, cx: &mut Context<Self>) {
        apply_boxai_codex_defaults(&mut result);
        self.api_key.update(cx, |input, cx| input.set_value("", cx));
        self.save_error = None;
        self.action_error = None;
        let staged = match &self.state {
            AppState::Connected { connection, .. } => Some((
                connection.profile.agents.clone(),
                connection.profile.confirmed_direct_models.clone(),
            )),
            _ => None,
        };
        if !self.page.available(result.provisioning.as_ref()) {
            self.page = Page::Overview;
        }
        let previous_overview = match &self.state {
            AppState::Connected { overview, .. } => overview.clone(),
            _ => Box::new(crate::AsyncValue::default()),
        };
        self.state = AppState::connected(result);
        if let AppState::Connected { overview, .. } = &mut self.state {
            *overview = previous_overview;
        }
        if let Some((agents, confirmed)) = staged {
            if let AppState::Connected { connection, .. } = &mut self.state {
                connection.profile.agents = agents;
                connection.profile.confirmed_direct_models = confirmed;
            }
        } else {
            self.capture_applied_choices();
        }
        self.sync_model_selects(cx);
        self.sync_protocol_selects(cx);
        self.sync_codex_selects(cx);
        self.sync_model_filters(cx);
        self.refreshed_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .ok()
            .map(|since| since.as_secs() as i64);
        self.begin_projection_status(cx);
        self.begin_overview_fetch(cx);
    }

    fn capture_applied_choices(&mut self) {
        if let AppState::Connected { connection, .. } = &self.state {
            self.applied_agents = connection.profile.agents.clone();
            self.applied_confirmed = connection.profile.confirmed_direct_models.clone();
        }
    }

    pub(crate) fn has_unapplied_edits(&self) -> bool {
        self.distribution
            .supported_agents
            .iter()
            .copied()
            .any(|agent| self.agent_has_unapplied_edits(agent))
    }

    pub(crate) fn agent_has_unapplied_edits(&self, agent: AgentId) -> bool {
        let AppState::Connected { connection, .. } = &self.state else {
            return false;
        };
        connection.profile.agents.get(&agent) != self.applied_agents.get(&agent)
    }

    pub(crate) fn agent_is_managed(&self, agent: AgentId) -> bool {
        let AppState::Connected { managed_agents, .. } = &self.state else {
            return false;
        };
        managed_agents
            .value
            .as_ref()
            .is_some_and(|values| values.contains(&agent))
    }

    fn persist_applied_agent(&mut self, agent: AgentId, cx: &mut Context<Self>) {
        if let AppState::Connected { connection, .. } = &self.state
            && let Some(selection) = connection.profile.agents.get(&agent)
        {
            self.applied_agents.insert(agent, selection.clone());
            self.applied_confirmed = connection.profile.confirmed_direct_models.clone();
        }
        self.queue_profile_save(cx);
    }

    pub(crate) fn sync_model_filters(&mut self, cx: &mut Context<Self>) {
        self.sync_model_selects(cx);
        let vendors = self.available_model_vendors();
        self.model_vendors
            .retain(|vendor| vendors.iter().any(|value| value == vendor));
    }

    pub(crate) fn available_model_vendors(&self) -> Vec<String> {
        let AppState::Connected { connection, .. } = &self.state else {
            return Vec::new();
        };
        let mut vendors = BTreeSet::new();
        if let Some(plaza) = connection
            .provisioning
            .as_ref()
            .and_then(|value| value.model_plaza.as_ref())
        {
            for model in &plaza.models {
                if let Some(name) = model
                    .vendor
                    .as_ref()
                    .map(|value| value.name.trim())
                    .filter(|value| !value.is_empty())
                {
                    vendors.insert(name.to_owned());
                }
            }
        } else {
            for model in &connection.models {
                if let Some(name) = model
                    .owned_by
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    vendors.insert(name.to_owned());
                }
            }
        }
        vendors.into_iter().collect()
    }

    pub(crate) fn agent_nav_badge(&self, agent: AgentId) -> Option<&'static str> {
        let locale = self.preferences.locale;
        let detected = match &self.state {
            AppState::Connected { installs, .. } => installs
                .value
                .as_ref()
                .and_then(|values| values.iter().find(|install| install.agent == agent))
                .is_some_and(|install| install.detected),
            _ => false,
        };
        if !detected {
            return Some(locale.text("Not detected"));
        }
        if self.agent_has_unapplied_edits(agent) {
            return Some(locale.text("Unapplied changes"));
        }
        None
    }

    pub(crate) fn agent_apply_enabled(&self, agent: AgentId) -> bool {
        let AppState::Connected {
            connection,
            installs,
            ..
        } = &self.state
        else {
            return false;
        };
        let detected = installs
            .value
            .as_ref()
            .and_then(|values| values.iter().find(|install| install.agent == agent))
            .is_some_and(|install| install.detected);
        let no_models = connection.models.is_empty();
        let dirty = self.agent_has_unapplied_edits(agent);
        let managed = self.agent_is_managed(agent);
        !self.projection_busy && detected && !no_models && (dirty || !managed)
    }

    pub(crate) fn filtered_plaza_count(&self, connection: &ConnectionResult) -> usize {
        if let Some(plaza) = connection
            .provisioning
            .as_ref()
            .and_then(|value| value.model_plaza.as_ref())
        {
            return plaza
                .models
                .iter()
                .filter(|model| self.plaza_model_visible(model))
                .count();
        }
        connection
            .models
            .iter()
            .filter(|model| self.descriptor_visible(model))
            .count()
    }

    pub(crate) fn plaza_model_visible(&self, model: &gateway_connector_core::Model) -> bool {
        let query = self.model_query.trim().to_ascii_lowercase();
        if !model_matches(
            &query,
            &model.id,
            model.vendor.as_ref().map(|value| value.name.as_str()),
            model.description.as_deref(),
            &model.tags,
        ) {
            return false;
        }
        if !self.model_vendors.is_empty() {
            let Some(vendor) = model.vendor.as_ref() else {
                return false;
            };
            if !self.model_vendors.contains(&vendor.name) {
                return false;
            }
        }
        if !self.model_kinds.is_empty() {
            return self
                .model_kinds
                .iter()
                .any(|kind| crate::model_matches_kind(model, *kind));
        }
        true
    }

    pub(crate) fn descriptor_visible(
        &self,
        model: &gateway_connector_backend::ModelDescriptor,
    ) -> bool {
        let query = self.model_query.trim().to_ascii_lowercase();
        if !model_matches(&query, &model.id, model.owned_by.as_deref(), None, &[]) {
            return false;
        }
        if !self.model_vendors.is_empty() {
            let Some(owner) = model.owned_by.as_ref() else {
                return false;
            };
            if !self.model_vendors.contains(owner) {
                return false;
            }
        }
        if !self.model_kinds.is_empty() {
            return self
                .model_kinds
                .iter()
                .any(|kind| crate::descriptor_matches_kind(model.capability, *kind));
        }
        true
    }

    fn sync_model_selects(&self, cx: &mut Context<Self>) {
        let AppState::Connected { connection, .. } = &self.state else {
            return;
        };
        let locale = self.preferences.locale;
        let query = self.model_query.trim().to_ascii_lowercase();
        let options = connection
            .models
            .iter()
            .filter(|model| {
                connection.profile.mode != gateway_connector_core::ConnectionMode::Direct
                    || model.capability != ModelCapability::NonChat
            })
            .filter(|model| {
                query.is_empty()
                    || model.id.to_ascii_lowercase().contains(&query)
                    || model
                        .owned_by
                        .as_ref()
                        .is_some_and(|owner| owner.to_ascii_lowercase().contains(&query))
            })
            .map(|model| {
                let mut option = SelectOption::new(model.id.clone(), model.id.clone());
                let description = match model.capability {
                    ModelCapability::Unknown => locale
                        .text("Unknown chat capability — choosing this model confirms its use")
                        .to_owned(),
                    _ => model.owned_by.clone().unwrap_or_default(),
                };
                if !description.is_empty() {
                    option = option.description(description);
                }
                option
            })
            .collect::<Vec<_>>();
        let options_with_selection = |selected: Option<String>| {
            let mut selected_options = options.clone();
            if let Some(selected) = &selected
                && !selected_options
                    .iter()
                    .any(|option| option.id.as_ref() == selected)
            {
                let catalog_model = connection.models.iter().find(|model| &model.id == selected);
                let option = if catalog_model
                    .is_some_and(|model| model.capability == ModelCapability::NonChat)
                {
                    SelectOption::new(
                        selected.clone(),
                        format!("{selected} {}", locale.text("(unavailable)")),
                    )
                    .description(
                        locale.text("Saved choice is explicitly non-chat and cannot be projected"),
                    )
                    .disabled(true)
                } else if catalog_model.is_some() {
                    SelectOption::new(
                        selected.clone(),
                        format!("{selected} {}", locale.text("(selected)")),
                    )
                    .description(locale.text("Selected model is hidden by the current filter"))
                } else {
                    SelectOption::new(
                        selected.clone(),
                        format!("{selected} {}", locale.text("(unavailable)")),
                    )
                    .description(locale.text("Saved choice is not in the current catalog"))
                    .disabled(true)
                };
                selected_options.push(option);
            }
            (selected_options, selected)
        };
        let catalog_ids = connection.provisioning.as_ref().map(|provisioning| {
            provisioning
                .models
                .iter()
                .filter(|model| model.is_codex_catalog_model())
                .map(|model| model.id.as_str())
                .collect::<std::collections::BTreeSet<_>>()
        });
        for (agent, select) in &self.model_selects {
            let selected = connection.profile.agents[agent].default_model.clone();
            let (mut agent_options, selected) = options_with_selection(selected);
            if *agent == AgentId::Codex
                && let Some(catalog) = &catalog_ids
            {
                let keep_selected = selected.clone();
                agent_options.retain(|option| {
                    catalog.contains(option.id.as_ref())
                        || keep_selected.as_deref() == Some(option.id.as_ref())
                });
                if let Some(selected_id) = keep_selected.as_deref()
                    && !catalog.contains(selected_id)
                {
                    agent_options.retain(|option| option.id.as_ref() != selected_id);
                    agent_options.push(
                        SelectOption::new(
                            selected_id.to_owned(),
                            format!("{selected_id} {}", locale.text("(unavailable)")),
                        )
                        .description(locale.text("Saved choice is not a Codex Responses model"))
                        .disabled(true),
                    );
                }
            }
            let disabled = self.projection_busy || agent_options.is_empty();
            select.update(cx, move |select, cx| {
                select.set_options(agent_options, cx);
                select.set_selected(selected.map(Into::into), cx);
                select.set_disabled(disabled, cx);
            });
        }
    }

    fn commit_codex_setting(&mut self, setting: &str, value: &str, cx: &mut Context<Self>) {
        let Some(setting) = CodexSetting::from_id(setting) else {
            return;
        };
        let AppState::Connected { connection, .. } = &self.state else {
            return;
        };
        let mut settings = connection.profile.agents[&AgentId::Codex].codex.clone();
        if let Err(error) = setting.update(&mut settings, value) {
            self.toast_danger(cx, "connector.codex.error", error);
        } else {
            self.state.update_codex_settings(settings);
        }
        self.sync_codex_selects(cx);
    }

    fn sync_protocol_selects(&self, cx: &mut Context<Self>) {
        let AppState::Connected { connection, .. } = &self.state else {
            return;
        };
        let locale = self.preferences.locale;
        for (agent, select) in &self.protocol_selects {
            let selected = connection.profile.agents[agent].protocol;
            let options = agent
                .supported_protocols()
                .iter()
                .copied()
                .map(|protocol| {
                    let available = protocol == Protocol::Auto
                        || connection.manifest.as_ref().is_none_or(|manifest| {
                            protocol
                                .wire_protocol()
                                .is_some_and(|wire| manifest.gateway.protocols.contains(&wire))
                        });
                    let mut option =
                        SelectOption::new(protocol.as_str(), locale.text(protocol.display_name()));
                    if !available {
                        option = option
                            .description(
                                locale.text("This protocol is not advertised by the Gateway"),
                            )
                            .disabled(true);
                    }
                    option
                })
                .collect::<Vec<_>>();
            let disabled = self.projection_busy || options.len() == 1;
            select.update(cx, |select, cx| {
                select.set_name(locale.text("Protocol"), cx);
                select.set_options(options, cx);
                select.set_selected(Some(selected.as_str().into()), cx);
                select.set_disabled(disabled, cx);
            });
        }
    }

    fn sync_codex_selects(&self, cx: &mut Context<Self>) {
        let AppState::Connected { connection, .. } = &self.state else {
            return;
        };
        let settings = &connection.profile.agents[&AgentId::Codex].codex;
        let model_id = connection.profile.agents[&AgentId::Codex]
            .default_model
            .as_deref();
        let supported_reasoning = connection
            .provisioning
            .as_ref()
            .and_then(|provisioning| {
                provisioning
                    .models
                    .iter()
                    .find(|model| Some(model.id.as_str()) == model_id)
            })
            .map(|model| model.supported_reasoning.clone())
            .or_else(|| {
                connection
                    .models
                    .iter()
                    .find(|model| Some(model.id.as_str()) == model_id)
                    .and_then(|model| model.metadata.get("supported_reasoning"))
                    .and_then(serde_json::Value::as_array)
                    .map(|values| {
                        values
                            .iter()
                            .filter_map(serde_json::Value::as_str)
                            .map(str::to_owned)
                            .collect()
                    })
            })
            .unwrap_or_default();
        let locale = self.preferences.locale;
        for (setting, select) in &self.codex_selects {
            let selected = setting.selected(settings);
            let disabled = self.projection_busy;
            let options = super::controls::codex_setting_options_for_model(
                *setting,
                locale,
                (*setting == CodexSetting::ReasoningEffort)
                    .then_some(supported_reasoning.as_slice()),
            );
            select.update(cx, |select, cx| {
                select.set_options(options, cx);
                select.set_selected(Some(selected.into()), cx);
                select.set_disabled(disabled, cx);
            });
        }
    }

    fn queue_profile_save(&mut self, cx: &mut Context<Self>) {
        if !self.ensure_isolated_paths(false, cx) {
            return;
        }
        if let AppState::Connected { connection, .. } = &self.state {
            self.pending_save = Some(connection.profile.clone());
            self.start_profile_save(cx);
        }
    }

    fn begin_projection_status(&mut self, cx: &mut Context<Self>) {
        if !self.ensure_isolated_paths(false, cx) {
            return;
        }
        let AppState::Connected {
            connection,
            installs,
            managed_agents,
            ..
        } = &mut self.state
        else {
            return;
        };
        installs.begin_refresh();
        managed_agents.begin_refresh();
        let profile = connection.profile.clone();
        let generation = self.projection_status_generation.begin();
        let backend = Arc::clone(&self.backend);
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    let installs = backend.discover_agents().map_err(|error| error.to_string());
                    let managed = backend
                        .managed_agents(&profile)
                        .map_err(|error| error.to_string());
                    (profile, installs, managed)
                })
                .await;
            this.update(cx, |this, cx| {
                let (profile, installs, managed) = result;
                if this.projection_status_generation.accepts(generation)
                    && matches!(
                        &this.state,
                        AppState::Connected { connection, .. }
                            if connection.profile.id == profile.id
                    )
                    && let AppState::Connected {
                        installs: current_installs,
                        managed_agents: current_managed,
                        projection,
                        ..
                    } = &mut this.state
                {
                    current_installs.finish(installs);
                    current_managed.finish(managed);
                    if matches!(
                        projection,
                        crate::ProjectionLifecycle::NotManaged
                            | crate::ProjectionLifecycle::ManagedExisting
                    ) {
                        *projection = if current_managed
                            .value
                            .as_ref()
                            .is_some_and(|agents| !agents.is_empty())
                        {
                            crate::ProjectionLifecycle::ManagedExisting
                        } else {
                            crate::ProjectionLifecycle::NotManaged
                        };
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn set_projection_busy(&mut self, busy: bool, cx: &mut Context<Self>) {
        self.projection_busy = busy;
        self.sync_model_selects(cx);
        self.sync_protocol_selects(cx);
        self.sync_codex_selects(cx);
    }

    fn begin_overview_fetch(&mut self, cx: &mut Context<Self>) {
        let AppState::Connected {
            connection,
            overview,
            ..
        } = &mut self.state
        else {
            return;
        };
        let Some(manifest) = connection.manifest.clone() else {
            return;
        };
        let profile = connection.profile.clone();
        let profile_id = profile.id;
        overview.begin_refresh();
        let backend = Arc::clone(&self.backend);
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move { backend.fetch_overview(&profile, &manifest) })
                .await;
            this.update(cx, |this, cx| {
                if let AppState::Connected {
                    overview,
                    connection,
                    ..
                } = &mut this.state
                    && connection.profile.id == profile_id
                {
                    overview.finish(result.map_err(|error| error.to_string()));
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn begin_refresh(&mut self, cx: &mut Context<Self>) {
        if self.projection_busy {
            return;
        }
        if !self.ensure_isolated_paths(false, cx) {
            return;
        }
        let AppState::Connected { connection, .. } = &self.state else {
            return;
        };
        let profile = connection.profile.clone();
        let backend = Arc::clone(&self.backend);
        self.action_error = None;
        self.set_projection_busy(true, cx);
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move { backend.refresh(profile) })
                .await;
            this.update(cx, |this, cx| {
                this.set_projection_busy(false, cx);
                match result {
                    Ok(connection) => {
                        this.complete_connection(connection, cx);
                        this.toast_success(
                            cx,
                            "connector.refresh.ok",
                            this.text("Refreshed account and catalogs."),
                        );
                    }
                    Err(error) => {
                        this.action_error = Some(error.to_string());
                        this.toast_danger(cx, "connector.refresh.error", error.to_string());
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn begin_apply(&mut self, agent: AgentId, cx: &mut Context<Self>) {
        if self.projection_busy {
            return;
        }
        if !self.ensure_isolated_paths(false, cx) {
            return;
        }
        let AppState::Connected { connection, .. } = &self.state else {
            return;
        };
        let connection = connection.as_ref().clone();
        let profile = connection.profile.clone();
        if !self.state.start_direct_apply() {
            return;
        }
        self.projection_status_generation.invalidate();
        let backend = Arc::clone(&self.backend);
        self.action_error = None;
        self.set_projection_busy(true, cx);
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    let plan = backend.plan_agent_projection(&connection, agent)?;
                    backend.apply_projection(&profile, &plan)?;
                    let managed = backend.managed_agents(&profile);
                    Ok::<_, gateway_connector_backend::BackendError>((profile, managed))
                })
                .await;
            this.update(cx, |this, cx| {
                this.set_projection_busy(false, cx);
                match result {
                    Ok((profile, managed)) => {
                        let profile_matches = matches!(
                            &this.state,
                            AppState::Connected { connection, .. }
                                if connection.profile.id == profile.id
                        );
                        if profile_matches {
                            this.state.finish_apply_and_settle();
                            if let AppState::Connected { managed_agents, .. } = &mut this.state {
                                managed_agents.finish(managed.map_err(|error| error.to_string()));
                            }
                            this.persist_applied_agent(agent, cx);
                            this.toast_success(
                                cx,
                                "connector.apply.ok",
                                this.text("Applied this Agent's configuration."),
                            );
                        }
                    }
                    Err(error) => {
                        this.state.fail_apply();
                        this.action_error = Some(error.to_string());
                        this.toast_danger(cx, "connector.apply.error", error.to_string());
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn begin_disconnect(&mut self, cx: &mut Context<Self>) {
        if self.projection_busy || self.save_in_flight {
            return;
        }
        if !self.ensure_isolated_paths(false, cx) {
            return;
        }
        let AppState::Connected { connection, .. } = &self.state else {
            return;
        };
        let profile = connection.profile.clone();
        let backend = Arc::clone(&self.backend);
        self.action_error = None;
        self.projection_status_generation.invalidate();
        self.state.start_disconnect();
        self.set_projection_busy(true, cx);
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    backend.disconnect(&profile)?;
                    Ok::<_, gateway_connector_backend::BackendError>(profile)
                })
                .await;
            this.update(cx, |this, cx| {
                this.set_projection_busy(false, cx);
                match result {
                    Ok(profile) => {
                        this.gateway_url.update(cx, |input, cx| {
                            input.set_value(profile.base_url.to_string(), cx)
                        });
                        this.pending_save = None;
                        this.save_error = None;
                        this.action_error = None;
                        this.page = Page::Overview;
                        this.state = AppState::FirstRun;
                    }
                    Err(error) => {
                        this.state.fail_disconnect();
                        this.action_error = Some(error.to_string());
                        this.toast_danger(cx, "connector.disconnect.error", error.to_string());
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn start_profile_save(&mut self, cx: &mut Context<Self>) {
        if self.save_in_flight {
            return;
        }
        if !self.ensure_isolated_paths(false, cx) {
            return;
        }
        let Some(profile) = self.pending_save.take() else {
            return;
        };
        self.save_in_flight = true;
        let backend = Arc::clone(&self.backend);
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move { backend.save_profile(&profile) })
                .await;
            this.update(cx, |this, cx| {
                this.save_in_flight = false;
                if let Some(error) = result.err().map(|error| error.to_string()) {
                    this.save_error = Some(error.clone());
                    this.toast_warning(cx, "connector.save.error", error);
                } else {
                    this.save_error = None;
                }
                this.start_profile_save(cx);
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub(crate) fn disconnect_semantic(&self) -> Option<ProjectionSemantic> {
        match &self.state {
            AppState::Connected { projection, .. }
                if matches!(
                    projection.semantic(),
                    ProjectionSemantic::Disconnecting | ProjectionSemantic::DisconnectFailed
                ) =>
            {
                Some(projection.semantic())
            }
            _ => None,
        }
    }
}

fn display_name(base_url: &str) -> String {
    CanonicalBaseUrl::parse(base_url)
        .map(|url| url.suggested_display_name())
        .unwrap_or_else(|_| "Gateway".to_owned())
}

fn model_matches(
    query: &str,
    id: &str,
    provider: Option<&str>,
    description: Option<&str>,
    tags: &[String],
) -> bool {
    query.is_empty()
        || id.to_ascii_lowercase().contains(query)
        || provider.is_some_and(|value| value.to_ascii_lowercase().contains(query))
        || description.is_some_and(|value| value.to_ascii_lowercase().contains(query))
        || tags
            .iter()
            .any(|value| value.to_ascii_lowercase().contains(query))
}
