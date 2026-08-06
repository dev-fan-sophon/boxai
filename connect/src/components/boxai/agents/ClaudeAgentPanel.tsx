import { useTranslation } from "react-i18next";
import { AgentConfigShell, AgentSection } from "../AgentConfigShell";
import { ModelSelect } from "../ModelPicker";
import { CLAUDE_ROLES, type ClaudeAgentConfig } from "../agentTypes";
import type { AgentPanelProps } from "./types";

/**
 * Claude Code picks a model per role name. Anything a role does not override
 * falls back to `ANTHROPIC_MODEL`, so the only required choice is that one
 * fallback — the roles exist for users who want Opus-class work routed
 * elsewhere, and stay on "follow the default" until they say otherwise.
 */
export function ClaudeAgentPanel(props: AgentPanelProps<ClaudeAgentConfig>) {
  const { t } = useTranslation();
  const state = props.state;
  const locked = Boolean(state.lockedModel);
  const problem = props.config.model
    ? null
    : t("boxai.agent.claude.chooseFallback");

  return (
    <AgentConfigShell {...props} problem={problem}>
      <AgentSection
        title={t("boxai.agent.claude.fallback")}
        description={t("boxai.agent.claude.fallbackHint")}
      >
        <ModelSelect
          models={state.models}
          meta={state.modelMeta}
          value={props.config.model}
          disabled={props.busy || locked}
          placeholder={t("boxai.agent.chooseModel")}
          ariaLabel={t("boxai.agent.claude.fallback")}
          onChange={(model) => props.onChange({ ...props.config, model })}
        />
      </AgentSection>

      <AgentSection
        title={t("boxai.agent.claude.roles")}
        description={t("boxai.agent.claude.rolesHint")}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {CLAUDE_ROLES.map((role) => (
            <div key={role} className="space-y-1">
              <span className="text-sm font-medium">
                {t(`boxai.agent.claude.role.${role}`)}
              </span>
              <ModelSelect
                models={state.models}
                meta={state.modelMeta}
                value={props.config[role]}
                disabled={props.busy || locked}
                noneLabel={t("boxai.agent.claude.followFallback")}
                ariaLabel={t(`boxai.agent.claude.role.${role}`)}
                onChange={(model) =>
                  props.onChange({ ...props.config, [role]: model })
                }
              />
            </div>
          ))}
        </div>
      </AgentSection>
    </AgentConfigShell>
  );
}
