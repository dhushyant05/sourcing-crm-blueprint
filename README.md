# Source Easy

A sourcing CRM for an India ↔ China trading business. India staff capture **leads** from customers. China staff turn them into **sourcing requests**, find **suppliers** and post **quotations** in RMB/USD. India converts the quotes to INR, shares a PDF quote on WhatsApp, records the **client approval**, and both offices track the **shipping order**.

The spec is in [BLUEPRINT.md](BLUEPRINT.md) and the decisions are in [QUESTIONS.md](QUESTIONS.md).

```
             ┌──────────── Server 1 ────────────┐   ┌──────── Server 2 ────────┐
Android app ─┤ Caddy → Twenty (GraphQL CRM)      │   │ Caddy → Chatwoot (chat)  │
 (Flutter)   │         Postgres 16 · Redis       │   │  Postgres(pgvector)·Redis│
             └───────────────┬──────────────────┘   └────────────┬─────────────┘
                             │ nightly pg_dump + rsync            │
                             ▼                                    ▼
                     ┌──────────── Server 3 (storage) ────────────────┐
                     │ rotation 7 daily / 4 weekly · restore.sh       │
                     │ hourly healthcheck → email · backup browser    │
                     └────────────────────────────────────────────────┘
```

| Folder | What's in it |
|---|---|
| `infra/server1-twenty/` | Docker Compose for Twenty (server and worker), Postgres, Redis and Caddy (TLS) |
| `infra/server2-chatwoot/` | Docker Compose for Chatwoot (rails and sidekiq), pgvector Postgres, Redis and Caddy |
| `infra/app-servers/` | `nightly-dump.sh`, which runs on servers 1 and 2 |
| `infra/server3-storage/` | `rotate.sh`, `restore.sh`, `healthcheck.sh`, a crontab, and the `backup-browser/` web page |
| `twenty-setup/` | A metadata API script that creates the custom objects |
| `mobile/` | The Flutter Android app (Material 3) |

No secrets are in git. Every `*.example` file has to be copied and filled in on the server.

---

## 1. Server 1: Twenty

```bash
cd infra/server1-twenty
cp .env.example .env
# Set the domain, then generate the secrets:
#   openssl rand -base64 32   → APP_SECRET, PG_DATABASE_PASSWORD
docker compose up -d
docker compose logs -f server      # wait for "Nest application successfully started"
```

Point DNS for `TWENTY_DOMAIN` at the server first, so Caddy can get a certificate. Then open `https://<domain>`, create the workspace and the first (super admin) user, and create an API key under **Settings → APIs & Webhooks**.

Postgres listens on `127.0.0.1` only. It is reached for dumps through `docker compose exec`.

## 2. Server 2: Chatwoot

```bash
cd infra/server2-chatwoot
cp .env.example .env               # SECRET_KEY_BASE (openssl rand -hex 64), passwords, domain, SMTP
docker compose run --rm rails bundle exec rails db:chatwoot_prepare
docker compose up -d
```

1. Create the admin account. Signup is off (`ENABLE_ACCOUNT_SIGNUP=false`), so invite every staff member as an agent.
2. Create an **API** inbox called "Source Easy internal". Note its **inbox ID** and the **account ID**, which is in the URL.
3. Each user copies their **access token** from *Profile settings* into the app (*Settings → Chatwoot*).

Each sourcing request gets one conversation, tagged with the custom attribute `sourcing_request_id`.

## 3. Create the Twenty objects

```bash
cd twenty-setup
python3 setup_twenty.py --dry-run                                  # prints the plan
TWENTY_URL=https://crm.example.com TWENTY_API_KEY=... python3 setup_twenty.py
python3 -m unittest test_setup.py
```

The script is idempotent, so you can re-run it safely. It creates:

- **Lead**, **Sourcing Request**, **Supplier**, **Quotation**, **Client Approval**, **Shipping Order** and **Exchange Rate**
- **Team Member**, which maps a login email to an app role

Every object gets an `office` select (INDIA / CHINA / BOTH) and a `clientRef` text field, which is used for offline idempotency. Relations are MANY_TO_ONE (for example, Quotation → Sourcing Request and Supplier). The full schema is in `schema.json`.

### Roles

Add one **Team Member** record per user in Twenty. Its `email` must match the user's Twenty login. Set `role` to one of the values below.

| Role | Sees |
|---|---|
| `INDIA_STAFF` | Customers and leads, and quotes in INR only. No supplier names or costs. |
| `CHINA_STAFF` | Suppliers and raw RMB/USD costs. Customer contact details are hidden. |
| `INDIA_ADMIN` / `CHINA_ADMIN` | Their own side, plus exchange rates. |
| `SUPER_ADMIN` | Everything, including backup downloads. |

A user with no Team Member record cannot sign in to the app.

> **Important:** this visibility is enforced in the app, which only queries the allowed fields. Twenty does not yet have field-level permissions. Anyone with Twenty web access and broad permissions can still see everything. To limit that, give staff the app only, or set up Twenty roles/views filtered on `office`.

### Exchange rates

Prices are stored **as quoted** (RMB or USD). India views are converted to INR.

- An admin sets the rate in the app (*Settings → Exchange rates*). Each change is saved as a new `Exchange Rate` row with `manual = true`.
- The newest rate wins. On the same day, a manual override beats an automatic rate.
- Each quotation snapshots the rate it used (`exchangeRateUsed`), so old quotes don't change when the rate does.
- Until a rate exists, the app falls back to 11.8 INR/RMB and 84 INR/USD.

---

## 4. Backups (server 3)

### On servers 1 and 2

Copy `infra/app-servers/` to the server, then:

```bash
cp backup.env.example backup.env        # APP=twenty|chatwoot, compose dir, storage host, ssh key
crontab -e
#   30 2 * * * /opt/source-easy/app-servers/nightly-dump.sh >> /var/log/se-backup.log 2>&1
```

The script does the following, in order:

1. Runs `pg_dump` and compresses the output with gzip.
2. Checks the archive with `gzip -t`.
3. Uses `rsync` to copy it to `storage:/srv/backups/incoming/<app>/`.
4. Triggers `rotate.sh` on the storage server.

Use a dedicated SSH key, and restrict it in `authorized_keys` on server 3.

### On server 3

```bash
cd infra/server3-storage
cp health.env.example health.env       # URLs to check, ALERT_EMAIL, thresholds
cp restore.env.example restore.env
crontab crontab.example                # hourly healthcheck (rotation is triggered by the app servers)
```

- **Rotation** keeps 7 daily dumps, plus 4 weekly dumps (Sunday copies).
- **Health check** (hourly) checks HTTP on all three servers, free disk space, and the age of the newest backup. It emails `ALERT_EMAIL` through `sendmail` when a check fails, so install `msmtp-mta` or `postfix`.
- **Restore** is one command:
  ```bash
  ./restore.sh twenty daily/twenty-2026-10-30.sql.gz
  ```
  You must re-type the filename to confirm. The script stops the app containers, loads the dump through ssh/psql, and then starts the containers again.

### Backup browser

`backup-browser/app.py` is a single-file Python web page that uses the standard library only.

- Only admin roles can sign in. **Only `super_admin` sees download links.** `/download` also checks the role and only serves files from a whitelist.
- Setup:
  ```bash
  python3 app.py hash-password             # make password hashes for users.json
  cp users.example.json users.json && $EDITOR users.json
  sudo cp source-easy-backups.service /etc/systemd/system/ && sudo systemctl enable --now source-easy-backups
  ```
  Put it behind Caddy for TLS (see `Caddyfile.example`).
- Tests: `python3 -m unittest test_app.py`

---

## 5. Mobile app (Android, sideloaded)

The app is Flutter 3.35 with Material 3 and requires Android 6.0 (API 23) or newer.

```bash
cd mobile
flutter pub get
flutter analyze
flutter test
flutter build apk --release      # → build/app/outputs/flutter-apk/app-release.apk
```

To install it, run `adb install app-release.apk`, or send the APK to the phone and allow "install unknown apps".

**Signing.** If there is no keystore, the release build is signed with the debug key. That works for sideloading, but you can't upgrade over it with a differently signed build later. For real distribution, create a key once and keep it **out of git**:

```bash
keytool -genkey -v -keystore ~/source-easy.jks -keyalg RSA -keysize 2048 -validity 10000 -alias source-easy
cat > android/app/key.properties <<P
storeFile=/home/you/source-easy.jks
storePassword=...
keyAlias=source-easy
keyPassword=...
P
```

**First run.** On the sign-in screen, enter the Twenty URL, email and password. Then enter the Chatwoot details under *Settings → Chatwoot*. The tokens are kept in Android encrypted storage.

### Screens

- Dashboard: pipeline counts by stage
- Leads: list, detail with timeline, and create
- Sourcing request form
- Quotation:
  - RMB / USD / INR toggle, limited by role
  - The client price is set in INR
  - **PDF quote → Android share sheet → WhatsApp**, with no WhatsApp API
- Client approval: accepting a quote creates a shipping order
- Shipping tracker: stage stepper, map of the current location, and editing for China
- Chat over the Chatwoot REST API: one conversation per sourcing request, polled every 10 s
- Settings:
  - profile and role
  - sync queue with "Sync now"
  - exchange rates (admins)
  - Chatwoot configuration
  - backups note (super admin)
  - sign out

### Offline

- Reads are cached in SQLite and served from the cache when there's no connection.
- Writes made offline go into a SQLite queue and are marked "pending".
- The queue replays in order when the connection returns, or when you tap "Sync now".
- Each create carries a `clientRef`. If a replay finds a record with that ref already exists, it skips the create, so nothing is duplicated.

### Code layout

```
lib/core/       roles.dart (Role, Permissions), currency.dart (RateTable, formatting)
lib/data/api/   twenty_client.dart (GraphQL), twenty_auth.dart, chatwoot_client.dart
lib/data/       models/, offline/offline_queue.dart, repository.dart (the single data API for the UI)
lib/services/   session.dart (login, config, sync), quote_pdf.dart
lib/ui/         home_shell.dart, screens/, widgets/
```

## Known limitations / TODO

- Role visibility is enforced in the app only (see Roles above).
- A sourcing request created offline can't have suppliers attached until it has synced.
- Push notifications (FCM) and the business-card scanner are not built yet.
- The names of Twenty's login mutations have changed between versions. `twenty_auth.dart` targets current releases, so adjust it if your Twenty version differs.
- Chat polls every 10 s instead of using websockets. "My" messages are matched by sender name.
- The quote PDF uses the built-in Helvetica font, which has no ₹ glyph, so amounts are printed as "INR 1,234.00". To show ₹, bundle a TTF such as Noto Sans.
- Nothing has been tested against live Twenty or Chatwoot servers yet. The automated tests use mocked HTTP.
