#!/usr/bin/env node
// Native installer acceptance. Reports are emitted only after installed bytes boot.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pkg = JSON.parse(readFileSync(join(root, "desktop/apps/desktop/package.json")));
const platform = process.platform;
assert.ok((platform === "darwin" && process.arch === "arm64") || (platform === "win32" && process.arch === "x64"), "native macOS arm64 / Windows x64 required");
const version = pkg.version;
const filename = `BoxAI-Desktop-${version}-${platform === "darwin" ? "macos-arm64.dmg" : "windows-x64-setup.exe"}`;
const artifact = join(root, "desktop/apps/desktop/release", filename);
const stage = join(root, "desktop/release", version);
const scratch = mkdtempSync(join(tmpdir(), "boxai-native-"));
const install = join(scratch, "installed");
const digest = createHash("sha256").update(readFileSync(artifact)).digest("hex");
let mounted = false;
try {
  let executable;
  if (platform === "darwin") {
    const mount = join(scratch, "volume");
    mkdirSync(mount);
    execFileSync("hdiutil", ["attach", artifact, "-nobrowse", "-readonly", "-mountpoint", mount]);
    mounted = true;
    execFileSync("ditto", [join(mount, "BoxAI Desktop.app"), join(install, "BoxAI Desktop.app")]);
    const contents = join(install, "BoxAI Desktop.app/Contents");
    const plist = JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", join(contents, "Info.plist")], { encoding: "utf8" }));
    assert.equal(plist.CFBundleIdentifier, "com.youbox.desktop");
    assert.equal(plist.CFBundleShortVersionString, version);
    executable = join(contents, "MacOS", plist.CFBundleExecutable);
    assert.equal(execFileSync("lipo", ["-archs", executable], { encoding: "utf8" }).trim(), "arm64");
    assert.ok(existsSync(join(contents, "Resources/bin/pi-desktop-host-core")));
  } else {
    // NSIS /D must be the final argument. Install into an isolated directory.
    await new Promise((resolve, reject) => {
      const child = spawn(artifact, ["/S", `/D=${install}`], { stdio: "inherit" });
      child.once("error", reject);
      child.once("exit", code => code === 0 ? resolve() : reject(new Error(`NSIS exit ${code}`)));
    });
    executable = join(install, "BoxAI Desktop.exe");
    const pe = readFileSync(executable);
    assert.equal(pe.readUInt16LE(pe.readUInt32LE(0x3c) + 4), 0x8664, "PE must be x64");
    assert.ok(existsSync(join(install, "resources/bin/pi-desktop-host-core.exe")));
  }
  const env = { ...process.env, PI_DESKTOP_DATA_DIR: join(scratch, "profile"), PI_DESKTOP_BOOT_PROBE: "1", ELECTRON_RENDERER_URL: "" };
  delete env.ELECTRON_RUN_AS_NODE;
  const probe = await new Promise((resolve, reject) => {
    const child = spawn(executable, [], { env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timeout = setTimeout(() => { child.kill(); reject(new Error("Installed application boot probe timed out")); }, 120_000);
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("close", code => {
      clearTimeout(timeout);
      const line = output.split(/\r?\n/).find(line => line.startsWith("BOOT_PROBE "));
      if (code !== 0 || !line) return reject(new Error(`Installed boot failed (${code}); no successful BOOT_PROBE`));
      try { resolve(JSON.parse(line.slice(11))); } catch (error) { reject(error); }
    });
  });
  assert.equal(probe.ok, true, JSON.stringify(probe));
  assert.equal(probe.version, version);
  assert.equal(probe.appName, "BoxAI Desktop");
  assert.equal(probe.platform, platform);
  assert.equal(probe.projectRemove?.ok, true, "host-core IPC round trip");
  assert.equal(probe.ctrlRBlocked, true);
  mkdirSync(stage, { recursive: true });
  copyFileSync(artifact, join(stage, filename));
  if (existsSync(`${artifact}.blockmap`)) copyFileSync(`${artifact}.blockmap`, join(stage, `${filename}.blockmap`));
  const report = { schema: 1, version, platform, arch: process.arch, filename, sha256: digest,
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    signed: false, installed: true, boot: probe, checked_at: new Date().toISOString() };
  writeFileSync(join(stage, `${filename}.assertion.json`), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`NATIVE_OK ${filename} SHA256 ${digest}`);
} finally {
  if (mounted) execFileSync("hdiutil", ["detach", join(scratch, "volume")]);
  // Windows uninstall owns registry/shortcut cleanup, not just its directory.
  if (platform === "win32" && existsSync(join(install, "Uninstall BoxAI Desktop.exe"))) {
    execFileSync(join(install, "Uninstall BoxAI Desktop.exe"), ["/S", `_?=${install}`]);
  }
  rmSync(scratch, { recursive: true, force: true });
}
