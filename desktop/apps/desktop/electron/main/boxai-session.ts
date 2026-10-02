import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export const BOXAI_HEADERS = { "X-BoxAI-Client": "boxai-desktop", "User-Agent": "BoxAI-Desktop" };
export type BoxAISession = {
  access_token: string;
  refresh_token: string;
  api_key: string;
  expiresAt: number;
};
export type BoxAIUsage = {
  account: { id: number; username: string; display_name: string };
  usage: { wallet_quota_remaining: number; lifetime_quota_used: number; lifetime_request_count: number };
};
export type BoxAISessionDependencies = {
  origin: string;
  read: () => Promise<BoxAISession | undefined>;
  write: (session: BoxAISession | undefined) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  fetch?: typeof fetch;
};

/** Packaged builds cannot redirect account credentials to another server. */
export function boxaiOrigin(packaged: boolean, override?: string): string {
  if (packaged || !override) return "https://you-box.com";
  const url = new URL(override);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.protocol !== "http:") {
    throw new Error("BoxAI development server must be an HTTP loopback origin");
  }
  return url.origin;
}

export class BoxAIHTTPError extends Error {
  readonly status: number;
  constructor(status: number) { super(`BoxAI request failed (${status})`); this.status = status; }
}

/** Serializes rotating credentials and logout; secret storage belongs to host-core. */
export class BoxAISessionClient {
  private queue: Promise<unknown> = Promise.resolve();
  private login?: AbortController;
  private readonly listeners = new Set<() => void>();
  private readonly deps: BoxAISessionDependencies;
  constructor(deps: BoxAISessionDependencies) { this.deps = deps; }

  /** Main-process invalidation only: credentials never appear in events. */
  onSessionChanged(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private async persist(session: BoxAISession | undefined): Promise<void> {
    await this.deps.write(session);
    for (const listener of this.listeners) listener();
  }

  async request<T>(path: string, body?: unknown, bearer?: string, signal?: AbortSignal): Promise<T> {
    const response = await (this.deps.fetch ?? fetch)(`${this.deps.origin}${path}`, {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
      headers: { ...BOXAI_HEADERS, ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new BoxAIHTTPError(response.status);
    return response.status === 204 ? undefined as T : await response.json() as T;
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  cancel(): void { this.login?.abort(); }

  async authorize(): Promise<void> {
    if (this.login) throw new Error("BoxAI login is already in progress");
    const controller = new AbortController();
    this.login = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(600_000)]);
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    let redirect = "";
    const { promise: callback, resolve, reject } = Promise.withResolvers<string>();
    // Attach a rejection handler before the browser can fail to launch.
    void callback.catch(() => undefined);
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const supplied = Buffer.from(url.searchParams.get("state") ?? "");
      if (req.method !== "GET" || url.pathname !== "/auth/callback" ||
          supplied.length !== state.length || !timingSafeEqual(supplied, Buffer.from(state))) {
        res.writeHead(400).end("Invalid authorization callback");
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Return to BoxAI Desktop.");
      const code = url.searchParams.get("code");
      if (!code || url.searchParams.has("error")) reject(new Error("BoxAI authorization denied"));
      else resolve(code);
    });
    const abort = () => reject(new Error("BoxAI authorization cancelled or expired"));
    signal.addEventListener("abort", abort, { once: true });
    try {
      await new Promise<void>((resolveListen, rejectListen) => {
        server.once("error", rejectListen);
        server.listen(0, "127.0.0.1", resolveListen);
      });
      redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}/auth/callback`;
      const request = await this.request<{ id: string }>("/api/desktop/authorization-requests", {
        client_id: "boxai-desktop", client_name: "BoxAI Desktop", redirect_uri: redirect,
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256", state,
      }, undefined, signal);
      if (typeof request.id !== "string" || !request.id) throw new Error("Invalid BoxAI authorization response");
      await this.deps.openExternal(`${this.deps.origin}/desktop/authorize?request=${encodeURIComponent(request.id)}`);
      const code = await callback;
      signal.throwIfAborted();
      await this.serial(async () => {
        const tokens = await this.request<BoxAISession & { expires_in: number }>("/api/desktop/token", {
          grant_type: "authorization_code", client_id: "boxai-desktop", code,
          code_verifier: verifier, redirect_uri: redirect,
        }, undefined, signal);
        if (!tokens.access_token || !tokens.refresh_token || !tokens.api_key || !(tokens.expires_in > 0)) {
          throw new Error("Invalid BoxAI token response");
        }
        await this.persist({ access_token: tokens.access_token, refresh_token: tokens.refresh_token,
          api_key: tokens.api_key, expiresAt: Date.now() + tokens.expires_in * 1000 });
      });
    } finally {
      signal.removeEventListener("abort", abort);
      server.close();
      server.closeAllConnections();
      this.login = undefined;
    }
  }

  async session(): Promise<BoxAISession> {
    return this.serial(async () => {
      let session = await this.deps.read();
      if (!session) throw new Error("Sign in to BoxAI");
      try {
        if (session.expiresAt <= Date.now() + 60_000) {
          const tokens = await this.request<{ access_token: string; refresh_token: string; expires_in: number }>(
            "/api/desktop/refresh", { grant_type: "refresh_token", refresh_token: session.refresh_token });
          if (!tokens.access_token || !tokens.refresh_token || !(tokens.expires_in > 0)) throw new Error("Invalid BoxAI refresh response");
          session = { ...session, ...tokens, expiresAt: Date.now() + tokens.expires_in * 1000 };
          await this.persist(session);
        }
        await this.request("/api/desktop/session-status", undefined, session.access_token);
        return session;
      } catch (error) {
        if (error instanceof BoxAIHTTPError && (error.status === 401 || error.status === 403)) await this.persist(undefined);
        throw error;
      }
    });
  }

  async usage(): Promise<BoxAIUsage> {
    const session = await this.session();
    const response = await this.request<{ success: boolean; data: BoxAIUsage }>("/api/usage/account", undefined, session.api_key);
    if (!response.success) throw new Error("BoxAI account unavailable");
    return response.data;
  }

  async logout(): Promise<void> {
    this.cancel();
    return this.serial(async () => {
      const session = await this.deps.read();
      // Do not claim revocation succeeded while offline; retain credentials for retry.
      if (session) await this.request("/api/desktop/revoke", { refresh_token: session.refresh_token });
      await this.persist(undefined);
    });
  }
}
