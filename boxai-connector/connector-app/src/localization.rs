use crate::backend::BackendError;
use fs2::FileExt;
use std::{
    fs,
    fs::OpenOptions,
    io,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Locale {
    En,
    Vi,
}

impl Locale {
    pub fn backend_error(self, error: &BackendError) -> String {
        match error {
            BackendError::Core(error) => {
                self.with_detail(Message::ErrorConnectorData, &error.to_string())
            }
            BackendError::Network => text(self, Message::ErrorNetwork).into(),
            BackendError::Http(status) => self.with_detail(Message::ErrorHttp, &status.to_string()),
            BackendError::Response => text(self, Message::ErrorResponse).into(),
            BackendError::Timeout => text(self, Message::ErrorTimeout).into(),
            BackendError::StateMismatch => text(self, Message::ErrorStateMismatch).into(),
            BackendError::LoginDenied(detail) => {
                self.with_detail(Message::ErrorLoginDenied, detail)
            }
            BackendError::Credential => text(self, Message::ErrorCredential).into(),
            BackendError::State { path, message } => self.with_detail(
                Message::ErrorLocalState,
                &format!("{}: {message}", path.display()),
            ),
            BackendError::Browser => text(self, Message::ErrorBrowser).into(),
            BackendError::PendingRevocation => text(self, Message::ErrorPendingRevocation).into(),
        }
    }

    pub const fn id(self) -> &'static str {
        match self {
            Self::En => "en",
            Self::Vi => "vi",
        }
    }
    pub fn from_id(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "en" => Some(Self::En),
            "vi" => Some(Self::Vi),
            _ => None,
        }
    }
    pub fn resolve_os(value: Option<&str>) -> Self {
        let language = value
            .unwrap_or_default()
            .split(['-', '_'])
            .next()
            .unwrap_or_default();
        if language.eq_ignore_ascii_case("vi") {
            Self::Vi
        } else {
            Self::En
        }
    }
    pub const fn display_name(self) -> &'static str {
        match self {
            Self::En => "English",
            Self::Vi => "Tiếng Việt",
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub enum Message {
    Connection,
    AgentClients,
    GatewayServices,
    SettingsDiagnostics,
    Connector,
    ModelsServices,
    Settings,
    Connected,
    NotConnected,
    Disconnected,
    RefreshGateway,
    ConnectAccount,
    ConnectionBoundary,
    Protocols,
    ChatModels,
    CredentialStorage,
    OsVault,
    Detected,
    NotFound,
    NoModel,
    PreviewChanges,
    ApplyAgents,
    ConfigurationPreview,
    Chat,
    RemoteBearer,
    Synchronized,
    Models,
    RemoteMcp,
    OfficialSkills,
    Runtime,
    LocalRelay,
    NotInstalled,
    Architecture,
    LoopbackCallback,
    Temporary,
    Authentication,
    GatewayCredential,
    SystemVault,
    OperatingSystem,
    Maintenance,
    ReloadStatus,
    Reload,
    RemoveConfiguration,
    ConfirmRemoval,
    ReviewRemoval,
    SignOutRevoke,
    ConfirmSignOut,
    ReviewSignOut,
    Retry,
    Language,
    LanguageDescription,
    LanguageSelectorName,
    SelectLanguage,
    Create,
    Update,
    Remove,
    Skill,
    LoadingManifest,
    GatewayUnavailable,
    ServicesAfterSignIn,
    ProvisioningUnavailable,
    NoChatModels,
    NoMcp,
    NoSkills,
    SavingModel,
    CheckingGateway,
    WaitingSignIn,
    RefreshingCatalog,
    BuildingPreview,
    ApplyingConfiguration,
    RemovingProjections,
    RevokingCredential,
    OverviewSubtitle,
    AgentsSubtitle,
    ServicesSubtitle,
    SettingsSubtitle,
    ModelSelectorName,
    ConnectLoadModels,
    PreferenceSaveFailed,
    ConnectedNotice,
    ConnectorAttention,
    ProvisioningStillUnavailable,
    RefreshedNotice,
    VerificationMismatch,
    ProjectionsRemovedNotice,
    RevokedNotice,
    LocalSignOutNotice,
    RemoveConfirmation,
    SignOutConfirmation,
    DirectConnectionExplanation,
    BoundaryDescription,
    ConnectFirst,
    AccountScopedDetail,
    InstallAgentReason,
    NoVisibleModelReason,
    PreviewFirstReason,
    EmptyModelWarning,
    EmptyCatalogDetail,
    EmptySkillsDetail,
    AgentsDirectDescription,
    CallbackDescription,
    VaultDescription,
    MaintenanceDescription,
    LogoutDescription,
    NoManagedState,
    ManagedByConnector,
    CallbackSuccess,
    CallbackFailure,
    ErrorConnectorData,
    ErrorNetwork,
    ErrorHttp,
    ErrorResponse,
    ErrorTimeout,
    ErrorStateMismatch,
    ErrorLoginDenied,
    ErrorCredential,
    ErrorLocalState,
    ErrorBrowser,
    ErrorPendingRevocation,
}

pub fn text(locale: Locale, message: Message) -> &'static str {
    use Message::*;
    match (locale, message) {
        (Locale::Vi, Connection) => "Kết nối",
        (Locale::Vi, AgentClients) => "Ứng dụng Agent",
        (Locale::Vi, GatewayServices) => "Dịch vụ Gateway",
        (Locale::Vi, SettingsDiagnostics) => "Cài đặt & chẩn đoán",
        (Locale::Vi, Connector) => "Trình kết nối",
        (Locale::Vi, ModelsServices) => "Mô hình & dịch vụ",
        (Locale::Vi, Settings) => "Cài đặt",
        (Locale::Vi, Connected) => "Đã kết nối",
        (Locale::Vi, NotConnected) => "Chưa kết nối",
        (Locale::Vi, Disconnected) => "Đã ngắt kết nối",
        (Locale::Vi, RefreshGateway) => "Làm mới từ Gateway",
        (Locale::Vi, ConnectAccount) => "Kết nối tài khoản",
        (Locale::Vi, ConnectionBoundary) => "Phạm vi kết nối",
        (Locale::Vi, Protocols) => "Giao thức",
        (Locale::Vi, ChatModels) => "Mô hình hỗ trợ chat",
        (Locale::Vi, CredentialStorage) => "Nơi lưu thông tin xác thực",
        (Locale::Vi, OsVault) => "Kho bảo mật hệ điều hành",
        (Locale::Vi, Detected) => "Đã phát hiện",
        (Locale::Vi, NotFound) => "Không tìm thấy",
        (Locale::Vi, NoModel) => "Không có mô hình",
        (Locale::Vi, PreviewChanges) => "Xem trước thay đổi",
        (Locale::Vi, ApplyAgents) => "Áp dụng cho Agent đã phát hiện",
        (Locale::Vi, ConfigurationPreview) => "Xem trước cấu hình",
        (Locale::Vi, Chat) => "Chat",
        (Locale::Vi, RemoteBearer) => "Bearer từ xa",
        (Locale::Vi, Synchronized) => "Đã đồng bộ",
        (Locale::Vi, Models) => "Mô hình",
        (Locale::Vi, RemoteMcp) => "MCP từ xa",
        (Locale::Vi, OfficialSkills) => "Skill chính thức",
        (Locale::Vi, Runtime) => "Môi trường chạy",
        (Locale::Vi, LocalRelay) => "Relay mô hình cục bộ",
        (Locale::Vi, NotInstalled) => "Chưa cài đặt",
        (Locale::Vi, Architecture) => "Kiến trúc",
        (Locale::Vi, LoopbackCallback) => "Callback loopback",
        (Locale::Vi, Temporary) => "Tạm thời",
        (Locale::Vi, Authentication) => "Xác thực",
        (Locale::Vi, GatewayCredential) => "Thông tin xác thực Gateway",
        (Locale::Vi, SystemVault) => "Kho hệ thống",
        (Locale::Vi, OperatingSystem) => "Hệ điều hành",
        (Locale::Vi, Maintenance) => "Bảo trì",
        (Locale::Vi, ReloadStatus) => "Tải lại trạng thái",
        (Locale::Vi, Reload) => "Tải lại",
        (Locale::Vi, RemoveConfiguration) => "Xóa cấu hình Agent được quản lý",
        (Locale::Vi, ConfirmRemoval) => "Xác nhận xóa",
        (Locale::Vi, ReviewRemoval) => "Xem lại việc xóa",
        (Locale::Vi, SignOutRevoke) => "Đăng xuất & thu hồi",
        (Locale::Vi, ConfirmSignOut) => "Xác nhận đăng xuất",
        (Locale::Vi, ReviewSignOut) => "Xem lại đăng xuất",
        (Locale::Vi, Retry) => "Thử lại",
        (Locale::Vi, Language) => "Ngôn ngữ",
        (Locale::Vi, LanguageDescription) => "Chọn ngôn ngữ hiển thị của BoxAI Connector.",
        (Locale::Vi, LanguageSelectorName) => "Ngôn ngữ ứng dụng",
        (Locale::Vi, SelectLanguage) => "Chọn ngôn ngữ",
        (Locale::Vi, Create) => "Tạo",
        (Locale::Vi, Update) => "Cập nhật",
        (Locale::Vi, Remove) => "Xóa",
        (Locale::Vi, Skill) => "Skill",
        (Locale::Vi, LoadingManifest) => "Đang tải manifest của trình kết nối…",
        (Locale::Vi, GatewayUnavailable) => "Không có trạng thái Gateway",
        (Locale::Vi, ServicesAfterSignIn) => "Dịch vụ khả dụng sau khi đăng nhập",
        (Locale::Vi, ProvisioningUnavailable) => "Không có dữ liệu cấp phát Gateway",
        (Locale::Vi, NoChatModels) => "Không có mô hình chat khả dụng",
        (Locale::Vi, NoMcp) => "Không có dịch vụ MCP được công bố",
        (Locale::Vi, NoSkills) => "Không có Skill chính thức được công bố",
        (Locale::Vi, SavingModel) => "Đang lưu lựa chọn mô hình Agent…",
        (Locale::Vi, CheckingGateway) => "Đang kiểm tra Gateway…",
        (Locale::Vi, WaitingSignIn) => "Đang chờ đăng nhập trên trình duyệt…",
        (Locale::Vi, RefreshingCatalog) => "Đang làm mới danh mục trực tuyến…",
        (Locale::Vi, BuildingPreview) => "Đang tạo bản xem trước chỉ đọc…",
        (Locale::Vi, ApplyingConfiguration) => "Đang áp dụng và xác minh cấu hình Agent…",
        (Locale::Vi, RemovingProjections) => "Đang xóa cấu hình được quản lý…",
        (Locale::Vi, RevokingCredential) => "Đang xóa cấu hình và thu hồi thông tin xác thực…",
        (Locale::Vi, OverviewSubtitle) => {
            "Kết nối trực tiếp thiết bị này với Gateway của nền tảng."
        }
        (Locale::Vi, AgentsSubtitle) => {
            "Chọn mô hình mặc định cho từng Agent đã cài đặt và xem trước mọi thay đổi được quản lý."
        }
        (Locale::Vi, ServicesSubtitle) => {
            "Mô hình, máy chủ MCP từ xa và Skill chính thức vẫn do Gateway kiểm soát."
        }
        (Locale::Vi, SettingsSubtitle) => {
            "Thông tin xác thực nằm trong kho bảo mật hệ điều hành. Không có relay cục bộ nào chạy nền."
        }
        (Locale::Vi, ModelSelectorName) => "Mô hình mặc định của Agent",
        (Locale::Vi, ConnectLoadModels) => "Kết nối để tải mô hình",
        (Locale::Vi, PreferenceSaveFailed) => {
            "Không thể lưu tùy chọn ngôn ngữ. Hãy kiểm tra quyền truy cập thư mục dữ liệu ứng dụng rồi thử lại."
        }
        (Locale::Vi, ConnectedNotice) => "Đã kết nối tài khoản Gateway.",
        (Locale::Vi, ConnectorAttention) => "Trình kết nối cần được xử lý",
        (Locale::Vi, ProvisioningStillUnavailable) => "Dữ liệu cấp phát Gateway vẫn chưa khả dụng",
        (Locale::Vi, RefreshedNotice) => "Đã làm mới mô hình và dịch vụ Gateway.",
        (Locale::Vi, VerificationMismatch) => {
            "Đã áp dụng thay đổi nhưng kết quả xác minh không khớp."
        }
        (Locale::Vi, ProjectionsRemovedNotice) => "Đã xóa cấu hình Agent và Skill được quản lý.",
        (Locale::Vi, RevokedNotice) => {
            "Đã đăng xuất và thu hồi thông tin xác thực của Trình kết nối này."
        }
        (Locale::Vi, LocalSignOutNotice) => {
            "Đã đăng xuất cục bộ. Nền tảng này không hỗ trợ tự thu hồi."
        }
        (Locale::Vi, RemoveConfirmation) => {
            "Xem lại ảnh hưởng rồi chọn Xác nhận xóa. Tài khoản BoxAI của bạn vẫn được kết nối."
        }
        (Locale::Vi, SignOutConfirmation) => {
            "Xem lại ảnh hưởng rồi chọn Xác nhận đăng xuất. Cấu hình được quản lý sẽ bị xóa trước khi thu hồi thông tin xác thực."
        }
        (Locale::Vi, DirectConnectionExplanation) => {
            "Agent bên ngoài gọi trực tiếp BoxAI và máy chủ MCP từ xa. BoxAI Connector không khởi động proxy mô hình hoặc duy trì dịch vụ cục bộ."
        }
        (Locale::Vi, BoundaryDescription) => {
            "Nền tảng quản lý danh mục; mỗi Agent quản lý mô hình mặc định riêng."
        }
        (Locale::Vi, ConnectFirst) => "Trước tiên, hãy kết nối tài khoản Gateway",
        (Locale::Vi, AccountScopedDetail) => {
            "Lựa chọn mô hình và cấu hình được quản lý thuộc phạm vi tài khoản."
        }
        (Locale::Vi, InstallAgentReason) => {
            "Cài đặt hoặc khởi chạy Agent được hỗ trợ để Trình kết nối phát hiện thư mục gốc cấu hình."
        }
        (Locale::Vi, NoVisibleModelReason) => {
            "Không có mô hình chat nào hiển thị với tài khoản. Hãy làm mới sau khi quản trị viên bật một mô hình."
        }
        (Locale::Vi, PreviewFirstReason) => {
            "Xem trước các thay đổi tệp được quản lý trước khi áp dụng."
        }
        (Locale::Vi, EmptyModelWarning) => {
            "Tài khoản này hiện không có mô hình chat khả dụng. Không thể áp dụng cấu hình cho đến khi danh mục Gateway có mô hình."
        }
        (Locale::Vi, EmptyCatalogDetail) => {
            "Gateway trả về danh mục hiển thị với tài khoản nhưng không có mục nào."
        }
        (Locale::Vi, EmptySkillsDetail) => {
            "BoxAI Connector không tự tạo danh mục Skill khi nền tảng không quản lý danh mục đó."
        }
        (Locale::Vi, AgentsDirectDescription) => {
            "Agent kết nối trực tiếp với Gateway của nền tảng."
        }
        (Locale::Vi, CallbackDescription) => {
            "Chỉ mở trong lúc đăng nhập PKCE bằng trình duyệt, sau đó sẽ đóng."
        }
        (Locale::Vi, VaultDescription) => {
            "Không bao giờ được ghi vào trạng thái JSON của BoxAI Connector."
        }
        (Locale::Vi, MaintenanceDescription) => {
            "Việc xóa có quản lý giữ nguyên nhà cung cấp, máy chủ MCP, Skill và mục cấu hình không liên quan."
        }
        (Locale::Vi, LogoutDescription) => {
            "Xóa cấu hình được quản lý trước khi xóa thông tin xác thực khỏi hệ điều hành."
        }
        (Locale::Vi, NoManagedState) => {
            "Không có cấu hình được quản lý hoặc thông tin xác thực Trình kết nối đã lưu."
        }
        (Locale::Vi, ManagedByConnector) => "BoxAI Connector quản lý",
        (Locale::Vi, CallbackSuccess) => "Đã đăng nhập. Bạn có thể đóng thẻ này.",
        (Locale::Vi, CallbackFailure) => "Chưa hoàn tất đăng nhập.",
        (Locale::Vi, ErrorConnectorData) => "Không thể xác minh dữ liệu Trình kết nối",
        (Locale::Vi, ErrorNetwork) => "Yêu cầu mạng không thành công.",
        (Locale::Vi, ErrorHttp) => "Gateway trả về lỗi HTTP",
        (Locale::Vi, ErrorResponse) => "Phản hồi Gateway không hợp lệ.",
        (Locale::Vi, ErrorTimeout) => "Đã hết thời gian đăng nhập.",
        (Locale::Vi, ErrorStateMismatch) => "Trạng thái callback đăng nhập không khớp.",
        (Locale::Vi, ErrorLoginDenied) => "Đăng nhập bị từ chối",
        (Locale::Vi, ErrorCredential) => "Kho thông tin xác thực không khả dụng.",
        (Locale::Vi, ErrorLocalState) => "Lỗi trạng thái cục bộ",
        (Locale::Vi, ErrorBrowser) => "Không thể mở trình duyệt hệ thống.",
        (Locale::Vi, ErrorPendingRevocation) => {
            "Không thể lưu thông tin xác thực và vẫn đang chờ thu hồi từ xa."
        }
        (_, message) => english(message),
    }
}

fn english(message: Message) -> &'static str {
    use Message::*;
    match message {
        Connection => "Connection",
        AgentClients => "Agent clients",
        GatewayServices => "Gateway services",
        SettingsDiagnostics => "Settings & diagnostics",
        Connector => "Connector",
        ModelsServices => "Models & services",
        Settings => "Settings",
        Connected => "Connected",
        NotConnected => "Not connected",
        Disconnected => "Disconnected",
        RefreshGateway => "Refresh from Gateway",
        ConnectAccount => "Connect account",
        ConnectionBoundary => "Connection boundary",
        Protocols => "Protocols",
        ChatModels => "Chat-capable models",
        CredentialStorage => "Credential storage",
        OsVault => "Operating-system vault",
        Detected => "Detected",
        NotFound => "Not found",
        NoModel => "No model available",
        PreviewChanges => "Preview changes",
        ApplyAgents => "Apply to detected Agents",
        ConfigurationPreview => "Configuration preview",
        Chat => "Chat",
        RemoteBearer => "Remote bearer",
        Synchronized => "Synchronized",
        Models => "Models",
        RemoteMcp => "Remote MCP",
        OfficialSkills => "Official Skills",
        Runtime => "Runtime",
        LocalRelay => "Local model relay",
        NotInstalled => "Not installed",
        Architecture => "Architecture",
        LoopbackCallback => "Loopback callback",
        Temporary => "Temporary",
        Authentication => "Authentication",
        GatewayCredential => "Gateway credential",
        SystemVault => "System vault",
        OperatingSystem => "Operating system",
        Maintenance => "Maintenance",
        ReloadStatus => "Reload status",
        Reload => "Reload",
        RemoveConfiguration => "Remove managed Agent configuration",
        ConfirmRemoval => "Confirm removal",
        ReviewRemoval => "Review removal",
        SignOutRevoke => "Sign out & revoke",
        ConfirmSignOut => "Confirm sign out",
        ReviewSignOut => "Review sign out",
        Retry => "Retry",
        Language => "Language",
        LanguageDescription => "Choose the display language for BoxAI Connector.",
        LanguageSelectorName => "Application language",
        SelectLanguage => "Select language",
        Create => "Create",
        Update => "Update",
        Remove => "Remove",
        Skill => "Skill",
        LoadingManifest => "Loading the connector manifest…",
        GatewayUnavailable => "Gateway status is unavailable",
        ServicesAfterSignIn => "Services are available after sign-in",
        ProvisioningUnavailable => "Gateway provisioning is unavailable",
        NoChatModels => "No callable chat models",
        NoMcp => "No MCP services advertised",
        NoSkills => "No official Skills advertised",
        SavingModel => "Saving the Agent model choice…",
        CheckingGateway => "Checking Gateway readiness…",
        WaitingSignIn => "Waiting for browser sign-in…",
        RefreshingCatalog => "Refreshing online catalog…",
        BuildingPreview => "Building a read-only preview…",
        ApplyingConfiguration => "Applying and verifying Agent configuration…",
        RemovingProjections => "Removing managed projections…",
        RevokingCredential => "Removing projections and revoking credential…",
        OverviewSubtitle => "Connect this device directly to your platform Gateway.",
        AgentsSubtitle => {
            "Choose a default model for each installed Agent and preview every managed change."
        }
        ServicesSubtitle => {
            "Models, remote MCP servers, and official Skills remain controlled by the Gateway."
        }
        SettingsSubtitle => {
            "Credentials stay in the operating-system vault. No local relay runs in the background."
        }
        ModelSelectorName => "Agent default model",
        ConnectLoadModels => "Connect to load models",
        PreferenceSaveFailed => {
            "The language preference could not be saved. Check access to the application data folder and try again."
        }
        ConnectedNotice => "Gateway account connected.",
        ConnectorAttention => "Connector requires attention",
        ProvisioningStillUnavailable => "Gateway provisioning is still unavailable",
        RefreshedNotice => "Gateway models and services refreshed.",
        VerificationMismatch => "Changes were applied, but verification found a mismatch.",
        ProjectionsRemovedNotice => "Managed Agent configuration and Skills were removed.",
        RevokedNotice => "Signed out and revoked this Connector credential.",
        LocalSignOutNotice => "Signed out locally. This platform does not expose self-revocation.",
        RemoveConfirmation => {
            "Review the impact, then choose Confirm removal. Your BoxAI account remains connected."
        }
        SignOutConfirmation => {
            "Review the impact, then choose Confirm sign out. Managed projections are removed before the credential is revoked."
        }
        DirectConnectionExplanation => {
            "External Agents call BoxAI and remote MCP servers directly. BoxAI Connector does not start a model proxy or keep a local service running."
        }
        BoundaryDescription => {
            "The platform owns the catalog; each Agent owns its own default model."
        }
        ConnectFirst => "Connect a Gateway account first",
        AccountScopedDetail => "Model choices and managed configuration are account-scoped.",
        InstallAgentReason => {
            "Install or launch a supported Agent so Connector can detect its configuration root."
        }
        NoVisibleModelReason => {
            "No account-visible chat model is available. Refresh after an administrator enables one."
        }
        PreviewFirstReason => "Preview the managed file changes before applying them.",
        EmptyModelWarning => {
            "This account currently has no callable chat model. Configuration cannot be applied until the Gateway catalog contains one."
        }
        EmptyCatalogDetail => "The Gateway returned an empty account-visible catalog.",
        EmptySkillsDetail => {
            "BoxAI Connector does not invent a Skill catalog the platform does not own."
        }
        AgentsDirectDescription => "Agents connect to the platform Gateway directly.",
        CallbackDescription => "Opened only during browser PKCE sign-in, then closed.",
        VaultDescription => "Never written into BoxAI Connector's JSON state.",
        MaintenanceDescription => {
            "Managed removal preserves unrelated providers, MCP servers, Skills, and config entries."
        }
        LogoutDescription => "Removes managed projections before clearing the OS credential.",
        NoManagedState => "No managed projection or stored Connector credential is present.",
        ManagedByConnector => "Managed by BoxAI Connector",
        CallbackSuccess => "Signed in. You may close this tab.",
        CallbackFailure => "Sign-in was not completed.",
        ErrorConnectorData => "Connector data could not be validated",
        ErrorNetwork => "Network request failed.",
        ErrorHttp => "Gateway returned HTTP error",
        ErrorResponse => "The Gateway response is invalid.",
        ErrorTimeout => "Sign-in timed out.",
        ErrorStateMismatch => "The sign-in callback state did not match.",
        ErrorLoginDenied => "Sign-in was declined",
        ErrorCredential => "Credential storage is unavailable.",
        ErrorLocalState => "Local state error",
        ErrorBrowser => "The system browser could not be opened.",
        ErrorPendingRevocation => {
            "The credential could not be stored and remote revocation is still pending."
        }
    }
}

impl Locale {
    pub fn with_detail(self, prefix: Message, detail: &str) -> String {
        format!("{}: {detail}", text(self, prefix))
    }
    pub fn model_updated(self, agent: &str) -> String {
        match self {
            Self::En => format!("{agent} will use the new model after changes are applied."),
            Self::Vi => format!("{agent} sẽ dùng mô hình mới sau khi áp dụng thay đổi."),
        }
    }
    pub fn previewed(self, count: usize) -> String {
        match self {
            Self::En => format!("Previewed {count} managed change(s). Nothing was written."),
            Self::Vi => {
                format!("Đã xem trước {count} thay đổi được quản lý. Chưa ghi dữ liệu nào.")
            }
        }
    }
    pub fn applied(self, count: usize) -> String {
        match self {
            Self::En => format!("Applied and verified {count} managed change(s)."),
            Self::Vi => format!("Đã áp dụng và xác minh {count} thay đổi được quản lý."),
        }
    }
    pub fn detected_count(self, detected: usize, total: usize) -> String {
        match self {
            Self::En => format!("{detected} of {total} detected"),
            Self::Vi => format!("Đã phát hiện {detected}/{total}"),
        }
    }
    pub fn section_count(self, label: Message, count: usize) -> String {
        format!("{} · {count}", text(self, label))
    }
    pub fn model_selector_name(self, agent: &str) -> String {
        match self {
            Self::En => format!("{agent} — Agent default model"),
            Self::Vi => format!("{agent} — Mô hình mặc định của Agent"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct LocaleStore {
    path: PathBuf,
}
impl LocaleStore {
    pub fn new(state_dir: impl AsRef<Path>) -> Self {
        Self {
            path: state_dir.as_ref().join("locale"),
        }
    }
    pub fn load(&self, os_locale: Option<&str>) -> Locale {
        self.with_lock(|| fs::read_to_string(&self.path))
            .ok()
            .and_then(Result::ok)
            .and_then(|v| Locale::from_id(&v))
            .unwrap_or_else(|| Locale::resolve_os(os_locale))
    }
    pub fn load_system(&self) -> Locale {
        self.load(sys_locale::get_locale().as_deref())
    }
    pub fn save(&self, locale: Locale) -> io::Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        self.with_lock(|| {
            let suffix = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let temporary = self
                .path
                .with_extension(format!("tmp-{}-{suffix}", std::process::id()));
            let result = (|| {
                let mut file = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&temporary)?;
                use io::Write;
                file.write_all(locale.id().as_bytes())?;
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
            .ok_or_else(|| io::Error::other("locale path has no parent"))?;
        fs::create_dir_all(parent)?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(parent.join("locale.lock"))?;
        lock.lock_exclusive()?;
        let result = operation();
        lock.unlock()?;
        Ok(result)
    }
}

#[cfg(not(windows))]
fn replace_file(from: &Path, to: &Path) -> io::Result<()> {
    fs::rename(from, to)
}

#[cfg(windows)]
fn replace_file(from: &Path, to: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };
    let from: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
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
    use tempfile::tempdir;
    #[test]
    fn resolves_supported_os_variants() {
        assert_eq!(Locale::resolve_os(Some("vi-VN")), Locale::Vi);
        assert_eq!(Locale::resolve_os(Some("VI_vn")), Locale::Vi);
    }
    #[test]
    fn unsupported_or_missing_is_english() {
        assert_eq!(Locale::resolve_os(Some("fr-FR")), Locale::En);
        assert_eq!(Locale::resolve_os(None), Locale::En);
    }
    #[test]
    fn preference_overrides_os_across_instances() {
        let d = tempdir().unwrap();
        LocaleStore::new(d.path()).save(Locale::En).unwrap();
        assert_eq!(LocaleStore::new(d.path()).load(Some("vi-VN")), Locale::En);
    }
    #[test]
    fn malformed_preference_falls_back() {
        let d = tempdir().unwrap();
        fs::write(d.path().join("locale"), "xx").unwrap();
        assert_eq!(LocaleStore::new(d.path()).load(Some("vi")), Locale::Vi);
    }
    #[test]
    fn language_change_is_persisted() {
        let d = tempdir().unwrap();
        let s = LocaleStore::new(d.path());
        s.save(Locale::En).unwrap();
        s.save(Locale::Vi).unwrap();
        assert_eq!(LocaleStore::new(d.path()).load(None), Locale::Vi);
    }

    #[test]
    fn dynamic_messages_follow_locale_and_preserve_values() {
        assert_eq!(Locale::En.detected_count(2, 5), "2 of 5 detected");
        assert_eq!(Locale::Vi.detected_count(2, 5), "Đã phát hiện 2/5");
        assert_eq!(
            Locale::Vi.with_detail(Message::ConnectorAttention, "HTTP 503"),
            "Trình kết nối cần được xử lý: HTTP 503"
        );
        assert_eq!(
            Locale::Vi.model_selector_name("Claude Code"),
            "Claude Code — Mô hình mặc định của Agent"
        );
    }
}
