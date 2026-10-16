# Amp Orb Configuration

## 1. Commit lifecycle and skill files

The repository must contain executable `.agents/setup` and `.agents/resume` files. A fresh orb runs setup once; a resumed orb runs the fast health checks in resume. Start a new orb thread after changing project secrets or setup behavior.

## 2. Add project environment variables and secrets

Open the BoxAI project on `ampcode.com`, then open **Settings** and add the following values.

**Canonical map (all env files):** [`docs/environment.md`](../../../../docs/environment.md).

Local equivalents (gitignored on developer machines):

| Amp / orb keys | Local file |
|----------------|------------|
| `BOXAI_*` | `.env.boxai-admin` (from `.env.boxai-admin.example`) |
| `SUB2API_*` | `.env.boxai-admin` (same file; Sub2API on BWG) |
| `ROLLDEK_*` | `.env.boxai-admin` (same file; reseller upstream, see § RollDek in `docs/environment.md`) |
| `CLOUDFLARE_*` | `.env.cloudflare` (from `.env.cloudflare.example`; also `~/.config/boxai/cf-xiaoqq-full.env`) |

### 2a. BoxAI management API + SSH

Non-secret environment variables:

```text
BOXAI_BASE_URL=https://you-box.com
BOXAI_ADMIN_USER_ID=<root or dedicated admin user id>
BOXAI_SSH_HOST=<production hostname or IP>
BOXAI_SSH_PORT=22
BOXAI_SSH_USER=boxai-deploy
```

Secrets:

```text
BOXAI_ADMIN_TOKEN=<system management token>
BOXAI_SSH_PRIVATE_KEY=<dedicated private SSH key or base64 encoding>
BOXAI_SSH_HOST_KEY=<pinned known_hosts line>
```

`BOXAI_SSH_HOST_KEY` is public material but should be protected from unauthorized modification because it establishes server identity. Obtain it from an already trusted machine or the server console and verify its fingerprint out of band. Do not have an orb accept an unverified `ssh-keyscan` result.

Do not retain `BOXAI_ADMIN_PASSWORD` in project settings. It is needed only for the one-time token bootstrap and should be removed immediately afterward.

### 2b. Sub2API (BWG subscription relay)

Not the BoxAI app. Public: `https://sub2api.origingame.dev`. Ops: SSH `bwg`, dir `/opt/sub2api`.

Non-secret (or low sensitivity):

```text
SUB2API_BASE_URL=https://sub2api.origingame.dev
SUB2API_ADMIN_API_HEADER=X-API-Key
SUB2API_ADMIN_EMAIL=<admin dashboard email>
SUB2API_DEPLOY_DIR=/opt/sub2api
SUB2API_SSH_HOST=bwg
SUB2API_RUN_MODE=simple
```

Secrets (Amp → secret):

```text
SUB2API_ADMIN_API_KEY=admin-…          # X-API-Key header for /api/v1/admin/*
SUB2API_ADMIN_PASSWORD=…               # optional; prefer admin API key
SUB2API_KEY_CODEX=sk-…                 # openai-default group
SUB2API_KEY_GROK=sk-…                  # grok-default group
SUB2API_KEY_CLI=sk-…                   # anthropic group (optional)
```

Admin API example:

```bash
curl -fsS -H "X-API-Key: $SUB2API_ADMIN_API_KEY" \
  "$SUB2API_BASE_URL/api/v1/admin/groups?page_size=5"
```

Local file: `.env.boxai-admin`. Full notes: [`docs/environment.md`](../../../../docs/environment.md) § Sub2API.

### 2c. Cloudflare full-control (小 QQ / you-box.com)

Agents building edge features (DNS, Workers, R2, Email, Tunnels, AI Gateway, …) must use the **小 QQ** Cloudflare account. Put these in Amp Settings (token as secret):

```text
CLOUDFLARE_ACCOUNT_ID=4379d21a3d3eadc0e37d63abff091f31
CLOUDFLARE_ZONE_ID=2a653c5c030f278f165adc1cd803adfd
CLOUDFLARE_ZONE_NAME=you-box.com
CLOUDFLARE_API_TOKEN=<xiaoqq-full-control user API token>
```

Token name in the dashboard: `xiaoqq-full-control` (full account permission groups on 小 QQ + full zone groups on `you-box.com`). Local source of truth for the secret value: `~/.config/boxai/cf-xiaoqq-full.env` or repo `.env.cloudflare` (never commit).

### 2d. RollDek (reseller upstream)

Seedance video and nano-banana images are resold through RollDek. Its management API needs **both** headers (`Authorization: Bearer $ROLLDEK_ACCESS_TOKEN` and `New-Api-User: $ROLLDEK_USER_ID`).

```text
ROLLDEK_BASE_URL=https://rolldek.com
ROLLDEK_USER_ID=2996
```

Secret:

```text
ROLLDEK_ACCESS_TOKEN=…
```

Full map (groups, per-image cost, BoxAI channels): [`docs/environment.md`](../../../../docs/environment.md) § RollDek.

## 3. Server-side SSH account

Preferred design:

1. Create a dedicated `boxai-deploy` account on production.
2. Install only the matching public key in its `authorized_keys`.
3. Grant read-only Docker/status commands by default.
4. Add narrowly scoped passwordless sudo commands only as deployment workflows require them.
5. Do not reuse a personal laptop key or enable password authentication.

Giving an orb an unrestricted root key means every agent thread in the project can fully control production. Only choose that deliberately; it is not required for API-driven platform administration.

## 4. Keep production environment on production

Do not copy `/opt/boxai/.env` into Amp project secrets. API automation only needs the management token. SSH automation can update a named variable on the server without exporting unrelated database, payment, OAuth, and session secrets into the orb.

If a cloud or internal access proxy supports OIDC, prefer `amp orb id-token --audience <service>` and short-lived credentials over a long-lived SSH private key.

## 5. Verify in a fresh orb

Ask the orb to load `managing-boxai-platform`, then perform read-only checks:

```bash
.agents/skills/managing-boxai-platform/scripts/boxai-api GET /api/status
.agents/skills/managing-boxai-platform/scripts/boxai-api GET '/api/user/?p=1&page_size=1'
.agents/skills/managing-boxai-platform/scripts/boxai-server 'systemctl is-active boxai'
.agents/skills/managing-boxai-platform/scripts/boxai-server 'curl -fsS http://127.0.0.1:3000/api/status | head -c 120'
.agents/skills/managing-boxai-platform/scripts/boxai-server 'cd /opt/boxai && docker compose -f docker-compose.infra.yml ps'

# Cloudflare foundation (do not print CLOUDFLARE_API_TOKEN)
curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  https://api.cloudflare.com/client/v4/user/tokens/verify
curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID" | head -c 200

# Sub2API admin (header is X-API-Key, not Bearer)
curl -fsS -H "X-API-Key: $SUB2API_ADMIN_API_KEY" \
  "$SUB2API_BASE_URL/api/v1/admin/groups?page_size=1" | head -c 120
```

Expected signals:

- Public API status returns JSON with `success: true`.
- Authenticated user request succeeds without exposing the token.
- SSH host-key verification succeeds; `boxai` systemd unit is `active`; infra compose shows healthy **postgres** and **redis** only (no app container).
- CF token verify returns `success: true` / active; account name is `123592844@qq.com's Account`.
- Sub2API admin groups list returns `code: 0` (do not print `SUB2API_ADMIN_API_KEY`).
## 6. Deploy

**Preferred:** push/merge to `main` and let GitHub Actions **Deploy production** run.

Emergency from an orb or laptop with SSH secrets:

```bash
make deploy
```

Application deploys are native (build on host, restart systemd). Do not `docker compose build` the app.

GitHub Actions repository secrets (not Amp orb secrets): `BOXAI_SSH_HOST`, `BOXAI_SSH_USER`, `BOXAI_SSH_PORT`, `BOXAI_SSH_PRIVATE_KEY`, `BOXAI_SSH_HOST_KEY`, `BOXAI_BASE_URL`, plus Environment `production`.

## Canonical production names

`boxai` only: repo `dev-fan-sophon/boxai`, `/opt/boxai`, `boxai.service`, containers `boxai-postgres`/`boxai-redis`. Do not target `boxai2`.

