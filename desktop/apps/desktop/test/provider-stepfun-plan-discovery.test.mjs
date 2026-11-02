import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { registerProviderIpc } = await import("../electron/main/ipc/provider-ipc.ts");
const { IPC } = await import("@pi-desktop/shared");

test("persisted StepFun endpoints cannot redirect BoxAI discovery or connection checks", async (t) => {
  const handlers = new Map();
  const accountCalls = [];
  const networkCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    networkCalls.push(args);
    throw new Error("Direct vendor requests are forbidden");
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  registerProviderIpc({
    registrar: { handle: (channel, handler) => handlers.set(channel, handler) },
    getHost: () => ({ call: async () => { throw new Error("No vendor secrets may be read"); } }),
    listRuntimeProviders: async () => [{ id: "boxai-account", vendorKey: "boxai", authKind: "oauth" }],
    vendorOAuth: {
      client: { async session() { accountCalls.push("session"); } },
      async listModels(id) {
        accountCalls.push(["models", id]);
        return [{ modelId: "boxai-model" }];
      },
      async bindingFor(id, modelId) {
        accountCalls.push(["binding", id, modelId]);
        return { modelConfig: { reasoning: false, modalities: ["text"], input: ["text"], toolCall: true } };
      },
    },
  });

  for (const baseUrl of ["https://api.stepfun.com/step_plan/v1", "https://api.stepfun.com/step_plan/v1/messages"]) {
    const row = { id: "stepfun-plan", vendorKey: "stepfun-step-plan", baseUrl, apiStyle: "anthropic_messages" };
    await assert.rejects(handlers.get(IPC.invoke.providersCreate)(row), /managed by BoxAI/);
    await assert.rejects(handlers.get(IPC.invoke.providersUpdate)(row), /managed by BoxAI/);
    await assert.rejects(handlers.get(IPC.invoke.providersSetSecret)({ id: row.id, value: "fixture-key" }), /managed by BoxAI/);
    const result = await handlers.get(IPC.invoke.providersListModels)({ providerId: row.id, source: "refresh" });
    assert.deepEqual(result.models.map(({ providerId, modelId }) => ({ providerId, modelId })), [
      { providerId: "boxai-account", modelId: "boxai-model" },
    ]);
    assert.equal(result.source, "remote");
    assert.deepEqual(await handlers.get(IPC.invoke.providersTest)(row.id), { ok: true, network: "ok" });
  }
  assert.deepEqual(accountCalls, [
    ["models", "boxai-account"], ["binding", "boxai-account", "boxai-model"], "session",
    ["models", "boxai-account"], ["binding", "boxai-account", "boxai-model"], "session",
  ]);
  assert.deepEqual(networkCalls, []);
});
