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

APP_ROOT="/opt/boxai"
LEGACY_APP_ROOT="/opt/boxai2"
SERVICE_NAME="boxai"
LEGACY_SERVICE_NAME="boxai2"

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

# SSH materials: prefer explicit files, else materialize from env (GitHub Actions).
TMP_SSH_DIR=""
cleanup_ssh_tmp() {
  if [[ -n "${TMP_SSH_DIR:-}" && -d "${TMP_SSH_DIR}" ]]; then
    rm -rf "${TMP_SSH_DIR}"
  fi
}
trap cleanup_ssh_tmp EXIT

KEY_FILE="${BOXAI_SSH_KEY_FILE:-}"
KNOWN_HOSTS="${BOXAI_SSH_KNOWN_HOSTS_FILE:-}"
if [[ -z "$KEY_FILE" || -z "$KNOWN_HOSTS" ]]; then
  if [[ -n "${BOXAI_SSH_PRIVATE_KEY:-}" || -n "${BOXAI_SSH_HOST_KEY:-}" ]]; then
    TMP_SSH_DIR="$(mktemp -d)"
    chmod 700 "$TMP_SSH_DIR"
    if [[ -z "$KEY_FILE" ]]; then
      : "${BOXAI_SSH_PRIVATE_KEY:?BOXAI_SSH_PRIVATE_KEY or BOXAI_SSH_KEY_FILE required}"
      KEY_FILE="${TMP_SSH_DIR}/id"
      # Support raw PEM/OpenSSH key or base64-encoded key.
      if [[ "${BOXAI_SSH_PRIVATE_KEY}" == -----BEGIN* ]]; then
        printf '%s\n' "${BOXAI_SSH_PRIVATE_KEY}" >"$KEY_FILE"
      else
        printf '%s' "${BOXAI_SSH_PRIVATE_KEY}" | base64 -d >"$KEY_FILE" 2>/dev/null \
          || printf '%s\n' "${BOXAI_SSH_PRIVATE_KEY}" >"$KEY_FILE"
      fi
      # Normalize Windows newlines if a secret was pasted with CRLF.
      if command -v sed >/dev/null 2>&1; then
        sed -i.bak 's/\r$//' "$KEY_FILE" 2>/dev/null || sed -i '' 's/\r$//' "$KEY_FILE" 2>/dev/null || true
        rm -f "${KEY_FILE}.bak"
      fi
      chmod 600 "$KEY_FILE"
    fi
    if [[ -z "$KNOWN_HOSTS" ]]; then
      : "${BOXAI_SSH_HOST_KEY:?BOXAI_SSH_HOST_KEY or BOXAI_SSH_KNOWN_HOSTS_FILE required}"
      KNOWN_HOSTS="${TMP_SSH_DIR}/known_hosts"
      printf '%s\n' "${BOXAI_SSH_HOST_KEY}" >"$KNOWN_HOSTS"
      chmod 600 "$KNOWN_HOSTS"
    fi
  else
    KEY_FILE="${HOME}/.ssh/boxai_orb_ed25519"
    KNOWN_HOSTS="${HOME}/.ssh/boxai_known_hosts"
  fi
fi

if [[ ! -f "$KEY_FILE" ]]; then
  echo "SSH private key file missing: $KEY_FILE" >&2
  exit 1
fi
if [[ ! -f "$KNOWN_HOSTS" ]]; then
  echo "SSH known_hosts file missing: $KNOWN_HOSTS" >&2
  exit 1
fi

PORT="${BOXAI_SSH_PORT:-22}"
if [[ -z "$PORT" ]]; then
  PORT=22
fi
SSH=(ssh -i "$KEY_FILE" -p "$PORT" -o BatchMode=yes -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$KNOWN_HOSTS" \
  -- "${BOXAI_SSH_USER}@${BOXAI_SSH_HOST}")

echo "==> deploy ref=${REF} host=${BOXAI_SSH_HOST} app_root=${APP_ROOT}"

# 0) One-time rename: /opt/boxai2 + boxai2.service → /opt/boxai + boxai.service
echo "==> ensure app root layout"
"${SSH[@]}" bash -s -- "$APP_ROOT" "$LEGACY_APP_ROOT" "$SERVICE_NAME" "$LEGACY_SERVICE_NAME" <<'REMOTE'
set -euo pipefail
APP_ROOT="$1"
LEGACY_APP_ROOT="$2"
SERVICE_NAME="$3"
LEGACY_SERVICE_NAME="$4"

if [[ -d "$LEGACY_APP_ROOT" && ! -e "$APP_ROOT" ]]; then
  echo "migrating ${LEGACY_APP_ROOT} -> ${APP_ROOT}"
  systemctl stop "${LEGACY_SERVICE_NAME}.service" 2>/dev/null || true
  if [[ -f "${LEGACY_APP_ROOT}/docker-compose.infra.yml" ]]; then
    (
      cd "$LEGACY_APP_ROOT"
      docker compose -f docker-compose.infra.yml down || true
    )
  fi
  # Drop legacy app container names if still present
  for c in boxai2 boxai2-postgres boxai2-redis; do
    docker rm -f "$c" 2>/dev/null || true
  done
  mv "$LEGACY_APP_ROOT" "$APP_ROOT"
  # Fix release symlink after directory move (may still point at /opt/boxai2/...)
  if [[ -L "${APP_ROOT}/current" || -e "${APP_ROOT}/current" ]]; then
    cur_target="$(readlink "${APP_ROOT}/current" 2>/dev/null || true)"
    cur_name="$(basename "${cur_target:-}")"
    if [[ -n "$cur_name" && -d "${APP_ROOT}/releases/${cur_name}" ]]; then
      ln -sfn "${APP_ROOT}/releases/${cur_name}" "${APP_ROOT}/current"
    fi
  fi
  echo "MIGRATE_ROOT_OK"
elif [[ -d "$LEGACY_APP_ROOT" && -d "$APP_ROOT" ]]; then
  echo "both ${LEGACY_APP_ROOT} and ${APP_ROOT} exist; using ${APP_ROOT}" >&2
fi

mkdir -p "${APP_ROOT}/releases" "${APP_ROOT}/bin" "${APP_ROOT}/logs" "${APP_ROOT}/data"

# Remove legacy systemd unit after rename path is ready
if systemctl list-unit-files "${LEGACY_SERVICE_NAME}.service" 2>/dev/null | grep -q "${LEGACY_SERVICE_NAME}.service"; then
  systemctl disable --now "${LEGACY_SERVICE_NAME}.service" 2>/dev/null || true
  rm -f "/etc/systemd/system/${LEGACY_SERVICE_NAME}.service"
  systemctl daemon-reload || true
  echo "LEGACY_SERVICE_REMOVED"
fi
REMOTE

# 1) Upload source as release tarball
echo "==> upload release ${REF}"
git archive --format=tar --prefix="${REF}/" "${REF}" | "${SSH[@]}" \
  "rm -rf ${APP_ROOT}/releases/${REF} && mkdir -p ${APP_ROOT}/releases && tar -x -C ${APP_ROOT}/releases"

# 2) Upload deploy assets + build scripts into release
"${SSH[@]}" "mkdir -p ${APP_ROOT}/releases/${REF}/deploy ${APP_ROOT}/releases/${REF}/scripts/server"
scp -i "$KEY_FILE" -P "$PORT" \
  -o BatchMode=yes -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$KNOWN_HOSTS" \
  deploy/docker-compose.infra.yml deploy/boxai.service \
  "${BOXAI_SSH_USER}@${BOXAI_SSH_HOST}:${APP_ROOT}/releases/${REF}/deploy/"
scp -i "$KEY_FILE" -P "$PORT" \
  -o BatchMode=yes -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$KNOWN_HOSTS" \
  scripts/server/bootstrap-toolchain.sh scripts/server/build-native.sh \
  "${BOXAI_SSH_USER}@${BOXAI_SSH_HOST}:${APP_ROOT}/releases/${REF}/scripts/server/"
"${SSH[@]}" "chmod +x ${APP_ROOT}/releases/${REF}/scripts/server/*.sh"

# 3) Optional bootstrap: toolchain + infra-only compose + env host rewrite
if [[ "$BOOTSTRAP" -eq 1 ]]; then
  echo "==> bootstrap toolchain + infra migration"
  "${SSH[@]}" bash -s -- "$REF" "$APP_ROOT" "$SERVICE_NAME" <<'REMOTE'
set -euo pipefail
REF="$1"
APP_ROOT="$2"
SERVICE_NAME="$3"
export PATH="/usr/local/go/bin:${HOME}/.bun/bin:/usr/local/bin:${PATH}"
bash "${APP_ROOT}/releases/${REF}/scripts/server/bootstrap-toolchain.sh"

# Install infra compose (app is no longer in compose)
cp -f "${APP_ROOT}/releases/${REF}/deploy/docker-compose.infra.yml" "${APP_ROOT}/docker-compose.infra.yml"

# Rewrite SQL_DSN / REDIS_CONN_STRING to localhost (keep credentials)
python3 - <<PY
from pathlib import Path
import re
p = Path("${APP_ROOT}/.env")
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
cd "$APP_ROOT"
docker compose -f docker-compose.infra.yml --env-file "${APP_ROOT}/.env" up -d
docker compose -f docker-compose.infra.yml --env-file "${APP_ROOT}/.env" ps

# Stop dockerized app if present (free :3000)
for c in boxai boxai2; do
  if docker ps -aq -f "name=^${c}$" | grep -q .; then
    echo "stopping docker app container ${c}..."
    docker stop "$c" || true
    docker rm "$c" || true
  fi
done

# Install systemd unit
cp -f "${APP_ROOT}/releases/${REF}/deploy/boxai.service" "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}.service"
echo "BOOTSTRAP_OK"
REMOTE
fi

# 4) Build on server + restart service
echo "==> remote build"
"${SSH[@]}" bash -s -- "$REF" "$APP_ROOT" "$SERVICE_NAME" <<'REMOTE'
set -euo pipefail
REF="$1"
APP_ROOT="$2"
SERVICE_NAME="$3"
export PATH="/usr/local/go/bin:${HOME}/.bun/bin:/usr/local/bin:${PATH}"
export BOXAI_APP_ROOT="$APP_ROOT"
ln -sfn "${APP_ROOT}/releases/${REF}" "${APP_ROOT}/current"
# Ensure infra compose is present even without --bootstrap
if [[ ! -f "${APP_ROOT}/docker-compose.infra.yml" ]]; then
  cp -f "${APP_ROOT}/releases/${REF}/deploy/docker-compose.infra.yml" "${APP_ROOT}/docker-compose.infra.yml"
else
  cp -f "${APP_ROOT}/releases/${REF}/deploy/docker-compose.infra.yml" "${APP_ROOT}/docker-compose.infra.yml"
fi
# Keep infra up; never use legacy app compose
cd "$APP_ROOT"
rm -f docker-compose.yml
# Ensure compose can start: derive POSTGRES_* from SQL_DSN when missing
python3 - <<PY
from pathlib import Path
import re
from urllib.parse import unquote

env_path = Path("${APP_ROOT}/.env")
text = env_path.read_text() if env_path.exists() else ""
vals = {}
for line in text.splitlines():
    if not line or line.lstrip().startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    vals[k.strip()] = v.strip().strip("'\"")

need = ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"]
missing = [k for k in need if not vals.get(k)]
if missing:
    dsn = vals.get("SQL_DSN", "")
    # postgresql://user:pass@host:port/db?...
    m = re.match(r"^postgres(?:ql)?://([^:/?#]+):([^@/]+)@[^/]+/([^?]+)", dsn)
    if not m:
        raise SystemExit(f"missing {missing} and cannot parse SQL_DSN for compose")
    user, password, db = unquote(m.group(1)), unquote(m.group(2)), unquote(m.group(3))
    derived = {
        "POSTGRES_USER": user,
        "POSTGRES_PASSWORD": password,
        "POSTGRES_DB": db,
    }
    with env_path.open("a") as f:
        if text and not text.endswith("\n"):
            f.write("\n")
        f.write("# Derived for docker-compose.infra.yml (boxai rename)\n")
        for k in need:
            if not vals.get(k):
                f.write(f"{k}={derived[k]}\n")
                print(f"ENV_ADDED {k}")
else:
    print("POSTGRES_ENV_OK")
PY
# Remove old container names so recreate picks boxai-* names (bind mounts keep data)
for c in boxai2-postgres boxai2-redis; do
  docker rm -f "$c" 2>/dev/null || true
done
docker compose -f docker-compose.infra.yml --env-file "${APP_ROOT}/.env" up -d
# Ensure systemd unit is current
cp -f "${APP_ROOT}/releases/${REF}/deploy/boxai.service" "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}.service"
# Build
bash "${APP_ROOT}/releases/${REF}/scripts/server/build-native.sh" "${APP_ROOT}/releases/${REF}"
# Ensure docker app is not holding the port
for c in boxai boxai2; do
  if docker ps -aq -f "name=^${c}$" | grep -q .; then
    docker stop "$c" 2>/dev/null || true
    docker rm -f "$c" 2>/dev/null || true
  fi
done
systemctl restart "${SERVICE_NAME}.service"
sleep 2
systemctl --no-pager --full status "${SERVICE_NAME}.service" | head -25
# Prune old releases (keep current + one previous)
python3 - <<PY
import os, shutil
from pathlib import Path
app_root = Path("${APP_ROOT}")
cur = (app_root / "current").resolve().name
rel = app_root / "releases"
entries = sorted([p for p in rel.iterdir() if p.is_dir()], key=lambda p: p.stat().st_mtime, reverse=True)
keep = set()
if cur:
    keep.add(cur)
for p in entries:
    if len(keep) >= 2:
        break
    keep.add(p.name)
for p in entries:
    if p.name not in keep:
        print(f"removing old release {p.name}")
        shutil.rmtree(p, ignore_errors=True)
print("KEEP_RELEASES", sorted(keep))
PY
# Drop obsolete app images (keep postgres/redis)
while read -r img; do
  echo "removing image $img"
  docker rmi -f "$img" 2>/dev/null || true
done < <(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^boxai-local:|^boxai2-local:|^ghcr.io/.*/boxai:' || true)
docker image prune -f >/dev/null 2>&1 || true
# Health
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/api/status | grep -q '"success"'; then
    echo "HEALTH_OK"
    exit 0
  fi
  sleep 1
done
echo "HEALTH_FAIL" >&2
journalctl -u "${SERVICE_NAME}" -n 50 --no-pager || true
exit 1
REMOTE

echo "==> public health"
if [[ -n "${BOXAI_BASE_URL:-}" ]]; then
  curl -fsS "${BOXAI_BASE_URL}/api/status" | head -c 200
  echo
fi
echo "DEPLOY_OK ${REF}"
