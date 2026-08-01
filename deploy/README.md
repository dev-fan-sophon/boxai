# BoxAI deployment

Canonical production and local ops for this repository.

**Product market:** Vietnam primary; other overseas markets secondary (see root `AGENTS.md` / `README.md`).

## Architecture

| Component | Production | Local default |
|-----------|------------|---------------|
| **App** (Go + embedded UI) | Host binary + **systemd** `boxai.service` → `127.0.0.1:3000` | Optional `make start-api` (`go run`) |
| **Chat service** (Bun/TypeScript, `chat-service/`) | **systemd** `boxai-chat.service` → `127.0.0.1:3100` | `cd chat-service && bun run dev` |
| **Postgres** | Docker `boxai-postgres` → `127.0.0.1:5432` | Optional `docker-compose.dev.yml` |
| **Redis** | Docker `boxai-redis` → `127.0.0.1:6379` | Optional `docker-compose.dev.yml` |
| **TLS** | nginx → `http://127.0.0.1:3000`; `/chat-api/*` → `http://127.0.0.1:3100` (`deploy/nginx/chat-api.conf.example`) | n/a |

**boxai-chat** owns the playground agent loop (`/chat-api/v1/chat`) and the
migrated playground product routes. It runs from the release checkout
(`/opt/boxai/current/chat-service`) with dependencies installed by
`scripts/server/build-native.sh`, and reads `/opt/boxai/chat.env`
(gateway shares `INTERNAL_SERVICE_SECRET` in `/opt/boxai/.env`; see
`docs/environment.md` § boxai-chat). The deploy script only enables the unit
when `/opt/boxai/chat.env` exists, so hosts are opted in explicitly.
Health: `curl -fsS http://127.0.0.1:3100/healthz`.

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

**Preferred:** merge/push to `main` → GitHub Actions workflow **Deploy production**  
(`.github/workflows/deploy-prod.yml`) SSHes to the host and runs `scripts/deploy-prod.sh`.

Manual / emergency from a trusted machine:

```bash
git push origin main
make deploy
# equivalent:
./scripts/deploy-prod.sh
./scripts/deploy-prod.sh --ref <commit>
```

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
  releases/<id>/               # source + build tree
  docker-compose.infra.yml     # Postgres + Redis only
  data/  logs/
  postgres_data/  redis_data/
```

### Ops

```bash
systemctl status boxai
journalctl -u boxai -f
curl -fsS http://127.0.0.1:3000/api/status
cd /opt/boxai && docker compose -f docker-compose.infra.yml ps
```

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
| `deploy/boxai.service` | systemd unit |
| `scripts/deploy-prod.sh` | Upload + remote build + restart |
| `scripts/server/bootstrap-toolchain.sh` | Install Go/Bun on host |
| `scripts/server/build-native.sh` | Server-side web + go build |
| `docker-compose.dev.yml` | Local PG/Redis only |
| `web/default/.env.development` | Default `VITE_REACT_APP_SERVER_URL` |
| [`docs/environment.md`](../docs/environment.md) | **Env inventory:** app, Amp orb `BOXAI_*`, Cloudflare `CLOUDFLARE_*` |
| `.env.boxai-admin.example` | Template for admin API + SSH (real: gitignored `.env.boxai-admin`) |
| `.env.cloudflare.example` | Template for 小 QQ full CF token (real: gitignored `.env.cloudflare`) |

## Platform admin skill

API/config over management token; SSH only for host/infra; Cloudflare edge via full-control token:

See `.agents/skills/managing-boxai-platform/SKILL.md` and Amp orb secrets in `reference/orb.md`.