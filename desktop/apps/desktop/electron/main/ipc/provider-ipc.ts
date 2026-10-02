import { IPC, type ModelBinding } from "@pi-desktop/shared";
import type { VendorOAuth } from "../oauth";
import type { ModelsDevCatalog } from "../models-dev-catalog";
import type { HostProcess } from "../host-process";
import type { Logger } from "../logger";
import type { RuntimeProvider } from "../runtime/provider-catalog";
import type { IpcRegistrar } from "./types";

export type ProviderIpcDependencies = {
  registrar: IpcRegistrar;
  getHost: () => HostProcess | null;
  modelsDevCatalog: ModelsDevCatalog;
  vendorOAuth: VendorOAuth;
  logger: Pick<Logger, "app">;
  enrichProvider: (provider: RuntimeProvider, selectedModelId?: string) => unknown;
  listRuntimeProviders: () => Promise<RuntimeProvider[]>;
  enrichProviderList: (result: { providers: RuntimeProvider[] }) => Promise<unknown>;
  bindingForModel: (provider: Pick<RuntimeProvider, "models">, modelId: string) => ModelBinding | undefined;
  onProviderInvalidated?: (providerId: string) => Promise<void> | void;
};

/** No renderer route can install a key, endpoint, or third-party OAuth account. */
export function registerProviderIpc({ registrar, vendorOAuth, listRuntimeProviders, onProviderInvalidated }: ProviderIpcDependencies): void {
  const handle = registrar.handle.bind(registrar);
  handle(IPC.invoke.boxaiAccount, () => vendorOAuth.status());
  handle(IPC.invoke.providersList, async () => {
    if (!(await vendorOAuth.status()).connected) return { providers: [] };
    await vendorOAuth.synchronizeProvider();
    return { providers: await listRuntimeProviders() };
  });
  handle(IPC.invoke.providersOauthVendors, () => vendorOAuth.listVendors().then(vendors => ({ vendors })));
  handle(IPC.invoke.providersOauthStart, (vendorId: string) => vendorOAuth.start(vendorId));
  handle(IPC.invoke.providersOauthCancel, async (id: string) => ({ ok: vendorOAuth.cancel(id) }));
  handle(IPC.invoke.providersOauthDelete, async () => {
    await vendorOAuth.deleteAccount("boxai");
    for (const row of await listRuntimeProviders()) await onProviderInvalidated?.(row.id);
    return { ok: true };
  });
  handle(IPC.invoke.providersListModels, async () => {
    const providers = await listRuntimeProviders();
    const provider = providers[0];
    if (!provider) return { models: [], source: "remote" };
    const options = await vendorOAuth.listModels(provider.id);
    const models = await Promise.all(options.map(async option => {
      const binding = await vendorOAuth.bindingFor(provider.id, option.modelId);
      const config = binding!.modelConfig;
      return { modelId: option.modelId, displayName: option.modelId, providerId: provider.id,
        source: "discovered", reasoning: config.reasoning, modalities: config.modalities,
        supportedThinkingLevels: config.supportedThinkingLevels, contextWindow: config.contextWindow,
        maxTokens: config.maxTokens, capabilities: ["text", ...(config.toolCall ? ["tools"] : []), ...(config.reasoning ? ["reasoning"] : []), ...(config.input.includes("image") ? ["vision"] : [])] };
    }));
    return { models, source: "remote" };
  });
  handle(IPC.invoke.providersLookupModel, async () => ({ info: null }));
  handle(IPC.invoke.providersModelCatalogStatus, async () => ({ status: { loaded: true, source: "remote", providerCount: 1, catalogPath: "BoxAI" } }));
  handle(IPC.invoke.providersTest, async () => { await vendorOAuth.client.session(); return { ok: true, network: "ok" }; });
  for (const channel of [IPC.invoke.providersCreate, IPC.invoke.providersUpdate, IPC.invoke.providersSetSecret,
    IPC.invoke.providersDelete, IPC.invoke.providersReorder, IPC.invoke.providersRefreshModelCatalog,
    IPC.invoke.providersOauthRespond, IPC.invoke.secretsSet, IPC.invoke.secretsDelete, IPC.invoke.secretsHas]) {
    handle(channel, async () => { throw new Error("Model accounts are managed by BoxAI"); });
  }
}
