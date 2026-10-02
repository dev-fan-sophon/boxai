#!/usr/bin/env node
// Bump BoxAI's distribution version only. Review and commit before tagging main.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version) || process.argv.length !== 3) {
  throw new Error("Usage: node scripts/release.mjs <stable-version>");
}
for (const name of ["package.json", "apps/desktop/package.json"]) {
  const file = path.join(root, name);
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  pkg.version = version;
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}
const protocol = path.join(root, "packages/shared/src/protocol.ts");
writeFileSync(protocol, readFileSync(protocol, "utf8").replace(
  /(export const APP_VERSION = ")[^"]+(")/, `$1${version}$2`,
));
console.log(`Review and commit the version bump. After main integration and native acceptance, tag desktop-v${version}.`);
