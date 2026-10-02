import { IPC, type MarketSource, type SkillCatalogEntry, type SkillMarketSource } from "@pi-desktop/shared";
import type { BoxAICatalog } from "../boxai-catalog";
import type { HostProcess } from "../host-process";
import { searchMcpMarket } from "../mcp-registry-catalog";
import { searchSkillMarket, fetchSkillMarketDocument } from "../skill-market-catalog";
import type { IpcRegistrar } from "./types";

export function registerBoxAICatalogIpc(
  registrar: IpcRegistrar,
  catalog: BoxAICatalog,
  getHost: () => HostProcess | null,
  changed: (kind: string) => Promise<void>,
) {
  registrar.handle(IPC.invoke.boxaiCatalogInstall, async (input: { kind: string; id: string }) => {
    if (!input || typeof input.id !== "string" || input.id.length > 64 || !["skill", "mcp"].includes(input.kind)) {
      throw new Error("Invalid official catalog install request");
    }
    const host = getHost();
    if (!host) throw new Error("host unavailable");
    const call = (method: string, params: unknown) => host.call(method, params);
    const result = input.kind === "skill" ? await catalog.skill(input.id, call) : await catalog.installServer(input.id, call);
    await changed(input.kind);
    return result;
  });
  return {
    searchSkills: async (query: string, sources: SkillMarketSource[]) => {
      const [official, custom] = await Promise.allSettled([catalog.skills(query), searchSkillMarket(query, sources.filter((source) => source.id !== "boxai"))]);
      const result = custom.status === "fulfilled" ? custom.value : { entries: [], failedSources: sources.map((source) => source.name), failureKinds: {}, failureDetails: {} };
      return { ...result,
        entries: [...(official.status === "fulfilled" ? official.value : []), ...result.entries.map((entry) => ({ ...entry, boxaiOfficial: false }))],
        failedSources: [...result.failedSources, ...(official.status === "rejected" ? ["BoxAI"] : [])],
      };
    },
    searchMcp: async (query: string, sources: MarketSource[], options?: { more?: boolean }) => {
      const [official, custom] = await Promise.allSettled([catalog.servers(query), searchMcpMarket(query, sources, options)]);
      const result = custom.status === "fulfilled" ? custom.value : { entries: [], failedSources: sources.map((source) => source.name), exhausted: true };
      return { ...result,
        entries: [...(official.status === "fulfilled" ? official.value : []), ...result.entries.map((entry) => ({ ...entry, boxaiOfficial: false }))],
        failedSources: [...result.failedSources, ...(official.status === "rejected" ? ["BoxAI"] : [])],
      };
    },
    fetchSkill: (entry: SkillCatalogEntry) => entry.boxaiOfficial ? catalog.skill(entry.id) : fetchSkillMarketDocument(entry),
  };
}
