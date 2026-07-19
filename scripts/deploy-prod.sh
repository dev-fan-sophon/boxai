#!/usr/bin/env bash
# Deploy BoxAI natively on production (app = host binary; PG/Redis = Docker).
#
# Prerequisites (local):
#   - .env.boxai-admin with BOXAI_SSH_* and BOXAI_BASE_URL
#   - git commit pushed (or pass --ref HEAD)
#
# Usage:
#   ./scripts/deploy-prod.sh              # deploy current HEAD
#   ./scripts/deploy-prod.sh --ref a45d048e
#   ./scripts/deploy-prod.sh --bootstrap  # first-time: toolchain + infra migrate
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REF=""
BOOTSTRAP=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF="$2"; shift 2 ;;
    --bootstrap) BOOTSTRAP=1; shift ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -f .env.boxai-admin ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.boxai-admin
  set +a
fi

: "${BOXAI_SSH_HOST:?BOXAI_SSH_HOST required}"
: "${BOXAI_SSH_USER:?BOXAI_SSH_USER required}"

if [[ -z "$REF" ]]; then
  REF="$(git rev-parse --short HEAD)"
fi
# Prefer full short from git when ref is a commit
if git rev-parse --verify "$REF" >/dev/null 2>&1; then
  REF="$(git rev-parse --short=12 "$REF")"
fi

KEY_FILE="${BOXAI_SSH_KEY_FILE:-$HOME/.ssh/boxai_orb_ed25519}"
KNOWN_HOSTS="${BOXAI_SSH_KNOWN_HOSTS_FILE:-$HOME/.ssh/boxai_known_hosts}"
PORT="${BOXAI_SSH_PORT:-22}"
SSH=(ssh -i "$KEY_FILE" -p "$PORT" -o BatchMode=yes -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$KNOWN_HOSTS" \
  -- "${BOXAI_SSH_USER}@${BOXAI_SSH_HOST}")

echo "==> deploy ref=${REF} host=${BOXAI_SSH_HOST}"

# 1) Upload source as release tarball
echo "==> upload release ${REF}"
git archive --format=tar --prefix="${REF}/" "${REF}" | "${SSH[@]}" \
  "rm -rf /opt/boxai2/releases/${REF} && mkdir -p /opt/boxai2/releases && tar -x -C /opt/boxai2/releases"

# 2) Upload deploy assets + build scripts into release
"${SSH[@]}" "mkdir -p /opt/boxai2/releases/${REF}/deploy /opt/boxai2/releases/${REF}/scripts/server"
scp -i "$KEY_FILE" -P "$PORT" \
  -o BatchMode=yes -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$KNOWN_HOSTS" \
  deploy/docker-compose.infra.yml deploy/boxai2.service \
  "${BOXAI_SSH_USER}@${BOXAI_SSH_HOST}:/opt/boxai2/releases/${REF}/deploy/"
scp -i "$KEY_FILE" -P "$PORT" \
  -o BatchMode=yes -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$KNOWN_HOSTS" \
  scripts/server/bootstrap-toolchain.sh scripts/server/build-native.sh \
  "${BOXAI_SSH_USER}@${BOXAI_SSH_HOST}:/opt/boxai2/releases/${REF}/scripts/server/"
"${SSH[@]}" "chmod +x /opt/boxai2/releases/${REF}/scripts/server/*.sh"

# 3) Optional bootstrap: toolchain + infra-only compose + env host rewrite
if [[ "$BOOTSTRAP" -eq 1 ]]; then
  echo "==> bootstrap toolchain + infra migration"
  "${SSH[@]}" bash -s -- "$REF" <<'REMOTE'
set -euo pipefail
REF="$1"
export PATH="/usr/local/go/bin:${HOME}/.bun/bin:/usr/local/bin:${PATH}"
bash "/opt/boxai2/releases/${REF}/scripts/server/bootstrap-toolchain.sh"

# Install infra compose (app is no longer in compose)
cp -f "/opt/boxai2/releases/${REF}/deploy/docker-compose.infra.yml" /opt/boxai2/docker-compose.infra.yml

# Rewrite SQL_DSN / REDIS_CONN_STRING to localhost (keep credentials)
python3 - <<'PY'
from pathlib import Path
import re
p = Path("/opt/boxai2/.env")
text = p.read_text()
orig = text
# postgres host
text = re.sub(
    r"(SQL_DSN=postgresql://[^@]+@)[^:/?\s]+",
    r"\g<1>127.0.0.1",
    text,
)
# redis host
text = re.sub(
    r"(REDIS_CONN_STRING=redis://(?:[^@]+@)?)[^:/?\s]+",
    r"\g<1>127.0.0.1",
    text,
)
if text != orig:
    p.write_text(text)
    print("ENV_HOSTS_UPDATED")
else:
    print("ENV_HOSTS_UNCHANGED")
PY

# Start / recreate infra with published localhost ports
cd /opt/boxai2
docker compose -f docker-compose.infra.yml up -d
docker compose -f docker-compose.infra.yml ps

# Stop dockerized app if present (free :3000)
if docker ps -q -f name=^boxai2$ | grep -q .; then
  echo "stopping docker app container boxai2..."
  docker stop boxai2 || true
  docker rm boxai2 || true
fi

# Install systemd unit
cp -f "/opt/boxai2/releases/${REF}/deploy/boxai2.service" /etc/systemd/system/boxai2.service
systemctl daemon-reload
systemctl enable boxai2.service
echo "BOOTSTRAP_OK"
REMOTE
fi

# 4) Build on server + restart service
echo "==> remote build"
"${SSH[@]}" bash -s -- "$REF" <<'REMOTE'
set -euo pipefail
REF="$1"
export PATH="/usr/local/go/bin:${HOME}/.bun/bin:/usr/local/bin:${PATH}"
ln -sfn "/opt/boxai2/releases/${REF}" /opt/boxai2/current
# Ensure infra compose is present even without --bootstrap
if [[ ! -f /opt/boxai2/docker-compose.infra.yml ]]; then
  cp -f "/opt/boxai2/releases/${REF}/deploy/docker-compose.infra.yml" /opt/boxai2/docker-compose.infra.yml
fi
# Keep infra up
cd /opt/boxai2 && docker compose -f docker-compose.infra.yml up -d
# Ensure systemd unit is current
cp -f "/opt/boxai2/releases/${REF}/deploy/boxai2.service" /etc/systemd/system/boxai2.service
systemctl daemon-reload
# Build
bash "/opt/boxai2/releases/${REF}/scripts/server/build-native.sh" "/opt/boxai2/releases/${REF}"
# Ensure docker app is not holding the port
if docker ps -q -f name=^boxai2$ | grep -q .; then
  docker stop boxai2 || true
  docker rm boxai2 || true
fi
systemctl restart boxai2.service
sleep 2
systemctl --no-pager --full status boxai2.service | head -25
# Health
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/api/status | grep -q '"success"'; then
    echo "HEALTH_OK"
    exit 0
  fi
  sleep 1
done
echo "HEALTH_FAIL" >&2
journalctl -u boxai2 -n 50 --no-pager || true
exit 1
REMOTE

echo "==> public health"
if [[ -n "${BOXAI_BASE_URL:-}" ]]; then
  curl -fsS "${BOXAI_BASE_URL}/api/status" | head -c 200
  echo
fi
echo "DEPLOY_OK ${REF}"
