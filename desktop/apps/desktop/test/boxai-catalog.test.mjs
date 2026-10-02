import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import test from "node:test";
import { extractOfficialSkill } from "../electron/main/boxai-skill-archive.ts";
import { BoxAICatalog } from "../electron/main/boxai-catalog.ts";
import { UserMcpRuntime } from "../electron/main/user-mcp.ts";

// Independent ZIP fixture writer with controllable metadata for hostile inputs.
function archive(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const { name, body = "x", mode = 0x81a4, declared } of entries) {
    const filename = Buffer.from(name), data = Buffer.from(body), compressed = deflateRawSync(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(declared ?? data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, compressed);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(0x0314, 4);
    header.copy(record, 6, 4, 28);
    record.writeUInt32LE((mode << 16) >>> 0, 38);
    record.writeUInt32LE(offset, 42);
    central.push(record, filename);
    offset += header.length + filename.length + compressed.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(Buffer.concat(central).length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}
const descriptor = (bytes) => ({ size_bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });

test("verified skill ZIP preserves supporting files and enforces integrity before writing", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "catalog-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = archive([{ name: "media/SKILL.md", body: "# Media\nUse tools." }, { name: "media/references/help.md", body: "reference" }]);
  const target = await extractOfficialSkill(bytes, descriptor(bytes), root);
  assert.equal(await readFile(join(target, "references/help.md"), "utf8"), "reference");
  assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "# Media\nUse tools.");
  const empty = await mkdtemp(join(tmpdir(), "catalog-test-"));
  t.after(() => rm(empty, { recursive: true, force: true }));
  await assert.rejects(extractOfficialSkill(bytes, { ...descriptor(bytes), sha256: "0".repeat(64) }, empty), /integrity/);
  await assert.rejects(extractOfficialSkill(bytes, { ...descriptor(bytes), size_bytes: bytes.length + 1 }, empty), /integrity/);
  assert.deepEqual(await readdir(empty), []);
});

test("archive refuses traversal, symlinks, aliases, duplicate paths and expansion bombs", async (t) => {
  for (const entry of [
    { name: "../escape" }, { name: "/absolute" }, { name: "C:/escape" }, { name: "dir\\escape" },
    { name: "link", mode: 0xa1ff }, { name: "CON.txt" }, { name: "trailing. " },
    { name: "bomb", declared: 64 * 1024 * 1024 + 1 },
    { name: "lying-size", body: "x".repeat(100_000), declared: 1 },
    { name: "SKILL.md", body: "x".repeat(128 * 1024 + 1) },
    { name: "skill.md" },
  ]) {
    const root = await mkdtemp(join(tmpdir(), "catalog-invalid-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const bytes = archive([{ name: "SKILL.md", body: "# Skill" }, entry]);
    await assert.rejects(extractOfficialSkill(bytes, descriptor(bytes), root), undefined, entry.name);
  }
});

function fixture(t, bytes, download = () => new Response(bytes)) {
  let listener, signedIn = true;
  const calls = [];
  const data = { schema_version: 1,
    skills: [{ id: "media", name: "Media", version: "1.0.0", archive: { ...descriptor(bytes), url: "https://dl.you-box.com/skills/media.zip", format: "zip", authorization: "none" } }],
    mcp_servers: [{ id: "media", name: "BoxAI Media", url: "https://you-box.com/mcp", description: "Media tools", authorization: "connection_bearer" }],
  };
  const client = {
    session: async () => { if (!signedIn) throw new Error("signed out"); return { access_token: "jwt-test", api_key: "relay-test" }; },
    request: async (path, body, bearer) => { assert.equal(path, "/api/desktop/catalog"); assert.equal(bearer, "jwt-test"); return { success: true, data }; },
    onSessionChanged: (fn) => { listener = fn; return () => { listener = undefined; }; },
  };
  const catalog = new BoxAICatalog(client, "https://you-box.com", () => calls.push("invalidated"), async (url, init) => {
    calls.push({ url, init });
    return download();
  });
  t.after(() => catalog.dispose());
  return { catalog, data, calls, client, logout: () => { signedIn = false; listener(); } };
}

test("official browse → preview → install uses catalog authority and keeps credentials out of CDN and records", async (t) => {
  const bytes = archive([{ name: "SKILL.md", body: "---\nname: Media\n---\nUse Media MCP." }, { name: "scripts/example.txt", body: "resource" }]);
  const { catalog, calls, logout } = fixture(t, bytes);
  const entries = await catalog.skills("media");
  assert.equal(entries[0].boxaiOfficial, true);
  assert.equal((await catalog.skill("media")).body.trim(), "Use Media MCP.");
  let imported;
  await catalog.skill("media", async (method, params) => {
    assert.equal(method, "skills.import");
    imported = params;
    assert.equal(await readFile(join(params.path, "scripts/example.txt"), "utf8"), "resource");
    return { skill: { id: "media" } };
  });
  await assert.rejects(readFile(join(imported.path, "SKILL.md")), /ENOENT/);
  assert.equal(imported.skill.mode, "copy");
  await assert.rejects(catalog.skill("unknown"), /unavailable/);
  let server;
  await catalog.installServer((await catalog.servers(""))[0].id, async (_method, params) => { server = params.server; });
  assert.deepEqual(server.headers, {});
  assert.equal(await catalog.authorization(server), "relay-test");
  await assert.rejects(catalog.authorization({ ...server, url: "https://attacker.example/mcp" }), /configuration/);
  for (const call of calls.filter((call) => typeof call === "object")) {
    assert.deepEqual(call.init.headers, {});
    assert.equal(call.init.redirect, "error");
    assert.equal(call.init.credentials, "omit");
  }
  assert.doesNotMatch(JSON.stringify({ entries, server }), /relay-test|jwt-test/);
  logout();
  assert.ok(calls.includes("invalidated"));
  await assert.rejects(catalog.authorization(server), /signed out/);
});

test("catalog never sends a bearer to a CDN or third-party descriptor", async (t) => {
  const bytes = archive([{ name: "SKILL.md" }]);
  const { catalog, data, calls } = fixture(t, bytes);
  data.skills[0].archive.authorization = "connection_bearer";
  await assert.rejects(catalog.skill("media"), /origin/);
  data.skills[0].archive.authorization = "none";
  data.skills[0].archive.url = "https://attacker.example/payload.zip";
  await assert.rejects(catalog.skill("media"), /origin/);
  assert.deepEqual(calls, []);
});

test("account MCP ignores saved headers, rotates connections and fences logout during credential resolution", async (t) => {
  const configs = [], clients = [];
  const runtime = new UserMcpRuntime({ createClient(config) {
    configs.push(config);
    let connected = false;
    const tools = [{ name: "media", description: "Media" }];
    const client = { connect: async () => { connected = true; return tools; }, getTools: () => tools,
      isConnected: () => connected, close: () => { connected = false; }, callTool: async () => "ok", ping: async () => {} };
    clients.push(client);
    return client;
  } });
  t.after(() => runtime.disposeAll());
  const record = { id: "boxai-official-test", label: "BoxAI Media", transport: "http", url: "https://you-box.com/mcp", enabled: true,
    headers: { authorization: "stale", "X-Other": "untrusted" }, scope: { mode: "global" } };
  runtime.setRecords([record]);
  let token = "first";
  runtime.setAccountAuthorization(async () => token);
  assert.equal((await runtime.toolsForProject("/repo")).length, 1);
  assert.deepEqual(configs[0].server.headers, { Authorization: "Bearer first" });
  token = "second";
  runtime.invalidate(record.id);
  assert.equal(clients[0].isConnected(), false);
  assert.equal((await runtime.toolsForProject("/repo")).length, 1);
  assert.deepEqual(configs[1].server.headers, { Authorization: "Bearer second" });
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, init) => { requests.push({ url, init }); return new Response("ok"); });
  token = "per-request";
  await configs[1].fetchImpl(record.url, { headers: { authorization: "old" } });
  assert.equal(requests[0].init.headers.get("authorization"), "Bearer per-request");
  assert.equal(requests[0].init.redirect, "error");
  assert.equal(requests[0].init.credentials, "omit");
  await assert.rejects(configs[1].fetchImpl("https://you-box.com/untrusted"), /endpoint/);
  assert.equal(requests.length, 1);
  let release;
  runtime.setAccountAuthorization(() => new Promise((resolve) => { release = resolve; }));
  const pending = runtime.toolsForProject("/repo");
  runtime.invalidate(record.id);
  release("stale-after-logout");
  assert.deepEqual(await pending, []);
  assert.equal(configs.length, 2);
  assert.equal(clients[1].isConnected(), false);
});

test("logout during an in-flight catalog read discards its response", async (t) => {
  const bytes = archive([{ name: "SKILL.md" }]);
  const { catalog, data, client, logout } = fixture(t, bytes);
  let release, started;
  const requested = new Promise((resolve) => { started = resolve; });
  client.request = () => { started(); return new Promise((resolve) => { release = resolve; }); };
  const pending = catalog.skills("");
  await requested;
  logout();
  release({ success: true, data });
  await assert.rejects(pending, /account changed/);
});

test("a changed account or mismatched download size never reaches the host importer", async (t) => {
  const bytes = archive([{ name: "SKILL.md" }]);
  let logout;
  const changing = fixture(t, bytes, () => { logout(); return new Response(bytes); });
  logout = changing.logout;
  const imported = [];
  const install = (...args) => { imported.push(args); };
  await assert.rejects(changing.catalog.skill("media", install), /account changed/);
  const mismatch = fixture(t, bytes);
  mismatch.data.skills[0].archive.size_bytes = bytes.length - 1;
  await assert.rejects(mismatch.catalog.skill("media", install), /declared size/);
  mismatch.data.skills[0].archive.size_bytes = bytes.length + 1;
  await assert.rejects(mismatch.catalog.skill("media", install), /integrity/);
  assert.deepEqual(imported, []);
});
