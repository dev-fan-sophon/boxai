import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("home and sidebar share the BoxAI mark, visible in both themes without motion", async () => {
  const [home, sidebar, styles] = await Promise.all([
    read("../src/components/HomeMascotLogo.tsx"),
    read("../src/components/Sidebar.tsx"),
    loadStyles(),
  ]);
  assert.match(home, /<BrandLogo size=\{100\}/);
  assert.match(sidebar, /<BrandLogo\s+size=\{20\}/);
  assert.match(styles, /\.home-mascot-logo img\s*\{\s*display:\s*block/);
  assert.doesNotMatch(home, /home-mascot-.*\.gif/);
  for (const theme of ["light", "dark"]) {
    const bytes = await readFile(new URL(`../src/assets/brand/logo-${theme}.png`, import.meta.url));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(bytes.readUInt32BE(16), 128);
    assert.equal(bytes.readUInt32BE(20), 128);
  }
});
