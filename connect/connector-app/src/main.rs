#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]

use std::{borrow::Cow, ffi::OsString};

use gpui::{AssetSource, SharedString};

mod distribution;

const AGENT_LOGOS: &[(&str, &[u8])] = &[
    (
        "agents/claude.svg",
        include_bytes!("../assets/agents/claude.svg"),
    ),
    (
        "agents/codex.svg",
        include_bytes!("../assets/agents/codex.svg"),
    ),
    (
        "agents/gemini.svg",
        include_bytes!("../assets/agents/gemini.svg"),
    ),
    (
        "agents/grok.svg",
        include_bytes!("../assets/agents/grok.svg"),
    ),
    (
        "agents/opencode.svg",
        include_bytes!("../assets/agents/opencode.svg"),
    ),
    (
        "agents/workbuddy.svg",
        include_bytes!("../assets/agents/workbuddy.svg"),
    ),
];

const VENDOR_ICONS: &[(&str, &[u8])] = &[
    (
        "vendors/ai360.svg",
        include_bytes!("../assets/vendors/ai360.svg"),
    ),
    (
        "vendors/azureai.svg",
        include_bytes!("../assets/vendors/azureai.svg"),
    ),
    (
        "vendors/claude.svg",
        include_bytes!("../assets/vendors/claude.svg"),
    ),
    (
        "vendors/cloudflare.svg",
        include_bytes!("../assets/vendors/cloudflare.svg"),
    ),
    (
        "vendors/cohere.svg",
        include_bytes!("../assets/vendors/cohere.svg"),
    ),
    (
        "vendors/deepseek.svg",
        include_bytes!("../assets/vendors/deepseek.svg"),
    ),
    (
        "vendors/doubao.svg",
        include_bytes!("../assets/vendors/doubao.svg"),
    ),
    (
        "vendors/elevenlabs.svg",
        include_bytes!("../assets/vendors/elevenlabs.svg"),
    ),
    (
        "vendors/gemini.svg",
        include_bytes!("../assets/vendors/gemini.svg"),
    ),
    (
        "vendors/hunyuan.svg",
        include_bytes!("../assets/vendors/hunyuan.svg"),
    ),
    (
        "vendors/jimeng.svg",
        include_bytes!("../assets/vendors/jimeng.svg"),
    ),
    (
        "vendors/jina.svg",
        include_bytes!("../assets/vendors/jina.svg"),
    ),
    (
        "vendors/kling.svg",
        include_bytes!("../assets/vendors/kling.svg"),
    ),
    (
        "vendors/meshy.svg",
        include_bytes!("../assets/vendors/meshy.svg"),
    ),
    (
        "vendors/minimax.svg",
        include_bytes!("../assets/vendors/minimax.svg"),
    ),
    (
        "vendors/mistral.svg",
        include_bytes!("../assets/vendors/mistral.svg"),
    ),
    (
        "vendors/moonshot.svg",
        include_bytes!("../assets/vendors/moonshot.svg"),
    ),
    (
        "vendors/ollama.svg",
        include_bytes!("../assets/vendors/ollama.svg"),
    ),
    (
        "vendors/openai.svg",
        include_bytes!("../assets/vendors/openai.svg"),
    ),
    (
        "vendors/qwen.svg",
        include_bytes!("../assets/vendors/qwen.svg"),
    ),
    (
        "vendors/spark.svg",
        include_bytes!("../assets/vendors/spark.svg"),
    ),
    (
        "vendors/vidu.svg",
        include_bytes!("../assets/vendors/vidu.svg"),
    ),
    (
        "vendors/wenxin.svg",
        include_bytes!("../assets/vendors/wenxin.svg"),
    ),
    (
        "vendors/xai.svg",
        include_bytes!("../assets/vendors/xai.svg"),
    ),
    ("vendors/yi.svg", include_bytes!("../assets/vendors/yi.svg")),
    (
        "vendors/zhipu.svg",
        include_bytes!("../assets/vendors/zhipu.svg"),
    ),
];

struct BoxAIAssets;

impl AssetSource for BoxAIAssets {
    fn load(&self, path: &str) -> gpui::Result<Option<Cow<'static, [u8]>>> {
        if path == distribution::SHELL_ICON_PATH {
            return Ok(Some(Cow::Borrowed(include_bytes!(
                "../../../logo/exports/mark-connect.svg"
            ))));
        }
        if let Some((_, bytes)) = AGENT_LOGOS.iter().find(|(logo, _)| *logo == path) {
            return Ok(Some(Cow::Borrowed(bytes)));
        }
        if let Some((_, bytes)) = VENDOR_ICONS.iter().find(|(icon, _)| *icon == path) {
            return Ok(Some(Cow::Borrowed(bytes)));
        }
        gpui_kit::assets::Assets.load(path)
    }

    fn list(&self, prefix: &str) -> gpui::Result<Vec<SharedString>> {
        let mut assets = gpui_kit::assets::Assets.list(prefix)?;
        if distribution::SHELL_ICON_PATH.starts_with(prefix) {
            assets.push(distribution::SHELL_ICON_PATH.into());
        }
        assets.extend(
            AGENT_LOGOS
                .iter()
                .chain(VENDOR_ICONS.iter())
                .filter(|(path, _)| path.starts_with(prefix))
                .map(|(path, _)| SharedString::from(*path)),
        );
        Ok(assets)
    }
}

fn main() {
    let distribution = &distribution::BOXAI_DISTRIBUTION;
    let args = std::env::args_os().skip(1).collect::<Vec<_>>();
    if uninstall_requested(&args) {
        let result = gateway_connector_backend::install_root()
            .ok_or(gateway_connector_backend::InstallError::MissingProgramDirectory)
            .and_then(|directory| {
                gateway_connector_backend::uninstall(
                    &directory,
                    gateway_connector_backend::system_shell().as_ref(),
                )
            });
        if let Err(error) = result {
            eprintln!("BoxAI Connect could not uninstall: {error}");
            std::process::exit(1);
        }
        return;
    }
    match gateway_connector_app::isolated::LaunchRequest::from_args(distribution, args) {
        Ok(gateway_connector_app::isolated::LaunchRequest::Normal) => {
            gateway_connector_app::gpui_app::run_with_assets(distribution, BoxAIAssets);
        }
        Ok(gateway_connector_app::isolated::LaunchRequest::Isolated(_)) => {
            eprintln!("BoxAI Connect disables isolated-root mode");
            std::process::exit(2);
        }
        Err(error) => {
            eprintln!("BoxAI Connect could not start: {error}");
            std::process::exit(2);
        }
    }
}

fn uninstall_requested(args: &[OsString]) -> bool {
    matches!(args, [flag] if flag == "--uninstall")
}

#[cfg(test)]
mod tests {
    use gpui::AssetSource;
    use gpui_kit::assets::Icon;

    use super::*;

    #[test]
    fn uninstall_command_is_exact() {
        assert!(uninstall_requested(&[OsString::from("--uninstall")]));
        assert!(!uninstall_requested(&[]));
        assert!(!uninstall_requested(&[
            OsString::from("--uninstall"),
            OsString::from("unexpected")
        ]));
    }

    #[test]
    fn shell_assets_serve_the_boxai_mark_and_delegate_neutral_assets() {
        let mark = BoxAIAssets
            .load(distribution::SHELL_ICON_PATH)
            .expect("load BoxAI mark")
            .expect("BoxAI mark exists");
        assert!(mark.starts_with(b"<svg"));
        assert!(
            BoxAIAssets
                .list("brand/")
                .expect("list branded assets")
                .iter()
                .any(|path| path == distribution::SHELL_ICON_PATH)
        );
        assert!(
            BoxAIAssets
                .load(Icon::Global.path())
                .expect("load delegated neutral icon")
                .is_some()
        );
    }

    #[test]
    fn shell_assets_serve_the_five_agent_logos() {
        let listed = BoxAIAssets.list("agents/").expect("list agent logos");
        for (path, bytes) in AGENT_LOGOS {
            assert!(
                listed.iter().any(|listed| listed == path),
                "{path} must be listed under agents/"
            );
            let loaded = BoxAIAssets
                .load(path)
                .expect("load agent logo")
                .expect("agent logo exists");
            assert_eq!(loaded.as_ref(), *bytes);
            assert!(loaded.windows(4).any(|window| window == b"<svg"));
        }
        assert_eq!(listed.len(), AGENT_LOGOS.len());
    }

    #[test]
    fn shell_assets_serve_vendor_icons() {
        let listed = BoxAIAssets.list("vendors/").expect("list vendor icons");
        for (path, bytes) in VENDOR_ICONS {
            assert!(
                listed.iter().any(|listed| listed == path),
                "{path} must be listed under vendors/"
            );
            let loaded = BoxAIAssets
                .load(path)
                .expect("load vendor icon")
                .expect("vendor icon exists");
            assert_eq!(loaded.as_ref(), *bytes);
            assert!(loaded.windows(4).any(|window| window == b"<svg"));
        }
        assert_eq!(listed.len(), VENDOR_ICONS.len());
    }
}
