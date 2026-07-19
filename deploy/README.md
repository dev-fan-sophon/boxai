# BoxAI production deploy (native app + Docker data plane)

## Architecture

| Component | How it runs |
|-----------|-------------|
| **BoxAI / new-api** | Host binary + **systemd** (`boxai2.service`) on `127.0.0.1:3000` |
| **Postgres** | Docker (`boxai2-postgres`), published `127.0.0.1:5432` |
| **Redis** | Docker (`boxai2-redis`), published `127.0.0.1:6379` |
| **nginx** | TLS termination → `http://127.0.0.1:3000` |

No application Docker image is built or run in steady state.

## First-time migration (once)

From a machine with SSH secrets (`.env.boxai-admin`):

```bash
./scripts/deploy-prod.sh --bootstrap --ref HEAD
```

This will:

1. Install Go + Bun on the server (if missing)
2. Install `docker-compose.infra.yml` (Postgres/Redis only)
3. Rewrite `SQL_DSN` / `REDIS_CONN_STRING` hosts to `127.0.0.1`
4. Stop the old `boxai2` app container
5. Build frontend + Go binary on the server
6. Install/enable `boxai2.service` and health-check

## Everyday deploy

```bash
git push origin main
./scripts/deploy-prod.sh          # uses current HEAD
# or
./scripts/deploy-prod.sh --ref a45d048e
```

Makefile:

```bash
make deploy
make deploy-bootstrap   # first time only
```

## Local frontend → production API

Default for `web/default` dev:

```bash
make dev-web
# or: cd web/default && bun run dev
```

Uses `VITE_REACT_APP_SERVER_URL=https://you-box.com` (see `.env.development`) and
proxies `/api`, `/mj`, `/pg` with cookie rewrites for localhost.

Local API instead:

```bash
make dev-web-local
```

## Server paths

```text
/opt/boxai2/
  .env                      # secrets (mode 600)
  bin/new-api               # active binary
  current -> releases/<id>
  releases/<id>/            # source + build tree
  data/                     # WorkingDirectory
  logs/
  postgres_data/ redis_data/
  docker-compose.infra.yml
```

## Ops

```bash
systemctl status boxai2
journalctl -u boxai2 -f
curl -fsS http://127.0.0.1:3000/api/status
cd /opt/boxai2 && docker compose -f docker-compose.infra.yml ps
```
