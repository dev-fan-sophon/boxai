import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "i18next";
import { http, HttpResponse } from "msw";
import { beforeAll, describe, expect, it } from "vitest";
import { BoxAIAgentPanel } from "@/components/boxai/BoxAIAgentPanel";
import type { AgentConfig, AgentState } from "@/components/boxai/agentTypes";
import en from "@/i18n/locales/en.json";
import { server } from "../msw/server";

const TAURI_ENDPOINT = "http://tauri.local";

beforeAll(() => {
  // The shared setup boots i18next with empty bundles; the real copy is what
  // makes these assertions describe the panel a user actually sees.
  i18n.addResourceBundle("zh", "translation", en, true, true);
});

function agentState(
  app: string,
  config: AgentConfig,
  overrides: Partial<AgentState> = {},
): AgentState {
  return {
    app,
    additive: ["opencode", "openclaw", "hermes"].includes(app),
    policyEnabled: true,
    signedIn: true,
    active: false,
    ownsClientDefault: false,
    configured: true,
    needsRepair: false,
    status: "inactive",
    config,
    appliedConfig: null,
    models: ["model-a", "model-b"],
    modelMeta: { "model-a": { displayName: "Model A", contextLength: 200000 } },
    recommendedModel: "model-a",
    lockedModel: null,
    policyRevision: "rev-1",
    lastSynced: null,
    liveConfigPath: `/home/ada/.${app}/config`,
    warnings: [],
    ...overrides,
  };
}

/** Serve one agent's state and record every command the panel invokes. */
function mountAgent(app: string, state: AgentState) {
  const calls: { command: string; body: Record<string, unknown> }[] = [];
  server.use(
    http.post(`${TAURI_ENDPOINT}/:command`, async ({ params, request }) => {
      const command = String(params.command);
      calls.push({
        command,
        body: (await request.json()) as Record<string, unknown>,
      });
      return HttpResponse.json(state);
    }),
  );
  render(<BoxAIAgentPanel app={app} />);
  return calls;
}

const appliedConfig = (
  calls: { command: string; body: Record<string, unknown> }[],
) =>
  calls.find((call) => call.command === "boxai_agent_apply")?.body.config as
    | Record<string, unknown>
    | undefined;

describe("BoxAI per-agent configuration", () => {
  it("lets Codex choose which models its picker offers and which one it starts on", async () => {
    const calls = mountAgent(
      "codex",
      agentState("codex", {
        kind: "codex",
        models: ["model-a", "model-b"],
        defaultModel: "model-a",
        reasoningEffort: "high",
      }),
    );
    await screen.findByText(en.boxai.agent.codex.catalog);
    expect(screen.getByText(en.boxai.agent.codex.default)).toBeInTheDocument();

    // Dropping the model Codex starts on must repoint the default rather than
    // writing a config.toml whose top-level model is not in the catalog.
    await userEvent.click(screen.getByRole("checkbox", { name: "model-a" }));
    await userEvent.click(
      screen.getByRole("button", { name: en.boxai.agent.actions.apply }),
    );

    await waitFor(() => expect(appliedConfig(calls)).toBeDefined());
    expect(appliedConfig(calls)).toEqual({
      kind: "codex",
      models: ["model-b"],
      defaultModel: "model-b",
      reasoningEffort: "high",
    });
  });

  it("leaves Claude Code roles following the default model until told otherwise", async () => {
    const calls = mountAgent(
      "claude",
      agentState("claude", {
        kind: "claude",
        model: "model-a",
        sonnet: null,
        opus: null,
        haiku: null,
        fable: null,
        subagent: null,
      }),
    );
    await screen.findByText(en.boxai.agent.claude.roles);
    expect(
      screen.getByLabelText(en.boxai.agent.claude.role.subagent),
    ).toBeInTheDocument();
    // Roles are a Claude concept; no other client shows a model catalog here.
    expect(screen.queryByRole("checkbox")).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: en.boxai.agent.actions.apply }),
    );
    await waitFor(() => expect(appliedConfig(calls)).toBeDefined());
    expect(appliedConfig(calls)).toMatchObject({
      kind: "claude",
      model: "model-a",
      opus: null,
    });
  });

  it("offers OpenCode no default model, because Connect does not write one", async () => {
    const calls = mountAgent(
      "opencode",
      agentState("opencode", { kind: "openCode", models: ["model-a"] }),
    );
    await screen.findByText(en.boxai.agent.opencode.models);
    expect(
      screen.getByText(en.boxai.agent.opencode.defaultNotice),
    ).toBeInTheDocument();
    expect(screen.queryByText(en.boxai.agent.codex.default)).toBeNull();
    expect(screen.queryByText(en.boxai.agent.hermes.default)).toBeNull();

    // Additive clients add themselves to a config; they do not take it over.
    expect(
      screen.getByRole("button", {
        name: en.boxai.agent.actions.add.replace("{{agent}}", "OpenCode"),
      }),
    ).toBeInTheDocument();
    expect(calls.every((call) => call.command === "boxai_agent_get")).toBe(true);
  });

  it("registers OpenClaw models without seizing its default routing", async () => {
    const calls = mountAgent(
      "openclaw",
      agentState("openclaw", {
        kind: "openClaw",
        models: ["model-a", "model-b"],
        primary: "model-a",
        fallbacks: [],
      }),
    );
    await screen.findByText(en.boxai.agent.openclaw.routing);

    await userEvent.click(
      screen.getByRole("button", {
        name: en.boxai.agent.actions.add.replace("{{agent}}", "OpenClaw"),
      }),
    );
    await waitFor(() => expect(appliedConfig(calls)).toBeDefined());
    expect(
      calls.some((call) => call.command === "boxai_agent_set_default"),
    ).toBe(false);

    await userEvent.click(
      screen.getByRole("button", {
        name: en.boxai.agent.actions.setDefault.replace(
          "{{agent}}",
          "OpenClaw",
        ),
      }),
    );
    await waitFor(() =>
      expect(
        calls.some((call) => call.command === "boxai_agent_set_default"),
      ).toBe(true),
    );
  });

  it("keeps adding Hermes' provider separate from switching Hermes onto it", async () => {
    const calls = mountAgent(
      "hermes",
      agentState("hermes", {
        kind: "hermes",
        models: ["model-a"],
        defaultModel: "model-a",
      }),
    );
    await screen.findByText(en.boxai.agent.hermes.models);

    await userEvent.click(
      screen.getByRole("button", {
        name: en.boxai.agent.actions.add.replace("{{agent}}", "Hermes"),
      }),
    );
    await waitFor(() => expect(appliedConfig(calls)).toBeDefined());
    expect(
      calls.some((call) => call.command === "boxai_agent_set_default"),
    ).toBe(false);
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: en.boxai.agent.actions.setDefault.replace("{{agent}}", "Hermes"),
        }),
      ).toBeEnabled(),
    );
  });

  it("explains itself instead of offering actions while the policy is off", async () => {
    mountAgent(
      "gemini",
      agentState(
        "gemini",
        { kind: "gemini", model: null },
        { policyEnabled: false, status: "policyDisabled", configured: false },
      ),
    );
    await screen.findByText(
      en.boxai.agent.statusHint.policyDisabled.replace("{{agent}}", "Gemini"),
    );
    expect(screen.queryByText(en.boxai.agent.gemini.model)).toBeNull();
    expect(
      screen.getByRole("button", { name: en.boxai.agent.actions.apply }),
    ).toBeDisabled();
  });
});
