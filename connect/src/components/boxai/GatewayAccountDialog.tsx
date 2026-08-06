import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, UserRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useGatewayAccount } from "./useGatewayAccount";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatQuota(quota: number): string {
  if (!Number.isFinite(quota)) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
    quota,
  );
}

/**
 * BoxAI account panel.
 *
 * The window behind it only exists while an account is connected, so this panel
 * shows who that account is and lets it be given up. Nothing here ever holds a
 * credential.
 */
export function GatewayAccountDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const { status, error, signOut } = useGatewayAccount();
  const connected = Boolean(status?.connected);

  // Connecting seeds the BoxAI provider and MCP server, disconnecting
  // removes them. Both happen in the backend, so the cached panel would keep
  // showing the previous state until something invalidates it.
  const queryClient = useQueryClient();
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ["providers"] });
    void queryClient.invalidateQueries({ queryKey: ["mcp", "all"] });
    void queryClient.invalidateQueries({ queryKey: ["skills"] });
  }, [connected, queryClient]);

  const handleSignOut = async () => {
    await signOut();
    onOpenChange(false);
  };

  const account = status?.connected ? status.account : null;
  const displayName = account?.display_name?.trim() || account?.username || "—";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0 sm:rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserRound className="h-5 w-5 text-primary" />
            {t("boxai.account.title", { defaultValue: "BoxAI 账号" })}
          </DialogTitle>
          <DialogDescription>
            {t("boxai.account.description", {
              defaultValue:
                "登录后，受支持的 AI 客户端会直接使用 BoxAI 的模型。",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5 [scrollbar-width:thin]">
          {account ? (
            <>
              {/* Identity */}
              <section className="rounded-xl border border-border/60 bg-card/60 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <UserRound className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-base font-semibold leading-tight">
                        {displayName}
                      </p>
                      <Badge variant="secondary" className="shrink-0">
                        {t("boxai.account.connected", {
                          defaultValue: "已连接",
                        })}
                      </Badge>
                    </div>
                    {account.email ? (
                      <p className="truncate text-sm text-muted-foreground">
                        {account.email}
                      </p>
                    ) : (
                      <p className="truncate text-sm text-muted-foreground">
                        @{account.username}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border border-border/50 bg-background/60 px-3 py-2.5">
                    <p className="text-xs text-muted-foreground">
                      {t("boxai.account.quotaLabel", {
                        defaultValue: "剩余额度",
                      })}
                    </p>
                    <p className="mt-0.5 font-mono text-sm font-medium tabular-nums">
                      {formatQuota(account.quota)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-background/60 px-3 py-2.5">
                    <p className="text-xs text-muted-foreground">
                      {t("boxai.account.usernameLabel", {
                        defaultValue: "用户名",
                      })}
                    </p>
                    <p className="mt-0.5 truncate text-sm font-medium">
                      {account.username}
                    </p>
                  </div>
                </div>
              </section>
            </>
          ) : (
            <p className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground">
              {t("boxai.account.notConnected", {
                defaultValue: "当前未连接账号。",
              })}
            </p>
          )}

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            className="sm:mr-auto"
            onClick={() => onOpenChange(false)}
          >
            {t("common.close", { defaultValue: "关闭" })}
          </Button>
          {account && (
            <Button variant="outline" onClick={() => void handleSignOut()}>
              <LogOut className="mr-2 h-4 w-4" />
              {t("boxai.account.signOut", { defaultValue: "退出登录" })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
