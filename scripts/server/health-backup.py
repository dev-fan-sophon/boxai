#!/usr/bin/env python3
"""Publish private host health and verified database backups to the backup bucket."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

import boto3

ROOT = Path('/opt/boxai')


def main():
    config = dict(line.split('=', 1) for line in (ROOT / 'backup.env').read_text().splitlines() if line and not line.startswith('#'))
    client = boto3.client('s3', endpoint_url=config['S3_ENDPOINT'], region_name='auto', aws_access_key_id=config['S3_ACCESS_KEY_ID'], aws_secret_access_key=config['S3_SECRET_ACCESS_KEY'])
    bucket = config['S3_BUCKET']
    pg = ['docker', 'run', '--rm', '--network', 'host', '--env-file', str(ROOT / 'postgres-client.env'), '-v', f'{ROOT}/ovh-postgres-ca.pem:{ROOT}/ovh-postgres-ca.pem:ro,z', 'postgres:18-alpine']
    if sys.argv[1] == 'backup':
        path = ROOT / 'backups' / (time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '.dump')
        with path.open('xb') as output:
            path.chmod(0o600)
            subprocess.run([*pg, 'pg_dump', '-Fc', '--no-owner', '--no-acl'], stdout=output, check=True)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        key = 'ovh/postgres/' + path.name
        client.upload_file(str(path), bucket, key, ExtraArgs={'Metadata': {'sha256': digest}})
        # Read back the uploaded object; metadata alone does not prove integrity.
        response = client.get_object(Bucket=bucket, Key=key)
        remote_hash = hashlib.sha256()
        for chunk in response['Body'].iter_chunks(1024 * 1024):
            remote_hash.update(chunk)
        response['Body'].close()
        if remote_hash.hexdigest() != digest:
            raise RuntimeError('Backup read-back checksum mismatch')
        (ROOT / 'backups' / 'last-success').write_text(str(int(time.time())))
        for old in (ROOT / 'backups').glob('*.dump'):
            if old.stat().st_mtime < time.time() - 7 * 86400:
                old.unlink()
        print('BACKUP_VERIFIED', key, path.stat().st_size, digest)
        return
    if sys.argv[1] != 'health':
        raise SystemExit('Expected backup or health')
    errors = []
    for name in ('boxai', 'boxai-chat', 'nginx', 'docker'):
        if subprocess.run(['systemctl', 'is-active', '--quiet', name]).returncode:
            errors.append(name + ' inactive')
    redis = subprocess.run(['docker', 'exec', 'boxai-redis', 'redis-cli', 'ping'], capture_output=True, text=True, timeout=15)
    if redis.returncode or redis.stdout.strip() != 'PONG':
        errors.append('Redis ping failed')
    database = subprocess.run([*pg, 'psql', '-Atc', 'SELECT 1'], capture_output=True, text=True, timeout=30)
    if database.returncode or database.stdout.strip() != '1':
        errors.append('PostgreSQL connection failed')
    disk = shutil.disk_usage(ROOT)
    if disk.free / disk.total < 0.15:
        errors.append('Disk free space below 15%')
    memory = {line.split(':')[0]: int(line.split()[1]) for line in Path('/proc/meminfo').read_text().splitlines()}
    if memory['MemAvailable'] / memory['MemTotal'] < 0.1:
        errors.append('Available memory below 10%')
    load = os.getloadavg()[1]
    if load > (os.cpu_count() or 1) * 1.5:
        errors.append('5-minute load exceeds 1.5 times CPU count')
    marker = ROOT / 'backups' / 'last-success'
    if not marker.exists() or time.time() - int(marker.read_text()) > 26 * 3600:
        errors.append('Verified backup older than 26 hours')
    data = {'timestamp': int(time.time()), 'errors': errors, 'disk_free_bytes': disk.free, 'memory_available_kib': memory['MemAvailable'], 'load5': load}
    client.put_object(Bucket=bucket, Key='ovh/monitor/heartbeat.json', Body=json.dumps(data).encode(), ContentType='application/json')
    print('HEALTH_PUBLISHED', 'healthy' if not errors else ', '.join(errors))


if __name__ == '__main__':
    main()
