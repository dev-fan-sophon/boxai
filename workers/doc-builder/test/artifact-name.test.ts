import { describe, expect, it } from "vitest";

import { artifactNameProblem } from "../src/build";

describe("artifactNameProblem", () => {
  it("accepts a name in the language the user asked in", () => {
    // Production caught this: a Chinese request produced a Chinese filename, and an ASCII-only
    // rule turned a perfectly good document into a failed turn.
    expect(artifactNameProblem("2026-Q1-运营报告.docx")).toBe("");
    expect(artifactNameProblem("báo-cáo-quý-1.xlsx")).toBe("");
    expect(artifactNameProblem("Q1 report (final).pdf")).toBe("");
  });

  it("accepts a file written into a subdirectory", () => {
    expect(artifactNameProblem("charts/growth.png")).toBe("");
  });

  it("rejects traversal out of the output directory", () => {
    expect(artifactNameProblem("../../etc/passwd")).not.toBe("");
    expect(artifactNameProblem("charts/../../secrets.docx")).not.toBe("");
  });

  it("rejects an absolute path", () => {
    expect(artifactNameProblem("/etc/passwd")).not.toBe("");
  });

  it("rejects a backslash, which is a separator on the reader's machine", () => {
    expect(artifactNameProblem("charts\\growth.png")).not.toBe("");
  });

  it("rejects a bidi override that disguises the real extension", () => {
    expect(artifactNameProblem("report\u202Excod.exe")).not.toBe("");
  });

  it("rejects zero-width and control characters", () => {
    expect(artifactNameProblem("report\u200B.docx")).not.toBe("");
    expect(artifactNameProblem("report\u0000.docx")).not.toBe("");
  });

  it("rejects a hidden file", () => {
    expect(artifactNameProblem(".bashrc")).not.toBe("");
    expect(artifactNameProblem("charts/.hidden.png")).not.toBe("");
  });

  it("requires an extension so the file has a usable type", () => {
    expect(artifactNameProblem("report")).not.toBe("");
  });

  it("rejects an empty or oversized name", () => {
    expect(artifactNameProblem("")).not.toBe("");
    expect(artifactNameProblem("a".repeat(130) + ".docx")).not.toBe("");
  });
});
