/**
 * Mirrors `src-tauri/src/boxai/agent_config.rs`.
 *
 * Each Agent carries its own configuration shape because the clients do not
 * share one: Claude Code maps roles onto models, Codex keeps a catalog plus a
 * startup default, Gemini takes a single model, and the additive clients
 * register a catalog next to whatever the user already had.
 */

export interface ModelMeta {
  displayName?: string;
  contextLength?: number;
  maxOutputTokens?: number;
  inputModalities?: string[];
  capabilities?: string[];
  reasoningEfforts?: string[];
}

export interface ClaudeAgentConfig {
  kind: "claude";
  model: string | null;
  sonnet: string | null;
  opus: string | null;
  haiku: string | null;
  fable: string | null;
  subagent: string | null;
}

export interface CodexAgentConfig {
  kind: "codex";
  models: string[];
  defaultModel: string | null;
  reasoningEffort: string | null;
}

export interface GeminiAgentConfig {
  kind: "gemini";
  model: string | null;
}

export interface GrokBuildAgentConfig {
  kind: "grokBuild";
  models: string[];
  defaultModel: string | null;
}

export interface OpenCodeAgentConfig {
  kind: "openCode";
  models: string[];
}

export interface OpenClawAgentConfig {
  kind: "openClaw";
  models: string[];
  primary: string | null;
  fallbacks: string[];
}

export interface HermesAgentConfig {
  kind: "hermes";
  models: string[];
  defaultModel: string | null;
}

export type AgentConfig =
  | ClaudeAgentConfig
  | CodexAgentConfig
  | GeminiAgentConfig
  | GrokBuildAgentConfig
  | OpenCodeAgentConfig
  | OpenClawAgentConfig
  | HermesAgentConfig;

export type AgentStatus =
  | "active"
  | "inactive"
  | "unconfigured"
  | "policyDisabled"
  | "signedOut";

export interface AgentState {
  app: string;
  additive: boolean;
  policyEnabled: boolean;
  signedIn: boolean;
  active: boolean;
  ownsClientDefault: boolean;
  configured: boolean;
  needsRepair: boolean;
  status: AgentStatus;
  config: AgentConfig;
  appliedConfig: AgentConfig | null;
  models: string[];
  modelMeta: Record<string, ModelMeta>;
  recommendedModel: string | null;
  lockedModel: string | null;
  policyRevision: string;
  lastSynced: string | null;
  liveConfigPath: string;
  warnings: string[];
}

export const CLAUDE_ROLES = [
  "sonnet",
  "opus",
  "haiku",
  "fable",
  "subagent",
] as const;

export type ClaudeRole = (typeof CLAUDE_ROLES)[number];

export const CODEX_REASONING_EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
] as const;
