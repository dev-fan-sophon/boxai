import { describe, expect, it } from "vitest";

import { buildBody, post } from "./helpers";

async function expectRejected(body: Record<string, unknown>, message: string): Promise<void> {
  const response = await post("/v1/build", body);
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({ error: message });
}

describe("build request validation", () => {
  it("requires a build script", async () => {
    await expectRejected(buildBody({ code: "" }), "code is required");
  });

  it("caps the size of the build script", async () => {
    await expectRejected(buildBody({ code: "x".repeat(200_001) }), "code is too large");
  });

  it("rejects a sandbox key with shell-hostile characters", async () => {
    await expectRejected(buildBody({ sandbox_key: "doc:7:42; rm -rf /" }), "sandbox_key is malformed");
  });

  it("rejects an input path that escapes the input directory", async () => {
    await expectRejected(
      buildBody({ inputs: [{ path: "../../etc/passwd", r2_key: "k" }] }),
      "path is malformed",
    );
  });

  it("rejects an absolute input path", async () => {
    await expectRejected(buildBody({ inputs: [{ path: "/etc/passwd", r2_key: "k" }] }), "path is malformed");
  });

  it("rejects more input files than a build can plausibly need", async () => {
    const inputs = Array.from({ length: 21 }, (_, index) => ({ path: `f${index}.csv`, r2_key: "k" }));
    await expectRejected(buildBody({ inputs }), "inputs holds too many entries");
  });

  it("rejects a negative timeout", async () => {
    await expectRejected(buildBody({ timeout_ms: -1 }), "timeout_ms must be a positive number");
  });

  // The prefix decides where artifacts land in a bucket shared with the whole asset library,
  // so a traversal here would let one build overwrite another user's file.
  it("rejects an artifact prefix that escapes its namespace", async () => {
    await expectRejected(buildBody({ artifact_prefix: "uploads/7/../8" }), "artifact_prefix is malformed");
  });

  it("rejects an absolute artifact prefix", async () => {
    await expectRejected(buildBody({ artifact_prefix: "/uploads/7" }), "artifact_prefix is malformed");
  });
});
