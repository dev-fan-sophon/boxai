import { useState, type ReactNode } from "react";
import { AlertTriangle, Loader2, LockKeyhole, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { AgentState } from "./agentTypes";

/**
 * The frame every Agent panel shares: what BoxAI's state is for this client,
 * where the configuration will be written, and the actions that write it.
 *
 * Only the frame is shared. The fields inside come from the Agent's own panel,
 * because a Codex catalog and a Claude role map are not the same decision.
 */
export function AgentConfigShell(props: {
  state: AgentState;
  busy: boolean;
  dirty: boolean;
  /** Why the draft cannot be applied yet, in the Agent's own words. */
  problem: string | null;
  error: string | null;
  onApply: () => void;
  onDisable: () => void;
  onReset: () => void;
  onRefresh: () => void;
  extraActions?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [confirmReset, setConfirmReset] = useState(false);
  const state = props.state;
  const agentLabel = t(`apps.${state.app}`, { defaultValue: state.app });
  const additive = state.additive;

  const applyLabel = () => {
    if (!state.active) {
      return additive
        ? t("boxai.agent.actions.add", { agent: agentLabel })
        : t("boxai.agent.actions.apply");
    }
    if (props.dirty) {
      return additive
        ? t("boxai.agent.actions.update", { agent: agentLabel })
        : t("boxai.agent.actions.applyChanges");
    }
    return additive
      ? t("boxai.agent.actions.added")
      : t("boxai.agent.actions.inUse");
  };

  const blocked = !state.policyEnabled || !state.signedIn;
  const canApply =
    !props.busy && !blocked && !props.problem && (!state.active || props.dirty);

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-5">
      <section className="rounded-xl border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">BoxAI · {agentLabel}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(`boxai.agent.statusHint.${state.status}`, {
                agent: agentLabel,
              })}
            </p>
            <p className="mt-2 truncate font-mono text-xs text-muted-foreground">
              {t("boxai.agent.writesTo", { path: state.liveConfigPath })}
            </p>
          </div>
          <Badge variant={state.active ? "default" : "secondary"}>
            {t(`boxai.agent.status.${state.status}`)}
          </Badge>
        </div>
        {state.lockedModel && (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <LockKeyhole className="h-4 w-4 shrink-0" />
            {t("boxai.agent.locked", { model: state.lockedModel })}
          </p>
        )}
        {state.needsRepair && (
          <p className="mt-3 flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {t("boxai.agent.needsRepair")}
          </p>
        )}
        {state.warnings
          .filter((warning) => warning !== "modelsWithdrawn")
          .map((warning) => (
            <p
              key={warning}
              className="mt-3 flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {t(`boxai.agent.warnings.${warning}`, {
                agent: agentLabel,
                defaultValue: warning,
              })}
            </p>
          ))}
      </section>

      {!blocked && props.children}

      <section className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!canApply} onClick={props.onApply}>
            {applyLabel()}
          </Button>
          {props.extraActions}
          {state.active && (
            <Button
              variant="outline"
              disabled={props.busy}
              onClick={props.onDisable}
            >
              {additive
                ? t("boxai.agent.actions.remove", { agent: agentLabel })
                : t("boxai.agent.actions.stop")}
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={props.busy}
            onClick={() => setConfirmReset(true)}
          >
            {t("boxai.agent.actions.reset")}
          </Button>
          <Button
            variant="ghost"
            disabled={props.busy}
            onClick={props.onRefresh}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            {t("common.refresh")}
          </Button>
          {props.busy && <Loader2 className="h-5 w-5 animate-spin" />}
        </div>
        {props.problem && !blocked && (
          <p className="mt-3 text-sm text-muted-foreground">{props.problem}</p>
        )}
        {!props.problem && props.dirty && state.active && (
          <p className="mt-3 text-sm text-amber-600 dark:text-amber-400">
            {t("boxai.agent.unapplied")}
          </p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          {t("boxai.agent.templateSafety")}
        </p>
      </section>

      <section className="rounded-xl border bg-card p-5 text-xs text-muted-foreground">
        <p>
          {t("boxai.agent.revision")}: {state.policyRevision || "—"}
        </p>
        <p>
          {t("boxai.agent.lastSynced")}:{" "}
          {state.lastSynced ? new Date(state.lastSynced).toLocaleString() : "—"}
        </p>
      </section>

      {props.error && (
        <p role="alert" className="text-sm text-destructive">
          {props.error}
        </p>
      )}

      <ConfirmDialog
        isOpen={confirmReset}
        variant="destructive"
        title={t("boxai.agent.resetTitle")}
        message={t("boxai.agent.resetMessage", { agent: agentLabel })}
        confirmText={t("boxai.agent.actions.reset")}
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          props.onReset();
        }}
      />
    </div>
  );
}

/** A titled block of Agent-specific fields. */
export function AgentSection(props: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border bg-card p-5">
      <div>
        <h3 className="font-semibold">{props.title}</h3>
        {props.description && (
          <p className="mt-1 text-sm text-muted-foreground">
            {props.description}
          </p>
        )}
      </div>
      {props.children}
    </section>
  );
}
