import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { AgentConfigShell, AgentSection } from "../AgentConfigShell";
import { ModelMultiSelect, ModelSelect } from "../ModelPicker";
import type { HermesAgentConfig } from "../agentTypes";
import type { AgentPanelProps } from "./types";

/**
 * Hermes stores BoxAI as one entry in `custom_providers`, with its own model
 * catalog and the model that entry starts on. Which provider Hermes actually
 * uses is a separate top-level setting, so adding BoxAI and switching Hermes
 * over to it are two deliberate actions.
 */
export function HermesAgentPanel(props: AgentPanelProps<HermesAgentConfig>) {
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
    ? t("boxai.agent.hermes.chooseModels")
    : !props.config.defaultModel
      ? t("boxai.agent.hermes.chooseDefault")
      : null;

  return (
    <AgentConfigShell
      {...props}
      problem={problem}
      extraActions={
        state.ownsClientDefault ? (
          <Button
            variant="outline"
            disabled={props.busy}
            onClick={() => props.run("boxai_agent_clear_default")}
          >
            {t("boxai.agent.actions.clearDefault")}
          </Button>
        ) : (
          <Button
            variant="secondary"
            disabled={props.busy || Boolean(problem)}
            onClick={() =>
              props.run("boxai_agent_set_default", { config: props.config })
            }
          >
            {t("boxai.agent.actions.setDefault", {
              agent: t("apps.hermes", { defaultValue: "Hermes" }),
            })}
          </Button>
        )
      }
    >
      <AgentSection
        title={t("boxai.agent.hermes.models")}
        description={t("boxai.agent.hermes.modelsHint")}
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
        title={t("boxai.agent.hermes.default")}
        description={t("boxai.agent.hermes.defaultHint")}
      >
        <ModelSelect
          models={props.config.models}
          meta={state.modelMeta}
          value={props.config.defaultModel}
          disabled={props.busy || locked || !props.config.models.length}
          placeholder={t("boxai.agent.chooseModel")}
          ariaLabel={t("boxai.agent.hermes.default")}
          onChange={(defaultModel) =>
            props.onChange({ ...props.config, defaultModel })
          }
        />
        <p className="text-xs text-muted-foreground">
          {state.ownsClientDefault
            ? t("boxai.agent.hermes.ownsDefault")
            : t("boxai.agent.hermes.currentHint")}
        </p>
      </AgentSection>
    </AgentConfigShell>
  );
}
