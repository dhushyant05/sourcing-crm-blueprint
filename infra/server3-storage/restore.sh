#!/usr/bin/env bash
# One-command restore, run on the storage VPS (server 3).
#   ./restore.sh twenty daily/twenty/twenty_20261031T204500Z.sql.gz
# Copies the dump to the target app server and restores it with psql inside the
# compose stack, after you re-type the filename to confirm. Writes are paused by
# stopping the app containers during the restore.
set -euo pipefail
CONF="${RESTORE_CONF:-/etc/source-easy/restore.env}"
# shellcheck source=/dev/null
[ -f "$CONF" ] && source "$CONF"
BACKUP_ROOT="${BACKUP_ROOT:-/srv/backups}"

app="${1:-}"; rel="${2:-}"
if [ -z "$app" ] || [ -z "$rel" ]; then
  echo "usage: $0 <twenty|chatwoot> <path-under-$BACKUP_ROOT>"
  echo "available:"; (cd "$BACKUP_ROOT" && ls -1 daily/*/*.sql.gz weekly/*/*.sql.gz 2>/dev/null)
  exit 1
fi
case "$app" in
  twenty)   host="${TWENTY_HOST:?}"; dir="${TWENTY_COMPOSE_DIR:?}"; svc=db;       db=default;  user="${TWENTY_DB_USER:-twenty}"; stop="server worker" ;;
  chatwoot) host="${CHATWOOT_HOST:?}"; dir="${CHATWOOT_COMPOSE_DIR:?}"; svc=postgres; db=chatwoot; user="${CHATWOOT_DB_USER:-chatwoot}"; stop="rails sidekiq" ;;
  *) echo "unknown app: $app"; exit 1 ;;
esac
file="$BACKUP_ROOT/$rel"
[ -f "$file" ] || { echo "not found: $file"; exit 1; }
gzip -t "$file" || { echo "dump is corrupt"; exit 1; }
name="$(basename "$file")"
case "$name" in "${app}_"*) ;; *) echo "file $name does not belong to $app"; exit 1 ;; esac

echo "About to OVERWRITE the $app database on $host with:"
echo "  $file ($(du -h "$file" | cut -f1), $(date -r "$file"))"
echo "App containers ($stop) will be stopped during the restore."
read -r -p "Type the filename ($name) to confirm: " answer
[ "$answer" = "$name" ] || { echo "confirmation mismatch, aborting"; exit 1; }

ssh_opts=(-o BatchMode=yes ${SSH_KEY:+-i "$SSH_KEY"})
echo "copying..."; scp "${ssh_opts[@]}" "$file" "$host:/var/tmp/$name"
echo "restoring..."
ssh "${ssh_opts[@]}" "$host" bash -s <<REMOTE
set -euo pipefail
cd "$dir"
docker compose stop $stop
gunzip -c "/var/tmp/$name" | docker compose exec -T $svc psql -v ON_ERROR_STOP=1 -U "$user" -d "$db"
docker compose start $stop
rm -f "/var/tmp/$name"
REMOTE
echo "restore of $app from $name complete"
