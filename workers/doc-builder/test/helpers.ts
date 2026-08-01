import { SELF } from "cloudflare:test";

export const SECRET = "test-secret";

export async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function post(
  path: string,
  body: unknown,
  options: { secret?: string; timestamp?: number; signature?: string } = {},
): Promise<Response> {
  const raw = JSON.stringify(body);
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const signature = options.signature ?? (await sign(options.secret ?? SECRET, `${timestamp}.${raw}`));
  return SELF.fetch(`https://doc-builder.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-boxai-timestamp": String(timestamp),
      "x-boxai-signature": signature,
    },
    body: raw,
  });
}

export function buildBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    job_id: "job-1",
    sandbox_key: "doc:7:42",
    code: "print('hi')",
    ...overrides,
  };
}
