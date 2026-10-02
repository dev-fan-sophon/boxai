import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { agentDataDir } from "./agent-data-dir.js";
import { NativePiSessionService, nativePiService } from "./native-pi-session.js";
import { globalInstructionPath, loadInstructionChain } from "./project-instructions.js";
import { customSystemPromptDirs } from "./custom-system-prompt.js";
import { composerTemplateDirs } from "./prompt-templates.js";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("selects the BoxAI shipped/dev profile, ignoring inherited Pi CLI overrides", () => {
  const home = mkdtempSync(join(tmpdir(), "boxai-home-"));
  roots.push(home);
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  vi.stubEnv("PI_DESKTOP_DATA_DIR", "");
  vi.stubEnv("PI_DESKTOP_DEV", "0");
  vi.stubEnv("PI_CODING_AGENT_DIR", join(home, ".pi", "agent"));
  expect(agentDataDir()).toBe(join(home, ".boxai-desktop", "agent"));
  vi.stubEnv("PI_DESKTOP_DEV", "1");
  expect(agentDataDir()).toBe(join(home, ".boxai-desktop-dev", "agent"));
});

it("an isolated profile lists only its own native sessions and instructions, leaving ~/.pi untouched", async () => {
  const home = mkdtempSync(join(tmpdir(), "boxai-isolation-"));
  roots.push(home);
  const profile = join(home, "capture-profile");
  const upstream = join(home, ".pi", "agent");
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  vi.stubEnv("PI_DESKTOP_DATA_DIR", profile);
  vi.stubEnv("PI_CODING_AGENT_DIR", upstream);
  const files: string[] = [];
  for (const [root, id] of [[upstream, "foreign"], [join(profile, "agent"), "owned"]]) {
    const folder = join(root, "sessions", "project");
    mkdirSync(folder, { recursive: true });
    const file = join(folder, `${id}.jsonl`);
    writeFileSync(file, JSON.stringify({ type: "session", version: 3, id, cwd: home, timestamp: "2026-10-01T00:00:00Z" }) + "\n");
    files.push(file);
    writeFileSync(join(root, "AGENTS.md"), id);
  }
  const original = readFileSync(files[0]);
  for (const service of [new NativePiSessionService(), nativePiService()]) {
    const listed = await service.list();
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain("foreign");
    expect(JSON.stringify(listed)).toContain("owned");
  }
  expect(readFileSync(files[0])).toEqual(original);
  expect(globalInstructionPath()).toBe(join(profile, "agent", "AGENTS.md"));
  expect((await loadInstructionChain(null))?.entries.map((entry) => entry.content)).toEqual(["owned"]);
  expect(customSystemPromptDirs(null).global).toBe(join(profile, "agent"));
  expect(composerTemplateDirs(null).user).toBe(join(profile, "agent", "prompts"));
});
