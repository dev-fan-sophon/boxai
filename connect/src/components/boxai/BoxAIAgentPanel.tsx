import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Loader2, LockKeyhole, RefreshCw, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface AgentState {
  app: string;
  enabled: boolean;
  policyEnabled: boolean;
  configured: boolean;
  pendingChanges: boolean;
  status: string;
  selectedModel: string | null;
  policyRevision: string;
  lastSynced: string | null;
  models: string[];
  recommendedModel: string | null;
  lockedModel: string | null;
}

export function BoxAIAgentPanel({ app }: { app: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<AgentState | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const agentLabel = t(`apps.${app}`, { defaultValue: app });
  const run = useCallback(
    async (command: string, args = {}) => {
      setLoading(true);
      setError(null);
      try {
        setState(await invoke<AgentState>(command, { app, ...args }));
      } catch (value) {
        setError(String(value));
      } finally {
        setLoading(false);
      }
    },
    [app],
  );
  useEffect(() => {
    void run("boxai_agent_get");
  }, [run]);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ changedAgents: string[] }>(
      "boxai-agent-policy-updated",
      (event) => {
        if (event.payload.changedAgents.includes(app))
          void run("boxai_agent_get");
      },
    ).then((off) => {
      if (disposed) off();
      else unlisten = off;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [app, run]);
  const models = useMemo(
    () =>
      state?.models.filter((model) =>
        model.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
      ) ?? [],
    [query, state],
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-5">
      <section className="rounded-xl border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">BoxAI · {agentLabel}</h2>
            <p className="text-sm text-muted-foreground">
              {t("boxai.agent.templateSafety")}
            </p>
          </div>
          <Badge variant={state?.enabled ? "default" : "secondary"}>
            {state?.enabled
              ? t("boxai.agent.enabled")
              : t("boxai.agent.disabled")}
          </Badge>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            disabled={
              loading ||
              !state?.configured ||
              !state?.policyEnabled ||
              (state?.enabled && !state?.pendingChanges)
            }
            onClick={() => void run("boxai_agent_enable", { enabled: true })}
          >
            {state?.enabled
              ? state.pendingChanges
                ? t("boxai.agent.applyChanges")
                : t("boxai.agent.enabled")
              : t("boxai.agent.enable")}
          </Button>
          {state?.pendingChanges && (
            <span className="self-center text-sm text-amber-600 dark:text-amber-400">
              {t("boxai.agent.pendingChanges")}
            </span>
          )}
          {!state?.configured && state?.policyEnabled && (
            <span className="self-center text-sm text-muted-foreground">
              {t("boxai.agent.selectBeforeEnable")}
            </span>
          )}
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => setConfirmReset(true)}
          >
            {t("common.reset")}
          </Button>
          <Button
            variant="ghost"
            disabled={loading}
            onClick={() => void run("boxai_agent_refresh")}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            {t("common.refresh")}
          </Button>
          {loading && <Loader2 className="h-5 w-5 animate-spin self-center" />}
        </div>
      </section>
      <section className="rounded-xl border bg-card p-5">
        <h3 className="font-semibold">{t("boxai.agent.model")}</h3>
        {state?.lockedModel && (
          <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
            <LockKeyhole className="h-4 w-4" />
            {t("boxai.agent.locked", { model: state.lockedModel })}
          </p>
        )}
        {!state?.selectedModel && state?.recommendedModel && (
          <p className="mt-2 text-sm text-muted-foreground">
            {t("boxai.agent.recommended", { model: state.recommendedModel })}
          </p>
        )}
        <label className="mt-4 flex items-center gap-2 rounded-md border px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            className="h-10 w-full bg-transparent text-sm outline-none"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("boxai.agent.searchModels")}
          />
        </label>
        <div className="mt-3 max-h-72 overflow-y-auto rounded-md border">
          {models.map((model) => (
            <button
              key={model}
              disabled={Boolean(state?.lockedModel) || loading}
              onClick={async () => {
                setLoading(true);
                setError(null);
                try {
                  await invoke("boxai_model_select", { app, model });
                  await run("boxai_agent_get");
                } catch (value) {
                  setError(String(value));
                  setLoading(false);
                }
              }}
              className={`block w-full border-b px-3 py-2 text-left font-mono text-sm last:border-0 hover:bg-muted ${state?.selectedModel === model ? "bg-primary/10 text-primary" : ""}`}
            >
              {model}
            </button>
          ))}
          {!models.length && (
            <p className="p-4 text-sm text-muted-foreground">
              {t("boxai.agent.noModels")}
            </p>
          )}
        </div>
      </section>
      <section className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
        <p>
          {t("boxai.agent.revision")}: {state?.policyRevision || "—"}
        </p>
        <p>
          {t("boxai.agent.lastSynced")}:{" "}
          {state?.lastSynced
            ? new Date(state.lastSynced).toLocaleString()
            : "—"}
        </p>
      </section>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <ConfirmDialog
        isOpen={confirmReset}
        title={t("boxai.agent.resetTitle")}
        message={t("boxai.agent.resetMessage")}
        confirmText={t("common.reset")}
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          void run("boxai_agent_reset");
        }}
      />
    </div>
  );
}
