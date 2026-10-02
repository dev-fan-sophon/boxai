import { readSettingsSource, readMainSource } from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [
  protocolSource,
  mainSource,
  apiSource,
  settingsSource,
  settingsSearchSource,
  enSource,
  zhSource,
] = await Promise.all([
  read("../../../packages/shared/src/protocol.ts"),
  readMainSource(),
  read("../src/lib/api.ts"),
  readSettingsSource(),
  read("../src/lib/settings-search.ts"),
  read("../../../packages/i18n/src/locales/en/index.ts"),
  read("../../../packages/i18n/src/locales/zh-CN/index.ts"),
]);

test("Settings Info exposes a Main-owned GitHub feedback action", () => {
  assert.match(protocolSource, /appOpenFeedback:\s*"pi-desktop\/app\/openFeedback"/);
  assert.match(mainSource, /IPC\.invoke\.appOpenFeedback/);
  assert.match(mainSource, /buildBugReportUrl\(/);
  assert.match(mainSource, /assertFeedbackIssueUrl\(/);
  assert.match(mainSource, /await safeOpenExternal\(url\)/);
  assert.match(apiSource, /openFeedback:\s*\(\)\s*=>\s*invoke\(IPC\.invoke\.appOpenFeedback\)/);
  assert.match(settingsSource, /t\("settings\.feedback"\)/);
  assert.match(settingsSource, /api\.openFeedback\(\)/);
  assert.match(settingsSearchSource, /"settings\.feedback"/);
  for (const source of [enSource, zhSource]) {
    assert.match(source, /feedback:/);
    assert.match(source, /feedbackDesc:/);
    assert.match(source, /openFeedback:/);
  }
});
