/** The builder answers the Go backend, never a browser fetch, so no CORS headers. */
export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function badRequest(message: string): never {
  throw new HttpError(400, message);
}

export function str(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value.trim() : "";
}

export function required(body: Record<string, unknown>, key: string): string {
  const value = str(body, key);
  if (!value) badRequest(`${key} is required`);
  return value;
}

export function positiveInt(body: Record<string, unknown>, key: string, fallback: number, max: number): number {
  const value = body[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    badRequest(`${key} must be a positive number`);
  }
  return Math.min(Math.floor(value), max);
}
