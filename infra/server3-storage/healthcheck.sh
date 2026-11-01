#!/usr/bin/env bash
# Hourly health check (cron on server 3):
#   0 * * * * /opt/source-easy/infra/server3-storage/healthcheck.sh
# Pings server 1 + 2 over HTTPS, checks server 3 disk and backup freshness, emails on failure.
set -uo pipefail
CONF="${HEALTH_CONF:-/etc/source-easy/health.env}"
# shellcheck source=/dev/null
[ -f "$CONF" ] && source "$CONF"
TWENTY_URL="${TWENTY_URL:-https://sourceeasy.in/healthz}"
CHATWOOT_URL="${CHATWOOT_URL:-https://chat.sourceeasy.in/api}"
BACKUP_ROOT="${BACKUP_ROOT:-/srv/backups}"
BROWSER_URL="${BROWSER_URL:-http://127.0.0.1:8088/healthz}"
MAX_BACKUP_AGE_H="${MAX_BACKUP_AGE_H:-26}"
DISK_MAX_PCT="${DISK_MAX_PCT:-90}"
ALERT_TO="${ALERT_TO:?ALERT_TO required}"
ALERT_FROM="${ALERT_FROM:-healthcheck@sourceeasy.in}"

fail=()
check_url() { curl -fsS -m 15 -o /dev/null "$2" || fail+=("$1 unreachable: $2"); }
check_url "Server 1 (Twenty)" "$TWENTY_URL"
check_url "Server 2 (Chatwoot)" "$CHATWOOT_URL"
check_url "Server 3 (backup browser)" "$BROWSER_URL"

pct="$(df -P "$BACKUP_ROOT" | awk 'NR==2{gsub("%","",$5);print $5}')"
[ "${pct:-100}" -lt "$DISK_MAX_PCT" ] || fail+=("Server 3 disk at ${pct}%")

for app in twenty chatwoot; do
  newest="$(find "$BACKUP_ROOT/daily/$app" -name '*.sql.gz' -mmin -$((MAX_BACKUP_AGE_H*60)) 2>/dev/null | head -1)"
  [ -n "$newest" ] || fail+=("No $app backup newer than ${MAX_BACKUP_AGE_H}h")
done

if [ ${#fail[@]} -gt 0 ]; then
  body="Source Easy health check failed at $(date -Is) on $(hostname):"$'\n'
  for f in "${fail[@]}"; do body+=" - $f"$'\n'; done
  echo "$body"
  # Uses the system sendmail (configure msmtp or postfix as a relay).
  { printf 'To: %s\nFrom: %s\nSubject: [Source Easy] health check FAILED\n\n%s\n' \
      "$ALERT_TO" "$ALERT_FROM" "$body"; } | ${SENDMAIL:-/usr/sbin/sendmail} -t
  exit 1
fi
echo "[$(date -Is)] all checks ok"
