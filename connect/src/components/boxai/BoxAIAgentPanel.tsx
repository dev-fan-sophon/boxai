import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAgentConfig } from "./useAgentConfig";
import { ClaudeAgentPanel } from "./agents/ClaudeAgentPanel";
import { CodexAgentPanel } from "./agents/CodexAgentPanel";
import { GeminiAgentPanel } from "./agents/GeminiAgentPanel";
import { GrokBuildAgentPanel } from "./agents/GrokBuildAgentPanel";
import { HermesAgentPanel } from "./agents/HermesAgentPanel";
import { OpenClawAgentPanel } from "./agents/OpenClawAgentPanel";
import { OpenCodeAgentPanel } from "./agents/OpenCodeAgentPanel";

/**
 * Routes one client to the panel that matches its real configuration model.
 *
 * There is no shared "pick a model, press enable" form here on purpose: the
 * clients disagree about what configuring them means, and a single form for
 * all of them can only be right for one.
 */
export function BoxAIAgentPanel({ app }: { app: string }) {
  const { t } = useTranslation();
  const agent = useAgentConfig(app);

  if (!agent.state || !agent.draft) {
    return (
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-10 text-sm text-muted-foreground">
        {agent.error ? (
          <span role="alert" className="text-destructive">
            {agent.error}
          </span>
        ) : (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("common.loading")}
          </>
        )}
      </div>
    );
  }

  const shared = {
    state: agent.state,
    busy: agent.busy,
    dirty: agent.dirty,
    error: agent.error,
    onApply: () => void agent.run("boxai_agent_apply", { config: agent.draft }),
    onDisable: () => void agent.run("boxai_agent_disable"),
    onReset: () => void agent.run("boxai_agent_reset"),
    onRefresh: () => void agent.run("boxai_agent_refresh"),
    run: (command: string, args?: Record<string, unknown>) =>
      void agent.run(command, args),
  };

  switch (agent.draft.kind) {
    case "claude":
      return (
        <ClaudeAgentPanel
          {...shared}
          config={agent.draft}
          onChange={agent.update}
        />
      );
    case "codex":
      return (
        <CodexAgentPanel
          {...shared}
          config={agent.draft}
          onChange={agent.update}
        />
      );
    case "gemini":
      return (
        <GeminiAgentPanel
          {...shared}
          config={agent.draft}
          onChange={agent.update}
        />
      );
    case "grokBuild":
      return (
        <GrokBuildAgentPanel
          {...shared}
          config={agent.draft}
          onChange={agent.update}
        />
      );
    case "openCode":
      return (
        <OpenCodeAgentPanel
          {...shared}
          config={agent.draft}
          onChange={agent.update}
        />
      );
    case "openClaw":
      return (
        <OpenClawAgentPanel
          {...shared}
          config={agent.draft}
          onChange={agent.update}
        />
      );
    case "hermes":
      return (
        <HermesAgentPanel
          {...shared}
          config={agent.draft}
          onChange={agent.update}
        />
      );
  }
}
