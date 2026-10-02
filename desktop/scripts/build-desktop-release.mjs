import { spawn, spawnSync, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const forwardedArgs = process.argv.slice(2);

const hostTarget =
  process.platform === "win32"
    ? "win"
    : process.platform === "darwin"
      ? "mac"
      : "linux";
const requestedTarget = ["linux", "mac", "win"].includes(forwardedArgs[0])
  ? forwardedArgs.shift()
  : undefined;
const target = requestedTarget ?? hostTarget;

if (target !== hostTarget || !["mac", "win"].includes(target)) {
  throw new Error("BoxAI releases require native macOS arm64 or Windows x64");
}
if (process.arch !== (target === "mac" ? "arm64" : "x64")) {
  throw new Error("Release architecture must match the native host");
}

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function runBuilder(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(pnpmCommand, ["exec", "electron-builder", "--config", "../../scripts/boxai-builder.cjs", ...args], {
      // Windows exposes pnpm as a .cmd shim. Launch it through the shell so
      // Node can start the shim consistently on the hosted Windows runner.
      shell: process.platform === "win32",
      stdio: "inherit",
      env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `electron-builder ${target} target failed with ${
            code === null ? `signal ${signal ?? "unknown"}` : `exit code ${code}`
          }`,
        ),
      );
    });
  });
}

if (target === "win") {
  await runBuilder([
    "--win",
    "nsis",
    "--publish",
    "never",
    ...forwardedArgs,
    "-c.extraMetadata.piDistribution=installed",
  ]);
} else {
  await runBuilder([
    `--${target}`,
    "--publish",
    "never",
    ...forwardedArgs,
  ]);
}

if (target === "mac" && process.env.BOXAI_MAC_SIGN === "1") {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  const dmg = resolve(`release/BoxAI-Desktop-${version}-macos-arm64.dmg`);
  // App notarization occurs in electron-builder before ZIP creation. The DMG
  // needs its own ticket; never alter a published artifact after hashing it.
  const notarization = spawnSync("xcrun", ["notarytool", "submit", dmg, "--wait", "--apple-id", process.env.APPLE_ID,
    "--password", process.env.APPLE_APP_SPECIFIC_PASSWORD, "--team-id", "9UUWCMKMDH"], { stdio: "inherit" });
  if (notarization.status !== 0) throw new Error("DMG notarization failed");
  execFileSync("xcrun", ["stapler", "staple", dmg], { stdio: "inherit" });
}
