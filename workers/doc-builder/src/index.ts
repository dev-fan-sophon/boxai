// BoxAI document builder — doc-builder.you-box.com.
//
// Runs model-authored Python in a Cloudflare sandbox with egress disabled and streams whatever it
// wrote to /workspace/out into R2. The Go backend is the only caller; see
// docs/document-artifacts.md for the architecture and threat model.
import { handleBuild, handleDestroy } from "./build";
import type { Env } from "./env";
import { HttpError, json } from "./http";

export { DocSandboxBasic, DocSandboxStandard } from "./sandbox";

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  if (method === "GET" && (path === "/" || path === "/health")) {
    return json({ ok: true, service: "boxai-doc-builder" });
  }
  if (method === "POST" && path === "/v1/build") return handleBuild(request, env);
  if (method === "POST" && path === "/v1/destroy") return handleDestroy(request, env);

  return json({ error: "not found" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error("unhandled builder error", err);
      return json({ error: "internal error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
