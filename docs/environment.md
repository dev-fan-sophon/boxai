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
| `~/.config/boxai/admin.env` | outside repo | Legacy/local SMTP + R2 helper secrets (not Amp orb) |
| Amp project Settings | Amp only | Same `BOXAI_*` / `CLOUDFLARE_*` keys injected into orbs |

Load local files:

```bash
# Platform admin + SSH
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

**Amp:** copy the same keys into the BoxAI Amp project **Settings → Environment / Secrets**.  
Do **not** put `BOXAI_ADMIN_PASSWORD` in Amp long-term (bootstrap only).  
Do **not** copy full production `/opt/boxai/.env` into Amp.

Details: [orb.md](../.agents/skills/managing-boxai-platform/reference/orb.md).

---

## 3. Cloudflare full-control (小 QQ) — `.env.cloudflare`

Production edge for BoxAI (`you-box.com`) runs under:

| | |
|--|--|
| Cloudflare account | `123592844@qq.com's Account` (**小 QQ**) |
| Account ID | `4379d21a3d3eadc0e37d63abff091f31` |
| Primary zone | `you-box.com` |
| Zone ID | `2a653c5c030f278f165adc1cd803adfd` |
| Token name | `xiaoqq-full-control` |
| Token ID | `94ee2aa376955340fd3e2c1166bda7c0` |

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

Private objects (`uploads/`, `outputs/`) are served via short-lived presigned
GET URLs; only explicitly published objects are copied under `public/` and
served through the `assets.you-box.com` CDN.

**Migrating legacy local assets to R2:** after switching `STORAGE_BACKEND` to
`r2`, migrate objects previously written to the local filesystem with the
admin-only endpoint (preserves storage keys, re-uploads public copies, marks
rows `backend=r2`):

```text
POST /api/playground/assets/backfill-r2?dry_run=true   # report candidates only
POST /api/playground/assets/backfill-r2?limit=100      # migrate a batch
```

---

## 4. Production host app env (`/opt/boxai/.env`)

Lives **only on the server**. Template fields: `.env.example`.  
Typical: `SQL_DSN`, `REDIS_CONN_STRING`, `SESSION_SECRET`, `CRYPTO_SECRET`, payment/OAuth secrets.

Agents must:

- Prefer management API for app config
- Use SSH only for named host/infra changes
- Never dump the full production `.env` into chat or Amp secrets

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
2. Never print `BOXAI_ADMIN_TOKEN`, `CLOUDFLARE_API_TOKEN`, or private keys in chat/PR bodies.
3. Prefer rotating compromised tokens via CF dashboard or management-token bootstrap scripts.
4. New zone under 小 QQ: extend the token’s zone resources (token currently binds `you-box.com` only for zone-scoped APIs).
5. Scoped product tokens (R2-only, Email-only) may still exist for app SMTP/S3; **full control for agents is `xiaoqq-full-control`**.
