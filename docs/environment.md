# BoxAI environment variables

Canonical map of **local agent**, **Amp orb**, **Cloudflare**, and **production** environment files.  
**Never commit secrets.** Values live in gitignored files or Amp project secrets only.

Related:

- Platform ops skill: `.agents/skills/managing-boxai-platform/SKILL.md`
- Amp orb wiring: `.agents/skills/managing-boxai-platform/reference/orb.md`
- Deploy layout: `deploy/README.md`
- App runtime template: `.env.example` (no secrets)

---

## 1. File inventory

| File | Committed? | Purpose |
|------|------------|---------|
| `.env.example` | yes | App runtime knobs template (`SQL_DSN`, Redis, session, …) |
| `.env` | **no** | Local/production app process env (on server: `/opt/boxai/.env`) |
| `.env.boxai-admin` | **no** | Local agent + Amp-shaped **BoxAI admin + SSH** secrets |
| `.env.boxai-admin.example` | yes | Placeholder keys for the admin/SSH file |
| `.env.cloudflare` | **no** | Local agent **Cloudflare full-control** token (小 QQ account) |
| `.env.cloudflare.example` | yes | Placeholder keys for Cloudflare |
| `~/.config/boxai/cf-xiaoqq-full.env` | outside repo | Canonical offline copy of the CF full token (mode 600) |
| `~/.config/boxai/cf-xiaoqq` | outside repo | Optional CLI helper wrapping the CF API |
| `~/.config/boxai/admin.env` | outside repo | Local helper: SMTP + R2 + **Sub2API** (mirror of `.env.boxai-admin` Sub2 keys; not Amp orb) |
| Amp project Settings | Amp only | Same `BOXAI_*` / `CLOUDFLARE_*` / `SUB2API_*` keys injected into orbs |

Load local files:

```bash
# Platform admin + SSH + Sub2API
set -a; source .env.boxai-admin; set +a

# Cloudflare full account API (小 QQ)
set -a; source .env.cloudflare; set +a
# equivalent canonical path:
# set -a; source ~/.config/boxai/cf-xiaoqq-full.env; set +a
```

---

## 2. Amp orb / local admin (`.env.boxai-admin`)

Used by `managing-boxai-platform` scripts and Amp orbs for dashboard API + production SSH.

### Non-secret (or low sensitivity)

```text
BOXAI_BASE_URL=https://you-box.com
BOXAI_ADMIN_USER_ID=<numeric admin user id>
BOXAI_SSH_HOST=<production hostname or IP>
BOXAI_SSH_PORT=22
BOXAI_SSH_USER=boxai-deploy
```

### Secrets

```text
BOXAI_ADMIN_TOKEN=<system management token, not sk-*>
BOXAI_SSH_PRIVATE_KEY=<OpenSSH private key or base64>
BOXAI_SSH_HOST_KEY=<single known_hosts line for the host>
```

| Variable | Used by |
|----------|---------|
| `BOXAI_BASE_URL` | `scripts/boxai-api` base origin |
| `BOXAI_ADMIN_USER_ID` | Header `New-Api-User` |
| `BOXAI_ADMIN_TOKEN` | Header `Authorization: Bearer …` |
| `BOXAI_SSH_*` | `scripts/boxai-server`, `make deploy` / `scripts/deploy-prod.sh` |

The OVH production destination and public host pin are authoritative in
`deploy/production.env` and `deploy/production_known_hosts`. Source the former
with `set -a` before manual SSH operations. The release scripts load it themselves;
old host values in Secrets are not deployment targets. Keep the private key secret.

**Amp:** copy the same keys into the BoxAI Amp project **Settings → Environment / Secrets**.  
Do **not** put `BOXAI_ADMIN_PASSWORD` in Amp long-term (bootstrap only).  
Do **not** copy full production `/opt/boxai/.env` into Amp.

Details: [orb.md](../.agents/skills/managing-boxai-platform/reference/orb.md).

### Sub2API (subscription relay on BWG)

Separate product from the BoxAI app (`you-box.com`). Self-hosted on **BWG** under `/opt/sub2api`, public UI/API:

| | |
|--|--|
| Public base | `https://sub2api.origingame.dev` |
| Deploy dir | `/opt/sub2api` (Docker Compose: app + postgres + redis) |
| Run mode | `simple` (hides SaaS billing UI; **also hides `/admin/groups` in the SPA**) |
| Admin HTTP auth | Header **`X-API-Key: $SUB2API_ADMIN_API_KEY`** (Bearer JWT is for interactive login only) |

Variables (in `.env.boxai-admin` / Amp secrets):

```text
SUB2API_BASE_URL=https://sub2api.origingame.dev
SUB2API_ADMIN_API_KEY=admin-…          # secret; regenerate: POST /api/v1/admin/settings/admin-api-key/regenerate
SUB2API_ADMIN_API_HEADER=X-API-Key
SUB2API_ADMIN_EMAIL=…                  # dashboard login
SUB2API_ADMIN_PASSWORD=…               # secret; prefer admin API key for agents
SUB2API_KEY_CODEX=sk-…                 # openai-default group (Codex / GPT)
SUB2API_KEY_GROK=sk-…                  # grok-default group
SUB2API_KEY_CLI=sk-…                   # anthropic default group (when accounts exist)
SUB2API_DEPLOY_DIR=/opt/sub2api
SUB2API_SSH_HOST=bwg
SUB2API_RUN_MODE=simple
```

Quick checks (do not print full keys):

```bash
set -a; source .env.boxai-admin; set +a
curl -fsS -H "X-API-Key: $SUB2API_ADMIN_API_KEY" \
  "$SUB2API_BASE_URL/api/v1/admin/groups?page_size=1" | head -c 120
curl -fsS -H "Authorization: Bearer $SUB2API_KEY_CODEX" \
  "$SUB2API_BASE_URL/v1/models" | head -c 120
```

**Groups:** one platform per group (`openai` / `grok` / `anthropic` / …). A key binds to **one** `group_id`. Image generation is per-group `allow_image_generation` (manage via admin API when simple mode hides the Groups UI).

Offline mirror of the same Sub2API secrets: `~/.config/boxai/admin.env` (keep in sync with `.env.boxai-admin`).

---

### RollDek (reseller upstream)

new-api fork used as an upstream reseller for Seedance video and the image models (Gemini, GPT Image, Seedream).

| | |
|--|--|
| Base | `https://rolldek.com` |
| Docs | `https://www.rolldek.com/docs/#/doubao-seedance`, `#/banana` (nano banana 2 & pro), `#/banana-2-1`, `#/seedream` (Seedream 5.0), `#/img25` |
| Account | uid **2996** (`xiaomao`), role **common user** — channel endpoints return `insufficient privileges`; use the public pricing API plus the account's own token/log endpoints |
| Management auth | `Authorization: Bearer $ROLLDEK_ACCESS_TOKEN` **and** header `New-Api-User: $ROLLDEK_USER_ID` (both required; without the id it is `Unauthorized, New-Api-User header not provided`) |
| Quota unit | `quota_per_unit = 500000` per **CNY**, not USD. RollDek prints those amounts with a `$` sign, which is misleading: read every RollDek figure as CNY (`usd_exchange_rate 7.3` is the display conversion). BoxAI's own quota stays USD. |

```text
ROLLDEK_ACCESS_TOKEN=…            # secret; management (access) token, not a relay sk-* key
ROLLDEK_USER_ID=2996              # non-secret; header New-Api-User
```

Groups in use (a key binds to one group; create/reveal keys with `POST /api/token/` and `POST /api/token/:id/key`):

| RollDek group | Models | BoxAI channel |
|---------------|--------|---------------|
| `seedance官渠 720&1080p` | `doubao-seedance-2-*`, `doubao-seedance-2-5-260628` | 36 `rolldek-seedance-official` |
| `香蕉` | `gemini-nano-banana-2.1`, `gemini-3.1-flash-image` (also `-preview` variants, `gemini-3-pro-image`) | 42 `rolldek-banana` (primary, Gemini-native) with `gemini2api` (28) as backup |
| `gpt-image 原生` | `gpt-image-2.5-flare`, `gpt-image-2.5-sunburst` | 40 `rolldek-image25-native` |
| `seedream` | `seedream-5.0` | 45 `rolldek-seedream` |

Nano-banana billing is **per image call, flat across 1K/2K/4K**: RollDek charges 35000 quota = **¥0.07** per image for both `gemini-nano-banana-2.1` and `gemini-3.1-flash-image` (`香蕉` group ratio 1). BoxAI retails them at `$0.084` (`ModelPrice`), verified against `/api/log/self` on the RollDek account.

Seedream 5.0 is billed **per call at ¥0.15** (`model_price 0.15`, group ratio 1) — RollDek charges one unit per delivered image and the model returns one image per call in practice. BoxAI retails it at `$0.18` (`ModelPrice`) on channel 45, and bills per **delivered** image, so a batch that comes back short settles down to what arrived.

Seedream request contract (RolDek docs `seedream.md`): the **aspect ratio travels in `size`** (`auto`, `1:1` … `21:9`, `9:21`), the tier in `resolution` (`1k`/`2k`), `n` is 1–4, and references are `image` (one) or `images` (1–10). BoxAI models this as the `seedream` image family (`relay/common/image_capabilities.go`), so clients may send either `aspect_ratio` or the upstream `size` spelling; the relay moves it into `size` before the upstream call and rejects pixel sizes, `n > 4` and more than 10 references with a 400.

Seedance video is token-billed, so read both sides in the same unit: RollDek's `doubao-seedance-2-5-260628` is `model_ratio 35` × group `0.7` = 24.5 quota per token = **¥49 per 1M video tokens** (Volcengine list is ¥70), i.e. ≈$6.71 per 1M tokens; BoxAI's `dreamina-seedance-2-5` ratio `4.4323` retails at **$8.86 per 1M tokens**, about +32%. A settled RollDek task of 620699 tokens cost ¥30.41 (≈$4.17) against $3.29 of BoxAI revenue, which matches that margin.

Both models accept `resolution` 1K/2K/4K, the ten standard aspect ratios plus the ultra-wide strips (`4:1`, `1:4`, `8:1`, `1:8`), and a `thinkingLevel` of `minimal`/`medium`/`high`. BoxAI exposes the thinking level as the model's **quality** control and the relay sends it as `generationConfig.thinkingConfig.thinkingLevel`.

Quick check (never print the token):

```bash
curl -fsS -H "Authorization: Bearer $ROLLDEK_ACCESS_TOKEN" -H "New-Api-User: $ROLLDEK_USER_ID" \
  https://rolldek.com/api/user/self | head -c 120
```

---

## 3. OpenAI native realtime (direct channel)

The OpenAI-native realtime models are served by a channel that calls OpenAI directly with the
same key the embedding channel uses:

| | |
|--|--|
| Channel | **44 `openai-native-realtime`** (type OpenAI, priority 30) |
| Base | `https://api.openai.com` |
| Key | the `sk-proj-…` key of channel 23 `openai-embeddings` (never printed; read it from the production database if a channel needs it again) |
| Models | `gpt-realtime-2.1` (duplex voice), `gpt-live-transcribe` (live transcription) |
| Fallback | channel **43 `origin-openai-native`** (`OG_AI_GATEWAY`) serves `gpt-live-transcribe` at lower priority |

Channel **43 `origin-openai-native`** stays as the lower-priority fallback for live
transcription; it points at OriginGame's AI gateway (`https://api.origingame.dev`,
`OG_PLATFORM_DEVELOPMENT_KEY`).

Both models are sold at OpenAI list price (no markup):

| Model | Text in | Text out | Audio in | Audio out |
|-------|---------|----------|----------|-----------|
| `gpt-realtime-2.1` (`ModelRatio` 2, `CompletionRatio` 6, `AudioRatio` 8, `AudioCompletionRatio` 2) | $4 / 1M | $24 / 1M | $32 / 1M | $64 / 1M |
| `gpt-live-transcribe` (`ModelRatio` 5.1) | – | – | $0.017 / minute | – |

Duplex voice is a WebSocket session that takes the model in the query:

```text
wss://you-box.com/v1/realtime?model=gpt-realtime-2.1
Authorization: Bearer <BoxAI key>
```

Live transcription is a WebSocket session whose model only routes and bills the request:

```text
wss://you-box.com/v1/realtime?intent=transcription&model=gpt-live-transcribe
Authorization: Bearer <BoxAI key>        # or Sec-WebSocket-Protocol: realtime, openai-insecure-api-key.<key>
```

The Realtime API rejects a `model` query parameter for transcription sessions
("You must not provide a model parameter for transcription sessions"), so the gateway drops it
from the upstream URL (`GenRelayInfoWs` in `relay/common/relay_info.go`) while keeping it for
routing and billing. Audio is **PCM16/24 kHz mono**, committed one turn at a time (at most 60
seconds per turn upstream); the model comes from the session configuration
(`audio.input.transcription.model`), not from the URL.

Audio is billed from tokens: 1666.67 input tokens and 833.33 output tokens per minute, with the
fraction of a chunk carried into the next one (`audioTokens` in `service/token_counter.go`), so
the charge tracks the audio duration no matter how small the client's chunks are.

---

## 4. Cloudflare full-control (小 QQ) — `.env.cloudflare`

Production edge for BoxAI (`you-box.com`) runs under:

| | |
|--|--|
| Cloudflare account | `123592844@qq.com's Account` (**小 QQ**) |
| Account ID | `4379d21a3d3eadc0e37d63abff091f31` |
| Primary zone | `you-box.com` |
| Zone ID | `2a653c5c030f278f165adc1cd803adfd` |
| Token name | `xiaoqq-full-control` |
| Token ID | `94ee2aa376955340fd3e2c1166bda7c0` |

### Application email transport

When the application's `SMTPServer` option is `smtp.mx.cloudflare.net`, BoxAI
sends through Cloudflare Email Sending's HTTPS API on port 443, using the
canonical account above and the existing `SMTPToken` (Email Sending permission).
`SMTPFrom` and the product display name remain the sender. SMTP port and TLS
options do not apply to this transport. Other SMTP hosts keep their existing
SMTP behavior. This avoids blocked outbound SMTP ports on the production host;
do not replace the scoped application token with an agent's full-control token.

### Variables

```text
CLOUDFLARE_ACCOUNT_ID=4379d21a3d3eadc0e37d63abff091f31
CLOUDFLARE_ZONE_ID=2a653c5c030f278f165adc1cd803adfd
CLOUDFLARE_ZONE_NAME=you-box.com
CLOUDFLARE_API_TOKEN=<user API token xiaoqq-full-control>
```

### Scope (agents may rely on this)

The token is a **User API Token** with full permission groups on:

- **Account** `4379d21a3d3eadc0e37d63abff091f31` — all account-level products (Workers, R2, D1, KV, Pages, Tunnels, AI Gateway, Email Routing/Sending, members, rulesets, queues, hyperdrive, vectorize, images, stream, …)
- **Zone** `you-box.com` — all zone-level products (DNS, SSL, WAF, settings, …)
- **R2 edge buckets** — `com.cloudflare.edge.r2.bucket.*`

It does **not** grant access to the separate Gmail-owned Cloudflare account.

### Agent usage

Subsequent product work that needs edge/CDN/DNS/Workers/R2/email/DNS **should use this token and account** as the default Cloudflare foundation for BoxAI:

The migration added the independently scoped Amp secret
`BOXAI_CLOUDFLARE_API_TOKEN`. Prefer it for BoxAI operations when present, and set
the account/zone IDs explicitly from this document. A personal
`CLOUDFLARE_ACCOUNT_ID` can belong to a different project; do not operate on it
merely because it is already in the environment.

DNS writes use the separate Amp secret `BOXAI_CLOUDFLARE_DNS_API_TOKEN`, scoped
to DNS editing on `you-box.com`. The current `BOXAI_CLOUDFLARE_API_TOKEN` can
manage the migration's Workers/R2 resources but returned an authorization error
for DNS edits; do not assume it inherits the historical full-control token's
permissions. Keep both token values in Secrets, not shell arguments or files
committed to Git.

```bash
set -a; source .env.cloudflare; set +a

curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  https://api.cloudflare.com/client/v4/user/tokens/verify

# examples
curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records"
curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets"
```

Wrangler / CF tooling:

```bash
export CLOUDFLARE_API_TOKEN   # from .env.cloudflare
export CLOUDFLARE_ACCOUNT_ID
# wrangler deploy …  (use account_id in wrangler.toml when needed)
```

Optional helper (outside repo): `~/.config/boxai/cf-xiaoqq GET /user/tokens/verify`

### Amp orb

Add the same four `CLOUDFLARE_*` keys to Amp project Settings (token as **secret**).  
Agents on Amp can then manage DNS, Workers, R2, email, and related CF resources without browser login.

### Playground object storage (R2)

Playground media (uploads + generation outputs) is stored via a pluggable
`AssetStore` (`STORAGE_BACKEND=local|r2`). Production uses the R2 bucket
**`boxai-playground`** (isolated from `boxai` / `boxai-backup`).

| | |
|--|--|
| Bucket | `boxai-playground` (location `WNAM`) |
| S3 endpoint | `https://4379d21a3d3eadc0e37d63abff091f31.r2.cloudflarestorage.com` |
| S3 token name | `boxai-playground-s3` (scoped to this bucket, Object Read+Write) |
| Public domain | `assets.you-box.com` → bucket (`public/`, `inspiration/` prefixes) |
| Key layout | `uploads/<uid>/…`, `outputs/<uid>/…`, `public/<uid>/…`, `inspiration/<slug>/…` |

R2 S3 credentials are derived from the scoped token:
**`R2_ACCESS_KEY_ID` = token id**, **`R2_SECRET_ACCESS_KEY` = `sha256(token value)`**.
They live in `.env.cloudflare` (gitignored); placeholders in `.env.cloudflare.example`.

```text
STORAGE_BACKEND=r2
R2_BUCKET=boxai-playground
R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<r2 token id>
R2_SECRET_ACCESS_KEY=<sha256 of r2 token value>
R2_PUBLIC_BASE_URL=https://assets.you-box.com
R2_PRESIGN_TTL=600
```

**Delivery model (CORS-safe):**

- **Private** objects (`uploads/`, `outputs/`) are always streamed
  same-origin through `GET /api/playground/assets/:id/content` (and video via
  `/v1/videos/:task_id/content`). The app opens R2 server-side; browsers never
  follow a cross-origin presign redirect for private media. Use
  `?download=1` for `Content-Disposition: attachment`.
- **Public** objects are copied under `public/` and served from
  `https://assets.you-box.com` (CDN). That custom domain should allow
  `GET`/`HEAD` from `https://you-box.com` (and `www`) via R2/custom-domain CORS.
- **Bucket CORS** on `boxai-playground` should allow `GET`/`HEAD` from
  `https://you-box.com` and `https://www.you-box.com` for residual presigned
  URL use (ops tooling / future opt-in). The production S3 token
  (`boxai-playground-s3`) is object-scoped and **cannot** call
  `PutBucketCors`; apply CORS with the Cloudflare dashboard or the
  account-level `xiaoqq-full-control` API token:

```bash
# Option A — Cloudflare API (account token with R2 admin), JSON body:
# PUT /accounts/<account_id>/r2/buckets/boxai-playground/cors
#
# Option B — on a host with admin R2 credentials that include bucket CORS:
set -a; source /opt/boxai/.env; set +a   # or export R2_* another way
python3 scripts/r2-put-cors.py           # S3 XML PutBucketCors helper
```

`assets.you-box.com` already returns `Access-Control-Allow-Origin:
https://you-box.com` for browser `Origin` requests (public CDN path).

**Migrating legacy local assets to R2:** after switching `STORAGE_BACKEND` to
`r2`, migrate objects previously written to the local filesystem with the
admin-only endpoint (preserves storage keys, re-uploads public copies, marks
rows `backend=r2`):

```text
POST /api/playground/assets/backfill-r2?dry_run=true   # report candidates only
POST /api/playground/assets/backfill-r2?limit=100      # migrate a batch
```

### BoxAI Desktop

The current client in `desktop/` is based on pi-desktop (Electron/React and Rust),
uses BoxAI account authorization and sends built-in model calls through BoxAI.
Packaged users do not need provider keys or server environment files. Keep local
authorization files private; never attach them to diagnostics or screenshots.
See [desktop-integration.md](desktop-integration.md) and
[desktop/README.md](../desktop/README.md) for ownership and development.

`BOXAI_DESKTOP_DEV_ORIGIN` optionally selects an HTTP loopback backend for
unpackaged development builds only. Packaged apps always use `https://you-box.com`;
the override does not bypass authorization. See [desktop-account.md](desktop-account.md).

Legacy connector OAuth services are not prerequisites for the current app.
Removing their source does not retire deployed Workers, delete D1 data or revoke
OAuth registrations. Those operations need a separate review and authorization.

---

## 4. Production host app env (`/opt/boxai/.env`)

Lives **only on the server**. Template fields: `.env.example`.  
Typical: `SQL_DSN`, `REDIS_CONN_STRING`, `SESSION_SECRET`, `CRYPTO_SECRET`, payment/OAuth secrets.

Agents must:

- Prefer management API for app config
- Use SSH only for named host/infra changes
- Never dump the full production `.env` into chat or Amp secrets

### SePay automatic VietQR confirmation

SePay confirms the existing **Bank QR** checkout for balance top-ups and
subscription purchases. It does not replace Waffo or require a second checkout.
Without a webhook secret, Bank QR keeps its existing manual-proof workflow.

| Variable | Purpose |
|----------|---------|
| `SEPAY_WEBHOOK_SECRET` | Secret shared with the SePay **HMAC-SHA256** webhook. Keep it server-side; never send it to the browser or paste it into chat. |
| `SEPAY_BANK_GATEWAY` | Exact `gateway` value from the linked bank's SePay payload, e.g. `MBBank`. Required when the secret is set. This is not the six-digit VietQR bank BIN. |
| `SEPAY_SUB_ACCOUNT` | Exact `subAccount` expected in notifications; omit for a normal account without a virtual subaccount. |

Setup, after explicit production deployment/configuration approval:

1. Link the receiving bank in [SePay](https://docs.sepay.vn/them-tai-khoan-ngan-hang.html).
   Prefer a direct bank API connection for prompt confirmation.
2. Configure BoxAI's existing Bank QR settings: bank name/BIN, receiving account,
   account holder, minimum amount and transfer prefix. Payment compliance must
   be confirmed, currency display VND, and the VND/USD exchange rate valid.
3. Set the named environment variables on the application server. Keep the
   receiving account consistent with the Bank QR settings. A virtual account
   integration must be verified against the actual `accountNumber`/`subAccount`
   payload and generated QR destination before enabling it for customers.
4. In SePay **Live**, create an incoming-transfer webhook for that bank account:
   URL `https://you-box.com/api/sepay/webhook`, JSON body, authentication
   **HMAC-SHA256**, secret equal to `SEPAY_WEBHOOK_SECRET`. API Key and unauthenticated
   webhooks are intentionally not accepted. Keep server clocks synchronized.
5. Deploy backend and frontend together, with a database backup before the
   normal application migration. New columns preserve each order's confirmation
   mode and destination; `se_pay_events` stores transaction IDs and outcomes.
6. Create a new checkout and transfer a small supported amount with the exact
   displayed content. Verify SePay delivery history, successful order status,
   the credited balance/subscription, and the user's confirmation screen.
   Re-deliver the same webhook and verify no second credit.

**Test isolation:** use a disposable/staging BoxAI database, a different webhook
secret and a staging URL for SePay Test mode. Never point simulated payments at
production or reuse the production secret; the webhook payload itself does not
provide a trusted test/live distinction.

The webhook validates its raw-body signature and a ±5-minute signing timestamp,
then matches an unambiguous complete order reference, snapshotted destination
and exact whole-VND payable amount (after discounts). It credits the order's
stored USD/plan snapshot, not a new exchange-rate quote. Transaction-ID recording
and settlement are atomic. Retries cannot credit twice, including when a manual
review races the webhook. Only newly created SePay-enabled orders auto-settle;
historical manual orders remain manual.

Authenticated mismatches, unmatched references and expired/cancelled orders are
acknowledged with HTTP 200 and retained in `se_pay_events` with `reason`,
`trade_no`, `payload` and `received_at` for reconciliation. A 200 therefore means
**delivery accepted**, not necessarily credited. Compare this ledger with SePay's
bank transaction history and BoxAI orders. Re-delivering an already recorded
transaction will not rematch it. Review unresolved transfers manually using
verified bank evidence; do not edit the ledger to force a retry or reuse a bank
transfer for another order. Late payments cannot automatically consume an
expired coupon reservation; cancelled/expired orders may require a manual
refund or a separately authorized account adjustment.

Invalid signatures return 401, invalid JSON/IDs 400, oversized bodies 413, and
database/settlement failures 500 so SePay can retry. Removing the secret stops
webhook processing as well as automatic mode for new orders. To pause sales
without losing notifications for existing orders, disable Bank QR checkout but
keep the webhook secret configured until outstanding orders are reconciled.

Protocol references: [webhook integration](https://developer.sepay.vn/vi/sepay-webhooks/tich-hop-webhook),
[HMAC authentication](https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc).

### On-disk SPA (`WEB_DIST_DIR`)

Set on the **systemd unit** (`deploy/boxai.service`), not required in `.env`:

| Variable | Default (unit) | Purpose |
|----------|----------------|---------|
| `WEB_DIST_DIR` | `/opt/boxai/web` | Prefer SPA from this path (usually a symlink to `web-releases/<id>`). If missing/unusable, fall back to the binary-embedded build. |

- Full deploy (`make deploy` / `build-native.sh`) publishes `web-releases/<release>` and flips the symlink.
- UI-only deploy (`make deploy-web`) uploads a new web release and flips the same symlink **without** restarting `boxai.service`.
- Details: [`deploy/README.md`](../deploy/README.md).

### boxai-chat (`/opt/boxai/chat.env`)

Server-only env for the `boxai-chat.service` unit (Bun chat service on
`127.0.0.1:3100`). This file is required: production deploys stop before
cutover when it is absent or empty.

| Variable | Purpose |
|----------|---------|
| `INTERNAL_SERVICE_SECRET` | Shared secret with the gateway (same value must be set in `/opt/boxai/.env`); authenticates every internal gateway call |
| `TAVILY_API_KEY` | Tavily key for the chat service's low-latency web search tool |
| `DATABASE_URL` | `postgres://…@127.0.0.1:5432/…` — same database as `SQL_DSN`, URL form |
| `GATEWAY_BASE_URL` | Default `http://127.0.0.1:3000` |
| `CHAT_SERVICE_PORT` / `CHAT_SERVICE_HOST` | Default `3100` / `127.0.0.1` |
| `PLAYGROUND_MEMORY_ENABLED` / `_BASE_URL` / `_API_KEY` / `_MODEL` | Memory/summary pipeline endpoint (mirrors the gateway's former `playground_memory` admin setting) |
| `PLAYGROUND_MEMORY_SUMMARY_ENABLED`, `_EXTRACT_EVERY`, `_MAX`, `_SUMMARY_TRIGGER`, `_SUMMARY_KEEP`, `_TIMEOUT` | Optional tuning; same defaults/clamps as the Go implementation |

---

## 5. GitHub Actions (deploy)

Repository secrets for **Deploy production** (not the Amp orb):

| Secret | Purpose |
|--------|---------|
| `BOXAI_SSH_HOST` | Host/IP |
| `BOXAI_SSH_USER` | SSH user |
| `BOXAI_SSH_PORT` | Optional; default 22 |
| `BOXAI_SSH_PRIVATE_KEY` | Deploy key |
| `BOXAI_SSH_HOST_KEY` | Pinned host key line |
| `BOXAI_BASE_URL` | e.g. `https://you-box.com` |

Environment name: `production`.

---

## 6. Security rules

1. Never commit `.env`, `.env.boxai-admin`, `.env.cloudflare`, or token values.
2. Never print `BOXAI_ADMIN_TOKEN`, `CLOUDFLARE_API_TOKEN`, `SUB2API_ADMIN_API_KEY`, `SUB2API_ADMIN_PASSWORD`, `SUB2API_KEY_*`, or private keys in chat/PR bodies.
3. Prefer rotating compromised tokens via CF dashboard or management-token bootstrap scripts.
4. New zone under 小 QQ: extend the token’s zone resources (token currently binds `you-box.com` only for zone-scoped APIs).
5. Scoped product tokens (R2-only, Email-only) may still exist for app SMTP/S3; **full control for agents is `xiaoqq-full-control`**.
