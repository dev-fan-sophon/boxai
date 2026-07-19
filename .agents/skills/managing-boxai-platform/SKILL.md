---
name: managing-boxai-platform
description: Manages the BoxAI production platform through its authenticated management API and controlled SSH access. Use for user, administrator, channel, model, pricing, OAuth, payment, subscription, redemption, log, deployment, or production configuration operations.
compatibility: Requires curl and jq for API operations. Production shell access additionally requires OpenSSH and project secrets configured for the Amp orb.
---

# Managing the BoxAI Platform

Use the management API for application configuration. Use SSH only for deployment infrastructure, containers, database maintenance, reverse proxy configuration, or environment variables that the API cannot manage.

## Required environment

API operations read these variables:

```text
BOXAI_BASE_URL=https://you-box.com
BOXAI_ADMIN_USER_ID=<numeric user id>
BOXAI_ADMIN_TOKEN=<system management access token, not an sk-* model key>
```

Production SSH additionally reads:

```text
BOXAI_SSH_HOST=<hostname or IP>
BOXAI_SSH_PORT=22
BOXAI_SSH_USER=<restricted deployment user preferred>
BOXAI_SSH_PRIVATE_KEY=<private key or its base64 encoding>
BOXAI_SSH_HOST_KEY=<pinned known_hosts line>
```

Never print, commit, paste into a thread, or return any secret value. Never read all of the production `.env` merely to inspect one setting. Query only the named variable needed for the task and redact command output.

## API workflow

1. Confirm the requested operation and determine whether it needs Admin or Root.
2. Run `scripts/boxai-api GET /api/status` for a public health check.
3. Run the narrowest read request needed before a mutation.
4. For a mutation, show the target resource and intended effect. Obtain explicit approval for destructive or shared operations such as deleting users/channels, rotating credentials, changing payment/OAuth secrets, or changing production-wide options.
5. Call `scripts/boxai-api METHOD /api/path '<json>'`.
6. Verify the JSON `success` field and read the resource back when a read endpoint exists.

Examples:

```bash
. ./.env.boxai-admin
.agents/skills/managing-boxai-platform/scripts/boxai-api GET '/api/user/?p=1&page_size=20'
.agents/skills/managing-boxai-platform/scripts/boxai-api PUT /api/option/ '{"key":"SystemName","value":"BoxAI"}'
.agents/skills/managing-boxai-platform/scripts/boxai-api POST /api/user/manage '{"id":42,"action":"disable"}'
```

The API wrapper automatically sends both required headers:

```text
Authorization: Bearer $BOXAI_ADMIN_TOKEN
New-Api-User: $BOXAI_ADMIN_USER_ID
```

Do not use an `sk-*` model gateway key as `BOXAI_ADMIN_TOKEN`.

Read [reference/api.md](reference/api.md) before composing unfamiliar payloads. Inspect the corresponding router and controller when an endpoint is absent from that reference; the dashboard API is internal and can change between upstream versions.

## One-time management token bootstrap

Generating a management token rotates that account's previous management token. Do not run this during routine setup.

After explicitly confirming rotation, provide the administrator password through `BOXAI_ADMIN_PASSWORD` or an interactive hidden prompt and run:

```bash
BOXAI_ADMIN_USERNAME='admin@example.com' \
  .agents/skills/managing-boxai-platform/scripts/bootstrap-management-token \
  --rotate --output .env.boxai-admin
```

The script logs in, handles an optional interactive 2FA challenge, rotates the token once, and writes a mode-0600 ignored environment file without printing the token. Remove `BOXAI_ADMIN_PASSWORD` from the shell and Amp project settings immediately afterward. Copy the resulting three values into Amp project secrets, then delete the local file if it is no longer needed.

## Production deployment (native app)

Canonical path: **host binary + systemd**; **Docker only for Postgres/Redis**.

```bash
# From repo root (preferred)
make deploy
# or
./scripts/deploy-prod.sh
./scripts/deploy-prod.sh --bootstrap   # first-time host only
```

Docs: [deploy/README.md](../../../deploy/README.md).

Use `scripts/boxai-server` instead of hand-built SSH flags:

```bash
.agents/skills/managing-boxai-platform/scripts/boxai-server 'systemctl status boxai2 --no-pager'
.agents/skills/managing-boxai-platform/scripts/boxai-server 'curl -fsS http://127.0.0.1:3000/api/status'
.agents/skills/managing-boxai-platform/scripts/boxai-server 'cd /opt/boxai2 && docker compose -f docker-compose.infra.yml ps'
```

**Do not** deploy the application as a Docker image/container. Do not resurrect root `docker-compose.yml` app services on production.

Follow [reference/orb.md](reference/orb.md) when connecting this repository to an Amp project and adding its orb secrets.

Rules:

- Prefer a dedicated `boxai-deploy` OS account with narrowly scoped `sudo`, not unrestricted root.
- Do not copy the entire production environment into the orb. Keep production secrets on the server and modify named values over SSH when necessary.
- Take a database/configuration backup before migrations or broad configuration changes.
- Ask before restart, deploy, migration, database write, firewall change, secret rotation, or deletion.
- Never disable SSH host-key checking. `BOXAI_SSH_HOST_KEY` must pin the production host.
- After deploy: verify `systemctl is-active boxai2`, `curl -fsS http://127.0.0.1:3000/api/status`, and infra compose health.

## Capability boundary

Use the API for users, administrator roles, channels, models, prices, groups, OAuth providers, payment settings, subscriptions, redemption codes, application logs, and runtime options.

Use SSH for host app binary/systemd, `SQL_DSN`, `REDIS_CONN_STRING`, `SESSION_SECRET`, `CRYPTO_SECRET`, Postgres/Redis Docker **infra only**, nginx, TLS, OS resources, and backups.
