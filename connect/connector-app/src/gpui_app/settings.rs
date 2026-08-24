use gateway_connector_backend::packaged_install;
use gpui::{Context, IntoElement};
use gpui_kit::prelude::*;

use crate::{AsyncStatus, ProjectionSemantic};

use super::chrome::page_column;
use super::controls::brand_mark;
use super::host::ConnectorHost;
use crate::app::Action;

impl ConnectorHost {
    pub(crate) fn render_settings(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let locale = self.preferences.locale;
        let theme = cx.theme().clone();
        let disconnect_view = cx.entity().downgrade();
        let disconnect_semantic = self.disconnect_semantic();
        let mut disconnect = Button::new("connector.disconnect").label(locale.text(
            if disconnect_semantic == Some(ProjectionSemantic::Disconnecting) {
                "Disconnecting…"
            } else {
                "Disconnect"
            },
        ));
        if self.projection_busy || self.save_in_flight {
            disconnect = disconnect.danger().disabled(true);
        } else {
            disconnect = disconnect.danger().on_click(move |window, cx| {
                let _ = disconnect_view.update(cx, |this, cx| this.request_disconnect(window, cx));
            });
        }
        let quit = Button::new("connector.quit")
            .label(locale.text("Quit application"))
            .secondary()
            .on_click(|_window, cx| cx.quit());
        let preferences =
            SettingsSection::new("connector.settings.preferences", locale.text("Settings"))
                .row(
                    SettingsRow::new("connector.settings.language", locale.text("Language"))
                        .search_terms(
                            crate::preferences::Locale::ALL.map(|value| value.display_name()),
                        )
                        .control(self.language_select.clone()),
                )
                .row(
                    SettingsRow::new("connector.settings.theme", locale.text("Theme"))
                        .search_terms(
                            crate::preferences::ThemePreference::ALL
                                .map(|value| value.display_name(locale)),
                        )
                        .control(self.theme_select.clone()),
                )
                .row(
                    SettingsRow::new("connector.settings.density", locale.text("Density"))
                        .search_terms(
                            crate::preferences::DensityPreference::ALL
                                .map(|value| value.display_name(locale)),
                        )
                        .control(self.density_select.clone()),
                );
        let connection =
            SettingsSection::new("connector.security.title", locale.text("Connection")).row(
                SettingsRow::new(
                    "connector.disconnect.row",
                    locale.text("Managed Agent configuration"),
                )
                .search_terms([locale.text("Disconnect")])
                .control(disconnect),
            );
        let application = SettingsSection::new("connector.application", locale.text("Application"))
            .row(
                SettingsRow::new(
                    "connector.application.quit.row",
                    self.distribution.product_name,
                )
                .search_terms([locale.text("Quit application")])
                .control(quit),
            );
        let settings = SettingsList::new("connector.settings.list")
            .query(self.settings_query.clone())
            .sections([self.render_about(cx), preferences, connection, application]);
        let mut children = vec![self.settings_search.clone().into_any_element()];
        if let Some(semantic) = disconnect_semantic {
            children.push(
                Callout::new(
                    locale.text(semantic.message()),
                    if semantic == ProjectionSemantic::DisconnectFailed {
                        Tone::Danger
                    } else {
                        Tone::Info
                    },
                )
                .id("connector.settings.disconnect-status")
                .into_any_element(),
            );
        }
        children.push(settings.into_any_element());
        page_column(&theme, children)
    }

    fn render_about(&self, cx: &mut Context<Self>) -> SettingsSection {
        let locale = self.preferences.locale;
        let version = env!("CARGO_PKG_VERSION");
        let check_view = cx.entity().downgrade();
        let download_view = cx.entity().downgrade();
        let auto_view = cx.entity().downgrade();
        let install_view = cx.entity().downgrade();
        let checking = matches!(
            self.update_check.status,
            AsyncStatus::Loading | AsyncStatus::Refreshing
        );
        let mut check = Button::new("connector.update.check")
            .label(locale.text(if checking {
                "Checking…"
            } else {
                "Check for updates"
            }))
            .secondary();
        if checking {
            check = check.disabled(true).loading(true);
        } else {
            check = check.on_click(move |_window, cx| {
                let _ = check_view.update(cx, |this, cx| this.dispatch(Action::CheckUpdates, cx));
            });
        }
        let mut download = Button::new("connector.update.download")
            .label(locale.text("Open download page"))
            .secondary();
        if self
            .distribution
            .release_metadata
            .and_then(|value| value.download_url)
            .is_some()
        {
            download = download.on_click(move |_window, cx| {
                let _ = download_view
                    .update(cx, |this, cx| this.dispatch(Action::OpenDownloadPage, cx));
            });
        } else {
            download = download.disabled(true);
        }
        let auto_check = self.preferences.auto_check_updates;
        let auto = Switch::new("connector.update.auto")
            .named(locale.text("Check for updates automatically"))
            .on(auto_check)
            .on_change(move |on, _window, cx| {
                let _ = auto_view.update(cx, |this, cx| {
                    this.dispatch(Action::SetAutoCheckUpdates(on), cx)
                });
            });
        let can_install = self
            .update_check
            .value
            .as_ref()
            .is_some_and(|value| value.has_signed_install())
            && packaged_install().is_some();
        let mut install = Button::new("connector.update.install")
            .label(locale.text("Install update"))
            .primary();
        if can_install && !checking && !self.update_installing {
            install = install.on_click(move |_window, cx| {
                let _ =
                    install_view.update(cx, |this, cx| this.dispatch(Action::InstallUpdate, cx));
            });
        } else {
            install = install.disabled(true);
        }

        let mut section = SettingsSection::new("connector.about", locale.text("About"));
        if let Some(identity) = self.distribution.asset_identity {
            section = section.row(
                SettingsRow::new("connector.about.product", self.distribution.product_name)
                    .control(brand_mark("connector.about.mark", identity.icon_path, 32.0)),
            );
        } else {
            section = section.row(
                SettingsRow::new("connector.about.product", self.distribution.product_name)
                    .value(self.distribution.product_name),
            );
        }
        let status_label = self.update_status_label();
        let mut status = StatusLine::new(status_label.clone(), self.update_status_tone())
            .id("connector.about.status.line");
        if matches!(
            self.update_check.status,
            AsyncStatus::Loading | AsyncStatus::Refreshing
        ) {
            status = status.busy("connector.about.status.wait");
        }
        section
            .row(
                SettingsRow::new("connector.about.version", locale.text("Version"))
                    .control(Badge::new(version.to_owned())),
            )
            .row(
                SettingsRow::new("connector.about.status", locale.text("Update status"))
                    .search_terms([status_label.clone()])
                    .control(status),
            )
            .row(
                SettingsRow::new(
                    "connector.about.auto",
                    locale.text("Check for updates automatically"),
                )
                .control(auto),
            )
            .row(
                SettingsRow::new("connector.about.check", locale.text("Updates"))
                    .search_terms([
                        locale.text("Check for updates"),
                        locale.text("Install update"),
                        locale.text("Open download page"),
                    ])
                    .control(
                        ButtonGroup::new("connector.about.update-actions")
                            .child(check)
                            .child(install)
                            .child(download),
                    ),
            )
    }

    fn update_status_tone(&self) -> Tone {
        match (&self.update_check.status, self.update_check.value.as_ref()) {
            (AsyncStatus::Loading | AsyncStatus::Refreshing, _) => Tone::Info,
            (AsyncStatus::Error(_), None) => Tone::Danger,
            (_, Some(value)) if value.has_signed_install() || value.has_newer_manual() => {
                Tone::Warning
            }
            (_, Some(_)) => Tone::Success,
            _ => Tone::Neutral,
        }
    }

    fn update_status_label(&self) -> String {
        let locale = self.preferences.locale;
        match (&self.update_check.status, self.update_check.value.as_ref()) {
            (AsyncStatus::Loading | AsyncStatus::Refreshing, _) => locale.text("Checking…").into(),
            (AsyncStatus::Error(error), None) => {
                format!("{}: {error}", locale.text("Update check failed"))
            }
            (_, Some(value)) if value.has_signed_install() => {
                let version = value
                    .signed
                    .as_ref()
                    .map(|update| update.version.as_str())
                    .unwrap_or_default();
                format!("{} {version}", locale.text("A signed update is available:"))
            }
            (_, Some(value)) if value.has_newer_manual() => {
                let version = value
                    .latest_manual
                    .as_ref()
                    .map(|release| release.version.as_str())
                    .unwrap_or_default();
                format!("{} {version}", locale.text("A newer package is available:"))
            }
            (_, Some(_)) => locale.text("You have the latest version.").into(),
            _ => locale.text("Not checked yet.").into(),
        }
    }
}
