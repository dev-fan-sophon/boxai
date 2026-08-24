//! Maps Gateway `@lobehub/icons` keys onto bundled static SVGs.

const VENDOR_ICONS: &[(&str, &str)] = &[
    ("ai360", "vendors/ai360.svg"),
    ("azureai", "vendors/azureai.svg"),
    ("claude", "vendors/claude.svg"),
    ("cloudflare", "vendors/cloudflare.svg"),
    ("cohere", "vendors/cohere.svg"),
    ("deepseek", "vendors/deepseek.svg"),
    ("doubao", "vendors/doubao.svg"),
    ("elevenlabs", "vendors/elevenlabs.svg"),
    ("gemini", "vendors/gemini.svg"),
    ("hunyuan", "vendors/hunyuan.svg"),
    ("jimeng", "vendors/jimeng.svg"),
    ("jina", "vendors/jina.svg"),
    ("kling", "vendors/kling.svg"),
    ("meshy", "vendors/meshy.svg"),
    ("minimax", "vendors/minimax.svg"),
    ("mistral", "vendors/mistral.svg"),
    ("moonshot", "vendors/moonshot.svg"),
    ("ollama", "vendors/ollama.svg"),
    ("openai", "vendors/openai.svg"),
    ("qwen", "vendors/qwen.svg"),
    ("spark", "vendors/spark.svg"),
    ("vidu", "vendors/vidu.svg"),
    ("wenxin", "vendors/wenxin.svg"),
    ("xai", "vendors/xai.svg"),
    ("yi", "vendors/yi.svg"),
    ("zhipu", "vendors/zhipu.svg"),
];

/// Resolves a Gateway `vendor.icon` (or vendor name) to a bundled asset path.
///
/// Normalization follows the Gateway admin `resolveIconKey` rules, plus the
/// first-segment split the plaza keys need (`Claude.Color` → `claude`).
pub(crate) fn vendor_icon_path(icon: &str) -> Option<&'static str> {
    let key = normalize_vendor_icon_key(icon);
    VENDOR_ICONS
        .iter()
        .find(|(candidate, _)| *candidate == key)
        .map(|(_, path)| *path)
}

pub(crate) fn normalize_vendor_icon_key(icon: &str) -> String {
    let first = icon.split('.').next().unwrap_or(icon).trim();
    let key: String = first
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .collect::<String>()
        .to_ascii_lowercase();
    match key.as_str() {
        "anthropic" => "claude".into(),
        "azure" | "microsoft" => "azureai".into(),
        "bytedance" => "doubao".into(),
        "google" => "gemini".into(),
        "meta" => "ollama".into(),
        other => other.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::{normalize_vendor_icon_key, vendor_icon_path};

    #[test]
    fn plaza_color_keys_resolve_to_bundled_files() {
        assert_eq!(normalize_vendor_icon_key("Claude.Color"), "claude");
        assert_eq!(normalize_vendor_icon_key("OpenAI"), "openai");
        assert_eq!(normalize_vendor_icon_key("XAI"), "xai");
        assert_eq!(normalize_vendor_icon_key("Anthropic"), "claude");
        assert_eq!(normalize_vendor_icon_key("Microsoft"), "azureai");
        assert_eq!(vendor_icon_path("Gemini.Color"), Some("vendors/gemini.svg"));
        assert_eq!(vendor_icon_path("unknown-vendor"), None);
    }
}
