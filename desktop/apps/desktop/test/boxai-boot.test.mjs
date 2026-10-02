import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { IPC } from "@pi-desktop/shared";

test("installed boot probe observes the signed-out gate without writing host state", async () => {
  const source = readFileSync(new URL("../electron/main/bootstrap/startup.ts", import.meta.url), "utf8");
  const expression = source.slice(source.indexOf("const probe = await window!.webContents.executeJavaScript(")).match(/`([\s\S]*?)`/)[1];
  const reads = new Map([
    [IPC.invoke.appGetVersion, { version: "0.2.0", hostProtocolVersion: 11 }],
    [IPC.invoke.windowControl, { maximized: true }],
    [IPC.invoke.boxaiAccount, { connected: false }],
    [IPC.invoke.providersList, { providers: [] }],
  ]);
  const result = await runInNewContext(expression, {
    window: { piDesktop: { platform: "win32", channels: IPC, invoke: async channel => {
      assert.ok(reads.has(channel), `boot attempted a non-read operation: ${channel}`);
      return { ok: true, data: reads.get(channel) };
    } } },
    document: { querySelector: selector => selector === "[data-boxai-account-gate]" ? {} : null },
  });
  assert.equal(result.ok, true);
  assert.equal(result.account.connected, false);
  assert.equal(result.providerCount, 0);
  assert.equal(result.loginGateVisible, true);
  assert.equal(result.hostProtocol, 11);
  assert.equal(result.maximized, true);
});
