# boxai-doc-builder

Runs model-authored Python in a Cloudflare sandbox with egress disabled and streams the files it
produced into R2. The Go backend is the only caller.

Design, threat model, and rollout plan: [`docs/document-artifacts.md`](../../docs/document-artifacts.md).

## Layout

| Path | Purpose |
|------|---------|
| `src/index.ts` | Routing and error mapping |
| `src/auth.ts` | HMAC request signature shared with the Go backend |
| `src/build.ts` | Workspace reset, input injection, execution, artifact export |
| `src/sandbox.ts` | `Sandbox` subclasses that disable egress, one per instance type |
| `container/run_build.py` | In-container entrypoint; runs the build script and verifies its output |
| `container/requirements.txt` | Pinned Python libraries |

Per-format authoring guidance is **not** here. The model writes the whole script in one shot with
no filesystem access, so it only helps in the prompt: see `service/document_skills/` in the Go
tree, embedded into the binary.

## Develop

Docker must be running: the Sandbox SDK builds the container image alongside the Worker.

```bash
npm install
npm run dev              # http://127.0.0.1:8787
npm run test             # auth and validation, no container needed
npm run test:integration # real builds, needs `npm run dev` in another terminal
```

`npm run test` deliberately stops at the container boundary. The two assertions that matter most —
that a build produces a file which reopens cleanly, and that the sandbox cannot reach the public
internet — only mean something against a real container, so they live in
`scripts/integration.mjs`.

## Deploy

```bash
npx wrangler secret put SERVICE_SECRET   # must match the Go backend setting
npx wrangler deploy
npx wrangler containers list
```

Deployment is manual, matching `workers/desktop-broker`. The Go application deploy pipeline is
untouched by this Worker.

## Contract

```
POST /v1/build
{
  "job_id":            "run-123",
  "sandbox_key":       "doc:{user_id}:{conversation_id}",
  "code":              "…python…",
  "instance":          "basic" | "standard-2",
  "sleep_after_sec":   120,
  "timeout_ms":        120000,
  "max_artifact_bytes": 20971520,
  "inputs":            [{ "path": "data.xlsx",         "r2_key": "…" }],
  "previous":          [{ "path": "build.py",          "r2_key": "…" }]
}
→ { "status": "completed" | "failed", "artifacts": [...], "logs": {...}, "error", "exit_code", "duration_ms" }

POST /v1/destroy   { "sandbox_key": "…", "instance": "…" }
```

Every request carries `x-boxai-timestamp` and `x-boxai-signature`, an HMAC-SHA256 of
`{timestamp}.{body}` under `SERVICE_SECRET`, valid for 60 seconds.

Build failures come back as HTTP 200 with `status: "failed"` so the orchestrator can tell a broken
build script apart from a broken transport. Only auth, validation, and infrastructure problems use
non-2xx.

## Two things that are easy to break

- **`enableInternet = false` lives on the `Sandbox` subclass**, not in `wrangler.toml`, and setting
  `allowedHosts` anywhere overrides it. The integration suite asserts this; do not skip it.
- **The image tag must match the `@cloudflare/sandbox` version** in `package.json`. A mismatch
  fails at runtime, not at build time.
