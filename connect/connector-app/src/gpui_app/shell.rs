use gpui::{
    Context, InteractiveElement, IntoElement, ParentElement, Render, Styled, Window, div, px,
};
use gpui_kit::foundation::text;
use gpui_kit::prelude::*;
use gpui_kit_semantics::SemanticCoordinator;
use gpui_kit_theme::{Space, TypeScale};

use crate::{AppState, Page, agent_page_id, app::Action, parse_agent_page_id};

use super::chrome::{format_unix_compact_locale, page_column, page_enter, signed_out_stage};
use super::controls::agent_logo_path;
use super::host::ConnectorHost;

impl ConnectorHost {
    fn isolation_banner(&self) -> Option<gpui::AnyElement> {
        self.isolated_layout.as_ref().map(|layout| {
            Callout::new(
                format!(
                    "{}\n{} {}",
                    self.text("Isolated mode"),
                    self.text(
                        "Managing fixture Agents under this path; installed Agents are not being modified:"
                    ),
                    layout.root().display()
                ),
                Tone::Warning,
            )
            .id("connector.isolated-mode")
            .into_any_element()
        })
    }

    fn status_bar(&self) -> StatusBar {
        let AppState::Connected { connection, .. } = &self.state else {
            unreachable!("status bar requires connected state")
        };
        let locale = self.preferences.locale;
        let mut end = Vec::new();
        if self.refresh_busy() {
            end.push(StatusItem::progress("refresh", locale.text("Refreshing…")));
        } else if let Some(refreshed_at) = self.refreshed_at {
            end.push(StatusItem::text(
                "refresh",
                format!(
                    "{} {}",
                    locale.text("Updated"),
                    format_unix_compact_locale(locale, refreshed_at)
                ),
            ));
        }
        if self.has_unapplied_edits() {
            end.push(StatusItem::state(
                "unapplied",
                locale.text("Unapplied changes"),
                Tone::Warning,
            ));
        }
        StatusBar::new("connector.shell.status")
            .label(locale.text("Connection status"))
            .start([
                StatusItem::text("gateway", connection.profile.base_url.to_string()),
                StatusItem::state("connection", locale.text("Connected"), Tone::Success),
            ])
            .end(end)
    }

    fn navigation(&self, cx: &mut Context<Self>) -> Sidebar {
        let AppState::Connected { connection, .. } = &self.state else {
            unreachable!("navigation requires connected state")
        };
        let locale = self.preferences.locale;
        let provisioning = connection.provisioning.as_ref();
        let account = self.provisioned_account();
        let name = account
            .map(|account| account.username.trim())
            .filter(|username| !username.is_empty())
            .unwrap_or_else(|| locale.text("BoxAI Connect"));
        let group = account
            .map(|account| account.group.trim())
            .filter(|value| !value.is_empty());
        let theme = cx.theme().clone();
        let identity_view = cx.entity().downgrade();
        let mut identity = ListRow::new()
            .id("connector.sidebar.identity")
            .leading(
                Avatar::new(name.to_owned())
                    .id("connector.sidebar.avatar")
                    .size(28.0),
            )
            .child(
                text(&theme, TypeScale::Label, name.to_owned())
                    .w_full()
                    .min_w(px(0.0))
                    .truncate(),
            )
            .on_click(move |_window, cx| {
                let _ = identity_view.update(cx, |this, cx| {
                    this.dispatch(Action::SelectPage(Page::Account), cx)
                });
            });
        if let Some(group) = group {
            identity = identity.trailing(Badge::new(group.to_owned()).accent());
        }
        let settings_view = cx.entity().downgrade();
        let settings = IconButton::new(
            "connector.sidebar.settings",
            gpui_kit::assets::Icon::Settings,
            locale.text("Settings"),
        )
        .ghost()
        .on_click(move |_window, cx| {
            let _ = settings_view.update(cx, |this, cx| {
                this.dispatch(Action::SelectPage(Page::Settings), cx)
            });
        });
        let footer = div()
            .w_full()
            .min_w(px(0.0))
            .overflow_hidden()
            .flex()
            .flex_row()
            .items_center()
            .gap_token(&theme, Space::Sm)
            .child(div().flex_1().min_w(px(0.0)).child(identity))
            .child(settings);
        let mut items = Vec::new();
        for (page, label, icon) in [
            (Page::Overview, "Overview", gpui_kit::assets::Icon::Global),
            (Page::Mcp, "MCP", gpui_kit::assets::Icon::Widget),
            (Page::Skills, "Skills", gpui_kit::assets::Icon::Document),
            (Page::Models, "Model Plaza", gpui_kit::assets::Icon::Chat),
        ] {
            if page.available(provisioning) {
                items.push(SidebarItem::new(page.id(), locale.text(label)).icon(icon));
            }
        }
        if Page::Agents.available(provisioning) {
            let children = self
                .distribution
                .supported_agents
                .iter()
                .copied()
                .map(|agent| {
                    let mut item = SidebarItem::new(agent_page_id(agent), agent.display_name())
                        .image(agent_logo_path(agent));
                    if let Some(badge) = self.agent_nav_badge(agent) {
                        item = item.badge(badge);
                    }
                    item
                });
            items.insert(
                1,
                SidebarItem::new(Page::Agents.id(), locale.text("Agents"))
                    .icon(gpui_kit::assets::Icon::Terminal)
                    .children(children),
            );
        }
        let active = if self.page == Page::Agents {
            agent_page_id(self.selected_agent)
        } else {
            self.page.id().to_owned()
        };
        let handle = cx.entity().downgrade();
        Sidebar::new("connector.sidebar")
            .active(active)
            .footer(footer)
            .section(SidebarSection::new("kit").items(items))
            .on_select(move |id, _, cx| {
                let _ = handle.update(cx, |this, cx| {
                    if let Some(agent) = parse_agent_page_id(id.as_ref()) {
                        this.dispatch(Action::SelectAgent(agent), cx);
                    } else if let Some(page) = Page::from_id(id.as_ref()) {
                        this.dispatch(Action::SelectPage(page), cx);
                    }
                });
            })
    }

    fn render_connected_page(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        match self.page {
            Page::Overview => self.render_overview(cx),
            Page::Account => self.render_account_hub(cx),
            Page::Models => self.render_model_catalog(cx),
            Page::Agents => self.render_agents(cx),
            Page::Mcp => self.render_mcp(cx),
            Page::Skills => self.render_skills(cx),
            Page::Settings => self.render_settings(cx),
        }
    }
}

impl Render for ConnectorHost {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        SemanticCoordinator::global(cx).begin_frame(window);
        let theme = cx.theme().clone();
        let connected = matches!(self.state, AppState::Connected { .. });
        let content = match &self.state {
            AppState::Loading => {
                let label = self.text("Loading saved connection");
                StateView::new("connector.loading", Phase::Loading)
                    .slot(slot::LOADING, move |_window, _cx| {
                        Skeleton::new("connector.loading.skeleton")
                            .label(label)
                            .rows(3)
                            .into_any_element()
                    })
                    .into_any_element()
            }
            AppState::FirstRun
            | AppState::Connecting
            | AppState::BrowserLogin(_)
            | AppState::Failed(_) => self.render_signed_out(cx),
            AppState::NotInstalled(invitation) => {
                let invitation = invitation.clone();
                self.render_not_installed(&invitation, cx)
            }
            AppState::Connected { .. } => self.render_connected_page(cx),
        };
        let page_id = match &self.state {
            AppState::Connected { .. } => format!("connector.page.{}", self.page.id()),
            AppState::Loading => "connector.page.loading".into(),
            _ => "connector.page.signed-out".into(),
        };
        let content = page_enter(page_id, &theme, content);
        let content = if let Some(banner) = self.isolation_banner() {
            page_column(&theme, [banner, content.into_any_element()])
        } else {
            content.into_any_element()
        };
        let root = div()
            .id("connector.root")
            .size_full()
            .bg(theme.colors.canvas)
            .font_family(theme.typography.sans.clone())
            .text_color(theme.colors.text);
        let shell = if connected {
            root.column()
                .child(
                    div()
                        .flex_1()
                        .min_h(px(0.0))
                        .w_full()
                        .flex()
                        .child(self.navigation(cx))
                        .child(
                            div().flex_1().min_w_0().h_full().child(
                                ScrollArea::new("connector.shell.scroll")
                                    .vertical()
                                    .label(self.text("Current BoxAI Connect page"))
                                    .child(
                                        div().w_full().p_token(&theme, Space::Xl).child(content),
                                    ),
                            ),
                        ),
                )
                .child(self.status_bar())
                .into_any_element()
        } else {
            root.child(signed_out_stage(&theme, content))
                .into_any_element()
        };
        let title = match &self.state {
            AppState::Connected { connection, .. } => format!(
                "{} — {}",
                self.distribution.product_name, connection.profile.base_url
            ),
            _ => self.distribution.product_name.to_owned(),
        };
        div()
            .id("connector.shell")
            .size_full()
            .column()
            .bg(theme.colors.canvas)
            .child(
                DesktopTitlebar::new("connector.titlebar", title)
                    .on_event(|event, window, _| event.apply(window)),
            )
            .child(div().flex_1().min_h(px(0.0)).w_full().child(shell))
            .child(self.toast_layer.clone())
            .child(self.confirm.clone())
    }
}
