import { useTranslation } from "react-i18next";
import { AgentConfigShell, AgentSection } from "../AgentConfigShell";
import { ModelMultiSelect } from "../ModelPicker";
import type { OpenCodeAgentConfig } from "../agentTypes";
import type { AgentPanelProps } from "./types";

/**
 * OpenCode's BoxAI entry is a provider catalog and nothing else. Which model
 * OpenCode actually starts on lives in the user's own top-level config, and
 * Connect does not write it — so this panel offers no default model, because
 * choosing one here would have no effect.
 */
export function OpenCodeAgentPanel(
  props: AgentPanelProps<OpenCodeAgentConfig>,
) {
  const { t } = useTranslation();
  const problem = props.config.models.length
    ? null
    : t("boxai.agent.opencode.chooseModels");

  return (
    <AgentConfigShell {...props} problem={problem}>
      <AgentSection
        title={t("boxai.agent.opencode.models")}
        description={t("boxai.agent.opencode.modelsHint")}
      >
        <ModelMultiSelect
          catalog={{
            models: props.state.models,
            meta: props.state.modelMeta,
            recommended: props.state.recommendedModel,
          }}
          selected={props.config.models}
          disabled={props.busy || Boolean(props.state.lockedModel)}
          onChange={(models) => props.onChange({ ...props.config, models })}
        />
        <p className="text-xs text-muted-foreground">
          {t("boxai.agent.opencode.defaultNotice")}
        </p>
      </AgentSection>
    </AgentConfigShell>
  );
}
