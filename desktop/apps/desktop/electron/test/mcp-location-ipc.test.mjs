import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("../../test/helpers/ts-import-hooks.mjs", import.meta.url));
const { registerMcpIpc } = await import("../main/ipc/mcp-ipc.ts");
const { IPC } = await import("@pi-desktop/shared");

test("MCP list preserves the current host directory alongside runtime statuses", async () => {
  const handlers = new Map();
  let directory = "D:\\BoxAI profiles\\Lotus\\agent\\servers";
  const queries = [];
  registerMcpIpc({
    registrar: { handle: (channel, fn) => handlers.set(channel, fn) },
    getHost: () => ({ call: async (method, query) => {
      assert.equal(method, "mcp.list");
      queries.push(query);
      return { servers: [], statuses: [], directory };
    } }),
    userMcp: { refreshStatuses: async () => [{ serverId: "test", state: "idle" }] },
    currentWorkspacePath: () => null,
    refreshUserMcp: async () => [],
  });
  const list = handlers.get(IPC.invoke.mcpList);
  const local = await list({ level: "global" });
  assert.equal(local.directory, "D:\\BoxAI profiles\\Lotus\\agent\\servers");
  assert.deepEqual(local.servers, []);
  assert.deepEqual(local.statuses, [{ serverId: "test", state: "idle", hasOauth: false }]);
  directory = "/srv/remote-boxai/agent/servers";
  assert.equal((await list({ level: "global" })).directory, directory);
  directory = undefined;
  assert.equal((await list({ level: "global" })).directory, undefined);
  assert.deepEqual(queries, Array(3).fill({ level: "global" }));
});
