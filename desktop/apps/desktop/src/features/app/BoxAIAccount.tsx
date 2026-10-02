import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { Button, Panel } from "../../components/ui";
import { WindowControls } from "../../components/WindowControls";
import { useAppStore } from "../../stores/app-store";

type Account = Awaited<ReturnType<typeof api.boxaiAccount>>;

export function BoxAIAccount({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const [account, setAccount] = useState<Account>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loginId, setLoginId] = useState<string>();
  const refreshProviders = useAppStore(s => s.refreshProviders);
  const refresh = useCallback(async () => {
    try { setAccount(await api.boxaiAccount()); }
    catch { setAccount({ connected: false }); setFailed(true); }
  }, []);
  useEffect(() => {
    let active = true;
    const check = async () => {
      try { const result = await api.boxaiAccount(); if (active) setAccount(result); }
      catch { if (active) setAccount({ connected: false }); }
    };
    void check();
    const timer = setInterval(() => void check(), 60_000);
    window.addEventListener("focus", check);
    const unsubscribe = api.onOauthLogin(event => {
      if (event.vendorId !== "boxai") return;
      if (event.kind === "done" || event.kind === "error" || event.kind === "cancelled") {
        setBusy(false); setLoginId(undefined); setFailed(event.kind === "error");
        void refresh().then(() => refreshProviders());
      }
    });
    const changed = () => void check();
    window.addEventListener("boxai-account-changed", changed);
    return () => { active = false; clearInterval(timer); unsubscribe(); window.removeEventListener("focus", check); window.removeEventListener("boxai-account-changed", changed); };
  }, [refresh, refreshProviders]);

  if (children && account?.connected) return children;
  const act = async () => {
    setBusy(true); setFailed(false);
    try {
      if (account?.connected) {
        await api.deleteOauthAccount("boxai");
        setAccount({ connected: false });
        window.dispatchEvent(new Event("boxai-account-changed"));
        setBusy(false);
      } else {
        const result = await api.startOauthLogin("boxai");
        setLoginId(result.loginId);
      }
    } catch { setFailed(true); setBusy(false); }
  };
  return <div data-boxai-account-gate={children ? "" : undefined} className="settings-page-content" style={{ maxWidth: 640, margin: "auto", padding: 32, minHeight: children ? "100vh" : undefined, display: "grid", alignContent: "center" }}>
    {children && <WindowControls />}
    <Panel className="space-y-4">
      <h1>{t("BoxAI account")}</h1>
      {!account ? <p>{t("Checking account…")}</p> : account.connected ? <>
        <p>{account.usage?.account.display_name || account.usage?.account.username}</p>
        <p>{t("Wallet balance (quota)")}: {account.usage?.usage.wallet_quota_remaining ?? 0}</p>
        <p>{t("Total usage (quota)")}: {account.usage?.usage.lifetime_quota_used ?? 0}</p>
        <p>{t("Requests")}: {account.usage?.usage.lifetime_request_count ?? 0}</p>
        <p><a href="https://you-box.com/console/topup" target="_blank" rel="noreferrer">{t("Top up")}</a></p>
        <p><a href="https://you-box.com/console" target="_blank" rel="noreferrer">{t("Open console")}</a></p>
      </> : <p>{t("Sign in with your BoxAI account to continue. All models are billed through BoxAI.")}</p>}
      {failed && <p role="alert">{t("Account request failed. Check your connection and try again.")}</p>}
      <Button disabled={busy || !account} onClick={() => void act()}>{busy ? t("Waiting for browser authorization…") : account?.connected ? t("Sign out") : t("Sign in with BoxAI")}</Button>
      {loginId && <Button onClick={() => { void api.cancelOauthLogin(loginId); setBusy(false); setLoginId(undefined); }}>{t("Cancel")}</Button>}
      {!busy && <Button onClick={() => void refresh()}>{t("Refresh")}</Button>}
    </Panel>
  </div>;
}
