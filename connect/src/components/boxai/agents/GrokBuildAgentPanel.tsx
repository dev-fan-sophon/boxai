import { useTranslation } from "react-i18next";
import { AgentConfigShell, AgentSection } from "../AgentConfigShell";
import { ModelMultiSelect, ModelSelect } from "../ModelPicker";
import type { GrokBuildAgentConfig } from "../agentTypes";
import type { AgentPanelProps } from "./types";

/**
 * Grok Build addresses models through named profiles: one `[model.<id>]` table
 * per model, and `[models].default` naming the profile it starts on. Each
 * profile also has to declare a context window, which comes from BoxAI's model
 * metadata rather than a number Connect made up.
 */
export function GrokBuildAgentPanel(
  props: AgentPanelProps<GrokBuildAgentConfig>,
) {
  const { t } = useTranslation();
  const state = props.state;
  const locked = Boolean(state.lockedModel);

  const setModels = (models: string[]) => {
    const defaultModel =
      props.config.defaultModel && models.includes(props.config.defaultModel)
        ? props.config.defaultModel
        : (models[0] ?? null);
    props.onChange({ ...props.config, models, defaultModel });
  };

  const problem = !props.config.models.length
    ? t("boxai.agent.grokbuild.chooseModels")
    : !props.config.defaultModel
      ? t("boxai.agent.grokbuild.chooseDefault")
      : null;

  return (
    <AgentConfigShell {...props} problem={problem}>
      <AgentSection
        title={t("boxai.agent.grokbuild.profiles")}
        description={t("boxai.agent.grokbuild.profilesHint")}
      >
        <ModelMultiSelect
          catalog={{
            models: state.models,
            meta: state.modelMeta,
            recommended: state.recommendedModel,
          }}
          selected={props.config.models}
          disabled={props.busy || locked}
          onChange={setModels}
        />
      </AgentSection>

      <AgentSection
        title={t("boxai.agent.grokbuild.default")}
        description={t("boxai.agent.grokbuild.defaultHint")}
      >
        <ModelSelect
          models={props.config.models}
          meta={state.modelMeta}
          value={props.config.defaultModel}
          disabled={props.busy || locked || !props.config.models.length}
          placeholder={t("boxai.agent.chooseModel")}
          ariaLabel={t("boxai.agent.grokbuild.default")}
          onChange={(defaultModel) =>
            props.onChange({ ...props.config, defaultModel })
          }
        />
      </AgentSection>
    </AgentConfigShell>
  );
}
