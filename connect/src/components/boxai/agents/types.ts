import type { AgentConfig, AgentState } from "../agentTypes";

/**
 * What every Agent panel needs: the server's answer for this account, the
 * user's working copy, and the actions that write it.
 *
 * The panels share these props and nothing else — the fields between them are
 * whatever that client's configuration actually is.
 */
export interface AgentPanelProps<C extends AgentConfig> {
  state: AgentState;
  config: C;
  busy: boolean;
  dirty: boolean;
  error: string | null;
  onChange: (config: C) => void;
  onApply: () => void;
  onDisable: () => void;
  onReset: () => void;
  onRefresh: () => void;
  run: (command: string, args?: Record<string, unknown>) => void;
}
