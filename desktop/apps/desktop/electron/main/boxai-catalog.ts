import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GLOBAL_SCOPE, splitSkillDocument, type McpServerRecord, type SourcedCatalogEntry, type SourcedSkillEntry } from "@pi-desktop/shared";
import { extractOfficialSkill, MAX_OFFICIAL_ARCHIVE_BYTES } from "./boxai-skill-archive.ts";
import type { SkillMarketDocument } from "./skill-market-scan";

export interface CatalogSessionClient {
  session(): Promise<{ access_token: string; api_key: string }>;
  request<T>(path: string, body?: unknown, bearer?: string): Promise<T>;
  onSessionChanged(listener: () => void): () => void;
}
type Archive = { url: string; sha256: string; size_bytes: number; format: "zip"; authorization: "none" | "connection_bearer" };
type Skill = { id: string; name: string; version: string; archive: Archive };
type Server = { id: string; name: string; description: string; url: string; authorization: "connection_bearer" };
type Catalog = { schema_version: 1; skills: Skill[]; mcp_servers: Server[] };
export const OFFICIAL_MCP_PREFIX = "boxai-official-";
const OFFICIAL_SOURCE = "BoxAI";

function officialMcpId(id: string): string {
  return `${OFFICIAL_MCP_PREFIX}${createHash("sha256").update(id).digest("hex").slice(0, 40)}`;
}

/** Account-authenticated catalog and install orchestration. Descriptors passed
 * by the renderer are never authority: installs resolve their ID again here.
 */
export class BoxAICatalog {
  private revision = 0;
  private unsubscribe: () => void;
  private client: CatalogSessionClient;
  private origin: string;
  private fetchImpl: typeof fetch;

  constructor(client: CatalogSessionClient, origin: string, invalidate: () => void, fetchImpl = fetch) {
    this.client = client;
    this.origin = origin;
    this.fetchImpl = fetchImpl;
    this.unsubscribe = client.onSessionChanged(() => {
      this.revision++;
      invalidate();
    });
  }

  dispose(): void { this.unsubscribe(); }

  private async catalog(): Promise<Catalog> {
    const session = await this.client.session();
    const revision = this.revision;
    const response = await this.client.request<{ success: boolean; data: Catalog }>("/api/desktop/catalog", undefined, session.access_token);
    if (revision !== this.revision) throw new Error("BoxAI account changed");
    const data = response.data;
    if (!response.success || data?.schema_version !== 1 || !Array.isArray(data.skills) || !Array.isArray(data.mcp_servers) ||
        data.skills.length > 1000 || data.mcp_servers.length > 1000) throw new Error("Invalid BoxAI catalog");
    const ids = new Set<string>();
    for (const entry of [...data.skills, ...data.mcp_servers]) {
      if (typeof entry.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.id) ||
          typeof entry.name !== "string" || !entry.name || entry.name.length > 255) throw new Error("Invalid BoxAI catalog entry");
    }
    for (const entry of data.skills) {
      if (ids.has(`skill:${entry.id}`)) throw new Error("Duplicate BoxAI skill");
      ids.add(`skill:${entry.id}`);
      const archive = entry.archive;
      if (typeof entry.version !== "string" || !archive || archive.format !== "zip" ||
          !/^[a-f0-9]{64}$/.test(archive.sha256) || !Number.isSafeInteger(archive.size_bytes) ||
          archive.size_bytes <= 0 || archive.size_bytes > MAX_OFFICIAL_ARCHIVE_BYTES ||
          !["none", "connection_bearer"].includes(archive.authorization)) throw new Error("Invalid BoxAI skill archive");
      const url = new URL(archive.url);
      if ((url.protocol !== "https:" && url.origin !== this.origin) || url.username || url.password || url.hash ||
          (url.origin !== this.origin && url.origin !== "https://dl.you-box.com") ||
          (archive.authorization === "connection_bearer" && url.origin !== this.origin)) throw new Error("Untrusted BoxAI archive origin");
    }
    for (const entry of data.mcp_servers) {
      if (ids.has(`mcp:${entry.id}`)) throw new Error("Duplicate BoxAI MCP server");
      ids.add(`mcp:${entry.id}`);
      const url = new URL(entry.url);
      if (url.origin !== this.origin || url.username || url.password || url.hash ||
          entry.authorization !== "connection_bearer") throw new Error("Untrusted BoxAI MCP origin");
    }
    return data;
  }

  async skills(query: string): Promise<SourcedSkillEntry[]> {
    return (await this.catalog()).skills.filter((entry) => `${entry.name} ${entry.id}`.toLowerCase().includes(query.toLowerCase())).map((entry) => ({
      id: entry.id, name: entry.name, version: entry.version, url: entry.archive.url,
      author: OFFICIAL_SOURCE, verified: true, sourceId: "boxai", boxaiOfficial: true,
    }));
  }

  async servers(query: string): Promise<SourcedCatalogEntry[]> {
    return (await this.catalog()).mcp_servers.filter((entry) => `${entry.name} ${entry.description}`.toLowerCase().includes(query.toLowerCase())).map((entry) => ({
      id: officialMcpId(entry.id), name: entry.name, description: entry.description,
      transport: "http", url: entry.url, author: OFFICIAL_SOURCE, verified: true, sourceId: "official", boxaiOfficial: true,
    }));
  }

  async authorization(record: McpServerRecord): Promise<string | undefined> {
    if (!record.id.startsWith(OFFICIAL_MCP_PREFIX)) return undefined;
    const catalog = await this.catalog();
    const server = catalog.mcp_servers.find((entry) => officialMcpId(entry.id) === record.id);
    if (!server || record.transport !== "http" || record.url !== server.url) throw new Error("Invalid BoxAI MCP configuration");
    const revision = this.revision;
    const session = await this.client.session();
    if (revision !== this.revision) throw new Error("BoxAI account changed");
    return session.api_key;
  }

  async installServer(id: string, call: (method: string, params: unknown) => Promise<unknown>): Promise<unknown> {
    const catalog = await this.catalog();
    const server = catalog.mcp_servers.find((entry) => officialMcpId(entry.id) === id);
    if (!server) throw new Error("BoxAI MCP server unavailable");
    return call("mcp.upsert", { server: {
      id, label: server.name, transport: "http", url: server.url, headers: {},
      enabled: true, level: "global", scope: GLOBAL_SCOPE,
    } });
  }

  skill(id: string): Promise<SkillMarketDocument>;
  skill(id: string, install: (method: string, params: unknown) => Promise<unknown>): Promise<unknown>;
  async skill(id: string, install?: (method: string, params: unknown) => Promise<unknown>): Promise<unknown> {
    const catalog = await this.catalog();
    const skill = catalog.skills.find((entry) => entry.id === id);
    if (!skill) throw new Error("BoxAI skill unavailable");
    const session = await this.client.session();
    const revision = this.revision;
    const response = await this.fetchImpl(skill.archive.url, {
      redirect: "error", credentials: "omit", signal: AbortSignal.timeout(30_000),
      headers: skill.archive.authorization === "connection_bearer" ? { Authorization: `Bearer ${session.api_key}` } : {},
    });
    if (!response.ok || !response.body) throw new Error("BoxAI skill download failed");
    const chunks: Buffer[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > skill.archive.size_bytes) throw new Error("BoxAI skill download exceeds declared size");
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel();
    }
    const directory = await mkdtemp(join(tmpdir(), "boxai-skill-"));
    try {
      const root = await extractOfficialSkill(Buffer.concat(chunks), skill.archive, directory);
      if (revision !== this.revision) throw new Error("BoxAI account changed");
      if (install) return await install("skills.import", { path: root, skill: {
        id: skill.id, name: skill.name, level: "global", scope: GLOBAL_SCOPE, enabled: true, mode: "copy",
      } });
      return splitSkillDocument(await readFile(join(root, "SKILL.md"), "utf8"));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
