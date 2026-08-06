import { useTranslation } from "react-i18next";
import { AgentConfigShell, AgentSection } from "../AgentConfigShell";
import { ModelSelect } from "../ModelPicker";
import type { GeminiAgentConfig } from "../agentTypes";
import type { AgentPanelProps } from "./types";

/**
 * Gemini CLI reads one model out of `GEMINI_MODEL`. It has no catalog to
 * populate, so offering a multi-select here would promise a picker the client
 * does not have.
 */
export function GeminiAgentPanel(props: AgentPanelProps<GeminiAgentConfig>) {
  const { t } = useTranslation();
  const problem = props.config.model
    ? null
    : t("boxai.agent.gemini.chooseModel");

  return (
    <AgentConfigShell {...props} problem={problem}>
      <AgentSection
        title={t("boxai.agent.gemini.model")}
        description={t("boxai.agent.gemini.modelHint")}
      >
        <ModelSelect
          models={props.state.models}
          meta={props.state.modelMeta}
          value={props.config.model}
          disabled={props.busy || Boolean(props.state.lockedModel)}
          placeholder={t("boxai.agent.chooseModel")}
          ariaLabel={t("boxai.agent.gemini.model")}
          onChange={(model) => props.onChange({ ...props.config, model })}
        />
      </AgentSection>
    </AgentConfigShell>
  );
}
