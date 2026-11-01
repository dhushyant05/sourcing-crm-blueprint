#!/usr/bin/env bash
# Publish a new Source Easy Android APK to the website download volume.
#   sudo ./publish-apk.sh path/to/app-release.apk [version] [build]
# version/build default to mobile/pubspec.yaml ("version: X.Y.Z+N").
# Files: $DOWNLOADS_DIR/source-easy.apk + version.json (default /opt/sourceeasy/downloads).
# The API serves them at /download/source-easy.apk and /download/version.json (or Caddy directly, see Caddyfile.sourceeasy.example).
set -euo pipefail
APK=${1:?usage: publish-apk.sh <apk> [version] [build]}
DIR=${DOWNLOADS_DIR:-/opt/sourceeasy/downloads}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PV=$(sed -n 's/^version: *//p' "$ROOT/mobile/pubspec.yaml" 2>/dev/null || true)
VERSION=${2:-${PV%%+*}}; BUILD=${3:-${PV#*+}}
[[ -f $APK ]] || { echo "no such file: $APK" >&2; exit 1; }
[[ $(head -c 2 "$APK") == PK ]] || { echo "$APK is not an APK (zip) file" >&2; exit 1; }
[[ $VERSION =~ ^[0-9]+(\.[0-9]+)*$ ]] || { echo "bad version: $VERSION" >&2; exit 1; }
[[ $BUILD =~ ^[0-9]+$ ]] || BUILD=0
mkdir -p "$DIR/archive"
SIZE=$(stat -c %s "$APK"); SHA=$(sha256sum "$APK" | cut -d' ' -f1)
if [[ -f $DIR/source-easy.apk ]]; then cp -p "$DIR/source-easy.apk" "$DIR/archive/source-easy-$(date +%Y%m%d%H%M%S).apk"; fi
# Atomic swap: write temp files in the same dir, then rename.
cp "$APK" "$DIR/.source-easy.apk.tmp" && chmod 644 "$DIR/.source-easy.apk.tmp"
cat > "$DIR/.version.json.tmp" <<JSON
{"version":"$VERSION","build":$BUILD,"size":$SIZE,"sha256":"$SHA","published":"$(date +%Y-%m-%d)","minAndroid":"7.0"}
JSON
chmod 644 "$DIR/.version.json.tmp"
mv -f "$DIR/.source-easy.apk.tmp" "$DIR/source-easy.apk"
mv -f "$DIR/.version.json.tmp" "$DIR/version.json"
ls -1t "$DIR/archive"/*.apk 2>/dev/null | tail -n +6 | xargs -r rm -f   # keep the last 5
echo "published $VERSION ($BUILD), $SIZE bytes, sha256 $SHA -> $DIR"
