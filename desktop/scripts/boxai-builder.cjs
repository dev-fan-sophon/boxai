// Signing is opt-in and pinned to the team verified on existing BoxAI installs.
const config = structuredClone(require("../apps/desktop/package.json").build);
if (process.env.BOXAI_MAC_SIGN === "1") {
  if (process.platform !== "darwin" || process.env.APPLE_TEAM_ID !== "9UUWCMKMDH") {
    throw new Error("BoxAI signing requires native macOS and the verified BoxAI team");
  }
  config.mac.identity = "Developer ID Application: fan Z (9UUWCMKMDH)";
  config.mac.hardenedRuntime = true;
  config.mac.notarize = { teamId: "9UUWCMKMDH" };
  config.mac.target = [{ target: "dmg", arch: ["arm64"] }, { target: "zip", arch: ["arm64"] }];
  config.extraMetadata.boxaiMacSigned = true;
}
module.exports = config;
