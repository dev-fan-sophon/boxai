/** BoxAI is the only model account. Secrets never cross renderer IPC. */
import { randomUUID } from "node:crypto";
import type { ModelAuth } from "@earendil-works/pi-ai";
import { capabilitiesFromModelConfig, genericModelConfig, type ModelConfig, type VendorModelBinding } from "@pi-desktop/agent-runtime";
import { OAUTH_AUTH_KIND, THINKING_LEVELS, type OAuthLoginEvent, type OAuthRespondInput, type OAuthVendor } from "@pi-desktop/shared";
import { BOXAI_HEADERS, BoxAISessionClient, type BoxAISession } from "./boxai-session.ts";

export { OAUTH_AUTH_KIND };
export const BOXAI_PROVIDER_ID = "boxai";
export type HostCall = <T = unknown>(method: string, params?: unknown) => Promise<T>;
export type OAuthModelOption = { modelId: string; apiStyle: string; baseUrl: string };
type ModelMetadata = { display_name?: string; context_length?: number; max_output_tokens?: number; input_modalities?: string[]; capabilities?: string[]; reasoning_efforts?: string[] };
export type VendorOAuthDeps = {
  call: HostCall;
  emit: (event: OAuthLoginEvent) => void;
  openExternal: (url: string) => Promise<void>;
  origin?: string;
  fetch?: typeof fetch;
  onModelConfig?: (modelId: string, config: ModelConfig) => void;
};
export function secretRefForProviderOauth(providerId: string): string {
  return `secret:provider:${providerId}:oauth`;
}
export function boxaiModelStyle(id: string): string {
  if (/(^|\/)claude-/i.test(id)) return "anthropic_messages";
  return "chat_completions";
}
export function protocolForApiStyle(style: string): string {
  return style === "anthropic_messages" ? "anthropic" : style === "responses" ? "openai" : "openai_compatible";
}

export class VendorOAuth {
  readonly client: BoxAISessionClient;
  readonly origin: string;
  private loginId?: string;
  private models?: { at: number; options: OAuthModelOption[] };
  private synchronization?: Promise<void>;
  private metadata: Record<string, ModelMetadata> = {};
  private readonly deps: VendorOAuthDeps;
  constructor(deps: VendorOAuthDeps) {
    this.deps = deps;
    this.origin = deps.origin ?? "https://you-box.com";
    this.client = new BoxAISessionClient({
      origin: this.origin, fetch: deps.fetch, openExternal: deps.openExternal,
      read: async () => {
        const { value } = await deps.call<{ value?: string }>("secrets.getForRuntime", {
          secretRef: secretRefForProviderOauth(BOXAI_PROVIDER_ID),
        });
        return value ? JSON.parse(value) as BoxAISession : undefined;
      },
      write: async (session) => {
        this.models = undefined;
        const secretRef = secretRefForProviderOauth(BOXAI_PROVIDER_ID);
        await deps.call(session ? "secrets.set" : "secrets.delete", {
          secretRef, ...(session ? { value: JSON.stringify(session) } : {}),
        });
      },
    });
  }

  async listVendors(): Promise<OAuthVendor[]> {
    const status = await this.status();
    return [{ vendorId: BOXAI_PROVIDER_ID, name: "BoxAI", isSubscription: false,
      accounts: status.connected ? [{ providerId: BOXAI_PROVIDER_ID, connected: true, accountLabel: status.usage?.account.username }] : [] }];
  }

  async status() {
    try { return { connected: true, usage: await this.client.usage() }; }
    catch { return { connected: false, usage: undefined }; }
  }

  async start(vendorId: string) {
    if (vendorId !== BOXAI_PROVIDER_ID) throw new Error("Only BoxAI accounts are supported");
    if (this.loginId) throw new Error("BoxAI login is already in progress");
    const loginId = randomUUID();
    this.loginId = loginId;
    void this.client.authorize().then(async () => {
      await this.synchronizeProvider();
      this.deps.emit({ loginId, vendorId, kind: "done", providerId: BOXAI_PROVIDER_ID });
    }).catch(() => {
      this.deps.emit({ loginId, vendorId, kind: "error", message: "BoxAI sign-in failed. Please try again." });
    }).finally(() => { this.loginId = undefined; });
    return { loginId };
  }

  respond(_input: OAuthRespondInput): boolean { return false; }
  cancel(loginId: string): boolean {
    if (loginId !== this.loginId) return false;
    this.client.cancel();
    return true;
  }
  async deleteAccount(providerId: string): Promise<void> {
    if (providerId !== BOXAI_PROVIDER_ID) throw new Error("Unknown account");
    await this.client.logout();
    this.models = undefined;
  }
  async resolveAuth(providerId: string): Promise<ModelAuth> {
    if (providerId !== BOXAI_PROVIDER_ID) {
      const { providers } = await this.deps.call<{ providers: { id: string; vendorKey: string }[] }>("providers.list");
      if (!providers.some(row => row.id === providerId && row.vendorKey === "boxai")) throw new Error("Only BoxAI accounts are supported");
    }
    const session = await this.client.session();
    return { apiKey: session.api_key, headers: BOXAI_HEADERS };
  }
  async listModels(providerId: string): Promise<OAuthModelOption[]> {
    if (this.models && Date.now() - this.models.at < 30_000) return this.models.options;
    const auth = await this.resolveAuth(providerId);
    const [response, provisioning] = await Promise.all([
      this.client.request<{ data: { id: string }[] }>("/v1/models", undefined, auth.apiKey),
      this.client.request<{ success: boolean; data: { chat_models: string[]; model_meta: Record<string, ModelMetadata> } }>("/api/connect/provisioning", undefined, auth.apiKey),
    ]);
    if (!Array.isArray(response.data)) throw new Error("Invalid BoxAI model list");
    if (!provisioning.success || !Array.isArray(provisioning.data.chat_models)) throw new Error("Invalid BoxAI model metadata");
    this.metadata = provisioning.data.model_meta ?? {};
    const allowed = new Set(provisioning.data.chat_models);
    const options = response.data.filter(row => typeof row.id === "string" && allowed.has(row.id))
      .map(row => ({ modelId: row.id, apiStyle: boxaiModelStyle(row.id), baseUrl: `${this.origin}/v1` }));
    this.models = { at: Date.now(), options };
    return options;
  }
  async bindingFor(providerId: string, modelId: string): Promise<VendorModelBinding | undefined> {
    const option = (await this.listModels(providerId)).find(row => row.modelId === modelId);
    if (!option) return undefined;
    const config = genericModelConfig(modelId, option.baseUrl);
    const meta = this.metadata[modelId];
    const input: ("text" | "image")[] = meta?.input_modalities?.includes("image") ? ["text", "image"] : ["text"];
    const levels = THINKING_LEVELS.filter(level => meta?.reasoning_efforts?.includes(level));
    const modelConfig: ModelConfig = { ...config, name: meta?.display_name || modelId,
      reasoning: levels.some(level => level !== "off"), toolCall: meta?.capabilities?.some(value => ["tools", "tool_call", "function_calling"].includes(value)),
      input, modalities: { input, output: ["text"] },
      contextWindow: meta?.context_length && meta.context_length > 0 ? meta.context_length : config.contextWindow,
      maxTokens: meta?.max_output_tokens && meta.max_output_tokens > 0 ? meta.max_output_tokens : config.maxTokens,
      supportedThinkingLevels: levels.length ? levels : ["off"], headers: BOXAI_HEADERS };
    this.deps.onModelConfig?.(modelId, modelConfig);
    return { ...option, modelConfig, ...capabilitiesFromModelConfig(modelConfig) };
  }

  synchronizeProvider(): Promise<void> {
    this.synchronization ??= this.updateProvider().finally(() => { this.synchronization = undefined; });
    return this.synchronization;
  }

  private async updateProvider(): Promise<void> {
    const options = await this.listModels(BOXAI_PROVIDER_ID);
    const { providers } = await this.deps.call<{ providers: { id: string; vendorKey: string }[] }>("providers.list", { includeDisabled: true });
    let provider = providers.find(row => row.vendorKey === "boxai");
    if (!provider) {
      const created = await this.deps.call<{ provider: { id: string; vendorKey: string } }>("providers.create", { name: "BoxAI", vendorKey: "boxai", authKind: OAUTH_AUTH_KIND, type: "native", baseUrl: `${this.origin}/v1` });
      provider = created.provider;
    }
    const models = await Promise.all(options.map(async option => {
      const binding = await this.bindingFor(provider.id, option.modelId);
      return { id: option.modelId, contextWindow: binding!.modelConfig.contextWindow,
        maxTokens: binding!.modelConfig.maxTokens, thinkingLevels: binding!.supportedThinkingLevels };
    }));
    await this.deps.call("providers.update", { id: provider.id, name: "BoxAI", vendorKey: "boxai", authKind: OAUTH_AUTH_KIND,
      baseUrl: `${this.origin}/v1`, headers: BOXAI_HEADERS, enabled: true,
      models,
      defaultModelId: options[0]?.modelId, apiStyle: "chat_completions" });
  }
}
