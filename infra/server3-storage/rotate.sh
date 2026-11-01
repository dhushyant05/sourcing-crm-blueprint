#!/usr/bin/env bash
# Files incoming dumps into daily/ and weekly/ and prunes: keep 7 daily, 4 weekly.
# Usage: rotate.sh [twenty|twenty-files|chatwoot]   (no arg = all apps)
# Cron on storage as a safety net:  45 3 * * * /opt/source-easy/infra/server3-storage/rotate.sh
set -euo pipefail
BACKUP_ROOT="${BACKUP_ROOT:-/srv/backups}"
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"
WEEKLY_DOW="${WEEKLY_DOW:-7}"   # ISO day of week for the weekly copy (7 = Sunday)

apps=("$@"); [ ${#apps[@]} -eq 0 ] && apps=(twenty twenty-files chatwoot)

prune() { # dir keep
  local dir="$1" keep="$2"
  # newest first; delete beyond $keep
  find "$dir" -maxdepth 1 -type f -name '*.gz' -printf '%f\n' | sort -r | tail -n +$((keep+1)) |
    while read -r f; do echo "prune $dir/$f"; rm -f -- "$dir/$f"; done
}

for app in "${apps[@]}"; do
  in="$BACKUP_ROOT/incoming/$app"; daily="$BACKUP_ROOT/daily/$app"; weekly="$BACKUP_ROOT/weekly/$app"
  mkdir -p "$in" "$daily" "$weekly"
  shopt -s nullglob
  for f in "$in"/*.gz; do
    if ! gzip -t "$f" 2>/dev/null; then echo "corrupt: $f (left in incoming)"; continue; fi
    base="$(basename "$f")"
    mv "$f" "$daily/$base"
    # Filename is <app>_YYYYmmddTHHMMSSZ.sql.gz (or .tar.gz for uploaded files)
    d="$(echo "$base" | sed -E 's/.*_([0-9]{8})T.*/\1/')"
    if [ "$(date -u -d "$d" +%u 2>/dev/null || echo 0)" = "$WEEKLY_DOW" ]; then
      cp -p "$daily/$base" "$weekly/$base"; echo "weekly copy $base"
    fi
  done
  # Guarantee at least one weekly exists per ISO week even if Sunday's dump was missed.
  latest="$(ls -1 "$daily" 2>/dev/null | sort -r | head -1 || true)"
  if [ -n "$latest" ]; then
    wk="$(date -u +%G%V)"
    have=0
    for w in "$weekly"/*.gz; do
      wd="$(basename "$w" | sed -E 's/.*_([0-9]{8})T.*/\1/')"
      [ "$(date -u -d "$wd" +%G%V)" = "$wk" ] && have=1
    done
    [ "$(date -u +%u)" = "$WEEKLY_DOW" ] && [ $have -eq 0 ] && cp -p "$daily/$latest" "$weekly/$latest"
  fi
  prune "$daily" "$KEEP_DAILY"
  prune "$weekly" "$KEEP_WEEKLY"
done
