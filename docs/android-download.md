# Android app download

The website offers the staff Android app at **`/download`** (page with version, size, install steps, QR code on desktop; EN/中文).
Buttons: landing header, hero and footer, and the staff login page.

| URL | Served from |
|---|---|
| `/download/source-easy.apk` | `$DOWNLOADS_DIR/source-easy.apk` — `Content-Type: application/vnd.android.package-archive`, `Content-Disposition: attachment; filename="source-easy.apk"` |
| `/download/version.json` | `$DOWNLOADS_DIR/version.json` (`version`, `build`, `size`, `sha256`, `published`, `minAndroid`) |

`DOWNLOADS_DIR` defaults to **`/opt/sourceeasy/downloads`** — a persistent host folder (survives redeploys; include it in backups).
Mount it into the API container, e.g. `-v /opt/sourceeasy/downloads:/opt/sourceeasy/downloads:ro`.
Caddy just reverse-proxies; an optional direct `file_server` block is in `infra/app-servers/Caddyfile.sourceeasy.example`.
If nothing is published yet the page says so and the APK URL returns 404.

## Publishing a new version

```bash
cd mobile && flutter build apk --release          # bump `version:` in pubspec.yaml first
sudo infra/app-servers/publish-apk.sh mobile/build/app/outputs/flutter-apk/app-release.apk
# optional explicit version/build: publish-apk.sh <apk> 0.3.0 4
```

The script checks it is an APK, archives the previous one (keeps 5), copies atomically and rewrites `version.json`.
Installed apps update by installing the new APK over the old one (same signing key — keep `mobile/android/key.properties` + keystore safe).

## Release signing

`mobile/android/app/build.gradle.kts` reads key.properties from `$SOURCEEASY_KEY_PROPERTIES`, else `mobile/android/key.properties`
(git-ignored; on the build box it is a symlink to `/home/box/secrets/sourceeasy-key.properties`), else `android/app/key.properties`.
Without one, release builds are debug-signed. Keystore: `/home/box/secrets/sourceeasy-release.jks` (PKCS12, RSA 4096, alias `sourceeasy`,
cert SHA-256 `24a42d6330246eb320dccd95761b11c35bb57f03bcbc5cb9283387df0c63b855`). Back up the .jks and properties offline — losing them means
installed apps cannot be updated. Verify: `apksigner verify --print-certs app-release.apk`.
