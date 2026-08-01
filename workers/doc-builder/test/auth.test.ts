import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { buildBody, post, sign } from "./helpers";

describe("request authentication", () => {
  it("serves health without a signature", async () => {
    const response = await SELF.fetch("https://doc-builder.test/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ service: "boxai-doc-builder" });
  });

  it("rejects a request with no signature headers", async () => {
    const response = await SELF.fetch("https://doc-builder.test/v1/build", {
      method: "POST",
      body: JSON.stringify(buildBody()),
    });
    expect(response.status).toBe(401);
  });

  it("rejects a signature made with the wrong secret", async () => {
    const response = await post("/v1/build", buildBody(), { secret: "not-the-secret" });
    expect(response.status).toBe(401);
  });

  it("rejects a signature outside the freshness window", async () => {
    const response = await post("/v1/build", buildBody(), {
      timestamp: Math.floor(Date.now() / 1000) - 120,
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "signature expired" });
  });

  it("rejects a body edited after signing", async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await sign("test-secret", `${timestamp}.${JSON.stringify(buildBody())}`);
    const response = await post("/v1/build", buildBody({ sandbox_key: "doc:8:42" }), {
      timestamp,
      signature,
    });
    expect(response.status).toBe(401);
  });
});
