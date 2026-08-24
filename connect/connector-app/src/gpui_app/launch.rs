use std::sync::Arc;

use directories::{ProjectDirs, UserDirs};
use gateway_connector_backend::{
    AssetIdentity, Browser, ConnectorBackend, Distribution, JsonProfileStore,
    ProfileCredentialStore, ProfileStore, SystemBrowser,
};
use gpui::{
    App, AppContext as _, AssetSource, Bounds, TitlebarOptions, WindowAppearance,
    WindowBackgroundAppearance, WindowBounds, WindowOptions, px, size,
};
use gpui_kit_theme::Density;

use crate::{
    isolated::LaunchRequest,
    preferences::{DensityPreference, Locale, PreferenceStore, Preferences, ThemePreference},
    sign_in_progress::{AnnouncingBrowser, SignInProgress},
    theme,
};

use super::host::{ConnectorHost, HostSetup};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ShellIconIdentity {
    Neutral,
    Distribution(AssetIdentity),
}

impl ShellIconIdentity {
    pub(crate) const fn for_distribution(distribution: &Distribution) -> Self {
        match distribution.asset_identity {
            Some(identity) => Self::Distribution(identity),
            None => Self::Neutral,
        }
    }
}

pub(crate) fn activate_theme_for(appearance: WindowAppearance, cx: &mut App) {
    let theme = match appearance {
        WindowAppearance::Light | WindowAppearance::VibrantLight => theme::STUDIO_LIGHT_ID,
        WindowAppearance::Dark | WindowAppearance::VibrantDark => theme::STUDIO_DARK_ID,
    };
    gpui_kit::theme::activate_theme(theme, cx);
}

pub(crate) fn apply_theme(preference: ThemePreference, cx: &mut App) {
    let appearance = match preference {
        ThemePreference::System => {
            cx.set_window_appearance(None);
            cx.window_appearance()
        }
        ThemePreference::Light => {
            cx.set_window_appearance(Some(WindowAppearance::Light));
            WindowAppearance::Light
        }
        ThemePreference::Dark => {
            cx.set_window_appearance(Some(WindowAppearance::Dark));
            WindowAppearance::Dark
        }
    };
    activate_theme_for(appearance, cx);
}

pub(crate) fn apply_density(preference: DensityPreference, cx: &mut App) {
    let density = match preference {
        DensityPreference::Compact => Density::Compact,
        DensityPreference::Comfortable => Density::Comfortable,
    };
    gpui_kit::theme::set_density(density, cx);
}

/// Runs the GPUI client with a compile-time neutral or downstream identity.
pub fn run(distribution: &'static Distribution) {
    run_launch(distribution, LaunchRequest::Normal);
}

/// Runs a pre-parsed launch request.
pub fn run_launch(distribution: &'static Distribution, request: LaunchRequest) {
    run_launch_with_assets(distribution, request, gpui_kit::assets::Assets);
}

/// Runs a distribution with a wrapper-owned asset source.
pub fn run_with_assets(distribution: &'static Distribution, assets: impl AssetSource) {
    run_launch_with_assets(distribution, LaunchRequest::Normal, assets);
}

fn run_launch_with_assets(
    distribution: &'static Distribution,
    request: LaunchRequest,
    assets: impl AssetSource,
) {
    distribution
        .validate()
        .expect("validate GatewayConnector distribution");
    validate_shell_asset_source(distribution, &assets)
        .expect("validate GatewayConnector distribution asset source");
    assert!(
        !matches!(&request, LaunchRequest::Isolated(_)) || distribution.allow_isolated_root,
        "this GatewayConnector distribution disables isolated-root mode"
    );
    let sign_in_progress = Arc::new(SignInProgress::default());
    let browser: Arc<dyn Browser> = Arc::new(AnnouncingBrowser::new(
        SystemBrowser,
        Arc::clone(&sign_in_progress),
    ));
    let (backend, preference_store, mut preferences, isolated_layout) = match request {
        LaunchRequest::Normal => {
            let directories = ProjectDirs::from(
                distribution.qualifier,
                distribution.organization,
                distribution.application,
            )
            .expect("the operating system provides a user data directory");
            let coordinator = ProjectDirs::from("dev", "GatewayConnector", "ProjectionCoordinator")
                .expect("the operating system provides a shared projection coordinator directory");
            let home = UserDirs::new()
                .expect("the operating system provides a home directory")
                .home_dir()
                .to_owned();
            let profiles: Arc<dyn ProfileStore> = Arc::new(JsonProfileStore::new(
                directories.data_local_dir().join("profiles.json"),
            ));
            let backend = Arc::new(
                ConnectorBackend::with_dependencies(
                    Arc::new(ProfileCredentialStore::new(Arc::clone(&profiles))),
                    profiles,
                    distribution,
                    Arc::clone(&browser),
                )
                .and_then(|backend| {
                    backend.with_runtime_directories(
                        directories.data_local_dir(),
                        coordinator.data_local_dir(),
                        home,
                    )
                })
                .expect("initialize GatewayConnector backend"),
            );
            let preference_store =
                PreferenceStore::new(directories.data_local_dir().join("ui-preferences.json"));
            let preferences = preference_store.load();
            (backend, preference_store, preferences, None)
        }
        LaunchRequest::Isolated(layout) => {
            let layout = *layout;
            layout
                .revalidate()
                .expect("revalidate isolated GatewayConnector root");
            eprintln!(
                "GatewayConnector Isolated mode: {}",
                layout.root().display()
            );
            let profiles: Arc<dyn ProfileStore> =
                Arc::new(JsonProfileStore::new(layout.profiles_file()));
            let backend = Arc::new(
                ConnectorBackend::with_dependencies(
                    Arc::new(ProfileCredentialStore::new(Arc::clone(&profiles))),
                    profiles,
                    distribution,
                    Arc::clone(&browser),
                )
                .and_then(|backend| {
                    backend.with_isolated_runtime_directories(
                        layout.state_dir(),
                        layout.coordinator_dir(),
                        layout.agent_roots(),
                    )
                })
                .expect("initialize isolated GatewayConnector backend"),
            );
            let preference_store = PreferenceStore::new(layout.preferences_file());
            let preferences = preference_store.load_or(Preferences::default());
            (backend, preference_store, preferences, Some(layout))
        }
    };
    if !distribution
        .supported_locales
        .contains(&preferences.locale.id())
    {
        preferences.locale = distribution
            .supported_locales
            .iter()
            .find_map(|value| Locale::from_id(value))
            .unwrap_or_default();
    }
    let application = gpui_platform::application().with_assets(assets);
    let window_title = if isolated_layout.is_some() {
        format!("{} — Isolated mode", distribution.product_name)
    } else {
        distribution.product_name.to_owned()
    };
    application.run(move |cx: &mut App| {
        super::dock_icon::apply_runtime_dock_icon();
        gpui_kit::install(cx);
        crate::locale::apply_box_locale(preferences.locale, cx);
        apply_theme(preferences.theme, cx);
        apply_density(preferences.density, cx);
        // Windows reserves a taskbar inside the display. Keep the initial frame
        // inside a 720p work area even after the native resize border is added;
        // otherwise high-DPI scaling can put the bottom edge behind the taskbar.
        let initial_height = if cfg!(target_os = "windows") {
            640.0
        } else {
            760.0
        };
        let bounds = Bounds::centered(None, size(px(1120.0), px(initial_height)), cx);
        let backend = Arc::clone(&backend);
        let preference_store = preference_store.clone();
        let preferences = preferences.clone();
        let isolated_layout = isolated_layout.clone();
        let window_title = window_title.clone();
        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                window_background: WindowBackgroundAppearance::Opaque,
                titlebar: Some(TitlebarOptions {
                    title: Some(window_title.into()),
                    // GPUI Box draws the cross-platform title bar. Windows
                    // otherwise paints a system caption whose colour follows
                    // the desktop rather than the chosen theme, and macOS
                    // otherwise stacks two bars of chrome.
                    appears_transparent: true,
                    ..Default::default()
                }),
                ..Default::default()
            },
            move |window, cx| {
                let backend = Arc::clone(&backend);
                cx.new(|cx| {
                    ConnectorHost::new(
                        HostSetup {
                            backend,
                            distribution,
                            preference_store,
                            preferences,
                            isolated_layout,
                            sign_in_progress,
                        },
                        window,
                        cx,
                    )
                })
            },
        )
        .expect("open GatewayConnector window");
        cx.activate(true);
    });
}

pub(crate) fn validate_shell_asset_source(
    distribution: &Distribution,
    assets: &impl AssetSource,
) -> Result<(), String> {
    let ShellIconIdentity::Distribution(identity) =
        ShellIconIdentity::for_distribution(distribution)
    else {
        return Ok(());
    };
    match assets.load(identity.icon_path) {
        Ok(Some(bytes)) if !bytes.is_empty() => Ok(()),
        Ok(Some(_)) => Err(format!(
            "distribution shell icon `{}` is empty",
            identity.icon_path
        )),
        Ok(None) => Err(format!(
            "distribution shell icon `{}` is not provided by the active AssetSource",
            identity.icon_path
        )),
        Err(error) => Err(format!(
            "distribution shell icon `{}` could not be loaded: {error}",
            identity.icon_path
        )),
    }
}

#[cfg(test)]
mod tests {
    use std::{
        borrow::Cow,
        sync::{Arc, Mutex},
    };

    use super::{ShellIconIdentity, validate_shell_asset_source};
    use crate::gpui_app::host::ProjectionStatusGeneration;
    use gateway_connector_backend::{AssetIdentity, Distribution, GENERIC_DISTRIBUTION};
    use gpui::{AssetSource, SharedString};

    #[test]
    fn older_projection_status_results_cannot_replace_newer_evidence() {
        let mut generation = ProjectionStatusGeneration::default();
        let older = generation.begin();
        let newer = generation.begin();
        assert!(!generation.accepts(older));
        assert!(generation.accepts(newer));

        generation.invalidate();
        assert!(!generation.accepts(newer));
    }

    #[test]
    fn configured_shell_icon_is_loaded_through_delegating_asset_source() {
        const ICON_PATH: &str = "brand/example-connector.svg";
        let branded = Distribution {
            product_id: "example-connector",
            product_name: "Example Connector",
            allow_isolated_root: false,
            asset_identity: Some(AssetIdentity {
                icon_key: "example-connector-shell-icon",
                icon_path: ICON_PATH,
            }),
            ..GENERIC_DISTRIBUTION
        };
        assert_eq!(
            ShellIconIdentity::for_distribution(&branded),
            ShellIconIdentity::Distribution(branded.asset_identity.expect("asset identity"))
        );

        let requests = Arc::new(Mutex::new(Vec::new()));
        let assets = WrapperAssets {
            requests: Arc::clone(&requests),
        };
        validate_shell_asset_source(&branded, &assets).expect("wrapper serves shell icon");
        assert_eq!(requests.lock().expect("requests").as_slice(), [ICON_PATH]);
        assert!(
            assets
                .load(gpui_kit::assets::Icon::Global.path())
                .expect("neutral icon")
                .is_some()
        );
        let listed = assets.list("icons/").expect("delegated neutral list");
        assert!(
            listed
                .iter()
                .any(|path| path == gpui_kit::assets::Icon::Global.path())
        );
        assert_eq!(assets.list("brand/").expect("wrapper list"), [ICON_PATH]);
        assert!(!branded.allow_isolated_root);
    }

    #[test]
    fn generic_fallback_needs_no_distribution_asset_and_missing_brand_fails() {
        let requests = Arc::new(Mutex::new(Vec::new()));
        let assets = WrapperAssets {
            requests: Arc::clone(&requests),
        };
        validate_shell_asset_source(&GENERIC_DISTRIBUTION, &assets)
            .expect("neutral fallback is built into the shared renderer");
        assert_eq!(
            ShellIconIdentity::for_distribution(&GENERIC_DISTRIBUTION),
            ShellIconIdentity::Neutral
        );
        assert!(assets.requests.lock().expect("requests").is_empty());

        let missing = Distribution {
            asset_identity: Some(AssetIdentity {
                icon_key: "missing-shell-icon",
                icon_path: "brand/missing.svg",
            }),
            ..GENERIC_DISTRIBUTION
        };
        assert!(validate_shell_asset_source(&missing, &assets).is_err());
    }

    struct WrapperAssets {
        requests: Arc<Mutex<Vec<String>>>,
    }

    impl AssetSource for WrapperAssets {
        fn load(&self, path: &str) -> gpui::Result<Option<Cow<'static, [u8]>>> {
            self.requests
                .lock()
                .expect("requests")
                .push(path.to_owned());
            if path == "brand/example-connector.svg" {
                Ok(Some(Cow::Borrowed(
                    br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>"#,
                )))
            } else {
                gpui_kit::assets::Assets.load(path)
            }
        }

        fn list(&self, prefix: &str) -> gpui::Result<Vec<SharedString>> {
            let mut assets = gpui_kit::assets::Assets.list(prefix)?;
            if "brand/example-connector.svg".starts_with(prefix) {
                assets.push("brand/example-connector.svg".into());
            }
            Ok(assets)
        }
    }
}
