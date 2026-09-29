#!/usr/bin/env bash
# Start only the data services owned by this host. External PostgreSQL is never
# replaced by a local container during a release.
set -euo pipefail
APP_ROOT="${BOXAI_APP_ROOT:-/opt/boxai}"
services="$(python3 - "$APP_ROOT/.env" <<'PY'
import sys
from pathlib import Path
from urllib.parse import urlparse, unquote

path = Path(sys.argv[1])
text = path.read_text()
values = {}
for line in text.splitlines():
    if line.strip() and not line.lstrip().startswith('#') and '=' in line:
        key, value = line.split('=', 1)
        values[key.strip()] = value.strip().strip('\'"')
mode = values.get('BOXAI_POSTGRES_MODE', 'local')
dsn = urlparse(values.get('SQL_DSN', ''))
if mode == 'external':
    if dsn.scheme not in ('postgres', 'postgresql') or not dsn.hostname or dsn.hostname in ('localhost', '127.0.0.1', '::1', 'postgres'):
        raise SystemExit('External PostgreSQL requires a non-local PostgreSQL SQL_DSN')
    print('redis')
elif mode == 'local':
    required = {'POSTGRES_USER': unquote(dsn.username or ''),
                'POSTGRES_PASSWORD': unquote(dsn.password or ''),
                'POSTGRES_DB': unquote(dsn.path.lstrip('/'))}
    missing = {key: value for key, value in required.items() if not values.get(key)}
    if missing:
        if dsn.scheme not in ('postgres', 'postgresql') or not all(missing.values()):
            raise SystemExit('Local PostgreSQL requires POSTGRES_* or a PostgreSQL SQL_DSN')
        with path.open('a') as output:
            if text and not text.endswith('\n'):
                output.write('\n')
            for key, value in missing.items():
                if '\n' in value or '\r' in value:
                    raise SystemExit('Invalid multiline PostgreSQL setting')
                output.write(f"{key}='{value}'\n")
    print('postgres redis')
else:
    raise SystemExit('BOXAI_POSTGRES_MODE must be local or external')
PY
)"
read -r -a services <<< "$services"
docker compose -f "$APP_ROOT/docker-compose.infra.yml" --env-file "$APP_ROOT/.env" up -d "${services[@]}"
