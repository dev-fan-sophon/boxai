use std::collections::BTreeSet;
use std::rc::Rc;

use gpui::prelude::FluentBuilder;
use gpui::{Context, IntoElement, ParentElement, SharedString, Styled, div, px};
use gpui_kit::foundation::text;
use gpui_kit::prelude::*;
use gpui_kit_theme::{Space, Theme, TypeScale};

use crate::preferences::Locale;
use crate::{AppState, ModelKind, app::Action};

use super::chrome::{grouped_number, page_column};
use super::host::ConnectorHost;
use super::vendor_icons::vendor_icon_path;

impl ConnectorHost {
    pub(crate) fn render_model_catalog(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let AppState::Connected { connection, .. } = &self.state else {
            unreachable!("model catalog requires connected state")
        };
        let locale = self.preferences.locale;
        let theme = cx.theme().clone();
        let query = self.model_query.trim();
        let vendors = self.available_model_vendors();
        let plaza = connection
            .provisioning
            .as_ref()
            .and_then(|value| value.model_plaza.as_ref());
        let kinds = if plaza.is_some() {
            ModelKind::PLAZA.as_slice()
        } else {
            ModelKind::DIRECT.as_slice()
        };
        let (title, catalog_total) = match plaza {
            Some(plaza) => ("Model Plaza", plaza.models.len()),
            None => ("Models", connection.models.len()),
        };
        let rows = Rc::new(if plaza.is_some() {
            self.plaza_models(locale)
        } else {
            self.gateway_models(locale)
        });
        let unfiltered =
            query.is_empty() && self.model_kinds.is_empty() && self.model_vendors.is_empty();
        let catalog = if rows.is_empty() {
            EmptyState::new(
                if unfiltered {
                    "connector.models.empty"
                } else {
                    "connector.model-plaza.empty"
                },
                locale.text(if unfiltered {
                    "The Gateway currently offers no models."
                } else {
                    "No models match this search."
                }),
            )
            .kind(EmptyKind::Empty)
            .into_any_element()
        } else {
            let count = rows.len();
            let row_theme = theme.clone();
            // The list is virtualized, so the page shows every match rather
            // than a silent prefix of them.
            List::new(
                "connector.models.list",
                count,
                move |index, _window, _cx| {
                    let model = &rows[index];
                    ListItem::new(
                        model.row_id.clone(),
                        model_row(&row_theme, locale, model, MODEL_ROW_HEIGHT),
                    )
                    .text(model.name.clone())
                },
            )
            .row_height(MODEL_ROW_HEIGHT)
            .visible_rows(count.clamp(1, 10))
            .into_any_element()
        };
        page_column(
            &theme,
            [
                self.page_banner(
                    &theme,
                    title,
                    Some(SharedString::from(format!(
                        "{} {}",
                        grouped_number(catalog_total as f64),
                        locale.text("models")
                    ))),
                    "connector.models.refresh",
                    cx,
                ),
                self.model_filters(locale, &theme, kinds, &vendors, cx),
                catalog,
            ],
        )
    }

    fn model_filters(
        &self,
        locale: Locale,
        theme: &Theme,
        kinds: &[ModelKind],
        vendors: &[String],
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let kind_view = cx.entity().downgrade();
        let vendor_view = cx.entity().downgrade();
        let clear_view = cx.entity().downgrade();
        let remove_view = cx.entity().downgrade();
        let kind_ids = self
            .model_kinds
            .iter()
            .map(|kind| kind.id().to_owned())
            .collect::<Vec<_>>();
        let vendor_ids = self.model_vendors.iter().cloned().collect::<Vec<_>>();
        let mut conditions = Vec::new();
        for kind in &self.model_kinds {
            conditions.push(FilterCondition::new(
                format!("kind.{}", kind.id()),
                locale.text("Type"),
                locale.text("is"),
                locale.text(kind.label()),
            ));
        }
        for vendor in &self.model_vendors {
            conditions.push(FilterCondition::new(
                format!("vendor.{vendor}"),
                locale.text("Vendor"),
                locale.text("is"),
                vendor.clone(),
            ));
        }
        if !self.model_query.trim().is_empty() {
            conditions.push(FilterCondition::new(
                "query",
                locale.text("Search model catalog"),
                locale.text("is"),
                self.model_query.trim().to_owned(),
            ));
        }
        let count = ResultCount::Known(self.filtered_model_count());
        div()
            .w_full()
            .column()
            .gap_token(theme, Space::Sm)
            .child(
                div()
                    .w_full()
                    .flex()
                    .flex_row()
                    .flex_wrap()
                    .items_end()
                    .gap_token(theme, Space::Md)
                    .child(
                        div()
                            .flex_1()
                            .min_w(px(220.0))
                            .child(self.model_search.clone()),
                    )
                    .child(
                        ToggleGroup::new("connector.models.kinds")
                            .label(locale.text("Type"))
                            .variant(ButtonVariant::Secondary)
                            .control_size(ControlSize::Sm)
                            .selection(ToggleSelection::Any)
                            .items(
                                kinds.iter().map(|kind| {
                                    ToggleItem::new(kind.id(), locale.text(kind.label()))
                                }),
                            )
                            .pressed_ids(&kind_ids)
                            .on_change(move |pressed, _, _, cx| {
                                let kinds = pressed
                                    .into_iter()
                                    .filter_map(|id| ModelKind::from_id(id.as_ref()))
                                    .collect();
                                let _ = kind_view.update(cx, |this, cx| {
                                    this.dispatch(Action::SetModelKinds(kinds), cx)
                                });
                            }),
                    ),
            )
            .when(!vendors.is_empty(), |element| {
                element.child(
                    ToggleGroup::new("connector.models.vendors")
                        .label(locale.text("Vendor"))
                        .variant(ButtonVariant::Secondary)
                        .control_size(ControlSize::Sm)
                        .selection(ToggleSelection::Any)
                        .items(
                            vendors
                                .iter()
                                .map(|vendor| ToggleItem::new(vendor.clone(), vendor.clone())),
                        )
                        .pressed_ids(&vendor_ids)
                        .on_change(move |pressed, _, _, cx| {
                            let vendors = pressed
                                .into_iter()
                                .map(|id| id.to_string())
                                .collect::<BTreeSet<_>>();
                            let _ = vendor_view.update(cx, |this, cx| {
                                this.dispatch(Action::SetModelVendors(vendors), cx)
                            });
                        }),
                )
            })
            .child(
                FilterBar::new("connector.models.filters")
                    .conditions(conditions)
                    .count(count)
                    .noun(locale.text("models"))
                    .clear_label(locale.text("Clear"))
                    .on_remove(move |id, _, cx| {
                        let id = id.to_string();
                        let _ = remove_view.update(cx, |this, cx| {
                            this.remove_model_filter(&id, cx);
                        });
                    })
                    .on_clear(move |_, cx| {
                        let _ = clear_view
                            .update(cx, |this, cx| this.dispatch(Action::ClearModelFilters, cx));
                    }),
            )
            .into_any_element()
    }

    fn remove_model_filter(&mut self, id: &str, cx: &mut Context<Self>) {
        if let Some(kind_id) = id.strip_prefix("kind.") {
            self.model_kinds.retain(|kind| kind.id() != kind_id);
            self.sync_model_filters(cx);
            return;
        }
        if let Some(vendor) = id.strip_prefix("vendor.") {
            self.model_vendors.remove(vendor);
            self.sync_model_filters(cx);
            return;
        }
        if id == "query" {
            self.model_query.clear();
            self.model_search.update(cx, |search, cx| {
                search.set_value("", cx);
            });
            self.sync_model_filters(cx);
        }
    }

    fn filtered_model_count(&self) -> usize {
        let AppState::Connected { connection, .. } = &self.state else {
            return 0;
        };
        self.filtered_plaza_count(connection)
    }

    fn plaza_models(&self, locale: Locale) -> Vec<CatalogModel> {
        let AppState::Connected { connection, .. } = &self.state else {
            unreachable!("Model Plaza requires connected state")
        };
        let plaza = connection
            .provisioning
            .as_ref()
            .and_then(|value| value.model_plaza.as_ref())
            .expect("Model Plaza page is conditional");
        plaza
            .models
            .iter()
            .filter(|model| self.plaza_model_visible(model))
            .map(|model| CatalogModel {
                row_id: format!("connector.model-plaza.{}", model.id),
                name: model.id.clone(),
                vendor: model
                    .vendor
                    .as_ref()
                    .map(|value| value.name.as_str())
                    .unwrap_or_else(|| locale.text("Provider"))
                    .to_owned(),
                icon: model
                    .vendor
                    .as_ref()
                    .and_then(|value| value.icon.clone())
                    .or_else(|| model.icon.clone())
                    .or_else(|| model.vendor.as_ref().map(|value| value.name.clone())),
                description: model.description.clone(),
                tags: model.tags.clone(),
            })
            .collect()
    }

    fn gateway_models(&self, locale: Locale) -> Vec<CatalogModel> {
        let AppState::Connected { connection, .. } = &self.state else {
            unreachable!("model catalog requires connected state")
        };
        connection
            .models
            .iter()
            .filter(|model| self.descriptor_visible(model))
            .map(|model| CatalogModel {
                row_id: format!("connector.account.model.{}", model.id),
                name: model.id.clone(),
                vendor: model
                    .owned_by
                    .clone()
                    .unwrap_or_else(|| locale.text("Provider").to_owned()),
                icon: model.owned_by.clone(),
                description: None,
                tags: Vec::new(),
            })
            .collect()
    }
}

/// Every list row is this tall; uniform height is what lets the list skip the
/// rows it does not show.
const MODEL_ROW_HEIGHT: f32 = 72.0;

struct CatalogModel {
    row_id: String,
    name: String,
    vendor: String,
    icon: Option<String>,
    description: Option<String>,
    tags: Vec<String>,
}

fn vendor_mark(icon: Option<&str>) -> gpui::AnyElement {
    if let Some(path) = icon.and_then(vendor_icon_path) {
        gpui::img(path).size(px(28.0)).into_any_element()
    } else {
        Icon::new(gpui_kit::assets::Icon::Widget)
            .large()
            .muted()
            .into_any_element()
    }
}

fn model_row(theme: &Theme, locale: Locale, model: &CatalogModel, height: f32) -> gpui::AnyElement {
    let description = model
        .description
        .as_deref()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| locale.text("No description."));
    div()
        .w_full()
        .h(px(height))
        .flex()
        .flex_row()
        .items_center()
        .gap_token(theme, Space::Md)
        .child(vendor_mark(model.icon.as_deref()))
        .child(
            div()
                .flex_1()
                .min_w(px(0.0))
                .column()
                .gap_token(theme, Space::Xs)
                .child(
                    text(theme, TypeScale::Strong, model.name.clone())
                        .w_full()
                        .min_w(px(0.0))
                        .truncate(),
                )
                .child(
                    text(theme, TypeScale::Caption, description.to_owned())
                        .w_full()
                        .min_w(px(0.0))
                        .truncate()
                        .text_color(theme.colors.text_muted),
                ),
        )
        .child(
            div()
                .flex_none()
                .flex()
                .flex_row()
                .items_center()
                .gap_token(theme, Space::Sm)
                .children(model.tags.iter().take(2).enumerate().map(|(index, tag)| {
                    Tag::new(format!("{}.tag.{index}", model.row_id), tag.clone())
                }))
                .child(
                    text(theme, TypeScale::Caption, model.vendor.clone())
                        .text_color(theme.colors.text_muted),
                ),
        )
        .into_any_element()
}
