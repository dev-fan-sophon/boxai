import assert from "node:assert/strict";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { IPC, PROTOCOL_VERSION } from "@pi-desktop/shared";
import { VendorOAuth } from "../electron/main/oauth.ts";
import { registerProviderIpc } from "../electron/main/ipc/provider-ipc.ts";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { ModelsDevCatalog } = await import("../electron/main/models-dev-catalog.ts");
const { createProviderCatalogRuntime } = await import("../electron/main/runtime/provider-catalog.ts");

test("login and cold bootstrap expose BoxAI models with a usable default; refresh preserves explicit choices", async t => {
  let settings = { defaultProviderId: null, defaultModelId: null, defaultMode: "agent", locale: "vi" };
  const providers = [];
  const modelIds = ["gpt-5.4-mini", "claude-fable-5", "grok-4.6", "claude-sonnet-4-6"];
  const host = { call: async (method, input) => {
    if (method === "secrets.getForRuntime") return { value: JSON.stringify({ access_token: "session", refresh_token: "refresh", api_key: "relay", expiresAt: Date.now() + 3600000 }) };
    if (method === "settings.get") return structuredClone(settings);
    if (method === "settings.set") { settings = structuredClone(input); return settings; }
    if (method === "providers.list") return { providers: structuredClone(providers) };
    if (method === "providers.create") { const provider = { ...input, id: "host-boxai" }; providers.push(provider); return { provider }; }
    if (method === "providers.update") { Object.assign(providers.find(row => row.id === input.id), input); return {}; }
    throw new Error(`Unexpected host operation ${method}`);
  } };
  const catalog = new ModelsDevCatalog({ catalogPath: "", providers: [] });
  const runtime = createProviderCatalogRuntime({ getHost: () => host, modelsDevCatalog: catalog });
  const account = new VendorOAuth({ call: host.call, emit() {}, openExternal: async () => {},
    fetch: async url => {
      if (url.endsWith("session-status")) return Response.json({ active: true });
      if (url.endsWith("usage/account")) return Response.json({ success: true, data: { account: { username: "review" }, usage: {} } });
      if (url.endsWith("/models")) return Response.json({ data: modelIds.map(id => ({ id })) });
      return Response.json({ success: true, data: { chat_models: modelIds, model_meta: {} } });
    },
  });
  const handlers = new Map();
  registerProviderIpc({ registrar: { handle: (key, handler) => handlers.set(key, handler) }, vendorOAuth: account,
    listRuntimeProviders: runtime.listRuntimeProviders });
  const fixed = new Map([
    [IPC.invoke.appGetVersion, { protocolVersion: PROTOCOL_VERSION }],
    [IPC.invoke.appHealth, { ok: true }],
    [IPC.invoke.sessionList, { sessions: [] }],
    [IPC.invoke.projectGet, { workspace: null }],
    [IPC.invoke.appGetOnboarding, {}],
    [IPC.invoke.pluginList, { plugins: [] }],
    [IPC.invoke.notificationList, { notifications: [], unreadCount: 0 }],
    [IPC.invoke.plansPending, { plans: [] }],
    [IPC.invoke.pluginViews, { views: [] }],
  ]);
  const previousWindow = globalThis.window;
  globalThis.window = { piDesktop: { invoke: async (channel, ...args) => {
    let data;
    if (handlers.has(channel)) data = await handlers.get(channel)(...args);
    else if (channel === IPC.invoke.settingsGet) data = structuredClone(settings);
    else if (fixed.has(channel)) data = structuredClone(fixed.get(channel));
    else throw new Error(`Unexpected renderer IPC ${channel}`);
    return { ok: true, data };
  } } };
  t.after(() => { globalThis.window = previousWindow; });
  const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
    logLevel: "silent", server: { middlewareMode: true, hmr: false, ws: false },
    esbuild: { jsx: "automatic" }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  t.after(() => server.close());
  const { useAppStore } = await server.ssrLoadModule("/src/stores/app-store.ts");
  const { composerModelsForProvider } = await server.ssrLoadModule("/src/lib/composer-models.ts");
  const { ComposerModelList } = await server.ssrLoadModule("/src/features/chat/composer/ComposerModelList.tsx");
  await useAppStore.getState().bootstrap();
  let state = useAppStore.getState();
  assert.equal(state.error, null);
  assert.equal(state.settings.defaultProviderId, "host-boxai");
  assert.equal(state.settings.defaultModelId, "grok-4.6");
  assert.equal(state.settings.locale, "vi");
  const provider = state.providers[0];
  assert.equal(provider.hasSecret, true);
  const models = composerModelsForProvider(provider, state.providerModels[provider.id]);
  assert.deepEqual(models.map(row => row.modelId), modelIds);
  const html = renderToStaticMarkup(createElement(ComposerModelList, {
    t: key => key, query: "", setQuery() {}, modelSearchRef: { current: null }, modelListRef: { current: null },
    modelGroups: [{ provider, providerDisplayName: "BoxAI", models }], modelHighlight: -1,
    setModelHighlight() {}, selectModel() {}, selectedProviderId: state.settings.defaultProviderId,
    selectedModelId: state.settings.defaultModelId,
  }));
  assert.equal((html.match(/role="menuitemradio"/g) ?? []).length, 4);
  assert.match(html, /title="grok-4.6"[^>]*aria-checked="true"/);
  settings.defaultModelId = "claude-sonnet-4-6";
  await useAppStore.getState().refreshProviders();
  assert.equal(useAppStore.getState().settings.defaultModelId, "claude-sonnet-4-6");
  settings.defaultModelId = "removed-model";
  await useAppStore.getState().refreshProviders();
  assert.equal(useAppStore.getState().settings.defaultModelId, "grok-4.6");
});
