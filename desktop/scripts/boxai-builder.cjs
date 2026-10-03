// Full-bundle ad-hoc signing is the default. Developer ID/notarization is opt-in
// and pinned to the team verified on existing BoxAI installs.
const config = structuredClone(require("../apps/desktop/package.json").build);
config.extraMetadata.boxaiBuildCommit = require("node:child_process").execFileSync(
  "git", ["rev-parse", "HEAD"], { cwd: require("node:path").resolve(__dirname, "../.."), encoding: "utf8" },
).trim();
if (process.env.BOXAI_MAC_SIGN === "1") {
  if (process.platform !== "darwin" || process.env.APPLE_TEAM_ID !== "9UUWCMKMDH") {
    throw new Error("BoxAI signing requires native macOS and the verified BoxAI team");
  }
  config.mac.identity = "fan Z (9UUWCMKMDH)";
  config.mac.hardenedRuntime = true;
  config.mac.notarize = true;
  config.mac.target = [{ target: "dmg", arch: ["arm64"] }, { target: "zip", arch: ["arm64"] }];
  config.dmg.sign = true;
  config.extraMetadata.boxaiMacSigned = true;
}
module.exports = config;
