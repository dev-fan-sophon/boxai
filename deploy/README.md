# BoxAI deployment

Canonical production and local ops for this repository.

**Product market:** Vietnam primary; other overseas markets secondary (see root `AGENTS.md` / `README.md`).

## Architecture

| Component | Production | Local default |
|-----------|------------|---------------|
| **App** (Go API + SEO shell) | Host binary + **systemd** `boxai.service` → `127.0.0.1:3000` | Optional `make start-api` (`go run`) |
| **Web SPA** (disk, preferred) | `/opt/boxai/web` → `web-releases/<id>` (atomic symlink); `WEB_DIST_DIR` in unit | embed fallback / `make dev-web` |
| **Chat service** (Bun/TypeScript, `chat-service/`) | **systemd** `boxai-chat.service` → `127.0.0.1:3100` | `cd chat-service && bun run dev` |
| **Postgres** | OVH managed PostgreSQL 18 over private network + verified TLS | Optional `docker-compose.dev.yml` |
| **Redis** | Docker `boxai-redis` → `127.0.0.1:6379` | Optional `docker-compose.dev.yml` |
| **TLS** | nginx → `http://127.0.0.1:3000`; `/chat-api/*` → `http://127.0.0.1:3100` (`deploy/nginx/chat-api.conf.example`) | n/a |

### OVH production destination and data services

The production destination is checked in as `deploy/production.env`, with the
public SSH host key in `deploy/production_known_hosts`. Both deploy scripts load
this after local configuration, so old GitHub host secrets cannot send a release
to the retired origin. The private deployment key remains in Secrets. For manual
administration, export this file before running `scripts/boxai-server`:

```bash
set -a; source deploy/production.env; set +a
```

The target is the `boxai` Public Cloud project, SGP1, one `b3-16` instance
(4 vCPU, 16 GiB, 100 GB), with local Redis and an independent managed PostgreSQL
Discovery service. This is **not** an HA application deployment.

Set `BOXAI_POSTGRES_MODE=external` in `/opt/boxai/.env`. Releases run
`scripts/server/start-infra.sh`, which starts **only Redis** in external mode and
refuses a localhost PostgreSQL DSN. Without this setting it preserves the local
PostgreSQL + Redis deployment. Do not run an unqualified `docker compose up` on
the OVH host: the compose file still contains the optional local PostgreSQL.

Gateway `SQL_DSN` uses `sslmode=verify-full` and
`sslrootcert=/opt/boxai/ovh-postgres-ca.pem`. Chat uses the same database with
`sslmode=verify-full` and `NODE_EXTRA_CA_CERTS` pointing to that CA. The application
user owns its database, not the entire managed service. Access is restricted to
the application's private IP. Database deletion protection is enabled.

AlmaLinux keeps SELinux enforcing. Bun's executable at `/root/.bun/bin/bun` needs
a persistent `bin_t` file-context rule and `restorecon`; nginx needs
`httpd_can_network_connect`. Public ingress is restricted by firewalld to SSH,
HTTP and HTTPS. Redis and PostgreSQL are not publicly exposed.

### Backups and external monitoring

`scripts/server/health-backup.py` runs from `/opt/boxai/ops/` in an isolated
Python environment with boto3. Root-only `backup.env` contains S3 credentials
scoped to **only `boxai-backup`**; `postgres-client.env` holds the application
database connection. Never commit either file.

- `boxai-backup.timer`: daily PostgreSQL custom-format dump, R2 upload and full
  download SHA-256 verification, plus a private runtime configuration/TLS archive.
  Local backups retain seven days. R2 lifecycle expires **only `ovh/postgres/`
  and `ovh/config/`** after 30 days; other prefixes are untouched.
- `boxai-health.timer`: every two minutes, publish a private heartbeat with
  service, PostgreSQL, Redis, free disk, available memory, load and backup-age
  checks. Backup freshness requires a verified success within 26 hours.
- `boxai-certbot.timer`: twice-daily renewal checks using the existing webroot
  configuration; reload nginx only after a certificate is renewed.
- `workers/health-monitor`: runs outside OVH on the canonical Cloudflare account.
  Every two minutes it checks public gateway/Chat health and the host heartbeat.
  Two failed checks trigger email, with hourly reminders and recovery notices.
  `ALERT_FROM`, `ALERT_TO` and `CHECK_TOKEN` are Worker secrets. Email delivery
  requires available Cloudflare Email Sending quota. Workers errors must not be
  interpreted as successful notification delivery.

Restore drills download an R2 object into a separate disposable database and
verify the restored data. `scripts/server/database-manifest.sql` compares counts,
order-independent row hashes and sequence values while writers are stopped.
A successful upload or VM snapshot alone is not a
database recovery test. During cutover, stop old writers and drain requests
before the final dump; compare table counts and billing totals before starting
the new master. After the new origin accepts writes, DNS-only rollback to the
old database is unsafe: keep the old host proxying to the new origin, or stop
writes and migrate the latest data back before reverting.

### Migration state on 2026-09-29

The OVH origin `15.235.200.162` is serving production with `NODE_TYPE=master`.
Final PostgreSQL table hashes/counts and sequences matched the stopped source
after canonicalizing timestamps to UTC. Redis and local-file SHA-256 manifests
also matched. Login, Chat sessions, R2 upload/finalize/delete, Kimi non-streaming
and streaming requests, and post-cutover backup read-back checks passed.
Health, backup and certificate-check timers are enabled. The external monitor
accepted both a simulated alert and recovery email and runs every two minutes.

**DNS cutover is pending:** the current Cloudflare token can read but cannot
edit the five production A records. They still point to `160.187.1.155`, whose
nginx forwards HTTPS traffic to the verified OVH origin. The old application,
Chat service and Redis are stopped with automatic startup disabled; its old
database is retained and must not receive new application writes. Keep this
forwarder running until DNS has moved and caches have expired. After obtaining
Zone/DNS/Edit permission for `you-box.com`, change the five A records while
preserving proxy flags and verify certificate renewal with `certbot renew
--dry-run` on OVH. Renewal has not yet been validated against the new origin.

### Frontend vs API release (same origin)

| Layer | Path / process | How to publish | Restarts API? |
|-------|----------------|----------------|---------------|
| API / billing / OAuth / SEO injection | `bin/new-api` + `boxai.service` | `make deploy` | **yes** |
| SPA (`index.html` + hashed `/static/*`) | `/opt/boxai/web` symlink | `make deploy-web` | **no** |
| Hash assets on CDN (later) | still `you-box.com/static/...` URLs | sync only | no |

- Go **prefers disk** when `WEB_DIST_DIR` points at a dir/symlink containing `index.html`; otherwise serves the **embedded** build from the binary.
- `deploy-web` builds locally, uploads to `web-releases/<id>`, then `mv`-replaces the `web` symlink. The running process re-reads the symlink per request — no restart.
- Full `make deploy` still builds web + Go and also publishes the disk SPA so API and UI stay aligned on mixed releases.
- **Pre-prod browser E2E / staging environment:** not set up yet for the main web app (see below). Desktop GUI has Playwright e2e only.

**boxai-chat** owns the playground agent loop (`/chat-api/v1/chat`) and the
migrated playground product routes. It runs from the release checkout
(`/opt/boxai/current/chat-service`) with dependencies installed by
`scripts/server/build-native.sh`, and reads `/opt/boxai/chat.env`
(gateway shares `INTERNAL_SERVICE_SECRET` in `/opt/boxai/.env`; see
`docs/environment.md` § boxai-chat). Production deploys fail closed when
`/opt/boxai/chat.env` is absent or the service/database readiness check fails.
Liveness: `curl -fsS http://127.0.0.1:3100/healthz`. Readiness (including the
shared Postgres connection): `curl -fsS http://127.0.0.1:3100/readyz`.
The transferred data layer requires the production gateway to use PostgreSQL.

**There is no application Docker container in steady state.**  
Root `Dockerfile` / `Dockerfile.dev` / empty `docker-compose.yml` are **deprecated** for BoxAI ops.

## Canonical names

Use **boxai** everywhere. Do not introduce `boxai2` for new work.

| Thing | Name |
|-------|------|
| GitHub repo | `dev-fan-sophon/boxai` |
| Product | BoxAI |
| Host app root | `/opt/boxai` |
| systemd unit | `boxai.service` |
| Infra containers | `boxai-postgres`, `boxai-redis` |
| Docker network | `boxai-network` |
| SSH deploy user (preferred) | `boxai-deploy` |
| Env / secrets prefix | `BOXAI_*` |

`scripts/deploy-prod.sh` may still clean leftover historical `boxai2*` container/image names once; that is not a supported target.

## Production deploy

### Prerequisites (local)

- Git pushed to the remote the release is cut from
- `.env.boxai-admin` with `BOXAI_SSH_*` and optional `BOXAI_BASE_URL`

### Everyday

**Preferred (API + web):** merge/push to `main` → GitHub Actions workflow **Deploy production**  
(`.github/workflows/deploy-prod.yml`) SSHes to the host and runs `scripts/deploy-prod.sh`.

Manual / emergency from a trusted machine:

```bash
git push origin main
make deploy
# equivalent:
./scripts/deploy-prod.sh
./scripts/deploy-prod.sh --ref <commit>
```

**Frontend-only** (UI copy, layout, i18n — no Go change):

```bash
make deploy-web
# equivalent:
./scripts/deploy-web.sh
./scripts/deploy-web.sh --skip-build   # reuse local web/default/dist
```

Requires production unit already shipping `WEB_DIST_DIR=/opt/boxai/web` (current `deploy/boxai.service`). After the first full deploy with that unit, pure UI work does not need `systemctl restart boxai`.

### GitHub Actions secrets

Repository secrets used by **Deploy production** (Settings → Secrets and variables → Actions):

| Secret | Purpose |
|--------|---------|
| `BOXAI_SSH_HOST` | Production host/IP |
| `BOXAI_SSH_USER` | SSH user (prefer `boxai-deploy`) |
| `BOXAI_SSH_PORT` | SSH port (optional; default `22` if empty) |
| `BOXAI_SSH_PRIVATE_KEY` | OpenSSH private key (PEM/`BEGIN OPENSSH` text) |
| `BOXAI_SSH_HOST_KEY` | Single `known_hosts` line for the host |
| `BOXAI_BASE_URL` | Public origin, e.g. `https://you-box.com` |

Also create a GitHub **Environment** named `production` (workflow references it). Optional protection rules / required reviewers can be added there.

Manual workflow dispatch supports an optional ref and first-time `--bootstrap`.

### First-time host only

```bash
make deploy-bootstrap
# installs Go/Bun, infra compose, systemd unit, rewrites DSN hosts to 127.0.0.1
```

### Server layout

```text
/opt/boxai/
  .env                         # mode 600; SQL_DSN/REDIS → 127.0.0.1
  bin/new-api                  # active binary
  current → releases/<id>
  releases/<id>/               # source + build tree (full deploy)
  web → web-releases/<id>      # live SPA (WEB_DIST_DIR); atomic symlink
  web-releases/<id>/           # SPA-only releases (deploy-web + full deploy)
  docker-compose.infra.yml     # Postgres + Redis only
  data/  logs/
  postgres_data/  redis_data/
```

### Pre-prod testing / cutover (current state)

| Mechanism | Status |
|-----------|--------|
| Unit / contract tests (Go `go test`, web vitest where present) | yes, local / ad hoc |
| PR template / anti-slop check | yes (`.github/workflows/pr-check.yml`) — **not** a product test suite |
| Main web app Playwright / Cypress E2E | **no** |
| Staging / preview environment (`staging.you-box.com`) | **no** |
| Production cutover (API) | single host; build `new-api.next` → chat `readyz` gate → `mv` + `systemctl restart`; keep previous `releases/` |
| Production cutover (web) | atomic symlink `/opt/boxai/web` → `web-releases/<id>` (no API restart) |
| Desktop GUI e2e | yes (`desktop/surfaces/gui` Playwright) — separate product |

There is **no** automated “run E2E then promote to prod” gate today. Cutover is: build on host → health checks (`/api/status`, chat `readyz`) → restart. For UI-only, cutover is symlink flip + public HTTP smoke in `deploy-web.sh`.

### Async media rollout and capacity

The media lifecycle release adds task polling/output columns and asset upload
state/expiry columns through AutoMigrate. Back up the database and approve the
production migration before deploying. Publish the API before the matching web
build: new clients require `POST /api/playground/assets/:id/finalize`. Rolling
back the binary does not require dropping the additive columns; do not drop them.

- Polling has 16 process-wide slots, at most 4 per channel, a 30-second request
  deadline and a 45-second pass budget. Persisted due times prevent oldest-row
  starvation; query errors back off up to 5 minutes. Existing system-task DB
  leases choose one scheduler across instances; this is not a sharded queue.
- A modern task's local age is not proof of upstream failure. It remains pending
  until authenticated polling confirms a terminal state. Investigate tasks older
  than `TASK_TIMEOUT_MINUTES` rather than assuming a refund occurred. Unverified callbacks
  only request polling; they cannot update results or settle billing.
- Automatic generated-video archiving is disabled. No new `video_output` jobs
  are scheduled; queued jobs from older releases drain without downloading.
  Seedance responses return upstream result URLs immediately. The owner-scoped
  `/v1/videos/:id/content` endpoint remains an on-demand streaming proxy, and
  previously archived outputs remain readable. Upstream URL expiry now determines
  new output availability; a BoxAI proxy URL does not extend the upstream lifetime.
- Reference-video uploads allow 200 MiB; image/audio/document limits are
  unchanged. Use signed R2 PUT for large files rather than relying on CDN
  multipart-body limits. Multipart video storage streams instead of buffering
  the whole file; parsing spills above 8 MiB and caps the body at 201 MiB.
- The web uploader requests `create_only: true` and sends the returned
  `put_headers` (`If-None-Match: *`). R2 rejects overwrites, so the object stays
  at its original `uploads/direct/` key. Finalize only checks HEAD and up to
  512 header bytes, then returns a 24-hour `fetch_url`; no copy or full transfer.
  R2 CORS must allow PUT and these headers from the application's allowed origins.
  Older clients without `create_only` retain the legacy snapshot fallback.
  Reference URLs sent upstream are direct 24-hour signed R2 GET URLs.
  `upload_cleanup` removes expired pending uploads only, after a one-hour grace.
  Ready references keep existing library/chat deletion semantics: URL expiry is
  not a file-retention policy and must not silently delete saved user assets.
- Configure an R2 lifecycle expiry **only on `upload-intents/`**, e.g. one day,
  after infrastructure approval. Signed PUT replay can recreate staging objects
  after finalization. Never apply this rule to `uploads/` or `outputs/`.
- All app instances need the same explicitly configured `CRYPTO_SECRET` (or
  `SESSION_SECRET`), database and R2 bucket. Local legacy references retain
  15-minute app fetch capabilities and need shared storage.
- SQL pools default to 20 open / 5 idle connections per pool per process.
  `SQL_MAX_OPEN_CONNS` / `SQL_MAX_IDLE_CONNS` override these. Budget the sum across
  API replicas, a separate log pool when used, chat, migrations and operators
  below the database connection limit.

Acceptance must include real R2 PUT → finalize → provider reference fetch,
browser CORS/write-once behavior, completed upstream URL responses, existing
archived downloads, and restart recovery. Watch oldest due poll, SQL connection
waits, RSS and proxy bandwidth. Archiving new generated content is intentionally
deferred; do not reactivate it without capacity and retention planning. No public
cloud traffic allowance or production capacity number is implied by these bounds.

### Ops

```bash
systemctl status boxai
journalctl -u boxai -f
curl -fsS http://127.0.0.1:3000/api/status
cd /opt/boxai && docker compose -f docker-compose.infra.yml ps
```

### Dedicated Codex Proxy cutover record (2026-08-27)

The production Codex route was validated and cut over on release
`5f0ce85a6cdc6b6e962498c81c203b0596a4202b`:

| Channel | Type | State | Priority / weight | Purpose |
|---------|------|-------|-------------------|---------|
| `22` — `codex-proxy-dedicated` | `61` (`Codex Proxy`) | enabled | `100 / 0` | Active production owner |
| `20` — `codex-proxy-bwg` | `1` (legacy OpenAI-compatible) | disabled | `0 / 0` | Reversible rollback only; do not delete |

Channel `22` publishes these priced models:

| Models | Public capability | Model / completion ratio |
|--------|-------------------|--------------------------|
| `gpt-5.6-sol` | Chat, Responses, Anthropic Messages, Gemini native | `0.31 / 8.048387096774` |
| `gpt-5.6-terra` | Chat, Responses, Anthropic Messages, Gemini native | `0.155 / 8.064516129032` |
| `gpt-5.6-luna` | Chat, Responses, Anthropic Messages, Gemini native; Responses web search verified | `0.01 / 10` |
| `gpt-5.5` | Chat, Responses, Anthropic Messages, Gemini native | `0.75 / 6` |
| `gpt-5.4` | Chat, Responses, Anthropic Messages, Gemini native | `0.9 / 6` |
| `gpt-5.4-mini` | Chat, Responses, Anthropic Messages, Gemini native | `0.375 / 6` |
| `gpt-5.3-codex-spark` | Chat, Responses, Anthropic Messages, Gemini native | `0.875 / 8` |
| `gpt-image-2` | Image generation and multipart image edit only | `1 / 3.745` |

The cutover deliberately does **not** publish `codex-auto-review` (opaque
selector without a price), `gpt-5.6-sol-wm` or `gpt-reserve` (no BoxAI pricing
and support contract), or embeddings (none discovered upstream). The retired
`/responses/compact` route is not projected into aliases. Audio, video, and
Realtime are not Codex Proxy capabilities.

Cutover evidence:

- Direct-channel and public-key checks passed for Chat JSON/SSE, Responses
  JSON/SSE (including string input with omitted `stream`), Anthropic JSON/SSE,
  Gemini JSON/SSE, Luna web search, and all seven text models through both Chat
  and SDK-shaped Responses.
- Image generation and multipart edit returned raster images and upstream tool
  usage. Usage logs `8334` and `8335` record channel `22`, non-zero quota, and
  the `openai_image` → `OpenAI Responses` conversion for generation and edit.
- After disabling channel `20`, final public Chat and Responses checks produced
  logs `8339` and `8340` on channel `22` with upstream usage and non-zero quota.
  The last channel `20` log is `8307` at `2026-08-27T13:16:49Z`, before cutover.
- `/v1/models` reports the four text endpoint types on each text model and only
  image generation on `gpt-image-2`. Live BoxAI Connect provisioning reports
  the seven chat models plus `gpt-image-2` as image-only; the Connector v2
  projection is covered by its provisioning contract tests.
- The post-disable ability rebuild completed with `15` successes and `0`
  failures.

Rollback only when a critical request fails after cutover. Re-enable the known
working legacy channel first, then disable the dedicated channel so there is no
gap in availability:

```bash
.agents/skills/managing-boxai-platform/scripts/boxai-api \
  POST /api/channel/20/status '{"status":1}'
.agents/skills/managing-boxai-platform/scripts/boxai-api \
  POST /api/channel/22/status '{"status":2}'
```

Read both channels back and run public Chat and non-streaming Responses smoke
tests after rollback. Do not delete either channel or copy channel credentials
into this repository.

### ElevenLabs type-62 cutover record (2026-08-27)

ElevenLabs support was implemented in `757aa6a74`, projected into the web and
Connector catalogs in `7a7c06d3a`, and given authoritative endpoint metadata in
`00907b893` and `102741d1c`. Production runs release `102741d1cc8c`.

Channel `30` (`elevenlabs`, type `62`) is enabled in `default` with priority and
weight `0 / 0`, base URL `https://api.elevenlabs.io`, and tag
`catalog:shared:elevenlabs`. Its credential remains production-only. The public
catalog contains exactly these models and capabilities:

| Model | Model ratio | Endpoint type |
|-------|------------:|---------------|
| `eleven_v3` | `50` | `audio-tts` |
| `scribe_v2` | `1.833333` | `audio-stt` |
| `eleven_multilingual_sts_v2` | `37.5` | `audio-speech-to-speech` |
| `eleven_text_to_sound_v2` | `25` | `audio-sfx` |
| `music_v2` | `50` | `audio-music` |
| `elevenlabs-audio-isolation` | `40` | `audio-isolation` |
| `elevenlabs-forced-alignment` | `1.833333` | `audio-alignment` |

Pricing was written through the supported Pricing Center API, never through
SQL: read `GET /api/admin/pricing/models`, then send the returned optimistic
`revision` to `POST /api/admin/pricing/models/bulk` with
`{"revision":<revision>,"models":[{"model_name":"...","pricing":{"mode":"per-token","model_ratio":<ratio>}}]}`.
The accepted write advanced production pricing revision from `69` to `70`; a
read-back and public `/api/pricing` both match the table above.

Direct-channel validation temporarily moved only channel `30` to the isolated
`elevenlabs-canary` group. All twelve checks returned HTTP 200: native model and
voice discovery, OpenAI speech and transcription, native TTS timestamps and raw
streaming, native STT, speech-to-speech streaming, sound effects, music
streaming, audio isolation streaming, and forced alignment. Usage logs
`8570`–`8579` all identify channel `30` and contain non-zero quota. They cover
character billing and response-header correction, audio-duration units, and
music-duration units; the corrected speech-to-speech ratio produced quota
`10013` for `267` audio units. Public `/api/pricing` and `/v1/models` expose one
fine-grained audio endpoint per model and never classify these models as Chat.
Connector provisioning excludes all seven from chat-capable projections.

To stop ElevenLabs traffic without affecting another provider, disable only
channel `30`, read it back, and confirm the seven models leave public routing:

```bash
.agents/skills/managing-boxai-platform/scripts/boxai-api \
  POST /api/channel/30/status '{"status":2}'
```

Do not delete the channel or its pricing. A code rollback can repoint
`/opt/boxai/current` to the retained release `00907b893e1d`; disable channel
`30` before rolling back because that release predates the embedding-only
catalog correction.

### Shared gateway catalog reconciliation (2026-08-27)

The post-cutover shared catalog contains `53` public BoxAI models. The catalog
coordinator's bilateral `gateway-catalog verify --json` returned `[]`: Origin
exposes the same shared set and additionally keeps `10` Origin-only Meshy
models. Meshy is not a BoxAI channel or rollback target.

Current channel ownership is:

| Channel | State | Priority / weight | Catalog role |
|---------|-------|-------------------|--------------|
| `1` — `wisech` | enabled | `0 / 0` | `deepseek-v4-flash`, `deepseek-v4-pro`, `glm-5.2`, `kimi-k2.6`, `kimi-k2.7-code` |
| `16` — `kimi-modal-doufunao80` | enabled | `10 / 0` | Healthy `kimi-k3` route |
| `17` — `kimi-modal-zhangfan0220` | **deleted** | n/a | Removed after repeated upstream `429 usage limit reached` |
| `18` — `kimi-modal-xiaomao2026` | enabled | `10 / 0` | Healthy `kimi-k3` route |
| `24` — `gemini-embedding` | **deleted** | n/a | Removed Gemini embedding route; not a rollback channel |
| `26` — `fireworks` | enabled | `0 / 100` | Shared text fallback for `glm-5.2`, `glm-5.2-fast`, `kimi-k3`, `kimi-k3-fast`, `kimi-k2.7-code`, `MiniMax-M3`, `deepseek-v4-pro`, `deepseek-v4-flash`, `gpt-oss-120b`, `qwen3.8-max`, and `inkling` |
| `29` — `4router-backup` | enabled | `-10 / 0` | Low-priority backup for the eight shared Claude models |
| `30` — `elevenlabs` | enabled | `0 / 0` | Seven audio models documented in the preceding section |
| `31` — `opencode2api` | enabled | `10 / 100` | Shared text route for `glm-5.3`, `glm-5.3-flash`, `glm-5.2`, `kimi-k3`, `kimi-k2.7-code`, `MiniMax-M3`, and `qwen3.8-max` |

Wisech no longer advertises `wan2.7-image` or `wan2.7-image-pro`. BoxAI,
Origin, and direct Wisech JSON/SSE checks returned HTTP 200 with usage but no
content, image, or stream delta, so these empty-success models must not be
restored merely because the transport succeeds. The final exact-model
reconciliation also removed `deepseek-v4-flash-0731`; all three are absent from
public `/api/pricing`.

The deletion records are management logs `8509` (`gemini-embedding`, channel
`24`) and `8682` (`kimi-modal-zhangfan0220`, channel `17`). Kimi error logs
`8652` and `8673` contain the repeated upstream 429 response. By contrast,
channels `16` and `18` remain enabled and their validation logs `8654` and
`8655` are successful, non-zero-quota `kimi-k3` consumes.

Rollback is route-specific: keep channels `16` and `18` as the Kimi fallback,
keep channel `29` below the primary Claude route, and disable an unhealthy
extant channel without deleting it. Channels `17` and `24` cannot be re-enabled
because they were deleted; recreating either requires a newly validated
credential and a new catalog review. Do not restore the withdrawn Wisech models
without validating non-empty response payloads in both JSON and streaming
modes.

## Local development

```bash
# Frontend only — proxies /api to https://you-box.com (default)
make dev-web

# Frontend + local API (host process)
make dev-infra          # Docker Postgres/Redis on localhost
make start-api          # go run main.go
make dev-web-local      # proxy to http://127.0.0.1:3000
```

Env for host API against `docker-compose.dev.yml` (makefile defaults):

```bash
SQL_DSN='postgresql://root:123456@127.0.0.1:5432/new-api?sslmode=disable'
REDIS_CONN_STRING='redis://127.0.0.1:6379/0'
```

## Related files

| Path | Role |
|------|------|
| `deploy/docker-compose.infra.yml` | Production PG/Redis |
| `deploy/boxai.service` | systemd unit (`WEB_DIST_DIR=/opt/boxai/web`) |
| `scripts/deploy-prod.sh` | Full upload + remote build + restart |
| `scripts/deploy-web.sh` | SPA-only publish (no API restart) |
| `scripts/server/bootstrap-toolchain.sh` | Install Go/Bun on host |
| `scripts/server/build-native.sh` | Server-side web + disk SPA publish + go build |
| `docker-compose.dev.yml` | Local PG/Redis only |
| `web/default/.env.development` | Default `VITE_REACT_APP_SERVER_URL` |
| [`docs/environment.md`](../docs/environment.md) | **Env inventory:** app, Amp orb `BOXAI_*`, Cloudflare `CLOUDFLARE_*` |
| `.env.boxai-admin.example` | Template for admin API + SSH (real: gitignored `.env.boxai-admin`) |
| `.env.cloudflare.example` | Template for 小 QQ full CF token (real: gitignored `.env.cloudflare`) |

## Platform admin skill

API/config over management token; SSH only for host/infra; Cloudflare edge via full-control token:

See `.agents/skills/managing-boxai-platform/SKILL.md` and Amp orb secrets in `reference/orb.md`.
