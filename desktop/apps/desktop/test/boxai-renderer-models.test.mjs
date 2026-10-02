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
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const storage = new Map();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  } });
  t.after(() => {
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete globalThis.localStorage;
  });
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
    [IPC.invoke.projectSet, { workspace: { path: "/review-project", name: "Review" } }],
    [IPC.invoke.appGetOnboarding, { showChecklist: true, steps: [
      { id: "provider", title: "Add an AI provider", action: "settings.providers", done: false },
      { id: "secret", title: "Save your API key", action: "saveKey", done: false },
      { id: "project", title: "Open a project folder", action: "project.open", done: false },
      { id: "prompt", title: "Send your first message", action: "chat.focus", done: false },
      { id: "plugin", title: "Load a development plugin (optional)", action: "plugins.open", done: false },
    ] }],
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
  // A fresh authorized account must not inherit the upstream provider/key CTA,
  // even when the host's legacy onboarding flags are still incomplete.
  const { OnboardingChecklist } = await server.ssrLoadModule("/src/components/OnboardingChecklist.tsx");
  // SSR subscriptions read getInitialState rather than the client snapshot.
  const initialSnapshot = useAppStore.getInitialState();
  const initialOnboarding = initialSnapshot.onboarding;
  initialSnapshot.onboarding = state.onboarding;
  t.after(() => { initialSnapshot.onboarding = initialOnboarding; });
  const checklist = renderToStaticMarkup(createElement(OnboardingChecklist));
  assert.doesNotMatch(checklist, /Add an AI provider|Save your API key|Load a development plugin|onboarding\.(addProvider|saveKey|loadPlugin)/);
  assert.match(checklist, /Open a project folder/);
  assert.match(checklist, /Send your first message/);
  assert.equal((checklist.match(/<li>/g) ?? []).length, 2);
  // Exercise real project/session actions with the original stale onboarding
  // snapshot, exactly as the app does when returning home after its first chat.
  await useAppStore.getState().openProjectPath("/review-project");
  initialSnapshot.workspace = useAppStore.getState().workspace;
  assert.match(renderToStaticMarkup(createElement(OnboardingChecklist)), /Send your first message/);
  const firstSession = { id: "first-chat", title: "First chat", projectPath: "/review-project",
    createdAt: "2026-10-02T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z", messageCount: 0 };
  fixed.set(IPC.invoke.sessionList, { sessions: [firstSession] });
  await useAppStore.getState().refreshSessions();
  initialSnapshot.sessions = useAppStore.getState().sessions;
  assert.match(renderToStaticMarkup(createElement(OnboardingChecklist)), /Send your first message/,
    "creating an empty session is not sending the first message");
  fixed.set(IPC.invoke.sessionList, { sessions: [{ ...firstSession, messageCount: 2 }] });
  await useAppStore.getState().refreshSessions();
  initialSnapshot.sessions = useAppStore.getState().sessions;
  assert.equal(useAppStore.getState().onboarding.showChecklist, true);
  assert.equal(useAppStore.getState().onboarding.steps.find(step => step.id === "prompt").done, false);
  assert.equal(renderToStaticMarkup(createElement(OnboardingChecklist)), "",
    "live project and first chat completion hide stale host onboarding without restarting");
  initialSnapshot.workspace = null;
  initialSnapshot.sessions = [];
  initialSnapshot.onboarding = { ...state.onboarding, showChecklist: false };
  assert.match(renderToStaticMarkup(createElement(OnboardingChecklist)), /Send your first message/,
    "the legacy host visibility flag does not control BoxAI steps");
  initialSnapshot.settings = { ...settings, onboardingDismissed: true };
  assert.equal(renderToStaticMarkup(createElement(OnboardingChecklist)), "",
    "explicit user dismissal still hides incomplete onboarding");
  initialSnapshot.settings = settings;
  useAppStore.setState({ onboarding: { ...state.onboarding, steps: state.onboarding.steps.map(step => ({
    ...step, done: step.id === "project" || step.id === "prompt",
  })) } });
  initialSnapshot.onboarding = useAppStore.getState().onboarding;
  assert.equal(renderToStaticMarkup(createElement(OnboardingChecklist)), "",
    "hidden provider/key/plugin steps must not keep completed onboarding visible");
  settings.defaultModelId = "claude-sonnet-4-6";
  await useAppStore.getState().refreshProviders();
  assert.equal(useAppStore.getState().settings.defaultModelId, "claude-sonnet-4-6");
  settings.defaultModelId = "removed-model";
  await useAppStore.getState().refreshProviders();
  assert.equal(useAppStore.getState().settings.defaultModelId, "grok-4.6");
});
