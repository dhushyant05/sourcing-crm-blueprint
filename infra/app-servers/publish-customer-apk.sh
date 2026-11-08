#!/usr/bin/env bash
# Publish the CUSTOMER app APK (in.sourceeasy.customer) — never the staff app.
#   sudo ./publish-customer-apk.sh [--notes TEXT] [--min-build N] path/to/app-release.apk [version] [build]
# version/build default to customer_app/pubspec.yaml. Files: $DOWNLOADS_DIR/customer/source-easy-customer.apk + version.json.
# Served at /download/source-easy-customer.apk and /download/customer/version.json; the app verifies sha256 before installing.
set -euo pipefail
NOTES=${NOTES:-}; MIN_BUILD=${MIN_BUILD:-}
while [[ ${1:-} == --* ]]; do
  case $1 in --notes) NOTES=${2:?}; shift 2;; --min-build) MIN_BUILD=${2:?}; shift 2;; *) echo "unknown option $1" >&2; exit 1;; esac
done
[[ -z $MIN_BUILD || $MIN_BUILD =~ ^[0-9]+$ ]] || { echo "bad --min-build" >&2; exit 1; }
APK=${1:?usage: publish-customer-apk.sh <apk> [version] [build]}
DIR=${DOWNLOADS_DIR:-/opt/sourceeasy/downloads}/customer
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PV=$(sed -n 's/^version: *//p' "$ROOT/customer_app/pubspec.yaml" 2>/dev/null || true)
VERSION=${2:-${PV%%+*}}; BUILD=${3:-${PV#*+}}
[[ -f $APK && $(head -c 2 "$APK") == PK ]] || { echo "$APK is not an APK" >&2; exit 1; }
[[ $VERSION =~ ^[0-9]+(\.[0-9]+)*$ && $BUILD =~ ^[0-9]+$ ]] || { echo "bad version/build" >&2; exit 1; }
if command -v aapt >/dev/null; then aapt dump badging "$APK" | grep -q "package: name='in.sourceeasy.customer'" || { echo "not the customer app" >&2; exit 1; }; fi
mkdir -p "$DIR/archive"
SIZE=$(stat -c %s "$APK"); SHA=$(sha256sum "$APK" | cut -d' ' -f1)
[[ -f $DIR/source-easy-customer.apk ]] && cp -p "$DIR/source-easy-customer.apk" "$DIR/archive/source-easy-customer-$(date +%Y%m%d%H%M%S).apk"
cp "$APK" "$DIR/.apk.tmp" && chmod 644 "$DIR/.apk.tmp"
VERSION=$VERSION BUILD=$BUILD SIZE=$SIZE SHA=$SHA MIN_BUILD=$MIN_BUILD NOTES=$NOTES python3 - > "$DIR/.version.json.tmp" <<'PY'
import json, os, datetime
e = os.environ
m = {"version": e["VERSION"], "build": int(e["BUILD"]), "size": int(e["SIZE"]), "sha256": e["SHA"], "published": datetime.date.today().isoformat()}
if e.get("MIN_BUILD"): m["minBuild"] = int(e["MIN_BUILD"])
if e.get("NOTES"): m["notes"] = {"en": e["NOTES"]}
print(json.dumps(m))
PY
mv "$DIR/.apk.tmp" "$DIR/source-easy-customer.apk" && mv "$DIR/.version.json.tmp" "$DIR/version.json"
echo "Published customer app $VERSION ($BUILD) sha256 $SHA"
