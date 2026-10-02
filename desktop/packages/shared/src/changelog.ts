import { normalizeChangelogVersion, resolveChangelogLocale } from "./changelog-runtime.js";

export { normalizeChangelogVersion, resolveChangelogLocale } from "./changelog-runtime.js";

/**
 * BoxAI's release line is independent of upstream versions. Never reuse an
 * upstream entry just because its semver happens to match a BoxAI release.
 * Update these offline notes when cutting a BoxAI release.
 */

export type ChangelogLocale = "en" | "zh-CN" | "zh-TW" | "tr" | "de" | "es" | "fr" | "ko" | "pt-BR" | "vi" | "ja" | "ru";

export type ChangelogEntry = {
  /** Semver without a leading `v`, matching apps/desktop package version. */
  version: string;
  /** Optional ISO date (YYYY-MM-DD) of the release. */
  date?: string;
  /** Short user-facing highlights; keep each line one idea. */
  highlights: string[];
};

/** Locale → newest-first product notes. */
export const CHANGELOG: Record<ChangelogLocale, readonly ChangelogEntry[]> = {
  en: [{ version: "0.2.0", highlights: ["BoxAI Desktop now uses the Electron desktop client with BoxAI account sign-in and gateway models."] }],
  "zh-CN": [{ version: "0.2.0", highlights: ["BoxAI Desktop 现采用 Electron 桌面客户端，支持 BoxAI 账号登录与网关模型。"] }],
  "zh-TW": [{ version: "0.2.0", highlights: ["BoxAI Desktop 現採用 Electron 桌面用戶端，支援 BoxAI 帳號登入與閘道模型。"] }],
  tr: [{ version: "0.2.0", highlights: ["BoxAI Desktop artık BoxAI hesap girişi ve ağ geçidi modelleriyle Electron masaüstü istemcisini kullanıyor."] }],
  de: [{ version: "0.2.0", highlights: ["BoxAI Desktop verwendet jetzt den Electron-Client mit BoxAI-Anmeldung und Gateway-Modellen."] }],
  es: [{ version: "0.2.0", highlights: ["BoxAI Desktop ahora usa el cliente Electron con inicio de sesión de BoxAI y modelos de su pasarela."] }],
  fr: [{ version: "0.2.0", highlights: ["BoxAI Desktop utilise désormais le client Electron avec connexion au compte BoxAI et modèles de sa passerelle."] }],
  ko: [{ version: "0.2.0", highlights: ["BoxAI Desktop이 BoxAI 계정 로그인과 게이트웨이 모델을 지원하는 Electron 클라이언트로 전환되었습니다."] }],
  "pt-BR": [{ version: "0.2.0", highlights: ["O BoxAI Desktop agora usa o cliente Electron com acesso pela conta BoxAI e modelos do gateway."] }],
  vi: [{ version: "0.2.0", highlights: ["BoxAI Desktop chuyển sang ứng dụng Electron, hỗ trợ đăng nhập bằng tài khoản BoxAI và sử dụng mô hình qua cổng BoxAI."] }],
  ja: [{ version: "0.2.0", highlights: ["BoxAI DesktopがElectronクライアントに移行し、BoxAIアカウントでのログインとゲートウェイのモデルに対応しました。"] }],
  ru: [{ version: "0.2.0", highlights: ["BoxAI Desktop перешёл на Electron с входом через аккаунт BoxAI и моделями шлюза BoxAI."] }],
};

export function getChangelogEntry(
  version: string | null | undefined,
  locale: ChangelogLocale = "en",
): ChangelogEntry | undefined {
  const key = normalizeChangelogVersion(version);
  if (!key) return undefined;
  const catalog = CHANGELOG[locale] ?? CHANGELOG.en;
  return catalog.find((entry) => entry.version === key);
}

/**
 * Format highlights as plain multi-line text for UpdateState / compact UI.
 * Returns undefined when the version has no catalog entry or empty highlights.
 */
export function formatChangelogNotes(
  version: string | null | undefined,
  localeInput?: string | null,
): string | undefined {
  const locale = resolveChangelogLocale(localeInput);
  const entry =
    getChangelogEntry(version, locale) ??
    (locale === "en" ? undefined : getChangelogEntry(version, "en"));
  if (!entry?.highlights.length) return undefined;
  return entry.highlights.map((line) => `• ${line}`).join("\n");
}
