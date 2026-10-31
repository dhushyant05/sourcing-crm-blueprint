# Source Easy — Sourcing CRM App Blueprint

## 1. Purpose
A cross-border sourcing operation with an India office capturing leads and delivering to clients, and a China office sourcing products and returning cost and specs. The app tracks every handoff in one pipeline. App name: **Source Easy**. Domain: **sourceec.in**.

## 2. Tech Stack
- **Mobile**: Flutter for iOS and Android with a modern Material 3 design
- **Web frontend**: Twenty's own React + TypeScript app (forked to embed Chatwoot widget), Chatwoot's Vue interface
- **Backend**: Twenty's Node.js + GraphQL/REST API; Chatwoot's Ruby on Rails API
- **Databases**: Twenty uses PostgreSQL; Chatwoot uses its own PostgreSQL with pgvector plus Redis
- Offline sync with local SQLite on mobile
- Push notifications via FCM
- Chatwoot embedded as a native chat screen in the Flutter app via Chatwoot's REST API (not a webview), tied to each sourcing request by ID

## 3. Three-Server Architecture
- **Server 1 — Source Easy App VPS** (4 cores, 8 GB RAM, ~$20-30/month): runs Twenty (Node.js, Postgres, Redis) in Docker. Serves the CRM web app and API on sourceec.in. India and China offices connect here.
- **Server 2 — Chatwoot VPS** (4 cores, 8 GB RAM, ~$15-20/month): runs Chatwoot (Rails, Postgres with pgvector, Redis, Sidekiq) in Docker on its own domain like chat.sourceec.in. Internal-only communication between India and China offices — no customer-facing WhatsApp or website widget.
- **Server 3 — Storage VPS** (1-2 cores, 2 GB RAM, ~$5/month): backup-only box in a different region/availability zone. No apps running. Receives nightly compressed pg_dump files from both app servers via SSH/rsync. Holds 7 daily + 4 weekly dumps. Serves a read-only backup browser page (timestamps, sizes, download links) but has no restore button — restores stay CLI-only for safety.
- Coupling between servers 1 and 2 is webhook URLs only, over public internet or a private tunnel.
- Health-check script pings all three hourly and emails on failure.
- Restore = SSH to storage VPS, copy chosen dump back, psql restore on the target app server. Pausing writes during restore avoids losing post-dump records. Script it as a one-command restore with filename confirmation prompt.

## 4. Source Easy Custom Objects (Twenty)
- **Lead**: client name, contact, source channel, status, assigned office, Chatwoot conversation link
- **Sourcing Request**: product description, quantity, target price, deadline, assigned China agent, linked Chatwoot thread URL
- **Quotation**: unit cost, total cost, currency, validity date, PDF attachment
- **Client Approval**: status, approver, timestamp, notes
- **Shipping Order**: forwarder, tracking number, container type, ETD, ETA, customs status

## 5. Workflows (10 Steps)
1. India agent creates a Lead manually in Source Easy — client name, contact, product interest, quantity, target price
2. Lead assigned to a China agent; push notification sent through the app
3. China opens the Lead, creates a Sourcing Request, logs supplier names and sample statuses
4. India-China discussion happens in the linked Chatwoot thread (internal agents only)
5. Quotation created in yuan or dollars, converted to rupees for display
6. India shares quote with client by phone or usual channel, logs client's yes or no as a Client Approval record
7. On approval, shipping order created
8. China coordinates forwarder and booking
9. Tracking updates entered by China, read by India to update the client
10. Delivery confirmed, lead closed with win-loss reason

## 6. Roles and Permissions
- **India role**: leads, quotations, approvals, shipping; not raw China supplier costs
- **China role**: sourcing requests, quotations, shipping; not client pricing or margins
- **Admin**: everything
- Approximate separation using custom office tags and filtered views (row-level security is a paid module at $19/user/month)

## 7. Chatwoot Integration (Internal Only)
- Runs on its own VPS (Server 2), domain chat.sourceec.in
- Used solely as the conversation layer between India and China offices
- India opens a Chatwoot thread tagged with the Source Easy sourcing request ID
- China replies in that thread with supplier options and landed costs
- No customer-facing WhatsApp, no website widget, no Meta Cloud API
- No per-message fees since all agents are internal
- The sourcing request ID is stored on both the Twenty record and the Chatwoot conversation for cross-linking
- Native chat screen in Flutter app via Chatwoot REST API; push notifications for replies
- Captain AI assistant V1 retired; not needed for internal use

## 8. Mobile App Screens
- Dashboard with pipeline summary
- Lead list with filters by office and status
- Lead detail with timeline of every handoff
- Sourcing request form for China
- Quotation view with currency toggle
- Approval screen with accept and reject
- Shipping tracker with map
- Native Chatwoot chat screen via bottom tab or floating button on every screen
- Business card scanner for quick lead capture
- Offline mode queues changes and syncs when back online

## 9. Build Plan (7 Phases)
- **Phase 1** (weeks 1-2): Source Easy (Twenty) self-hosted on Server 1, custom objects, basic permissions, Docker Compose; Chatwoot on Server 2; storage VPS provisioned with SSH keys and backup cron
- **Phase 2** (weeks 3-4): Flutter app shell, auth, lead list and detail, GraphQL layer
- **Phase 3** (weeks 5-6): Sourcing and quotation screens, currency conversion, PDF generation
- **Phase 4** (week 7): Shipping tracker, native Chatwoot chat screen, push notifications, offline sync
- **Phase 5**: Testing with both offices
- **Phase 6**: Pilot with five real leads
- **Phase 7**: Iterate and harden

## 10. Open Questions (Revised)
1. Should client quotes go out as an auto-generated PDF, or should India staff paste details into WhatsApp manually?
2. Which currency should display by default for each office — rupees for India, yuan for China, or a single global default? Who controls the exchange rate source?
3. Should China agents see raw supplier contact details inside the app, or only through a separate channel?
4. Do we need voice-note capture for factory visits and supplier calls?
5. Who owns user-account administration day to day — one trusted admin per office or a single global admin?
6. Sideload the APK for China staff, or publish to the Play Store and App Store?
7. Should the read-only backup browser page show download links or only metadata?

## 11. License Notes
- Twenty core is AGPLv3 — free for internal commercial use across both offices
- Paid modules like row-level permissions: $19 per user per month even self-hosted
- Chatwoot is MIT — fully free and open source
