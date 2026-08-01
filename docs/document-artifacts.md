# Document artifacts (playground)

Design record for the playground **document generation** subsystem: the user describes a document
in chat, the platform builds it, and the result is previewable, downloadable, and editable as
`.docx`, `.xlsx`, `.pptx`, or `.pdf`.

Related:

- Playground API inventory: `docs/playground-p1-p3.md`
- Cloudflare account and tokens: `docs/environment.md` § Cloudflare
- Deploy layout: `deploy/README.md`
- Existing tool-run state machine: `controller/playground_chat_tools.go`, `service/playground_tools.go`
- Existing asset pipeline: `service/playground_assets.go`, `service/playground_document_parse.go`

---

## 1. Scope

In scope:

- Model-authored documents produced from a chat request ("make me a Q3 Vietnam market report with charts").
- Preview, download, and persistence of the produced file as a playground asset.
- **Iteration on an existing artifact** ("rewrite section 3"), which is the expected steady state,
  not an edge case.
- Exporting an existing assistant message to a document, which is a degenerate case of the same path.

Out of scope for the first release:

- Collaborative editing of the produced document inside BoxAI.
- Server-side conversion between arbitrary formats (no LibreOffice, see § 2.3).
- Any document generation that requires network access from inside the build environment.

## 2. Execution environment

Builds run on **Cloudflare Sandbox SDK** (Containers), GA on Workers Paid since 2026-04-13.
Every sandbox runs in its own VM with filesystem, process, and network isolation.

PDF rendering runs on **Cloudflare Browser Run** (`/pdf` quick action), which is real Chromium.
This removes the entire font-embedding and pagination problem: Vietnamese diacritics and CJK
glyphs are handled by the browser, not by us.

### 2.1 Why not relay the providers' native code tools

Every major provider we relay now ships a server-side code execution tool, so "just pass the
model's own tool through" is a real option and was evaluated. State of the four as of 2026-08-01:

| Provider | Tool | Produces docx/xlsx/pptx | Container reuse | File retrieval |
|----------|------|-------------------------|-----------------|----------------|
| Anthropic | `code_execution` | Yes (python-docx, openpyxl, python-pptx, reportlab) | 30 days, 5-min checkpoint | Files API |
| OpenAI | `code_interpreter` (Responses) | Yes; memory tiers 1g/4g/16g/64g | 20 min idle, then unrecoverable | `container_file_citation` + container files API |
| Google | `code_execution` | **No.** Libraries are present but the docs state the model "can't return other artifacts like media files"; output is inline only, 30 s max runtime | Across turns | Inline images only |
| xAI | `code_execution` / `code_interpreter` | **No.** Docs state limited filesystem access and "stateless, doesn't persist between requests" | None | None |

Rejected as the primary path, for three reasons:

1. **Coverage.** Gemini and Grok cannot return a file at all, and neither is a marginal model in
   our pool. Relaying would still require building a sandbox for them, which means two systems.
2. **Divergent semantics.** Four different expiry clocks, four retrieval mechanisms, four billing
   units. Writing and maintaining four adapters plus four artifact-transfer paths is not cheaper
   than one sandbox, and it cannot produce consistent behaviour.
3. **Iteration is incompatible.** § 5.3 requires re-injecting the previous script and artifacts on
   every build. Under relaying those live in each provider's storage on each provider's clock, and
   the artifacts never enter our asset library, preview, version, or share surfaces.

Two things worth borrowing anyway: Gemini's library list is broader than Anthropic's and informed
§ 2.3, and OpenAI's willingness to hold a container idle for 20 minutes is a consequence of
per-session pricing — we are billed per GiB-second and cannot copy it (§ 2.5).

### 2.2 Why not run Pyodide in the user's browser

Considered and rejected. A browser WASM sandbox has zero marginal cost, but:

- The runtime download is 20-40 MB and resident memory is in the hundreds of MB. BoxAI is
  Vietnam-first; low-end Android on mobile data is the primary device profile, not the exception.
- Isolation would have to be built by us (cross-origin runner, opaque origin, CSP, stripped
  network globals). Same-origin Pyodide execution is a known RCE class — see open-webui
  `GHSA-4r2p-27mh-5m22`, where model-authored Python reached the app's own API with the user's
  session.
- Capability ceiling is lower: only pure-Python wheels plus whatever Pyodide ships, MEMFS instead
  of a real filesystem, and no real fonts.

### 2.3 Container image

Base `docker.io/cloudflare/sandbox:0.12.4-python`. The base image is not a free choice: the
Sandbox SDK runs a control process inside the container, so the image must extend Cloudflare's,
and its tag must stay pinned to the `@cloudflare/sandbox` version in `package.json`. The library
set on top is drawn from Anthropic's and Google's published code-execution containers, which are
the closest production references for "model writes code with no network":

| Layer | Contents |
|-------|----------|
| Documents | `python-docx`, `openpyxl`, `xlsxwriter`, `python-pptx`, `pypdf`, `pdfplumber`, `reportlab`, `fpdf2`, `img2pdf`, `Pillow`, `lxml` |
| Data / charts | `pandas`, `numpy`, `matplotlib`, `tabulate` |
| Text | `striprtf`, `markdown` |
| CLI | `unzip`, `7z`, `rg`, `sqlite3` |
| Fonts | Noto Sans, Noto Sans CJK (SC/TC/JP) |
| BoxAI content | Skill package (§ 5.2), build entrypoint |

Deliberately excluded: `pdfkit` (pulls wkhtmltopdf), `pdf2image` (pulls poppler), `tabula-py`
(pulls a JRE) — Browser Run covers PDF output and `pdfplumber` covers PDF reading.
**LibreOffice is excluded** for the same reason: hundreds of MB and seconds of cold start for a
capability we already have.

Image size measured at 625 MB with the Cloudflare base, the Python libraries, and the CJK fonts
stacked, far below the instance disk on every candidate instance type. Total image storage per
account is capped at 50 GB.

Two things the base image dictates, both verified rather than assumed: it ships **Python 3.11**,
so library versions must be resolved against 3.11 (several current PyPI releases require 3.12 and
will not install), and it exposes `pip3` but no `pip` on `PATH`, so the image installs through
`python3 -m pip`.

### 2.4 Instance types and cost

| Workload | Instance | vCPU / Memory | Typical wall time | Approx. cost |
|----------|----------|---------------|-------------------|--------------|
| Text document, simple sheet | `basic` | 1/4 / 1 GiB | 10-20 s | ~$0.0001 |
| Data analysis, charts, large decks | `standard-2` | 1 / 6 GiB | ~20 s | ~$0.0007 |
| PDF render | Browser Run | — | 2-4 s | ~$0.0001 |
| Warm hold between edits | (whichever is held) | — | 120 s idle | ~$0.002 |

`standard-2` matches the 1 CPU / 5 GiB that Anthropic provisions for the same class of work.

Workers Paid includes 25 GiB-hours of memory, 375 vCPU-minutes, and 10 browser-hours per month.
Note that the warm-hold line above is the **dominant cost in an iterative session** — holding a
container idle for two minutes costs several times more than the build itself. See § 2.5.

Container cold start is typically 1-3 s; images are pre-fetched across Cloudflare's network.
Billing rates verified 2026-04-21.

### 2.5 Sandbox lifecycle

Iteration is the normal case, so the sandbox is **scoped to a conversation**, not to a single
build and not to a user:

| Rule | Detail |
|------|--------|
| Sandbox key | `doc:{user_id}:{conversation_id}`. The user ID prevents a guessed conversation ID from landing in someone else's container. |
| Reuse | Consecutive builds in the same conversation reuse the warm container, so an edit skips the 1-3 s cold start entirely. |
| Warm hold | `sleepAfter` 120 s after a build completes. A second build inside that window extends it to 300 s, matching the checkpoint interval Anthropic uses. |
| Awake cap | Total awake time per conversation per hour is capped; past the cap, builds still work but always cold-start. |
| Serialization | One build at a time per sandbox, enforced by a conversation-level lock in Go. A concurrent second request queues or is rejected, never shares the filesystem mid-build. |
| Teardown | Explicit `destroy()` on cancel, on hard failure, and on conversation close. |

**Container disk is ephemeral and must never be treated as state.** A sleeping container's disk is
gone on next start. Reuse is a latency optimization only; correctness comes from § 5.3, where the
orchestrator re-injects the previous script and artifacts on every build. Leaking an awake sandbox
is the main cost risk in this design.

## 3. Security model

Cloudflare provides VM isolation, resource quotas, and container escape protection. Its docs are
explicit that authentication, input validation, and rate limiting are **our** responsibility.
Anthropic's published mitigations for the equivalent feature are the baseline we match.

| Threat | Mitigation |
|--------|------------|
| Model-authored code exfiltrates user data | **Container egress disabled**: `enableInternet = false` as a property on our `Sandbox` subclass, not a wrangler setting. Sandboxes allow outbound traffic by default, so this must be set explicitly, and it only takes effect at container start. `allowedHosts` must stay unset, since it overrides the flag. Inputs and outputs move through the SDK file API only. |
| Model-authored code reaches BoxAI's own API | The sandbox holds no BoxAI credential and cannot route to our origin. Only the edge Worker talks to R2, and only the Go backend talks to the Worker. |
| Users calling the build service directly | The Worker accepts requests only from the Go backend, authenticated with a service secret and a timestamped signature. The frontend never sees that secret. |
| Command injection through user text | Inputs are written with `writeFile` and referenced by fixed paths. No user or model string is interpolated into a shell command. |
| Prompt injection from an uploaded document | With egress disabled there is no exfiltration channel. The generated script is retained on the run record and surfaced to the user, so injected behaviour is auditable. |
| Runaway or looping build | Hard wall-clock timeout (120 s), then `destroy()`. |
| Resource abuse | Max 2 concurrent builds per user; artifact size capped at 20 MB; every build logged with user, duration, instance type, and outcome. |
| Cross-conversation data leakage | Sandbox key includes the owner; ownership is re-verified server-side on every build and every artifact read. |
| Hostile artifact filename | The name a script chooses becomes an R2 key and a `Content-Disposition` value, so it is untrusted. Traversal, absolute paths, backslashes, and the whole Unicode control and format range are rejected — the latter covers the bidi overrides used to disguise an executable extension as a document one. Names in the user's own language are **not** rejected: see § 10.8. |
| Public sharing of injected content | Document artifacts are served through owner-scoped signed URLs. Public share of a document artifact is off by default. |
| Secrets reaching the sandbox | No secrets are passed in. If an outbound call is ever needed, it goes through the Worker-proxy + short-lived JWT pattern, never a real credential in the container. |

Document generation is **free and unmetered** for the first release; the guardrails above exist to
prevent cost runaway, not to price the feature. Usage is logged from day one so metering can be
added later if the data justifies it.

## 4. Architecture

```
frontend
   │ 1. POST /api/playground/chat/runs                     run, action=generate_document
   │ 2. POST /api/playground/documents/runs/:id/prompt     authoring prompt + declared inputs
   │ 3. POST /pg/chat/completions                          the user's model writes build.py
   │ 4. POST /api/playground/documents/runs/:id/build      the script
   ▼
Go backend        rollout gate, concurrency slot, attempt cap, run state machine,
   │              input ownership, previous-state injection, telemetry
   │  service secret + HMAC signature
   ▼
CF Worker
   ├── conversation-scoped sandbox ──► model-authored Python ──► /workspace/out/*
   └── HTML ──► Browser Run /pdf ──► Chromium-rendered PDF
   │
   ▼
R2, written directly under the asset-library prefix the backend chose
   │
   ▼
Go records playground_assets rows ──► preview / download / iterate / share
```

**Step 3 is a client-side call on purpose.** Every model invocation in this codebase goes through
the relay endpoints, and the tool-run design says so explicitly: execution stays in relay so media
is billed exactly once. There is no helper for the backend to call a model on a user's behalf, and
adding one would mean reimplementing quota pre-consume and settlement outside the paths that
enforce the billing invariants. So the browser makes an ordinary billed chat call with the system
prompt the backend handed it, and posts back the script. The backend still owns everything that
must not be client-controlled: which files the sandbox may read, what the previous version was,
how many attempts are left, and the artifacts.

Artifacts are written straight into `uploads/{user_id}/{job_id}/` by the worker rather than to a
temporary prefix that the backend then copies. The backend picks the prefix and passes it with the
request, so a produced file is delivered by exactly the same owner-scoped code path as an uploaded
one, with no second trip through the app for a 20 MB file.

Reused components, so this feature adds no parallel infrastructure:

| Need | Existing component |
|------|--------------------|
| Run lifecycle, cancel, execution token | `PlaygroundChatToolRun` + a new `generate_document` action |
| Intent detection | `service.ClassifyPlaygroundTool` |
| Artifact storage, mime sniffing, owner-scoped streaming | `service/playground_assets.go` (already recognizes docx/xlsx/pptx/pdf, `kind=document`) |
| Feeding an artifact back to a model | `service/playground_document_parse.go` |
| Versions and share links | the `playground_canvas_project` version/share tables |
| Sandboxed preview surface | `components/ai-elements/html-preview-fence.tsx` |

## 5. Generation

### 5.1 Single path: the model writes code

There is no intermediate document schema. The model writes a Python program; the program writes
files to `/out`. This matches how both ChatGPT Code Interpreter and Claude file creation work, and
an earlier draft of this document was wrong to propose a structured `DocSpec` layer alongside it:
a schema constrains output to whatever we anticipated, and every real request eventually needs
something outside it.

Execution contract, stated to the model in the system prompt:

| Rule | Detail |
|------|--------|
| Inputs | Read-only, under `/workspace/in`. Uploaded assets and previous versions are written there by the orchestrator. |
| Outputs | Write files to `/workspace/out`. Every file there becomes an artifact. |
| Network | Unavailable. Any attempt fails. |
| Libraries | Only what the image ships (§ 2.3). No installation at runtime. |
| Fonts | Registered for matplotlib; CJK and Vietnamese text render correctly without extra setup. |
| Time | The program must finish well inside 120 s. |

**The script is authored by the model the user selected for the conversation**, not by a fixed
platform model. The feature therefore inherits the capability of whatever model is in use, and a
weak model will fail more often and lean on the self-heal loop (§ 5.4). This is deliberate:
silently routing to a different author model would bill the user for a model they did not choose
and would make document quality inconsistent with the rest of the conversation. The compensating
controls are the two-retry cap and per-model success-rate logging, so a model that fails
consistently can be excluded later on evidence rather than on assumption.

### 5.2 Quality comes from a skill package, not a schema

Output quality is the real risk in a free-form path, and the answer is a **skill package baked
into the image** at `/skills/{docx,xlsx,pptx,pdf}/`, each with a `SKILL.md` and helper scripts.
The system prompt points the model at the skill for the requested format before it writes
anything. This is the same mechanism Anthropic uses; they have open-sourced the four skills that
power Claude's document features, and the repository is 85% Python — the substance is helper
scripts and templates, not prose.

Each skill covers:

- House style: fonts, spacing, heading hierarchy, table and chart defaults, Vietnamese typography.
- Helper functions for the tedious parts (styled tables, chart embedding, page setup, number
  formats).
- A **verification step**: after writing the file, reopen it with `python-docx` / `openpyxl` /
  `pypdf` and assert the structure is what was intended. A build that cannot reopen its own
  output fails rather than shipping a corrupt file.

Anthropic's document skills are source-available, not open source. They are a **reference for
structure only** — our skill package is written from scratch and vendored under its own path.

This is unrelated to the existing `/api/playground/skill` endpoint (`controller.GetPlaygroundSkill`),
which serves the playground's own agent-facing documentation. Keep the two namespaces distinct.

### 5.3 Iteration

An edit request never regenerates from zero. The previous version is found **server-side**: the
backend looks up the last completed build in the same conversation, and passes its artifacts to
the worker, which writes them into `/workspace/in/previous/`. The client never says which document
to edit, so it cannot point a build at someone else's file or at an older version to hide a change.

The authoring prompt then names those files and tells the model to open the existing document,
apply only the requested change, and save under the same name. Everything the user did not
mention has to survive unchanged, which is far more reliable than re-authoring a whole document
from a diff description.

Because this injection happens on every build, iteration works identically whether the container
was reused or cold-started. § 2.5's warm hold only affects latency.

### 5.4 Self-heal loop

A failed build is a normal outcome, not an error. On a non-zero exit the `/build` response carries
`can_retry` plus a `retry_prompt` that already contains the failing script and the truncated
traceback; the client makes another billed chat call and posts the corrected script back. The warm
sandbox is reused.

The cap lives on the server and is counted from `playground_document_builds` rows, not from a
counter the client sends, so replaying the endpoint cannot extend the loop. Three attempts total
by default. After the last one the run is marked failed and the traceback is surfaced in a
collapsed panel.

## 6. Backend surface

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/playground/chat/runs` | Existing endpoint. Creates the run; `generate_document` falls back to `chat` for users outside the rollout. |
| POST | `/api/playground/documents/runs/:id/prompt` | Returns the authoring system prompt. Records which assets the build may read and which previous version it is editing. |
| POST | `/api/playground/documents/runs/:id/build` | Runs one script. Returns artifacts, or the retry prompt. |
| POST | `/api/playground/documents/sandbox/release` | Drops a conversation's warm container when the user leaves. |
| GET | `/api/playground/chat/runs/:id` | Existing endpoint; polls the run. |
| POST | `/api/playground/chat/runs/:id/cancel` | Existing endpoint. |

Edge Worker (not publicly routable, service-secret only):

```
POST /v1/build
{
  "job_id":            "...",
  "sandbox_key":       "doc:{user_id}:{conversation_id}",
  "code":              "...",
  "artifact_prefix":   "uploads/{user_id}/{job_id}",
  "inputs":            [{ "path": "data.xlsx",  "r2_key": "..." }],
  "previous":          [{ "path": "report.docx", "r2_key": "..." }],
  "instance":          "basic" | "standard-2",
  "sleep_after_sec":   120,
  "timeout_ms":        120000,
  "max_artifact_bytes": 20971520
}
→ { "status", "artifacts": [{ "name", "r2_key", "bytes", "mime", "verified" }],
    "logs": { "stdout", "stderr" }, "error", "exit_code", "duration_ms" }

POST /v1/destroy  { "sandbox_key", "instance" }
```

Signed with `X-BoxAI-Timestamp` and `X-BoxAI-Signature`, an HMAC-SHA256 of `{timestamp}.{body}`,
valid for 60 seconds.

Because artifacts are written under the prefix the backend supplies, importing them is just a
`playground_assets` row — there is no copy step and no temporary-prefix lifecycle rule to
maintain. The generated script is stored on `playground_document_builds` so § 5.3 can replay it.

## 7. Frontend surface

- Build progress card in the message stream, reusing the managed-tool card layout: queued →
  building → rendering → done, with cancel.
- Preview reuses the **server-side document parser that already backs uploads**
  (`playground_document_parse`), which reads docx, xlsx, pptx and PDF. Documents preview as
  extracted text; images preview directly.

  The alternative — rendering the real file in a frame — was rejected because the asset content
  endpoint deliberately serves every `kind=document` asset as `Content-Disposition: attachment`
  so a generated file can never execute on our own origin. Weakening that to get a prettier
  preview would trade a real security property for a cosmetic one. Downloading gives the real
  file.
- Actions: download, save to asset library, regenerate, and a follow-up prompt affordance for
  edits that carries `parent_run_id`.
- The generated script is viewable in a collapsed panel, both for trust and for debugging.
- No WASM, no OOXML, and no font bundles ship to the browser.
- All new copy goes through `t()` with keys added to every locale under
  `web/default/src/i18n/locales/`.

## 8. Deployment

The build service is a **separate wrangler-deployed Worker plus container image**, versioned in
this repo alongside `workers/desktop-broker/` but deployed on its own pipeline. It does not touch
the Go binary, systemd unit, or nginx configuration.

This does not conflict with the rule that the BoxAI application is never deployed as a Docker
image: that rule is about the Go application itself. The container image here is an edge
execution environment for untrusted code and contains no BoxAI application code.

Cloudflare resources all live in the 小 QQ account (see `docs/environment.md`): Workers Paid,
Containers, Browser Run, and the existing R2 bucket. Both `workers_paid` and `r2_paid`
entitlements are confirmed active.

## 9. Phases

| Phase | Contents | Estimate |
|-------|----------|----------|
| 1 | Edge foundation: Worker, image, conversation-scoped sandbox orchestration, egress lockdown, service auth, R2 output | ~1 week |
| 2 | Go integration: `documents/runs`, run state machine, conversation lock, asset import, usage logging, guardrails | 4 days |
| 3 | Skill package, self-heal loop, previous-state injection, HTML → Browser Run PDF | ~1 week |
| 4 | Frontend: intent → progress card → previews → download / save / edit | ~1 week |
| 5 | Version history and share links | 4 days |

Phases 1-2 give an end-to-end docx. Phase 4 is the first shippable user experience.

## 10. Measured behaviour and open items

**Rollout state:** generally available since 2026-08-01. `document_builder.enabled = true` with
`enabled_groups = []`, which means every group. Rollback is a single option flip of
`document_builder.enabled`.

Per-model build outcomes are queryable directly, which is the evidence base for open item 6:

```sql
select chat_model, status, count(*) n, round(avg(duration_ms)) avg_ms
from playground_document_builds group by 1, 2 order by 1, 2;
```

Measured against production (`doc-builder.you-box.com`) on 2026-08-01, admin account, `default`
group:

| Case | Result |
|------|--------|
| docx, cold container | 10.4 s |
| docx, warm container, reopening the previous version | 6.1 s |
| xlsx with an embedded bar chart | 10.3 s |
| pptx | 7.7 s |
| PDF via reportlab with `STSong-Light` | 8.4 s |
| PDF via Browser Run (Chromium) | 7.2 s, 230 KB with embedded fonts |
| matplotlib PNG with CJK labels | 10.7 s |
| Script raises → build failure, `can_retry: true` | 8.8 s |
| Full turn including the model authoring the script | 18-46 s, first attempt succeeded for both `gemini-3.6-flash` and `deepseek-v4-flash` across docx, xlsx and PDF |

Open items:

1. Measure real cold start and end-to-end latency from Vietnam; container placement will likely be
   Singapore or Hong Kong.
2. Tune the warm-hold window against real session data — 120 s is a guess, and it dominates cost.
3. Confirm Browser Run REST throughput headroom (10 req/s on Workers Paid as of 2026-03).
4. Define the R2 lifecycle rule for the temporary build prefix.
5. Decide whether the generated script is stored on the run record or promoted to a hidden asset
   once version history lands.
6. Per-model build success rate needs to be in the usage log from day one — it is the evidence
   base for any future decision to restrict which models can author build scripts (§ 5.1).
7. Revisit metering once usage data exists.
8. **Anything a build script controls must fail as a build failure, never as a transport error.**
   The first production run found this the hard way: the artifact-name check was ASCII-only, so a
   Chinese request that produced `2026-Q1-运营报告.docx` was rejected — and rejected as an HTTP
   400, which the backend reads as "the service is unavailable". A perfectly good document became
   a dead turn that self-heal never saw. The name rule now allows any language and the file-count
   and size caps return through the same retryable channel. When adding a new artifact-level
   check, put it on that channel.
