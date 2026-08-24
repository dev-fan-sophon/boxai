use gpui::{Context, IntoElement, ParentElement, SharedString, Styled, div};
use gpui_kit::foundation::text;
use gpui_kit::prelude::*;
use gpui_kit_theme::{Space, Theme, TypeScale};

use crate::AppState;
use crate::preferences::Locale;

use super::chrome::page_column;
use super::host::ConnectorHost;

impl ConnectorHost {
    pub(crate) fn render_mcp(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let AppState::Connected { connection, .. } = &self.state else {
            unreachable!("MCP page requires connected state")
        };
        let locale = self.preferences.locale;
        let theme = cx.theme().clone();
        let servers = connection
            .provisioning
            .as_ref()
            .map(|provisioning| provisioning.mcp_servers.as_slice())
            .unwrap_or_default();
        let banner = self.page_banner(
            &theme,
            "MCP",
            Some(SharedString::from(format!(
                "{} {}",
                servers.len(),
                locale.text("servers")
            ))),
            "connector.mcp.refresh",
            cx,
        );
        if servers.is_empty() {
            return page_column(
                &theme,
                [
                    banner,
                    self.render_catalog_empty(
                        "connector.mcp",
                        locale.text("No MCP servers were provisioned."),
                    ),
                ],
            );
        }
        page_column(
            &theme,
            [
                banner,
                StatusLine::new(
                    locale.text("Enable each server on the Agent page, then apply that Agent."),
                    Tone::Info,
                )
                .id("connector.mcp.hint")
                .into_any_element(),
                Card::new()
                    .id("connector.mcp.list")
                    .variant(CardVariant::Elevated)
                    .divided(true)
                    .children(
                        servers
                            .iter()
                            .map(|server| mcp_row(&theme, locale, server))
                            .collect::<Vec<_>>(),
                    )
                    .into_any_element(),
            ],
        )
    }

    pub(crate) fn render_catalog_empty(&self, id: &'static str, message: &str) -> gpui::AnyElement {
        EmptyState::new(format!("{id}.empty"), message.to_owned())
            .kind(EmptyKind::Empty)
            .into_any_element()
    }
}

fn mcp_row(theme: &Theme, locale: Locale, server: &gateway_connector_core::McpServer) -> ListRow {
    let authorization = locale.text(match server.authorization {
        gateway_connector_core::McpAuthorization::ConnectionBearer => "Connection bearer",
    });
    let description = server
        .description
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| locale.text("Available from platform").into());
    ListRow::new()
        .id(format!("connector.mcp.{}", server.id))
        .leading(StatusDot::new(Tone::Info))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .column()
                .child(
                    text(theme, TypeScale::Label, server.name.clone())
                        .w_full()
                        .min_w_0()
                        .truncate(),
                )
                .child(
                    text(
                        theme,
                        TypeScale::Caption,
                        format!("{description} · {}", server.url),
                    )
                    .w_full()
                    .min_w_0()
                    .truncate()
                    .text_color(theme.colors.text_muted),
                ),
        )
        .trailing(
            div()
                .flex()
                .flex_row()
                .items_center()
                .gap_token(theme, Space::Sm)
                .child(Tag::new(
                    format!("connector.mcp.{}.origin", server.id),
                    locale.text("Provisioned"),
                ))
                .child(
                    Badge::new(authorization)
                        .tone(Tone::Info)
                        .id(format!("connector.mcp.{}.state", server.id)),
                ),
        )
}
