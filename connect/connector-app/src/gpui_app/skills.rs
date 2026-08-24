use gpui::{Context, IntoElement, ParentElement, SharedString, Styled, div};
use gpui_kit::foundation::text;
use gpui_kit::prelude::*;
use gpui_kit_theme::{Space, Theme, TypeScale};

use crate::AppState;
use crate::preferences::Locale;

use super::chrome::page_column;
use super::host::ConnectorHost;

impl ConnectorHost {
    pub(crate) fn render_skills(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let AppState::Connected { connection, .. } = &self.state else {
            unreachable!("Skills page requires connected state")
        };
        let locale = self.preferences.locale;
        let gateway_skills = connection
            .provisioning
            .as_ref()
            .map(|value| value.skills.as_slice())
            .unwrap_or(&[]);
        let skills = gateway_skills
            .iter()
            .map(|skill| SkillRow {
                id: skill.id.clone(),
                name: skill.name.clone(),
                description: locale.text("Available from platform").to_owned(),
                version: skill.version.clone(),
                synchronized: connection.synchronized_skills.contains_key(&skill.id),
            })
            .collect::<Vec<_>>();
        let theme = cx.theme().clone();
        let banner = self.page_banner(
            &theme,
            "Skills",
            Some(SharedString::from(format!(
                "{} {}",
                skills.len(),
                locale.text("Skills")
            ))),
            "connector.skills.refresh",
            cx,
        );
        if skills.is_empty() {
            return page_column(
                &theme,
                [
                    banner,
                    self.render_catalog_empty(
                        "connector.skills",
                        locale.text("No Skills were provisioned."),
                    ),
                ],
            );
        }
        page_column(
            &theme,
            [
                banner,
                StatusLine::new(
                    locale.text("Enable each Skill on the Agent page, then apply that Agent."),
                    Tone::Info,
                )
                .id("connector.skills.hint")
                .into_any_element(),
                Card::new()
                    .id("connector.skills.list")
                    .variant(CardVariant::Elevated)
                    .divided(true)
                    .children(
                        skills
                            .iter()
                            .map(|skill| skill_row(&theme, locale, skill))
                            .collect::<Vec<_>>(),
                    )
                    .into_any_element(),
            ],
        )
    }
}

struct SkillRow {
    id: String,
    name: String,
    description: String,
    version: String,
    synchronized: bool,
}

fn skill_row(theme: &Theme, locale: Locale, skill: &SkillRow) -> ListRow {
    let origin = skill.version.as_str();
    let (status, tone) = if skill.synchronized {
        (locale.text("Synced"), Tone::Success)
    } else {
        (locale.text("Pending"), Tone::Warning)
    };
    ListRow::new()
        .id(format!("connector.skills.{}", skill.id))
        .leading(StatusDot::new(tone))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .column()
                .child(
                    text(theme, TypeScale::Label, skill.name.clone())
                        .w_full()
                        .min_w_0()
                        .truncate(),
                )
                .child(
                    text(theme, TypeScale::Caption, skill.description.clone())
                        .w_full()
                        .min_w_0()
                        .line_clamp(2)
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
                    format!("connector.skills.{}.origin", skill.id),
                    origin.to_owned(),
                ))
                .child(
                    Badge::new(status)
                        .tone(tone)
                        .id(format!("connector.skills.{}.state", skill.id)),
                ),
        )
}
