# Amp Orb Configuration

## 1. Commit lifecycle and skill files

The repository must contain executable `.agents/setup` and `.agents/resume` files. A fresh orb runs setup once; a resumed orb runs the fast health checks in resume. Start a new orb thread after changing project secrets or setup behavior.

## 2. Add project environment variables and secrets

Open the BoxAI project on `ampcode.com`, then open **Settings** and add the following values.

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

## 3. Server-side SSH account

Preferred design:

1. Create a dedicated `boxai-deploy` account on production.
2. Install only the matching public key in its `authorized_keys`.
3. Grant read-only Docker/status commands by default.
4. Add narrowly scoped passwordless sudo commands only as deployment workflows require them.
5. Do not reuse a personal laptop key or enable password authentication.

Giving an orb an unrestricted root key means every agent thread in the project can fully control production. Only choose that deliberately; it is not required for API-driven platform administration.

## 4. Keep production environment on production

Do not copy `/opt/boxai2/.env` into Amp project secrets. API automation only needs the management token. SSH automation can update a named variable on the server without exporting unrelated database, payment, OAuth, and session secrets into the orb.

If a cloud or internal access proxy supports OIDC, prefer `amp orb id-token --audience <service>` and short-lived credentials over a long-lived SSH private key.

## 5. Verify in a fresh orb

Ask the orb to load `managing-boxai-platform`, then perform read-only checks:

```bash
.agents/skills/managing-boxai-platform/scripts/boxai-api GET /api/status
.agents/skills/managing-boxai-platform/scripts/boxai-api GET '/api/user/?p=1&page_size=1'
.agents/skills/managing-boxai-platform/scripts/boxai-server 'systemctl is-active boxai2'
.agents/skills/managing-boxai-platform/scripts/boxai-server 'curl -fsS http://127.0.0.1:3000/api/status | head -c 120'
.agents/skills/managing-boxai-platform/scripts/boxai-server 'cd /opt/boxai2 && docker compose -f docker-compose.infra.yml ps'
```

Expected signals:

- Public API status returns JSON with `success: true`.
- Authenticated user request succeeds without exposing the token.
- SSH host-key verification succeeds; `boxai2` systemd unit is `active`; infra compose shows healthy **postgres** and **redis** only (no app container).

## 6. Deploy from an orb

```bash
make deploy
```

Application deploys are native (build on host, restart systemd). Do not `docker compose build` the app.
