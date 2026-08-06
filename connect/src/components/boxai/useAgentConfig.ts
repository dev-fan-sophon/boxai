import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AgentConfig, AgentState } from "./agentTypes";

/**
 * Load one Agent's BoxAI configuration and edit it locally.
 *
 * Edits stay in the draft until a command is invoked. Nothing here writes to a
 * client's real config file, which is why the panel can offer checkboxes and
 * selects without every click changing a file the user is working against.
 */
export function useAgentConfig(app: string) {
  const [state, setState] = useState<AgentState | null>(null);
  const [draft, setDraft] = useState<AgentConfig | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A reload triggered by a policy push must not discard what the user is
  // typing, so only an action's own result replaces the draft.
  const edited = useRef(false);

  const load = useCallback(
    async (command: string, args: Record<string, unknown> = {}) => {
      setBusy(true);
      setError(null);
      try {
        const next = await invoke<AgentState>(command, { app, ...args });
        setState(next);
        setDraft((current) =>
          current && edited.current && command === "boxai_agent_get"
            ? current
            : next.config,
        );
        if (command !== "boxai_agent_get") edited.current = false;
        return next;
      } catch (value) {
        setError(String(value));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [app],
  );

  useEffect(() => {
    edited.current = false;
    void load("boxai_agent_get");
  }, [load]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ changedAgents: string[] }>(
      "boxai-agent-policy-updated",
      (event) => {
        if (event.payload.changedAgents.includes(app)) {
          void load("boxai_agent_get");
        }
      },
    ).then((off) => {
      if (disposed) off();
      else unlisten = off;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [app, load]);

  const update = useCallback((next: AgentConfig) => {
    edited.current = true;
    setDraft(next);
  }, []);

  const dirty = useMemo(() => {
    if (!state || !draft) return false;
    if (!state.appliedConfig) return true;
    return JSON.stringify(draft) !== JSON.stringify(state.appliedConfig);
  }, [draft, state]);

  return { state, draft, update, dirty, busy, error, setError, run: load };
}
