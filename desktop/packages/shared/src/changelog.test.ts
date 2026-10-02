import { describe, expect, it } from "vitest";
import { CHANGELOG, formatChangelogNotes, getChangelogEntry, normalizeChangelogVersion, resolveChangelogLocale } from "./changelog.js";
import { loadChangelogCatalog } from "./changelog-loader.js";

describe("BoxAI release notes", () => {
  it("never confuses an upstream version with a BoxAI release", () => {
    expect(getChangelogEntry("0.16.0")).toBeUndefined();
    expect(getChangelogEntry("0.2.7")).toBeUndefined();
    expect(formatChangelogNotes(" v0.2.0 ", "en")).toBe(
      "• BoxAI Desktop now uses the Electron desktop client with BoxAI account sign-in and gateway models.",
    );
    expect(formatChangelogNotes("0.2.0-beta.1")).toBeUndefined();
  });

  it("keeps the same release set in every shipped locale", () => {
    for (const entries of Object.values(CHANGELOG)) {
      expect(entries.map((entry) => entry.version)).toEqual(["0.2.1", "0.2.0"]);
      expect(entries[0].highlights).toHaveLength(2);
      expect(entries[0].highlights[0]).toContain("macOS");
    }
  });

  it("loads Vietnamese notes for the Vietnamese system locale", async () => {
    expect(resolveChangelogLocale("vi_VN")).toBe("vi");
    expect(resolveChangelogLocale("ja-JP")).toBe("ja");
    expect(resolveChangelogLocale("ru-RU")).toBe("ru");
    expect(resolveChangelogLocale("zh-Hant-HK")).toBe("zh-TW");
    expect((await loadChangelogCatalog("vi-VN"))[0].highlights[0]).toContain("chữ ký");
    expect(await loadChangelogCatalog("unknown")).toEqual(CHANGELOG.en);
  });

  it("normalizes versions without inventing entries for missing data", () => {
    expect(normalizeChangelogVersion(" V0.2.0 ")).toBe("0.2.0");
    expect(getChangelogEntry(null)).toBeUndefined();
    expect(formatChangelogNotes(undefined)).toBeUndefined();
    expect(formatChangelogNotes("0.2.0", "unknown")).toBe(formatChangelogNotes("0.2.0", "en"));
  });
});
