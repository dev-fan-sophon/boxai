use gateway_connector_backend::NotInstalledReason;
use gpui::{Context, InteractiveElement, IntoElement, ParentElement, Styled, div, px};
use gpui_kit::foundation::text;
use gpui_kit::prelude::*;
use gpui_kit_theme::{Space, TypeScale};

use crate::{AppState, app::Action};

use super::controls::brand_mark;
use super::host::{ConnectorHost, SignInFailure};
use crate::preferences::Locale;

/// Names the failure and the one thing that fixes it.
///
/// A single "sign-in failed" would be true of all three and useful for none:
/// a machine with no browser, a callback the browser could not reach, and an
/// account that declined need different actions from the person reading it.
fn sign_in_failure_text(locale: Locale, failure: SignInFailure) -> &'static str {
    match failure {
        SignInFailure::BrowserUnavailable => locale.text(
            "No browser could be opened. Set a default browser, then sign in again — the link is shown here so it can be opened by hand.",
        ),
        SignInFailure::CallbackNeverArrived => locale.text(
            "The browser never returned to this app. That is almost always a proxy or security tool that intercepts 127.0.0.1: switch the proxy to rule mode or exempt 127.0.0.1, allow this program to accept local connections, then sign in again.",
        ),
        SignInFailure::Declined => {
            locale.text("Sign-in was declined in the browser. Nothing was saved.")
        }
    }
}

impl ConnectorHost {
    pub(crate) fn render_signed_out(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let theme = cx.theme().clone();
        let connecting = matches!(self.state, AppState::Connecting);
        let error = match &self.state {
            AppState::Failed(error) => Some(error.as_str()),
            AppState::BrowserLogin(_) => self.action_error.as_deref(),
            _ => None,
        };
        let body = if self.distribution.allow_custom_urls {
            if matches!(self.state, AppState::BrowserLogin(_)) {
                self.render_browser_login(cx)
            } else {
                self.render_custom_connect(connecting, cx)
            }
        } else {
            self.render_browser_sign_in(connecting, cx)
        };
        let mut stage = div()
            .id("connector.sign-in")
            .w_full()
            .max_w(px(360.0))
            .column()
            .items_center()
            .gap_token(&theme, Space::Lg)
            .child(text(
                &theme,
                TypeScale::Title,
                self.distribution.product_name.to_owned(),
            ))
            .child(body);
        if let Some(error) = error {
            stage = stage.child(FailurePanel::new(
                "connector.sign-in.failure",
                error.to_owned(),
            ));
        }
        stage.into_any_element()
    }

    /// The install step. It is the first thing a downloaded copy shows,
    /// before any account exists, because everything the app saves afterwards
    /// depends on it running from a place that survives.
    pub(crate) fn render_not_installed(
        &self,
        invitation: &crate::InstallInvitation,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let theme = cx.theme().clone();
        let locale = self.preferences.locale;
        let temporary = matches!(invitation.reason, NotInstalledReason::TemporaryCopy);
        let mut card = Card::new()
            .id("connector.not-installed.card")
            .header(CardHeader::new(if invitation.replaces_existing {
                locale.text("Update the installed copy")
            } else {
                locale.text("Install BoxAI Connect")
            }))
            .padded(true)
            .child(
                Callout::new(
                    if temporary {
                        locale.text("This copy is running from the temporary folder a file manager uses to preview an archive. That folder is deleted without warning, so a sign-in saved here does not survive. Install it first.")
                    } else if invitation.replaces_existing {
                        locale.text("An earlier version is already installed. Installing replaces it in place and keeps your account, so the copy you just downloaded can be deleted afterwards.")
                    } else {
                        locale.text("Installing copies the program into your own program folder and adds it to the Start menu, so it keeps working after this download is cleaned up. Your account and settings stay where they are.")
                    },
                    if temporary { Tone::Danger } else { Tone::Info },
                )
                .id("connector.not-installed.reason"),
            )
            .child(
                DescriptionList::new("connector.not-installed.detail")
                    .item(DescriptionItem::new(
                        "connector.not-installed.path",
                        locale.text("Current location"),
                        invitation.current.display().to_string(),
                    ))
                    .item(DescriptionItem::new(
                        "connector.not-installed.target",
                        locale.text("Install location"),
                        invitation.target.display().to_string(),
                    )),
            );
        if let Some(error) = &invitation.error {
            card = card.child(FailurePanel::new(
                "connector.not-installed.failure",
                error.clone(),
            ));
        }

        let shortcut_view = cx.entity().downgrade();
        let desktop_shortcut = invitation.desktop_shortcut;
        card = card.child(
            Checkbox::new("connector.not-installed.desktop-shortcut")
                .label(locale.text("Add a desktop shortcut"))
                .checked(desktop_shortcut)
                .disabled(invitation.busy)
                .on_change(move |checked, _window, cx| {
                    let _ = shortcut_view.update(cx, |this, cx| {
                        this.dispatch(Action::SetInstallDesktopShortcut(checked), cx)
                    });
                }),
        );

        let install_view = cx.entity().downgrade();
        let mut install = Button::new("connector.not-installed.install")
            .label(if invitation.replaces_existing {
                locale.text("Update and restart")
            } else {
                locale.text("Install and start")
            })
            .primary()
            .on_click(move |_window, cx| {
                let _ =
                    install_view.update(cx, |this, cx| this.dispatch(Action::InstallPackage, cx));
            });
        if invitation.busy {
            install = install.loading(true);
        }
        card = card.child(install);

        div()
            .id("connector.not-installed")
            .w_full()
            .max_w(px(460.0))
            .column()
            .items_center()
            .gap_token(&theme, Space::Lg)
            .child(text(
                &theme,
                TypeScale::Title,
                self.distribution.product_name.to_owned(),
            ))
            .child(card)
            .into_any_element()
    }

    fn render_custom_connect(&self, connecting: bool, cx: &mut Context<Self>) -> gpui::AnyElement {
        let locale = self.preferences.locale;
        let this = cx.entity().downgrade();
        let section = SettingsSection::new(
            "connector.first-run.settings",
            locale.text("Connect a Gateway"),
        )
        .row(
            SettingsRow::new("connector.gateway-url.row", locale.text("Gateway base URL"))
                .control(self.gateway_url.clone()),
        )
        .row(
            SettingsRow::new("connector.api-key.row", locale.text("API key"))
                .control(self.api_key.clone()),
        )
        .action(move |_window, _cx| {
            let this = this.clone();
            Button::new("connector.connect")
                .label(if connecting {
                    locale.text("Testing…")
                } else {
                    locale.text("Connect")
                })
                .primary()
                .loading(connecting)
                .on_click(move |_window, cx| {
                    let _ = this.update(cx, |this, cx| this.dispatch(Action::Connect, cx));
                })
                .into_any_element()
        });
        let mut card = Card::new()
            .id("connector.first-run.card")
            .padded(true)
            .child(section);
        if connecting {
            card = card.child(
                ProgressBar::new("connector.connect.progress")
                    .label(locale.text("Testing connection")),
            );
        }
        card.into_any_element()
    }

    fn render_browser_sign_in(&self, connecting: bool, cx: &mut Context<Self>) -> gpui::AnyElement {
        let locale = self.preferences.locale;
        let this = cx.entity().downgrade();
        let mut card = Card::new()
            .id("connector.sign-in.card")
            .header(CardHeader::new(self.distribution.product_name.to_owned()))
            .padded(true);
        if let Some(identity) = self.distribution.asset_identity {
            card = card.child(brand_mark(
                "connector.sign-in.mark",
                identity.icon_path,
                96.0,
            ));
        }
        card = card
            .child(
                Callout::new(
                    locale.text("BoxAI Connect needs an account. Sign-in is confirmed in the browser; the account stays in this app's local config directory."),
                    Tone::Neutral,
                )
                .id("connector.sign-in.boundary"),
            )
            .child(
                Button::new("connector.sign-in")
                    .label(if connecting {
                        locale.text("Waiting…")
                    } else {
                        locale.text("Sign in")
                    })
                    .primary()
                    .full_width(true)
                    .loading(connecting)
                    .on_click(move |_window, cx| {
                        let _ = this.update(cx, |this, cx| this.dispatch(Action::SignIn, cx));
                    }),
            );
        if let Some(failure) = self.sign_in_failure {
            card = card.child(
                Callout::new(sign_in_failure_text(locale, failure), Tone::Danger)
                    .id("connector.sign-in.failure-reason"),
            );
        }
        if connecting {
            card = card
                .child(
                    StatusLine::new(locale.text("Complete sign-in in your browser"), Tone::Info)
                        .id("connector.sign-in.waiting")
                        .busy("connector.sign-in.wait"),
                )
                .child(PulseLoader::new("connector.sign-in.pulse"));
            if let Some(invitation) = &self.sign_in_invitation {
                card = card.child(self.render_sign_in_invitation(invitation, cx));
            }
        }
        card.into_any_element()
    }

    /// The authorization link, shown while the browser half is outstanding.
    ///
    /// A browser that never opened, and a browser that opened onto a page the
    /// person cannot finish, both end here with something they can act on: the
    /// exact URL, copyable into any other browser on the machine, which reaches
    /// the same loopback callback this window is still listening on.
    fn render_sign_in_invitation(
        &self,
        invitation: &crate::sign_in_progress::SignInInvitation,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let theme = cx.theme().clone();
        let locale = self.preferences.locale;
        let url = invitation.authorization_url.clone();
        let copied = url.clone();
        div()
            .id("connector.sign-in.invitation")
            .w_full()
            .column()
            .gap_token(&theme, Space::Sm)
            .child(
                Callout::new(
                    if invitation.browser_opened {
                        locale.text(
                            "If the browser did not come up, open this link yourself. It stays valid while this window waits.",
                        )
                    } else {
                        locale.text(
                            "No browser could be opened on this machine. Copy the link below and open it in any browser.",
                        )
                    },
                    if invitation.browser_opened {
                        Tone::Neutral
                    } else {
                        Tone::Warning
                    },
                )
                .id("connector.sign-in.invitation-reason"),
            )
            .child(
                text(&theme, TypeScale::Caption, url).id("connector.sign-in.invitation-url"),
            )
            .child(
                Button::new("connector.sign-in.copy-link")
                    .label(locale.text("Copy the sign-in link"))
                    .secondary()
                    .full_width(true)
                    .on_click(move |_window, cx| super::chrome::copy_text(cx, copied.clone())),
            )
            .into_any_element()
    }

    fn render_browser_login(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let AppState::BrowserLogin(offer) = &self.state else {
            return self.render_browser_sign_in(false, cx);
        };
        let locale = self.preferences.locale;
        let continue_view = cx.entity().downgrade();
        let back_view = cx.entity().downgrade();
        Card::new()
            .id("connector.browser-login.card")
            .header(CardHeader::new(locale.text("Browser login available")))
            .padded(true)
            .child(
                StatusLine::new(locale.text("Browser login available"), Tone::Info)
                    .id("connector.browser-login.status"),
            )
            .child(
                DescriptionList::new("connector.browser-login.summary")
                    .item(DescriptionItem::new(
                        "connector.browser-login.platform",
                        locale.text("Platform"),
                        offer.manifest.platform.name.clone(),
                    ))
                    .item(DescriptionItem::new(
                        "connector.browser-login.gateway",
                        locale.text("Gateway"),
                        offer.request.base_url.clone(),
                    ))
                    .item(DescriptionItem::new(
                        "connector.browser-login.security",
                        locale.text("Security"),
                        "S256 PKCE",
                    )),
            )
            .child(
                ButtonGroup::new("connector.browser-login.actions")
                    .child(
                        Button::new("connector.browser-login.continue")
                            .label(locale.text("Continue"))
                            .primary()
                            .on_click(move |_window, cx| {
                                let _ = continue_view.update(cx, |this, cx| {
                                    this.dispatch(Action::ContinueBrowserLogin, cx)
                                });
                            }),
                    )
                    .child(
                        Button::new("connector.browser-login.back")
                            .label(locale.text("Back"))
                            .secondary()
                            .on_click(move |_window, cx| {
                                let _ = back_view.update(cx, |this, cx| {
                                    this.dispatch(Action::BackToFirstRun, cx)
                                });
                            }),
                    ),
            )
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Three failures, three answers. Whatever the wording becomes, a person who
    /// hits one of these must not be handed the advice for another.
    #[test]
    fn each_sign_in_failure_names_its_own_remedy() {
        for locale in [Locale::Vi, Locale::En, Locale::ZhCn] {
            let browser = sign_in_failure_text(locale, SignInFailure::BrowserUnavailable);
            let callback = sign_in_failure_text(locale, SignInFailure::CallbackNeverArrived);
            let declined = sign_in_failure_text(locale, SignInFailure::Declined);
            assert!(!browser.is_empty() && !callback.is_empty() && !declined.is_empty());
            assert_ne!(browser, callback, "{locale:?}");
            assert_ne!(callback, declined, "{locale:?}");
            assert_ne!(browser, declined, "{locale:?}");
            // The one failure nobody can guess the cause of names the thing that
            // actually intercepts it.
            assert!(callback.contains("127.0.0.1"), "{locale:?}: {callback}");
        }
    }

    #[test]
    fn the_chinese_build_does_not_fall_back_to_english_for_sign_in_failures() {
        for failure in [
            SignInFailure::BrowserUnavailable,
            SignInFailure::CallbackNeverArrived,
            SignInFailure::Declined,
        ] {
            assert_ne!(
                sign_in_failure_text(Locale::ZhCn, failure),
                sign_in_failure_text(Locale::En, failure),
                "{failure:?}",
            );
        }
    }
}
