# Source Easy — Sourcing CRM App Blueprint

## 1. Purpose
A cross-border sourcing operation with an India office capturing leads and delivering to clients, and a China office sourcing products and returning cost and specs. The app tracks every handoff in one pipeline. App name: **Source Easy**. Domain: **sourceec.in**.

## 2. Tech Stack
- **Mobile**: Flutter for Android (sideloaded APK) with a modern Material 3 design
- **Web frontend**: Twenty's own React + TypeScript app (forked to embed Chatwoot widget), Chatwoot's Vue interface
- **Backend**: Twenty's Node.js + GraphQL/REST API; Chatwoot's Ruby on Rails API
- **Databases**: Twenty uses PostgreSQL; Chatwoot uses its own PostgreSQL with pgvector plus Redis
- Offline sync with local SQLite on mobile
- Push notifications via FCM
- Chatwoot embedded as a native chat screen in the Flutter app via Chatwoot's REST API (not a webview), tied to each sourcing request by ID

## 3. Three-Server Architecture
- **Server 1 — Source Easy App VPS** (4 cores, 8 GB RAM, ~$20-30/month): runs Twenty (Node.js, Postgres, Redis) in Docker, **internal only**, plus the Source Easy server (Fastify) that holds the Twenty API key, does role-based login and serves the web app and REST API on sourceec.in behind Caddy. India and China offices (web and Android) connect only to this server.
- **Server 2 — Chatwoot VPS** (4 cores, 8 GB RAM, ~$15-20/month): runs Chatwoot (Rails, Postgres with pgvector, Redis, Sidekiq) in Docker on chat.sourceec.in. Internal-only communication between India and China offices — no customer-facing WhatsApp or website widget.
- **Server 3 — Storage VPS** (1-2 cores, 2 GB RAM, ~$5/month): backup-only box in a different region/availability zone. No apps running. Receives nightly compressed pg_dump files from both app servers via SSH/rsync. Holds 7 daily + 4 weekly dumps. Serves a backup browser page showing timestamps and sizes to admins; download links visible to the super admin only. No restore button — restores stay CLI-only for safety.
- Coupling between servers 1 and 2 is webhook URLs only, over public internet or a private tunnel.
- Health-check script pings all three hourly and emails on failure.
- Restore = SSH to storage VPS, copy chosen dump back, psql restore on the target app server. Pausing writes during restore avoids losing post-dump records. Script it as a one-command restore with filename confirmation prompt.

## 4. Source Easy Custom Objects (Twenty)
- **Lead**: client name, contact, source channel, status, assigned office, Chatwoot conversation link
- **Sourcing Request**: product description, quantity, target price, deadline, assigned China agent, linked Chatwoot thread URL
- **Supplier**: name, phone, WeChat ID, notes (China-side only)
- **Quotation**: unit cost, total cost, currency (RMB or USD as quoted), exchange rate used, INR equivalent, validity date, PDF attachment
- **Client Approval**: status, approver, timestamp, notes
- **Shipping Order**: forwarder, tracking number, container type, ETD, ETA, customs status
- **Exchange Rate**: currency pair, rate, source, set by, date (admin-controlled)

## 5. Workflows (10 Steps)
1. India agent creates a Lead manually in Source Easy — client name, contact, product interest, quantity, target price
2. Lead assigned to a China agent; push notification sent through the app
3. China opens the Lead, creates a Sourcing Request, logs supplier names and sample statuses
4. India-China discussion happens in the linked Chatwoot thread (internal agents only)
5. Quotation created in RMB or USD; India sees INR conversion using the admin-set rate
6. India generates the quote PDF and shares it to the client via WhatsApp (phone share sheet), then logs the client's yes or no as a Client Approval record
7. On approval, shipping order created
8. China coordinates forwarder and booking
9. Tracking updates entered by China, read by India to update the client
10. Delivery confirmed, lead closed with win-loss reason

## 6. Roles and Permissions
- **India staff**: leads, customer details, quotations (INR view), approvals, shipping; not supplier details or raw supplier costs
- **China staff**: sourcing requests, supplier details, quotations, shipping; not customer details, client pricing or margins
- **Office admin (India or China)**: everything on their own office's side, plus user administration for that office
- **Super admin**: everything across both offices, exchange rates (super admin only), backup links
- Enforced server-side by the Source Easy server (record + field filtering per role, per-field write checks); Twenty is never exposed, so no paid row-level security is needed

## 7. Chatwoot Integration (Internal Only)
- Runs on its own VPS (Server 2), domain chat.sourceec.in
- Used solely as the conversation layer between India and China offices
- India opens a Chatwoot thread tagged with the Source Easy sourcing request ID
- China replies in that thread with supplier options and landed costs
- No customer-facing WhatsApp, no website widget, no Meta Cloud API
- No per-message fees since all agents are internal
- The sourcing request ID is stored on both the Twenty record and the Chatwoot conversation for cross-linking
- Native chat screen in Flutter app via Chatwoot REST API; push notifications for replies

## 8. Mobile App Screens
- Dashboard with pipeline summary
- Lead list with filters by office and status
- Lead detail with timeline of every handoff
- Sourcing request form for China
- Quotation view with currency toggle (RMB / USD / INR) and PDF share to WhatsApp
- Approval screen with accept and reject
- Shipping tracker with map
- Native Chatwoot chat screen via bottom tab or floating button on every screen
- Business card scanner for quick lead capture
- Offline mode queues changes and syncs when back online

## 9. Build Plan (7 Phases)
- **Phase 1** (weeks 1-2): Source Easy (Twenty) self-hosted on Server 1, custom objects, basic permissions, Docker Compose; Chatwoot on Server 2; storage VPS provisioned with SSH keys and backup cron
- **Phase 2** (weeks 3-4): Flutter app shell, auth, lead list and detail, GraphQL layer
- **Phase 3** (weeks 5-6): Sourcing and quotation screens, currency conversion, PDF generation and share
- **Phase 4** (week 7): Shipping tracker, native Chatwoot chat screen, push notifications, offline sync, APK distribution
- **Phase 5**: Testing with both offices
- **Phase 6**: Pilot with five real leads
- **Phase 7**: Iterate and harden

## 10. Decisions (resolved 2026-10-31)
See QUESTIONS.md. Summary: PDF quotes shared to WhatsApp manually; RMB/USD with admin-set INR rate; office-scoped visibility with super admin over all; no voice notes; sideloaded APK for everyone; backup downloads for super admin only.

## 11. License Notes
- Twenty core is AGPLv3 — free for internal commercial use across both offices
- Paid modules like row-level permissions: $19 per user per month even self-hosted
- Chatwoot is MIT — fully free and open source
