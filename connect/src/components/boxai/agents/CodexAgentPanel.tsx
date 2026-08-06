import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AgentConfigShell, AgentSection } from "../AgentConfigShell";
import { ModelMultiSelect, ModelSelect } from "../ModelPicker";
import { CODEX_REASONING_EFFORTS, type CodexAgentConfig } from "../agentTypes";
import type { AgentPanelProps } from "./types";

/**
 * Codex holds two separate answers: which models its `/model` picker offers,
 * and which one a new session starts on. Connect writes the first into Codex's
 * model catalog file and the second into `config.toml`.
 */
export function CodexAgentPanel(props: AgentPanelProps<CodexAgentConfig>) {
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

  // Only offer levels the chosen models declare; a model that documents none
  // keeps Codex's own range rather than being narrowed to nothing.
  const declared = props.config.models.flatMap(
    (model) => state.modelMeta[model]?.reasoningEfforts ?? [],
  );
  const efforts = CODEX_REASONING_EFFORTS.filter(
    (effort) => !declared.length || declared.includes(effort),
  );

  const problem = !props.config.models.length
    ? t("boxai.agent.codex.chooseModels")
    : !props.config.defaultModel
      ? t("boxai.agent.codex.chooseDefault")
      : null;

  return (
    <AgentConfigShell {...props} problem={problem}>
      <AgentSection
        title={t("boxai.agent.codex.catalog")}
        description={t("boxai.agent.codex.catalogHint")}
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
        title={t("boxai.agent.codex.default")}
        description={t("boxai.agent.codex.defaultHint")}
      >
        <ModelSelect
          models={props.config.models}
          meta={state.modelMeta}
          value={props.config.defaultModel}
          disabled={props.busy || locked || !props.config.models.length}
          placeholder={t("boxai.agent.chooseModel")}
          ariaLabel={t("boxai.agent.codex.default")}
          onChange={(defaultModel) =>
            props.onChange({ ...props.config, defaultModel })
          }
        />
      </AgentSection>

      <AgentSection
        title={t("boxai.agent.codex.effort")}
        description={t("boxai.agent.codex.effortHint")}
      >
        <Select
          value={props.config.reasoningEffort ?? "high"}
          disabled={props.busy}
          onValueChange={(reasoningEffort) =>
            props.onChange({ ...props.config, reasoningEffort })
          }
        >
          <SelectTrigger
            className="w-full"
            aria-label={t("boxai.agent.codex.effort")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {efforts.map((effort) => (
              <SelectItem key={effort} value={effort}>
                {t(`boxai.agent.codex.efforts.${effort}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </AgentSection>
    </AgentConfigShell>
  );
}
