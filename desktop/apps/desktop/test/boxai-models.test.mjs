import assert from "node:assert/strict";
import test from "node:test";
import { VendorOAuth, boxaiModelStyle } from "../electron/main/oauth.ts";
import { registerProviderIpc } from "../electron/main/ipc/provider-ipc.ts";
import { IPC } from "@pi-desktop/shared";

test("BoxAI account intersects entitlements and projects exact server metadata", async () => {
  const visited = [];
  const account = new VendorOAuth({
    call: async method => {
      assert.equal(method, "secrets.getForRuntime");
      return { value: JSON.stringify({ access_token: "session", refresh_token: "refresh", api_key: "relay", expiresAt: Date.now() + 3600000 }) };
    },
    emit: () => {}, openExternal: async () => {},
    fetch: async (url, init) => {
      visited.push(new URL(url).pathname);
      if (url.endsWith("session-status")) return Response.json({ active: true });
      assert.equal(init.headers.Authorization, "Bearer relay");
      if (url.endsWith("/models")) return Response.json({ data: [{ id: "claude-test" }, { id: "gpt-test" }, { id: "image" }] });
      assert.ok(url.endsWith("/api/connect/provisioning"));
      return Response.json({ success: true, data: { chat_models: ["claude-test", "gpt-test", "not-entitled"],
        model_meta: { "claude-test": { context_length: 321000, max_output_tokens: 4096,
          input_modalities: ["text", "image"], reasoning_efforts: ["low", "high"], capabilities: ["tools"] } } } });
    },
  });
  assert.deepEqual((await account.listModels("boxai")).map(row => row.modelId), ["claude-test", "gpt-test"]);
  const claude = await account.bindingFor("boxai", "claude-test");
  assert.equal(claude.apiStyle, "anthropic_messages");
  assert.equal(claude.baseUrl, "https://you-box.com/v1");
  assert.equal(claude.modelConfig.contextWindow, 321000);
  assert.equal(claude.modelConfig.maxTokens, 4096);
  assert.deepEqual(claude.modelConfig.input, ["text", "image"]);
  assert.deepEqual(claude.supportedThinkingLevels, ["low", "high"]);
  assert.equal(await account.bindingFor("boxai", "not-entitled"), undefined);
  assert.equal((await account.bindingFor("boxai", "gpt-test")).supportsReasoning, false);
  assert.deepEqual(visited.sort(), ["/api/connect/provisioning", "/api/desktop/session-status", "/v1/models"]);
  await assert.rejects(account.start("anthropic"), /Only BoxAI/);
});

test("model family routing keeps non-OpenAI models on Chat Completions", () => {
  assert.equal(boxaiModelStyle("anthropic/claude-sonnet-4-6"), "anthropic_messages");
  assert.equal(boxaiModelStyle("gpt-5.4"), "chat_completions");
  assert.equal(boxaiModelStyle("o3"), "chat_completions");
  assert.equal(boxaiModelStyle("gemini-3.1-pro-preview"), "chat_completions");
  assert.equal(boxaiModelStyle("grok-4.6"), "chat_completions");
});

test("renderer cannot configure keys, endpoints, third-party accounts or secret storage", async () => {
  const handlers = new Map();
  registerProviderIpc({ registrar: { handle: (channel, handler) => handlers.set(channel, handler) },
    vendorOAuth: { status: async () => ({ connected: false }) }, listRuntimeProviders: async () => [] });
  for (const channel of [IPC.invoke.providersCreate, IPC.invoke.providersUpdate, IPC.invoke.providersSetSecret, IPC.invoke.secretsSet]) {
    await assert.rejects(handlers.get(channel)({ baseUrl: "https://evil.test", apiKey: "foreign" }), /managed by BoxAI/);
  }
  assert.deepEqual(await handlers.get(IPC.invoke.providersList)(), { providers: [] });
});

test("concurrent account hydration creates one host-assigned BoxAI provider", async () => {
  const providers = [];
  let settings = {};
  const account = new VendorOAuth({
    call: async (method, input) => {
      if (method === "secrets.getForRuntime") return { value: JSON.stringify({ access_token: "session", refresh_token: "refresh", api_key: "relay", expiresAt: Date.now() + 3600000 }) };
      if (method === "providers.list") return { providers };
      if (method === "settings.get") return structuredClone(settings);
      if (method === "settings.set") { settings = input; return settings; }
      if (method === "providers.create") {
        const provider = { ...input, id: `host-${providers.length}` };
        providers.push(provider);
        return { provider };
      }
      assert.equal(method, "providers.update");
      Object.assign(providers.find(row => row.id === input.id), input);
      return {};
    },
    emit: () => {}, openExternal: async () => {},
    fetch: async url => {
      if (url.endsWith("session-status")) return Response.json({ active: true });
      if (url.endsWith("/models")) return Response.json({ data: [{ id: "grok-4.6" }] });
      return Response.json({ success: true, data: { chat_models: ["grok-4.6"], model_meta: {} } });
    },
  });
  await Promise.all([account.synchronizeProvider(), account.synchronizeProvider()]);
  assert.equal(providers.length, 1);
  assert.equal(providers[0].id, "host-0");
  assert.equal(providers[0].authKind, "oauth");
  assert.deepEqual(providers[0].models.map(row => row.id), ["grok-4.6"]);
  assert.deepEqual(settings, { defaultProviderId: "host-0", defaultModelId: "grok-4.6" });
});
