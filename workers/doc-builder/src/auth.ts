import type { Env } from "./env";
import { HttpError } from "./http";

const SIGNATURE_WINDOW_SECONDS = 60;

export const TIMESTAMP_HEADER = "x-boxai-timestamp";
export const SIGNATURE_HEADER = "x-boxai-signature";

/**
 * Verifies the shared-secret signature the Go backend attaches to every build request.
 *
 * The hostname is public, so this is the only thing standing between the open internet and a
 * container that runs arbitrary Python. Signing the body rather than just a bearer token means a
 * captured request cannot be edited to point at someone else's R2 keys.
 *
 * Replay inside the 60 s window is possible and deliberately not defended here: builds are keyed
 * by job ID and the workspace is reset before each run, so a replay rebuilds the same artifacts.
 */
export async function verifySignature(request: Request, env: Env, rawBody: string): Promise<void> {
  const secret = (env.SERVICE_SECRET ?? "").trim();
  if (!secret) throw new HttpError(503, "builder is not configured");

  const timestamp = request.headers.get(TIMESTAMP_HEADER) ?? "";
  const provided = request.headers.get(SIGNATURE_HEADER) ?? "";
  if (!timestamp || !provided) throw new HttpError(401, "missing signature");

  const issued = Number(timestamp);
  if (!Number.isInteger(issued) || issued <= 0) throw new HttpError(401, "invalid signature timestamp");
  if (Math.abs(Math.floor(Date.now() / 1000) - issued) > SIGNATURE_WINDOW_SECONDS) {
    throw new HttpError(401, "signature expired");
  }

  const expected = await sign(secret, `${timestamp}.${rawBody}`);
  if (!timingSafeEqual(expected, provided)) throw new HttpError(401, "invalid signature");
}

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

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
