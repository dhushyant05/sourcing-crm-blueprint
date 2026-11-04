#!/usr/bin/env bash
# Runs on server 1 (Twenty) and server 2 (Chatwoot) from cron, e.g.:
#   15 2 * * * /opt/source-easy/infra/app-servers/nightly-dump.sh >> /var/log/se-backup.log 2>&1
# Dumps the Postgres DB inside the compose stack, gzips it, and rsyncs it to server 3.
set -euo pipefail
CONF="${BACKUP_CONF:-/etc/source-easy/backup.env}"
# shellcheck source=/dev/null
[ -f "$CONF" ] && source "$CONF"
: "${APP_NAME:?APP_NAME (twenty|chatwoot) required}"
: "${COMPOSE_DIR:?COMPOSE_DIR required}"
: "${DB_SERVICE:=db}"
: "${DB_NAME:?DB_NAME required}"
: "${DB_USER:?DB_USER required}"
: "${STORAGE_HOST:?STORAGE_HOST required (user@host)}"
: "${STORAGE_DIR:=/srv/backups}"
: "${SSH_KEY:=$HOME/.ssh/id_ed25519_backup}"
: "${LOCAL_TMP:=/var/tmp/se-dumps}"

mkdir -p "$LOCAL_TMP"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
file="$LOCAL_TMP/${APP_NAME}_${ts}.sql.gz"

echo "[$(date -Is)] dumping $APP_NAME -> $file"
docker compose --project-directory "$COMPOSE_DIR" exec -T "$DB_SERVICE" \
  pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --clean --if-exists \
  | gzip -9 > "$file.partial"
gzip -t "$file.partial"
mv "$file.partial" "$file"

echo "[$(date -Is)] rsync to $STORAGE_HOST:$STORAGE_DIR/incoming/$APP_NAME/"
rsync -az --partial -e "ssh -i $SSH_KEY -o BatchMode=yes" \
  "$file" "$STORAGE_HOST:$STORAGE_DIR/incoming/$APP_NAME/"
rm -f "$file"
# Ask storage to file + rotate (key can be restricted to this command via authorized_keys).
ssh -i "$SSH_KEY" -o BatchMode=yes "$STORAGE_HOST" \
  "$STORAGE_DIR/../source-easy/infra/server3-storage/rotate.sh" "$APP_NAME" || \
  echo "rotation call failed (cron on storage will still rotate)"

# Optional: also archive the API data volume (users.db + enquiry attachments in /data/uploads).
# Set FILES_SERVICE=api (and FILES_PATH=/data) on server 1.
if [ -n "${FILES_SERVICE:-}" ]; then
  fapp="${APP_NAME}-files"; ffile="$LOCAL_TMP/${fapp}_${ts}.tar.gz"
  echo "[$(date -Is)] archiving $FILES_SERVICE:${FILES_PATH:-/data} -> $ffile"
  docker compose --project-directory "$COMPOSE_DIR" exec -T "$FILES_SERVICE" \
    tar czf - -C "${FILES_PATH:-/data}" . > "$ffile.partial"
  gzip -t "$ffile.partial"
  mv "$ffile.partial" "$ffile"
  rsync -az --partial -e "ssh -i $SSH_KEY -o BatchMode=yes" "$ffile" "$STORAGE_HOST:$STORAGE_DIR/incoming/$fapp/"
  rm -f "$ffile"
  ssh -i "$SSH_KEY" -o BatchMode=yes "$STORAGE_HOST" \
    "$STORAGE_DIR/../source-easy/infra/server3-storage/rotate.sh" "$fapp" || echo "rotation call failed for $fapp"
fi
echo "[$(date -Is)] done"
