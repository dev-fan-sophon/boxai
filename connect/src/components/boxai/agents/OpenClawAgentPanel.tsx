import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { AgentConfigShell, AgentSection } from "../AgentConfigShell";
import { ModelMultiSelect, ModelSelect } from "../ModelPicker";
import type { OpenClawAgentConfig } from "../agentTypes";
import type { AgentPanelProps } from "./types";

/**
 * OpenClaw keeps two independent things: the provider catalog under
 * `models.providers`, and the routing defaults under `agents.defaults.model`.
 * Registering BoxAI models must not silently re-point a user's routing, so the
 * routing chain is configured separately and only written when asked for.
 */
export function OpenClawAgentPanel(
  props: AgentPanelProps<OpenClawAgentConfig>,
) {
  const { t } = useTranslation();
  const state = props.state;
  const locked = Boolean(state.lockedModel);

  const setModels = (models: string[]) => {
    props.onChange({
      ...props.config,
      models,
      primary:
        props.config.primary && models.includes(props.config.primary)
          ? props.config.primary
          : null,
      fallbacks: props.config.fallbacks.filter((model) =>
        models.includes(model),
      ),
    });
  };

  const problem = props.config.models.length
    ? null
    : t("boxai.agent.openclaw.chooseModels");
  const routingReady = Boolean(props.config.primary) && !props.dirty;

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
            disabled={props.busy || !props.config.primary || Boolean(problem)}
            onClick={() =>
              props.run("boxai_agent_set_default", { config: props.config })
            }
          >
            {t("boxai.agent.actions.setDefault", {
              agent: t("apps.openclaw", { defaultValue: "OpenClaw" }),
            })}
          </Button>
        )
      }
    >
      <AgentSection
        title={t("boxai.agent.openclaw.models")}
        description={t("boxai.agent.openclaw.modelsHint")}
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
        title={t("boxai.agent.openclaw.routing")}
        description={t("boxai.agent.openclaw.routingHint")}
      >
        <div className="space-y-1">
          <span className="text-sm font-medium">
            {t("boxai.agent.openclaw.primary")}
          </span>
          <ModelSelect
            models={props.config.models}
            meta={state.modelMeta}
            value={props.config.primary}
            disabled={props.busy || !props.config.models.length}
            noneLabel={t("boxai.agent.openclaw.keepCurrentPrimary")}
            ariaLabel={t("boxai.agent.openclaw.primary")}
            onChange={(primary) =>
              props.onChange({
                ...props.config,
                primary,
                fallbacks: props.config.fallbacks.filter(
                  (model) => model !== primary,
                ),
              })
            }
          />
        </div>
        {props.config.primary && (
          <div className="space-y-1">
            <span className="text-sm font-medium">
              {t("boxai.agent.openclaw.fallbacks")}
            </span>
            <ModelMultiSelect
              catalog={{
                models: props.config.models.filter(
                  (model) => model !== props.config.primary,
                ),
                meta: state.modelMeta,
              }}
              selected={props.config.fallbacks}
              disabled={props.busy}
              onChange={(fallbacks) =>
                props.onChange({ ...props.config, fallbacks })
              }
            />
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {state.ownsClientDefault
            ? t("boxai.agent.openclaw.ownsDefault")
            : routingReady
              ? t("boxai.agent.openclaw.setDefaultHint")
              : t("boxai.agent.openclaw.applyBeforeDefault")}
        </p>
      </AgentSection>
    </AgentConfigShell>
  );
}
