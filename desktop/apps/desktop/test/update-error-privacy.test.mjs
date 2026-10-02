import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../electron/main/updater.ts", import.meta.url), "utf8");
const classSource = source.slice(source.indexOf("export class AppUpdaterController"));
const Controller = runInNewContext(
  stripTypeScriptTypes(classSource.replace("export class", "class")) + "\nAppUpdaterController;",
  {
    IPC: { event: { updatesState: "updates-state" } },
    MANUAL_CHECK_TIMEOUT_MS: 1000,
    AUTO_CHECK_TIMEOUT_MS: 1000,
    UPDATE_CHECK_TIMEOUT_CODE: "UPDATE_CHECK_TIMEOUT",
    raceWithTimeout: promise => promise,
  },
);

test("updater never exposes upstream URLs, headers or bodies in state, logs or rejections", async () => {
  const raw = new Error("404 https://example.test/latest.yml?token=private\nreport-to: https://nel.test/report?s=opaque\nsecret response body");
  const events = new Map();
  const sent = [];
  const logs = [];
  const controller = Object.create(Controller.prototype);
  Object.assign(controller, {
    state: { mode: "in-app", status: "idle" },
    ensureSettingsLoaded: async () => {},
    logger: { app: (...args) => logs.push(args) },
    send: (...args) => sent.push(args),
    autoUpdater: {
      on: (event, callback) => events.set(event, callback),
      checkForUpdates: async () => { throw raw; },
      downloadUpdate: async () => { throw raw; },
    },
  });
  controller.attachListeners();
  assert.equal(controller.autoUpdater.logger, null);
  events.get("error")(raw);
  assert.equal(controller.getState().error, "UPDATE_UNAVAILABLE");
  await assert.rejects(controller.check({ manual: true }), { message: "UPDATE_UNAVAILABLE" });
  await assert.rejects(controller.download(), { message: "UPDATE_UNAVAILABLE" });
  const background = await controller.check();
  assert.equal(background.error, "UPDATE_UNAVAILABLE");
  const visible = JSON.stringify({ sent, logs });
  for (const forbidden of ["https://", "token=", "report-to", "opaque", "secret response body"]) {
    assert.equal(visible.includes(forbidden), false, forbidden);
  }
});
