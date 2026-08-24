use std::collections::BTreeMap;

use gpui::{App, Context, IntoElement, ParentElement, SharedString, Window};
use gpui_kit::prelude::*;

use crate::AppState;

use super::chrome::{
    compact_of_total, copy_text, format_unix_utc_locale, page_column, responsive_grid,
};
use super::host::ConnectorHost;

impl ConnectorHost {
    pub(crate) fn render_account_hub(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let AppState::Connected { .. } = &self.state else {
            unreachable!("account hub requires connected state")
        };
        let theme = cx.theme().clone();
        let locale = self.preferences.locale;
        let account = self.provisioned_account();
        let subtitle = account
            .map(|account| SharedString::from(account.username.clone()))
            .unwrap_or_else(|| SharedString::from(locale.text("Direct connection")));
        let mut cards = vec![
            self.page_banner(
                &theme,
                "Account",
                Some(subtitle),
                "connector.account.refresh",
                cx,
            ),
            self.render_account_details(cx),
        ];
        if self.provisioning().is_none() {
            cards.push(
                EmptyState::new(
                    "connector.account.unavailable",
                    locale.text("Overview data is unavailable for direct connections."),
                )
                .kind(EmptyKind::Unavailable)
                .into_any_element(),
            );
            return page_column(&theme, cards);
        }
        cards.push(responsive_grid(
            "connector.usage",
            theme.clone(),
            200.0,
            self.usage_metric_cards("connector.usage", false),
        ));
        match self.provisioned_billing() {
            Some(billing) if !billing.subscriptions.is_empty() => cards.push(responsive_grid(
                "connector.account.plans",
                theme.clone(),
                320.0,
                billing
                    .subscriptions
                    .iter()
                    .map(|subscription| subscription_card(locale, subscription))
                    .collect(),
            )),
            _ => cards.push(
                Card::new()
                    .id("connector.account.plans.empty")
                    .header(CardHeader::new(locale.text("Subscriptions")))
                    .padded(true)
                    .child(
                        EmptyState::new(
                            "connector.account.plans.empty.state",
                            locale.text("No active subscriptions."),
                        )
                        .kind(EmptyKind::Empty),
                    )
                    .into_any_element(),
            ),
        }
        page_column(&theme, cards)
    }

    fn render_account_details(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let AppState::Connected { connection, .. } = &self.state else {
            unreachable!("account details require connected state")
        };
        let locale = self.preferences.locale;
        let sign_out_view = cx.entity().downgrade();
        let account = self.provisioned_account();
        let portal = self
            .provisioned_billing()
            .map(|billing| billing.portal_url.to_string());
        let gateway = connection.profile.base_url.to_string();
        let mut copies = BTreeMap::new();
        copies.insert("gateway".to_owned(), gateway.clone());
        let mut items =
            vec![DescriptionItem::new("gateway", locale.text("Gateway"), gateway).copyable(true)];
        if let Some(portal) = portal {
            copies.insert("portal".to_owned(), portal.clone());
            items
                .push(DescriptionItem::new("portal", locale.text("Portal"), portal).copyable(true));
        }
        if let Some(account) = account {
            copies.insert("username".to_owned(), account.username.clone());
            items.push(
                DescriptionItem::new(
                    "username",
                    locale.text("Username"),
                    account.username.clone(),
                )
                .copyable(true),
            );
            if !account.display_name.trim().is_empty() {
                copies.insert("display-name".to_owned(), account.display_name.clone());
                items.push(
                    DescriptionItem::new(
                        "display-name",
                        locale.text("Display name"),
                        account.display_name.clone(),
                    )
                    .copyable(true),
                );
            }
            if !account.email.trim().is_empty() {
                copies.insert("email".to_owned(), account.email.clone());
                items.push(
                    DescriptionItem::new("email", locale.text("Email"), account.email.clone())
                        .copyable(true),
                );
            }
            if !account.group.trim().is_empty() {
                copies.insert("group".to_owned(), account.group.clone());
                items.push(
                    DescriptionItem::new("group", locale.text("Group"), account.group.clone())
                        .copyable(true),
                );
            }
        }
        let sign_out_label = locale.text("Sign out");
        let busy = self.projection_busy || self.save_in_flight;
        Card::new()
            .id("connector.account.details")
            .header(
                CardHeader::new(locale.text("Identity and connection")).action(
                    move |_window: &mut Window, _cx: &mut App| {
                        let sign_out_view = sign_out_view.clone();
                        let mut button = Button::new("connector.account.sign-out")
                            .label(sign_out_label)
                            .danger()
                            .control_size(ControlSize::Sm);
                        if busy {
                            button = button.disabled(true);
                        } else {
                            button = button.on_click(move |window, cx| {
                                let _ = sign_out_view
                                    .update(cx, |this, cx| this.request_sign_out(window, cx));
                            });
                        }
                        button.into_any_element()
                    },
                ),
            )
            .padded(true)
            .child(
                DescriptionList::new("connector.account.facts")
                    .columns(2)
                    .items(items)
                    .on_copy(move |id, _window, cx| {
                        if let Some(value) = copies.get(id.as_ref()) {
                            copy_text(cx, value.clone());
                        }
                    }),
            )
            .into_any_element()
    }
}

fn subscription_card(
    locale: crate::preferences::Locale,
    subscription: &gateway_connector_core::SubscriptionSnapshot,
) -> gpui::AnyElement {
    let title = if subscription.plan_title.trim().is_empty() {
        format!("{} {}", locale.text("Plan"), subscription.plan_id)
    } else {
        subscription.plan_title.clone()
    };
    let mut header = CardHeader::new(title).subtitle(subscription.status.clone());
    if subscription.unlimited {
        header = header.action(move |_, _| {
            Badge::new(locale.text("Unlimited"))
                .accent()
                .into_any_element()
        });
    }
    let mut card = Card::new()
        .id(format!("connector.subscription.{}", subscription.id))
        .header(header)
        .padded(true);
    // A period allowance is a fraction of something; the wallet is not, which
    // is why only this readout gets a bar.
    if !subscription.unlimited && subscription.quota_total > 0 {
        card = card.child(
            ProgressBar::new(format!("connector.subscription.{}.bar", subscription.id))
                .label(locale.text("Current period"))
                .fraction(
                    (subscription.quota_used_current_period as f32
                        / subscription.quota_total as f32)
                        .clamp(0.0, 1.0),
                )
                .display(compact_of_total(
                    locale,
                    subscription.quota_used_current_period,
                    subscription.quota_total,
                )),
        );
    }
    card.child(
        DescriptionList::new(format!("connector.subscription.{}.dates", subscription.id))
            .columns(2)
            .item(DescriptionItem::new(
                format!("connector.subscription.{}.start", subscription.id),
                locale.text("Period start"),
                format_unix_utc_locale(locale, subscription.current_period_start),
            ))
            .item(DescriptionItem::new(
                format!("connector.subscription.{}.end", subscription.id),
                locale.text("Period end"),
                format_unix_utc_locale(locale, subscription.end_time),
            ))
            .item(DescriptionItem::new(
                format!("connector.subscription.{}.reset", subscription.id),
                locale.text("Next reset"),
                format_unix_utc_locale(locale, subscription.next_reset_time),
            ))
            .item(DescriptionItem::new(
                format!("connector.subscription.{}.fallback", subscription.id),
                locale.text("Wallet fallback"),
                locale.text(if subscription.wallet_fallback {
                    "Yes"
                } else {
                    "No"
                }),
            ))
            .item(DescriptionItem::new(
                format!("connector.subscription.{}.quota", subscription.id),
                locale.text("Current period"),
                if subscription.unlimited {
                    locale.text("Unlimited").to_owned()
                } else {
                    compact_of_total(
                        locale,
                        subscription.quota_used_current_period,
                        subscription.quota_total,
                    )
                },
            )),
    )
    .into_any_element()
}
