//! Credential-free UI preferences with crash-safe replacement.

use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use fs2::FileExt;
use serde::{Deserialize, Serialize};

static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Locale {
    #[default]
    En,
    Vi,
    ZhCn,
}

impl Locale {
    pub const ALL: [Self; 3] = [Self::Vi, Self::En, Self::ZhCn];

    pub const fn id(self) -> &'static str {
        match self {
            Self::En => "en",
            Self::Vi => "vi",
            Self::ZhCn => "zh-CN",
        }
    }

    pub const fn display_name(self) -> &'static str {
        match self {
            Self::En => "English",
            Self::Vi => "Tiếng Việt",
            Self::ZhCn => "简体中文",
        }
    }

    pub fn from_id(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "en" => Some(Self::En),
            "vi" | "vi-vn" | "vi_vn" => Some(Self::Vi),
            "zh" | "zh-cn" | "zh_cn" | "zh-hans" | "zh_hans" => Some(Self::ZhCn),
            _ => None,
        }
    }

    pub fn from_os(value: Option<&str>) -> Self {
        value.and_then(Self::from_id).unwrap_or_default()
    }

    /// Translates the generic app's fixed user-facing strings. Dynamic
    /// gateway and operating-system error details intentionally remain intact.
    pub fn text(self, english: &'static str) -> &'static str {
        match self {
            Self::En => english,
            Self::Vi => vietnamese_text(english),
            Self::ZhCn => simplified_chinese_text(english),
        }
    }
}

fn simplified_chinese_text(english: &'static str) -> &'static str {
    match english {
        "GatewayConnector" => "GatewayConnector",
        "Gateway" => "网关",
        "Connection" => "连接",
        "Overview" => "总览",
        "Current account" => "当前账户",
        "Current account data from the signed-in Gateway account." => {
            "当前登录 Gateway 账户的数据。"
        }
        "Agents" => "智能体",
        "Quota" => "配额",
        "Used quota" => "已用配额",
        "Request count" => "请求次数",
        "Recent rate" => "近期速率",
        "Requests per minute" => "每分钟请求",
        "Tokens per minute" => "每分钟 Token",
        "Usage by day" => "按天用量",
        "Usage by model" => "按模型用量",
        "Usage trend" => "用量趋势",
        "Recent requests" => "最近调用",
        "No recent requests." => "最近没有调用。",
        "Agent status" => "智能体状况",
        "Catalog sync" => "目录同步",
        "Synchronized Skills" => "已同步 Skills",
        "Overview data is unavailable for direct connections." => "直连模式没有总览数据。",
        "Account data is unavailable." => "账户数据不可用。",
        "Type" => "类型",
        "Vendor" => "厂商",
        "All" => "全部",
        "All vendors" => "全部厂商",
        "Text" => "文本",
        "Image" => "图像",
        "Video" => "视频",
        "Audio" => "音频",
        "Embeddings and rerank" => "向量与重排",
        "3D" => "3D",
        "Other" => "其他",
        "is" => "为",
        "Time" => "时间",
        "Tokens" => "Token",
        "Requests" => "请求",
        "7 days" => "7 天",
        "30 days" => "30 天",
        "No usage in this range." => "这个区间没有用量。",
        "No description." => "没有描述。",
        "Duration" => "耗时",
        "Online services" => "在线服务",
        "Settings" => "设置",
        "Application" => "应用",
        "Quit application" => "退出应用",
        "Account" => "账户",
        "Identity, quota, and active plans." => "账户身份、配额和有效套餐。",
        "Choose one vendor to filter its models immediately." => {
            "选择一个厂商，立即筛选该厂商的模型。"
        }
        "Configure this Agent, then apply its managed settings." => {
            "配置此智能体，然后应用其托管设置。"
        }
        "Services available to connect through this Gateway." => "可通过此 Gateway 连接的服务。",
        "Reusable capabilities available to your Agents." => "智能体可用的复用能力。",
        "Language, appearance, and update preferences." => "语言、外观和更新偏好。",
        "Usage" => "用量",
        "Billing" => "账单",
        "Identity and connection" => "身份与连接",
        "Model Plaza" => "模型广场",
        "The Gateway currently offers no models." => "网关目前未提供模型。",
        "Direct image generation" => "生图直连",
        "Write OPENAI_BASE_URL and OPENAI_API_KEY so image skills can call the Gateway Images API directly." => {
            "写入 OPENAI_BASE_URL 和 OPENAI_API_KEY，让生图技能直接调用网关 Images API。"
        }
        "Codex already uses the Gateway Responses provider for native image generation." => {
            "Codex 已通过网关 Responses 提供方支持原生生图。"
        }
        "This Agent has no environment-variable channel for Images API credentials." => {
            "此 Agent 没有可用于 Images API 凭据的环境变量通道。"
        }
        "Images API" => "Images API",
        "Codex model list" => "Codex 模型列表",
        "Always included as the default model." => "作为默认模型始终写入。",
        "Model list" => "模型列表",
        "Only Responses-native models are written to model_catalog_json so Codex can switch among them." => {
            "只有 Responses 原生模型会写入 model_catalog_json，供 Codex 在列表中切换。"
        }
        "Native and converted Responses models can be written to model_catalog_json. BoxAI Connect lets you choose." => {
            "原生和转换的 Responses 模型都可以写入 model_catalog_json，由 BoxAI Connect 自行勾选。"
        }
        "Native" => "原生",
        "Converted" => "转换",
        "Runtime" => "运行设置",
        "Enablement is written when you apply this Agent." => {
            "对此 Agent 点应用后才会写入启用状态。"
        }
        "Writes" => "将写入",
        "Write location" => "写入位置",
        "Apply writes only this Agent. Other Agents stay as they are." => {
            "应用只写入此 Agent，其他 Agent 保持原样。"
        }
        "Applied this Agent's configuration." => "已应用此 Agent 的配置。",
        "Enable each server on the Agent page, then apply that Agent." => {
            "在对应 Agent 页启用服务器，再对该 Agent 应用。"
        }
        "Enable each Skill on the Agent page, then apply that Agent." => {
            "在对应 Agent 页启用 Skill，再对该 Agent 应用。"
        }
        "Connected" => "已连接",
        "Not connected" => "未连接",
        "Loading saved connection" => "正在加载已保存的连接",
        "Connect a Gateway" => "连接网关",
        "Connect" => "连接",
        "Testing…" => "测试中…",
        "BoxAI account" => "BoxAI 账号",
        "BoxAI Connect needs an account. Sign-in is confirmed in the browser; the account stays in this app's local config directory." => {
            "BoxAI Connect 需要登录后使用。登录在浏览器中确认，账号状态保存在本机配置目录。"
        }
        "Sign in to BoxAI" => "登录 BoxAI",
        "Sign in" => "登录",
        "Extract the download before running it" => "请先解压后再运行",
        "This copy is running from the temporary folder a file manager uses to preview an archive. That folder is deleted without warning and the package's own files are missing from it. Extract the download to a folder you choose, then start it from there." => {
            "当前副本运行在文件管理器为预览压缩包而创建的临时目录里。该目录会被系统随时清理，安装包自带的文件也不在其中。请把下载的压缩包解压到你自己选定的目录，再从那里启动。"
        }
        "Current location" => "当前位置",
        "Waiting…" => "等待中…",
        "Complete sign-in in your browser" => "请在浏览器中完成登录",
        "If the browser did not come up, open this link yourself. It stays valid while this window waits." => {
            "如果浏览器没有自动打开，可以自己打开下面的链接。本窗口等待期间该链接一直有效。"
        }
        "No browser could be opened on this machine. Copy the link below and open it in any browser." => {
            "这台机器上没有可用的浏览器。请复制下面的链接，用任意浏览器打开。"
        }
        "Copy the sign-in link" => "复制登录链接",
        "No browser could be opened. Set a default browser, then sign in again — the link is shown here so it can be opened by hand." => {
            "无法打开浏览器。请先设置默认浏览器再重新登录；上面的链接也可以手动打开。"
        }
        "The browser never returned to this app. That is almost always a proxy or security tool that intercepts 127.0.0.1: switch the proxy to rule mode or exempt 127.0.0.1, allow this program to accept local connections, then sign in again." => {
            "浏览器没有回到本应用。这几乎都是代理或安全软件拦截了 127.0.0.1：请把代理切换为规则模式或放行 127.0.0.1，并允许本程序接受本机连接，然后重新登录。"
        }
        "Sign-in was declined in the browser. Nothing was saved." => {
            "已在浏览器中拒绝登录，未保存任何内容。"
        }
        "Waiting for confirmation…" => "等待确认…",
        "The authorization page opened in your browser. This window returns automatically when you finish." => {
            "已在浏览器中打开授权页面，完成后会自动返回。"
        }
        "Enter a Gateway URL with OpenAI-style model discovery and the native Agent APIs you intend to use." => {
            "输入支持 OpenAI 风格模型发现及所需 Agent 原生 API 的网关 URL。"
        }
        "Gateway base URL" => "网关基础 URL",
        "Root or nested prefix; /v1 and /v1/models forms are also accepted. HTTPS except loopback." => {
            "可输入根路径或嵌套前缀，也支持 /v1 和 /v1/models。除回环地址外须使用 HTTPS。"
        }
        "API key" => "API 密钥",
        "Stored in this app's local profile config. Leave blank when the platform advertises browser login." => {
            "保存在本应用本地配置中。平台提供浏览器登录时可留空。"
        }
        "Connect / Test" => "连接 / 测试",
        "Testing connection" => "正在测试连接",
        "Browser login available" => "可使用浏览器登录",
        "Platform" => "平台",
        "Available" => "可用",
        "Security" => "安全性",
        "Continue" => "继续",
        "Continue in browser" => "在浏览器中继续",
        "Back" => "返回",
        "Clear error" => "清除错误",
        "Profile" => "配置档案",
        "Models" => "模型",
        "Detected Agents" => "已检测到的 Agent",
        "Refresh models and online services" => "刷新模型与在线服务",
        "Search model catalog" => "搜索模型目录",
        "Filters every Agent picker by model ID or provider; saved unavailable choices remain visible." => {
            "按模型 ID 或提供方筛选所有 Agent；不可用的已保存选项仍会显示。"
        }
        "Connection overview" => "连接概览",
        "Agent default" => "Agent 默认值",
        "Detected" => "已检测",
        "Not detected" => "未检测",
        "Managed by this connection" => "由此连接管理",
        "Not managed" => "未管理",
        "Root" => "根目录",
        "Protocol" => "协议",
        "Model" => "模型",
        "Apply" => "应用",
        "Working…" => "处理中…",
        "Install a supported Agent before applying configuration." => {
            "请先安装受支持的 Agent，再应用配置。"
        }
        "The Gateway currently offers no Responses-native models." => {
            "网关目前未提供 Responses 原生模型。"
        }
        "The Gateway currently offers no Codex Responses models." => {
            "网关目前未提供可供 Codex 使用的 Responses 模型。"
        }
        "No managed Agent files yet." => "尚未写入托管的 Agent 文件。",
        "Managed files exist. Apply changes or disconnect this connection." => {
            "已存在托管文件。请应用更改或断开此连接。"
        }
        "Applying managed files…" => "正在应用托管文件…",
        "Apply failed. You can apply again." => "应用失败。可以再次应用。",
        "Disconnecting managed files…" => "正在断开托管文件…",
        "Disconnect failed. Managed files may still be present." => {
            "断开失败。托管文件可能仍然存在。"
        }
        "No Agent file changes are needed." => "无需更改 Agent 文件。",
        "Direct connections do not invent MCP servers or Skills." => {
            "直连模式不会虚构 MCP 服务器或 Skills。"
        }
        "MCP servers" => "MCP 服务器",
        "Available from platform" => "平台提供",
        "Configured for Agents" => "已为 Agent 配置",
        "Skills" => "Skills",
        "No online services were provisioned." => "未配置在线服务。",
        "Language" => "语言",
        "Theme" => "主题",
        "System" => "跟随系统",
        "Studio Light" => "Studio 浅色",
        "Studio Dark" => "Studio 深色",
        "Light" => "浅色",
        "Dark" => "深色",
        "Clear" => "清除",
        "Provisioned" => "已配置",
        "Synced" => "已同步",
        "Density" => "信息密度",
        "Compact" => "紧凑",
        "Comfortable" => "舒适",
        "Cancel" => "取消",
        "Confirm" => "确认",
        "Sign out of BoxAI Connect?" => "退出 BoxAI Connect？",
        "This removes managed Agent configuration and the local credential." => {
            "这将移除托管的 Agent 配置和本机凭据。"
        }
        "Disconnect managed configuration?" => "断开托管配置？",
        "Agent files will no longer be managed by this connection." => {
            "此连接将不再管理 Agent 文件。"
        }
        "Applied managed Agent configuration." => "已应用托管的 Agent 配置。",
        "Updating managed Agent configuration" => "正在更新托管的 Agent 配置",
        "Refreshed account and catalogs." => "已刷新账户与目录。",
        "Copy" => "复制",
        "Unlimited" => "不限量",
        "Current period" => "当前周期",
        "Refreshing…" => "正在刷新…",
        "Stale" => "可能过期",
        "Security facts" => "安全说明",
        "Credentials stay in this app's local profile config. Bearers are sent only to exact allowlisted origins. Agent changes are written only when you apply them." => {
            "凭据保存在本应用本地配置中。Bearer 仅发送到精确允许的来源。只有应用后才会写入 Agent 更改。"
        }
        "Isolated mode" => "隔离模式",
        "Managing fixture Agents under this path; installed Agents are not being modified:" => {
            "仅管理此路径下的测试 Agent；不会修改已安装的 Agent："
        }
        "Disconnect Gateway and remove managed configuration" => "断开网关并移除托管配置",
        "Provider" => "提供方",
        "Chat capable" => "支持对话",
        "Other model" => "其他模型",
        "No models match this search." => "没有匹配此搜索的模型。",
        "Portal" => "门户",
        "Display name" => "显示名称",
        "Username" => "用户名",
        "Email" => "电子邮件",
        "Group" => "组",
        "Wallet remaining" => "钱包余额",
        "Lifetime used" => "累计用量",
        "Lifetime requests" => "累计请求数",
        "Subscriptions" => "订阅",
        "Wallet fallback allowed" => "允许钱包回退",
        "Yes" => "是",
        "No" => "否",
        "No active subscriptions." => "没有有效订阅。",
        "Preference could not be saved" => "无法保存偏好设置",
        "MCP" => "MCP",
        "Details" => "详情",
        "Refresh" => "刷新",
        "Managed Agent configuration" => "托管的 Agent 配置",
        "Disconnect" => "断开连接",
        "Disconnecting…" => "正在断开…",
        "Unapplied changes" => "未应用的更改",
        "Discard" => "放弃",
        "Changes stay in this window until you apply them. Agent files are not written yet." => {
            "更改只留在此窗口，应用后才会写入 Agent 文件。"
        }
        "Discard unapplied Agent choices" => "放弃未应用的 Agent 选择",
        "Sign out" => "退出登录",
        "Connection status" => "连接状态",
        "Enabled for this Agent" => "为此 Agent 启用",
        "Disabled for this Agent" => "已对此 Agent 停用",
        "No MCP servers were provisioned." => "未配置 MCP 服务器。",
        "No Skills were provisioned." => "未配置 Skills。",
        "Description" => "说明",
        "Endpoint" => "端点",
        "Authorization" => "授权",
        "Version" => "版本",
        "Size" => "大小",
        "Checksum" => "校验和",
        "Synchronized" => "已同步",
        "Pending" => "待同步",
        "Connection bearer" => "连接凭据",
        "Public archive" => "公开归档",
        "Default" => "默认",
        "Default model" => "默认模型",
        "Configuration folder" => "配置目录",
        "Checking standard root…" => "正在检查默认目录…",
        "Model and connection" => "模型与连接",
        "Choose what this Agent uses. Gateway address and credentials stay managed by BoxAI Connect." => {
            "选择此 Agent 使用的配置。网关地址和凭据仍由 BoxAI Connect 管理。"
        }
        "Used for new sessions unless the Agent overrides it." => {
            "用于新会话，除非 Agent 在会话中另行覆盖。"
        }
        "Provider protocol" => "提供方协议",
        "Current Codex releases support custom providers through the Responses API." => {
            "当前 Codex 版本通过 Responses API 支持自定义提供方。"
        }
        "Responses API" => "Responses API",
        "Automatic chooses the first protocol supported by both the Agent and Gateway." => {
            "自动选择 Agent 与网关共同支持的首个协议。"
        }
        "Model behavior" => "模型行为",
        "Tune supported Responses models without changing the Gateway connection." => {
            "调整受支持 Responses 模型的行为，不改变网关连接。"
        }
        "Safety and permissions" => "安全与权限",
        "These settings control local command execution. They do not change Gateway access." => {
            "这些设置控制本地命令执行，不会改变网关访问权限。"
        }
        "Tools" => "工具",
        "Choose how Codex retrieves current information from the web." => {
            "选择 Codex 如何从网页获取当前信息。"
        }
        "This Codex configuration reduces local safety checks. Use it only in a trusted environment." => {
            "此 Codex 配置降低了本地安全检查。请仅在可信环境中使用。"
        }
        "Reasoning effort" => "推理强度",
        "Reasoning summary" => "推理摘要",
        "Response detail" => "回答详细度",
        "Command approvals" => "命令审批",
        "Sandbox access" => "沙箱权限",
        "Web search" => "网页搜索",
        "How much reasoning supported Responses models perform before answering." => {
            "受支持的 Responses 模型在回答前投入多少推理。"
        }
        "How much of the model's reasoning summary Codex displays." => {
            "Codex 显示多少模型推理摘要。"
        }
        "How concise or detailed final answers should be." => "最终回答应多简洁或多详细。",
        "When Codex pauses before running local commands." => {
            "Codex 在运行本地命令前何时暂停等待确认。"
        }
        "Which local files and networks commands may access." => "命令可以访问哪些本地文件和网络。",
        "Whether Codex can retrieve current information from the web." => {
            "Codex 是否可以从网页获取当前信息。"
        }
        "Keep current Codex setting" => "保留当前 Codex 设置",
        "Keep current" => "保持当前值",
        "BoxAI Connect will leave this value unchanged." => "BoxAI Connect 不会更改此项。",
        "Minimal" => "最少",
        "Low" => "低",
        "Medium" => "中",
        "High" => "高",
        "Extra high" => "极高",
        "Automatic" => "自动",
        "Concise" => "简洁",
        "Detailed" => "详细",
        "Hidden" => "隐藏",
        "Balanced" => "均衡",
        "Controls how much reasoning the model performs." => "控制模型投入多少推理。",
        "Controls the reasoning summary shown by Codex." => "控制 Codex 显示的推理摘要。",
        "Controls final-answer detail for supported models." => {
            "控制受支持模型最终回答的详细程度。"
        }
        "Ask for untrusted commands" => "不可信命令需确认",
        "Trusted read-only commands run automatically; other commands ask first." => {
            "可信只读命令自动运行，其他命令先询问。"
        }
        "Ask when Codex requests it" => "按 Codex 请求确认",
        "Codex decides when an action needs your approval." => "由 Codex 判断操作何时需要确认。",
        "Never ask" => "从不询问",
        "Codex will not pause for command approval." => "Codex 不会暂停等待命令审批。",
        "Read only" => "只读",
        "Commands can inspect files but cannot modify the workspace." => {
            "命令可以查看文件，但不能修改工作区。"
        }
        "Workspace access" => "工作区读写",
        "Commands can modify the current workspace within the sandbox." => {
            "命令可以在沙箱内修改当前工作区。"
        }
        "Full system access" => "完整系统权限",
        "Commands run without filesystem or network sandbox restrictions." => {
            "命令运行时不受文件系统或网络沙箱限制。"
        }
        "Off" => "关闭",
        "Remove the web search tool." => "移除网页搜索工具。",
        "Cached index" => "缓存索引",
        "Use OpenAI's maintained index without live external access." => {
            "使用 OpenAI 维护的索引，不进行实时外部访问。"
        }
        "Indexed live access" => "索引按需联网",
        "Allow external access only when the search index requires it." => {
            "仅在搜索索引需要时允许外部访问。"
        }
        "Live web" => "实时网页",
        "Allow unrestricted live web retrieval." => "允许不受限制的实时网页检索。",
        "Projected MCP" => "将投影的 MCP",
        "Projected Skills" => "将投影的 Skills",
        "All enabled" => "全部启用",
        "Some disabled" => "部分停用",
        "Account details" => "账户详情",
        "Model catalog" => "模型目录",
        "Search" => "搜索",
        "contains" => "包含",
        "models" => "个模型",
        "servers" => "个服务器",
        "Empty" => "已用尽",
        "Last 30 days" => "最近 30 天",
        "Updated" => "更新于",
        "Direct connection" => "直连",
        "Plan" => "套餐",
        "Period start" => "周期开始",
        "Period end" => "周期结束",
        "Next reset" => "下次重置",
        "Wallet fallback" => "钱包回退",
        "Unknown" => "未知",
        "About" => "关于",
        "Search settings" => "搜索设置",
        "Filter settings" => "按名称、状态或操作筛选设置",
        "Check for updates" => "检查更新",
        "Checking…" => "正在检查…",
        "Check for updates automatically" => "自动检查更新",
        "Open download page" => "打开下载页",
        "Install update" => "安装更新",
        "Signed update" => "签名更新",
        "Manual download" => "手动下载",
        "Update status" => "更新状态",
        "Updates" => "更新",
        "You have the latest version." => "已是最新版本。",
        "Not checked yet." => "尚未检查。",
        "Update check failed" => "检查更新失败",
        "A newer package is available:" => "有新的安装包：",
        "A signed update is available:" => "有可安装的签名更新：",
        "Installing update…" => "正在安装更新…",
        "This build is not a packaged install. Open the download page instead." => {
            "当前不是已打包的安装，请改从下载页安装。"
        }
        "This distribution has no download page" => "此发行版没有下载页",
        "This platform has no Connector package." => "此平台没有 Connector 安装包。",
        "Filter by model ID, provider, or tag" => "按模型 ID、提供方或标签筛选",
        "Choose a model" => "选择模型",
        "model" => "模型",
        "https://gateway.example.com or https://gateway.example.com/v1" => {
            "https://gateway.example.com 或 https://gateway.example.com/v1"
        }
        "API key, or leave blank for advertised browser login" => {
            "API 密钥；平台提供浏览器登录时可留空"
        }
        "(unavailable)" => "（不可用）",
        "(selected)" => "（已选）",
        "Saved choice is explicitly non-chat and cannot be projected" => {
            "已保存的选择明确不可对话，无法投影"
        }
        "Selected model is hidden by the current filter" => "已选模型被当前筛选隐藏",
        "Saved choice is not in the current catalog" => "已保存的选择不在当前目录中",
        "Saved choice is not a Responses-native Codex model" => {
            "已保存的选择不是 Responses 原生 Codex 模型"
        }
        "Saved choice is not a Codex Responses model" => {
            "已保存的选择不是可供 Codex 使用的 Responses 模型"
        }
        "Unknown chat capability — choosing this model confirms its use" => {
            "对话能力未知 — 选择即确认使用"
        }
        "Error:" => "错误：",
        "Isolated mode path validation failed:" => "隔离模式路径校验失败：",
        "s" => " 秒",
        "UTC" => "UTC",
        "Current BoxAI Connect page" => "当前 BoxAI Connect 页面",
        "Auto (best protocol for this Agent)" => "自动（此 Agent 的最佳协议）",
        "OpenAI Chat Completions" => "OpenAI Chat Completions",
        "OpenAI Responses" => "OpenAI Responses",
        "Anthropic Messages" => "Anthropic Messages",
        "Gemini" => "Gemini",
        "This protocol is not advertised by the Gateway" => "网关未公布此协议",
        "Install BoxAI Connect" => "安装 BoxAI Connect",
        "Update the installed copy" => "更新已安装的版本",
        "This copy is running from the temporary folder a file manager uses to preview an archive. That folder is deleted without warning, so a sign-in saved here does not survive. Install it first." => {
            "当前程序运行在文件管理器预览压缩包时使用的临时目录中。该目录会被系统随时清除，在这里保存的登录状态无法留存，请先安装。"
        }
        "An earlier version is already installed. Installing replaces it in place and keeps your account, so the copy you just downloaded can be deleted afterwards." => {
            "已安装较早的版本。安装会就地替换它并保留你的账户，完成后可以删除刚下载的文件。"
        }
        "Installing copies the program into your own program folder and adds it to the Start menu, so it keeps working after this download is cleaned up. Your account and settings stay where they are." => {
            "安装会把程序复制到你的程序目录并加入开始菜单，这样即使下载文件被清理也不影响使用。账户与设置保持不变。"
        }
        "Install location" => "安装位置",
        "Add a desktop shortcut" => "创建桌面快捷方式",
        "Install and start" => "安装并启动",
        "Update and restart" => "更新并重启",
        _ => english,
    }
}

fn vietnamese_text(english: &'static str) -> &'static str {
    match english {
        "Gateway" => "Cổng kết nối",
        "Connection" => "Kết nối",
        "Overview" => "Tổng quan",
        "Current account" => "Tài khoản hiện tại",
        "Current account data from the signed-in Gateway account." => {
            "Dữ liệu của tài khoản BoxAI đang đăng nhập."
        }
        "Agents" => "Tác nhân",
        "Quota" => "Hạn mức",
        "Used quota" => "Hạn mức đã dùng",
        "Request count" => "Số yêu cầu",
        "Recent rate" => "Tốc độ gần đây",
        "Requests per minute" => "Yêu cầu mỗi phút",
        "Tokens per minute" => "Token mỗi phút",
        "Usage by day" => "Mức dùng theo ngày",
        "Usage by model" => "Mức dùng theo mô hình",
        "Usage trend" => "Xu hướng sử dụng",
        "Recent requests" => "Yêu cầu gần đây",
        "No recent requests." => "Chưa có yêu cầu gần đây.",
        "Agent status" => "Trạng thái tác nhân",
        "Catalog sync" => "Đồng bộ danh mục",
        "Synchronized Skills" => "Skill đã đồng bộ",
        "Account data is unavailable." => "Không có dữ liệu tài khoản.",
        "All" => "Tất cả",
        "All vendors" => "Tất cả nhà cung cấp",
        "Text" => "Văn bản",
        "Image" => "Hình ảnh",
        "Model list" => "Danh sách mô hình",
        "Native" => "Gốc",
        "Converted" => "Chuyển đổi",
        "Runtime" => "Thiết lập chạy",
        "Writes" => "Sẽ ghi",
        "Write location" => "Vị trí ghi",
        "Connected" => "Đã kết nối",
        "Not connected" => "Chưa kết nối",
        "Loading saved connection" => "Đang tải kết nối đã lưu",
        "Connect a Gateway" => "Kết nối cổng BoxAI",
        "Connect" => "Kết nối",
        "Testing…" => "Đang kiểm tra…",
        "BoxAI account" => "Tài khoản BoxAI",
        "BoxAI Connect needs an account. Sign-in is confirmed in the browser; the account stays in this app's local config directory." => {
            "BoxAI Connect cần tài khoản. Bạn xác nhận đăng nhập trong trình duyệt; trạng thái tài khoản chỉ được lưu trong thư mục cấu hình cục bộ của ứng dụng."
        }
        "Sign in to BoxAI" => "Đăng nhập BoxAI",
        "Sign in" => "Đăng nhập",
        "Waiting…" => "Đang chờ…",
        "Complete sign-in in your browser" => "Hoàn tất đăng nhập trong trình duyệt",
        "Copy the sign-in link" => "Sao chép liên kết đăng nhập",
        "Waiting for confirmation…" => "Đang chờ xác nhận…",
        "Cancel sign-in" => "Hủy đăng nhập",
        "Try again" => "Thử lại",
        "Disconnect" => "Ngắt kết nối",
        "Apply" => "Áp dụng",
        "Applied" => "Đã áp dụng",
        "Apply again" => "Áp dụng lại",
        "Refresh" => "Làm mới",
        "Refreshing…" => "Đang làm mới…",
        "Search" => "Tìm kiếm",
        "Models" => "Mô hình",
        "Model Plaza" => "Kho mô hình",
        "Native and converted Responses models can be written to model_catalog_json. BoxAI Connect lets you choose." => {
            "Có thể ghi cả mô hình Responses gốc và mô hình đã chuyển đổi vào model_catalog_json. BoxAI Connect cho phép bạn lựa chọn."
        }
        "MCP Servers" => "Máy chủ MCP",
        "MCP server" => "Máy chủ MCP",
        "Skills" => "Skill",
        "Account" => "Tài khoản",
        "Settings" => "Cài đặt",
        "Appearance" => "Giao diện",
        "Language" => "Ngôn ngữ",
        "Theme" => "Chủ đề",
        "Density" => "Mật độ",
        "System" => "Hệ thống",
        "Studio Light" => "Sáng",
        "Studio Dark" => "Tối",
        "Compact" => "Gọn",
        "Comfortable" => "Thoải mái",
        "Updates" => "Cập nhật",
        "Check for updates" => "Kiểm tra cập nhật",
        "Checking…" => "Đang kiểm tra…",
        "Up to date" => "Đã cập nhật",
        "Install update" => "Cài đặt bản cập nhật",
        "Download update" => "Tải bản cập nhật",
        "Downloading…" => "Đang tải…",
        "Version" => "Phiên bản",
        "About" => "Giới thiệu",
        "Open download page" => "Mở trang tải xuống",
        "Sign out" => "Đăng xuất",
        "Sign out of BoxAI Connect?" => "Đăng xuất khỏi BoxAI Connect?",
        "Cancel" => "Hủy",
        "Continue" => "Tiếp tục",
        "Close" => "Đóng",
        "Copy" => "Sao chép",
        "Done" => "Xong",
        "Error:" => "Lỗi:",
        "None" => "Không có",
        "Unknown" => "Không xác định",
        "Available" => "Khả dụng",
        "Unavailable" => "Không khả dụng",
        "Never" => "Chưa bao giờ",
        "Quit application" => "Thoát ứng dụng",
        "Current BoxAI Connect page" => "Trang BoxAI Connect hiện tại",
        "Install BoxAI Connect" => "Cài đặt BoxAI Connect",
        _ => english,
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ThemePreference {
    #[default]
    System,
    Light,
    Dark,
}

impl ThemePreference {
    pub const ALL: [Self; 3] = [Self::System, Self::Light, Self::Dark];

    pub const fn id(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::Light => "light",
            Self::Dark => "dark",
        }
    }

    pub fn from_id(value: &str) -> Option<Self> {
        match value {
            "system" => Some(Self::System),
            "light" => Some(Self::Light),
            "dark" => Some(Self::Dark),
            _ => None,
        }
    }

    pub fn display_name(self, locale: Locale) -> &'static str {
        locale.text(match self {
            Self::System => "System",
            Self::Light => "Studio Light",
            Self::Dark => "Studio Dark",
        })
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DensityPreference {
    Compact,
    #[default]
    Comfortable,
}

impl DensityPreference {
    pub const ALL: [Self; 2] = [Self::Compact, Self::Comfortable];

    pub const fn id(self) -> &'static str {
        match self {
            Self::Compact => "compact",
            Self::Comfortable => "comfortable",
        }
    }

    pub fn from_id(value: &str) -> Option<Self> {
        match value {
            "compact" => Some(Self::Compact),
            "comfortable" => Some(Self::Comfortable),
            _ => None,
        }
    }

    pub fn display_name(self, locale: Locale) -> &'static str {
        locale.text(match self {
            Self::Compact => "Compact",
            Self::Comfortable => "Comfortable",
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Preferences {
    pub locale: Locale,
    pub theme: ThemePreference,
    pub density: DensityPreference,
    pub auto_check_updates: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            locale: Locale::Vi,
            theme: ThemePreference::Dark,
            density: DensityPreference::Comfortable,
            auto_check_updates: true,
        }
    }
}

#[derive(Debug, Clone)]
pub struct PreferenceStore {
    path: PathBuf,
}

impl PreferenceStore {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    pub fn load(&self) -> Preferences {
        self.load_or_else(Preferences::default)
    }

    pub fn load_or(&self, fallback: Preferences) -> Preferences {
        self.load_or_else(|| fallback)
    }

    fn load_or_else(&self, fallback: impl FnOnce() -> Preferences) -> Preferences {
        self.with_lock(|| fs::read(&self.path))
            .ok()
            .and_then(Result::ok)
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_else(fallback)
    }

    pub fn save(&self, preferences: &Preferences) -> io::Result<()> {
        self.with_lock(|| {
            let suffix = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let temporary = self
                .path
                .with_extension(format!("tmp-{}-{suffix}", std::process::id()));
            let result = (|| {
                let bytes = serde_json::to_vec_pretty(preferences)
                    .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
                let mut file = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&temporary)?;
                file.write_all(&bytes)?;
                file.write_all(b"\n")?;
                file.sync_all()?;
                replace_file(&temporary, &self.path)
            })();
            if result.is_err() {
                let _ = fs::remove_file(&temporary);
            }
            result
        })?
    }

    fn with_lock<T>(&self, operation: impl FnOnce() -> T) -> io::Result<T> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| io::Error::other("preference path has no parent"))?;
        fs::create_dir_all(parent)?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(parent.join("preferences.lock"))?;
        lock.lock_exclusive()?;
        let value = operation();
        lock.unlock()?;
        Ok(value)
    }
}

#[cfg(not(windows))]
fn replace_file(from: &Path, to: &Path) -> io::Result<()> {
    fs::rename(from, to)
}

#[cfg(windows)]
#[allow(unsafe_code)]
fn replace_file(from: &Path, to: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };
    let from = from
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let to = to
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    if unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simplified_chinese_os_variants_are_supported() {
        assert_eq!(Locale::from_os(Some("zh-CN")), Locale::ZhCn);
        assert_eq!(Locale::from_os(Some("zh_Hans")), Locale::ZhCn);
        assert_eq!(Locale::from_os(Some("fr-FR")), Locale::En);
    }

    #[test]
    fn signed_out_boxai_copy_is_browser_sign_in() {
        assert_eq!(Locale::ZhCn.text("Sign in to BoxAI"), "登录 BoxAI");
        assert_eq!(Locale::ZhCn.text("BoxAI account"), "BoxAI 账号");
        assert_eq!(Locale::ZhCn.text("Overview"), "总览");
        assert_eq!(Locale::ZhCn.text("About"), "关于");
        assert_eq!(Locale::ZhCn.text("Check for updates"), "检查更新");
        assert_eq!(Locale::ZhCn.text("Embeddings and rerank"), "向量与重排");
        assert_eq!(
            Locale::ZhCn.text("Filter by model ID, provider, or tag"),
            "按模型 ID、提供方或标签筛选"
        );
        assert_eq!(Locale::ZhCn.text("Choose a model"), "选择模型");
        assert_eq!(Locale::ZhCn.text("Error:"), "错误：");
        assert_eq!(Locale::ZhCn.text("Install and start"), "安装并启动");
        assert_eq!(Locale::ZhCn.text("Update and restart"), "更新并重启");
        assert_eq!(Locale::ZhCn.text("Install location"), "安装位置");
        assert_eq!(Locale::ZhCn.text("Application"), "应用");
        assert_eq!(Locale::ZhCn.text("Quit application"), "退出应用");
        assert_ne!(
            Locale::ZhCn.text("Install BoxAI Connect"),
            Locale::ZhCn.text("Update the installed copy")
        );
        assert_eq!(Locale::ZhCn.text("Continue"), "继续");
        assert_eq!(Locale::ZhCn.text("s"), " 秒");
        assert_eq!(Locale::En.text("Sign in to BoxAI"), "Sign in to BoxAI");
        assert_ne!(
            Locale::ZhCn.text("Sign in to BoxAI"),
            Locale::ZhCn.text("Connect a Gateway")
        );
    }

    #[test]
    fn preferences_round_trip_without_credentials() {
        let directory = tempfile::tempdir().expect("tempdir");
        let store = PreferenceStore::new(directory.path().join("preferences.json"));
        let expected = Preferences {
            locale: Locale::ZhCn,
            theme: ThemePreference::Dark,
            density: DensityPreference::Compact,
            auto_check_updates: false,
        };
        store.save(&expected).expect("save");
        assert_eq!(store.load(), expected);
        let json = fs::read_to_string(directory.path().join("preferences.json")).expect("read");
        assert!(!json.contains("credential"));
        assert!(!json.contains("token"));
    }

    #[test]
    fn malformed_preferences_fall_back_safely() {
        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("preferences.json");
        fs::write(&path, b"not json").expect("write");
        let loaded = PreferenceStore::new(path).load();
        assert_eq!(loaded.locale, Locale::Vi);
        assert_eq!(loaded.theme, ThemePreference::Dark);
    }

    #[test]
    fn first_run_preferences_are_vietnamese_and_dark() {
        let preferences = Preferences::default();
        assert_eq!(preferences.locale, Locale::Vi);
        assert_eq!(preferences.theme, ThemePreference::Dark);
        assert_eq!(preferences.density, DensityPreference::Comfortable);
        assert!(preferences.auto_check_updates);
    }
}
