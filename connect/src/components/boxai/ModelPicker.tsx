import { useMemo, useState } from "react";
import { Search, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ModelMeta } from "./agentTypes";

interface ModelCatalog {
  models: string[];
  meta: Record<string, ModelMeta>;
  recommended?: string | null;
}

function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

/** The human-facing label for a model, falling back to its id. */
export function modelLabel(
  model: string,
  meta: Record<string, ModelMeta>,
): string {
  return meta[model]?.displayName || model;
}

function ModelDetails(props: {
  model: string;
  meta: Record<string, ModelMeta>;
}) {
  const { t } = useTranslation();
  const info = props.meta[props.model];
  const label = info?.displayName;
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate font-mono text-sm">{props.model}</span>
      {(label || info?.contextLength) && (
        <span className="block truncate text-xs text-muted-foreground">
          {[
            label,
            info?.contextLength
              ? t("boxai.agent.contextWindow", {
                  tokens: formatContext(info.contextLength),
                })
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      )}
    </span>
  );
}

/**
 * Pick the set of models an Agent should be configured with.
 *
 * Used by the clients whose config genuinely holds a list — Codex's picker,
 * Grok Build's profiles, and the three additive catalogs — never by the ones
 * that only take a single model.
 */
export function ModelMultiSelect(props: {
  catalog: ModelCatalog;
  selected: string[];
  disabled?: boolean;
  onChange: (models: string[]) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return props.catalog.models;
    return props.catalog.models.filter(
      (model) =>
        model.toLocaleLowerCase().includes(needle) ||
        modelLabel(model, props.catalog.meta)
          .toLocaleLowerCase()
          .includes(needle),
    );
  }, [props.catalog.meta, props.catalog.models, query]);

  const toggle = (model: string, checked: boolean) => {
    if (checked) {
      props.onChange([...props.selected, model]);
      return;
    }
    props.onChange(props.selected.filter((entry) => entry !== model));
  };

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 rounded-md border px-3">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          className="h-9 w-full bg-transparent text-sm outline-none"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("boxai.agent.searchModels")}
        />
      </label>
      <div className="max-h-72 overflow-y-auto rounded-md border">
        {visible.map((model) => {
          const checked = props.selected.includes(model);
          return (
            <label
              key={model}
              className={cn(
                "flex items-center gap-3 border-b px-3 py-2 last:border-0",
                props.disabled
                  ? "cursor-not-allowed opacity-60"
                  : "cursor-pointer hover:bg-muted",
              )}
            >
              <Checkbox
                checked={checked}
                disabled={props.disabled}
                aria-label={model}
                onCheckedChange={(value) => toggle(model, value === true)}
              />
              <ModelDetails model={model} meta={props.catalog.meta} />
              {props.catalog.recommended === model && (
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <Sparkles className="h-3 w-3" />
                  {t("boxai.agent.recommended")}
                </span>
              )}
            </label>
          );
        })}
        {!visible.length && (
          <p className="p-4 text-sm text-muted-foreground">
            {t("boxai.agent.noModels")}
          </p>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("boxai.agent.selectedCount", { count: props.selected.length })}
      </p>
    </div>
  );
}

const NONE = "__none__";

/**
 * Pick exactly one model. `noneLabel` turns the empty choice into a real
 * option, which is how Claude Code's roles express "follow the default model"
 * rather than pinning a model of their own.
 */
export function ModelSelect(props: {
  models: string[];
  meta: Record<string, ModelMeta>;
  value: string | null;
  disabled?: boolean;
  noneLabel?: string;
  placeholder?: string;
  ariaLabel?: string;
  onChange: (model: string | null) => void;
}) {
  return (
    <Select
      value={props.value ?? NONE}
      disabled={props.disabled}
      onValueChange={(value) => props.onChange(value === NONE ? null : value)}
    >
      <SelectTrigger className="w-full" aria-label={props.ariaLabel}>
        <SelectValue placeholder={props.placeholder} />
      </SelectTrigger>
      <SelectContent>
        {props.noneLabel && (
          <SelectItem value={NONE}>{props.noneLabel}</SelectItem>
        )}
        {props.models.map((model) => (
          <SelectItem key={model} value={model}>
            <span className="font-mono text-sm">{model}</span>
            {props.meta[model]?.displayName && (
              <span className="ml-2 text-xs text-muted-foreground">
                {props.meta[model]?.displayName}
              </span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
