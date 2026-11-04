#!/usr/bin/env bash
# Nightly local backup (cron 02:30): Source Easy Postgres (`sourceeasy`), api-data (uploads), downloads. Keeps 14 days.
# The retired Twenty database is not dumped any more; its final dump lives in $D/archive (never rotated).
set -euo pipefail
D=/opt/sourceeasy-backups; C=/opt/sourceeasy/infra/server1-twenty; ts=$(date +%Y%m%d-%H%M%S)
mkdir -p "$D"; cd "$C"
U=$(sed -n "s/^PG_DATABASE_USER=//p" .env)
docker compose exec -T db pg_dump -U "$U" -d sourceeasy --no-owner --clean --if-exists | gzip -9 > "$D/.se-db-$ts.sql.gz"
gzip -t "$D/.se-db-$ts.sql.gz" && zcat "$D/.se-db-$ts.sql.gz" | grep -q "CREATE TABLE public.leads" && mv "$D/.se-db-$ts.sql.gz" "$D/se-db-$ts.sql.gz"
docker compose exec -T api tar czf - -C /data . > "$D/.apidata-$ts.tar.gz"
gzip -t "$D/.apidata-$ts.tar.gz" && mv "$D/.apidata-$ts.tar.gz" "$D/apidata-$ts.tar.gz"
tar czf "$D/downloads-$ts.tar.gz" -C /opt/sourceeasy downloads
chmod 600 "$D"/*-$ts.*
find "$D" -maxdepth 1 -type f -mtime +14 -delete
echo "[$(date -Is)] ok $ts"; du -sh "$D"
