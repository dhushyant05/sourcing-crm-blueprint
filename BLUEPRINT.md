# Source Easy — Sourcing CRM App Blueprint

## 1. Purpose
A cross-border sourcing operation with an India office capturing leads and delivering to clients, and a China office sourcing products and returning cost and specs. The app tracks every handoff in one pipeline. App name: **Source Easy**. Domain: **sourceec.in**.

Customers now have a dedicated portal (login) where they can raise requests and track progress. Staff continue to use the internal Twenty + Flutter apps.

## 2. Tech Stack
- **Mobile**: Flutter for Android (sideloaded APK) with a modern Material 3 design (staff)
- **Customer Portal**: Web app (React/Next.js or Twenty custom views + auth) + optional Flutter customer app later. Separate login from staff.
- **Web frontend**: Twenty's own React + TypeScript app (forked to embed Chatwoot widget), Chatwoot's Vue interface
- **Backend**: Twenty's Node.js + GraphQL/REST API; Chatwoot's Ruby on Rails API
- **Databases**: Twenty uses PostgreSQL; Chatwoot uses its own PostgreSQL with pgvector plus Redis
- Offline sync with local SQLite on mobile (staff)
- Push notifications via FCM
- Chatwoot embedded as a native chat screen in the Flutter app via Chatwoot's REST API (not a webview), tied to each sourcing request by ID

## 3. Three-Server Architecture
- **Server 1 — Source Easy App VPS** (4 cores, 8 GB RAM, ~$20-30/month): runs Twenty (Node.js, Postgres, Redis) in Docker. Serves the CRM web app and API on sourceec.in. India and China offices connect here. Also serves the customer portal.
- **Server 2 — Chatwoot VPS** (4 cores, 8 GB RAM, ~$15-20/month): runs Chatwoot (Rails, Postgres with pgvector, Redis, Sidekiq) in Docker on chat.sourceec.in. Internal-only communication between India and China offices — no customer-facing WhatsApp or website widget.
- **Server 3 — Storage VPS** (1-2 cores, 2 GB RAM, ~$5/month): backup-only box in a different region/availability zone. No apps running. Receives nightly compressed pg_dump files from both app servers via SSH/rsync. Holds 7 daily + 4 weekly dumps. Serves a backup browser page showing timestamps and sizes to admins; download links visible to the super admin only. No restore button — restores stay CLI-only for safety.
- Coupling between servers 1 and 2 is webhook URLs only, over public internet or a private tunnel.
- Health-check script pings all three hourly and emails on failure.
- Restore = SSH to storage VPS, copy chosen dump back, psql restore on the target app server. Pausing writes during restore avoids losing post-dump records. Script it as a one-command restore with filename confirmation prompt.

## 4. Source Easy Custom Objects (Twenty)
- **Customer**: name, email, phone, company, login credentials (or linked auth), preferred currency, status
- **Lead**: customer (relation), product description, quantity, target price, product photo/video attachments, source channel, status, assigned office, Chatwoot conversation link
- **Sourcing Request**: linked to Lead (and optionally Customer), product description, quantity, target price, deadline, assigned China agent, linked Chatwoot thread URL, status. Can transition to Shipping phase.
- **Shipping Request** (new): raised by Customer or India team. Linked to Sourcing Request (optional) or standalone. Contains: product/order reference, quantity, shipping method preference, destination, special instructions, attachments (photos/docs), status, assigned India agent.
- **Supplier**: name, phone, WeChat ID, notes (China-side only)
- **Quotation**: unit cost, total cost, currency (RMB or USD as quoted), exchange rate used, INR equivalent, validity date, PDF attachment, linked to Sourcing Request
- **Client Approval**: status, approver, timestamp, notes (can be triggered from customer portal or staff)
- **Shipping Order**: forwarder, tracking number, container type, ETD, ETA, customs status, linked to Shipping Request or Sourcing Request
- **Exchange Rate**: currency pair, rate, source, set by, date (admin-controlled)
- **Order Tracking Event**: timestamp, status, note, visible_to_customer (boolean), linked to Sourcing Request or Shipping Request

## 5. Workflows

### Customer-Initiated Flow
1. Customer logs into the portal.
2. Customer creates a **Lead** (or directly a Sourcing Request / Shipping Request). Lead can include product photo or video.
3. For **Sourcing Request**:
   - Assigned to India team for review, then to China agent.
   - Follows existing India-China sourcing, quotation, approval flow.
   - On approval / quotation acceptance, it can be linked / transitioned to a **Shipping Request** or Shipping Order.
4. For **Shipping Request**:
   - Customer raises it (with order details, attachments).
   - Automatically or manually assigned to India team.
   - India team processes (coordinates with China if needed, books forwarder, updates tracking).
   - Tracking events are pushed and visible to the customer in real time (or near-real-time).
5. Customer can view a timeline of all their Sourcing Requests and Shipping Requests, with status, key dates, quotations (sanitized), and tracking events.

### Staff Flow (updated)
- India staff can still create Leads manually (existing).
- Sourcing Request remains linked to Lead and can explicitly link to a subsequent Shipping Request/Order.
- Shipping Request is a first-class object that can be raised by customer or staff.

## 6. Roles and Permissions
- **Customer**: own portal only. Can create Leads / Sourcing Requests / Shipping Requests for themselves. Can view and track only their own requests and related tracking events. Cannot see supplier costs, internal notes, or other customers.
- **India staff**: leads, customer details, quotations (INR view), approvals, shipping requests & orders; not supplier details or raw supplier costs
- **China staff**: sourcing requests, supplier details, quotations, shipping (limited); not customer details, client pricing or margins
- **Office admin (India or China)**: everything on their own office's side, plus user administration for that office
- **Super admin**: everything across both offices, exchange rates, backup downloads, customer account management
- Approximate separation using custom office tags and filtered views (row-level security is a paid module at $19/user/month). Customer data isolation is enforced via ownership filters.

## 7. Chatwoot Integration (Internal Only)
- Runs on its own VPS (Server 2), domain chat.sourceec.in
- Used solely as the conversation layer between India and China offices
- India opens a Chatwoot thread tagged with the Source Easy sourcing request ID
- China replies in that thread with supplier options and landed costs
- No customer-facing WhatsApp, no website widget, no Meta Cloud API
- No per-message fees since all agents are internal
- The sourcing request ID is stored on both the Twenty record and the Chatwoot conversation for cross-linking
- Native chat screen in Flutter app via Chatwoot REST API; push notifications for replies

## 8. Screens

### Staff (Flutter + Twenty Web)
- Dashboard with pipeline summary
- Lead list with filters by office and status
- Lead detail with timeline of every handoff
- Sourcing request form for China
- Quotation view with currency toggle (RMB / USD / INR) and PDF share to WhatsApp
- Approval screen with accept and reject
- Shipping tracker with map
- Shipping Request list and detail (new)
- Native Chatwoot chat screen via bottom tab or floating button on every screen
- Business card scanner for quick lead capture
- Offline mode queues changes and syncs when back online

### Customer Portal (Web)
- Login / Register (email + password or magic link)
- Dashboard: list of my Sourcing Requests and Shipping Requests with status badges
- Create Lead / Sourcing Request form (with photo/video upload)
- Create Shipping Request form
- Request detail page: timeline of tracking events, status history, linked documents (quotes visible after approval, sanitized)
- Tracking view for both request types
- Profile / settings

## 9. Build Plan (updated phases)
- **Phase 1** (weeks 1-2): Source Easy (Twenty) self-hosted on Server 1, custom objects (including Customer, Shipping Request, Tracking Event), basic permissions, Docker Compose; Chatwoot on Server 2; storage VPS provisioned with SSH keys and backup cron
- **Phase 2** (weeks 3-4): Flutter staff app shell, auth, lead list and detail, GraphQL layer
- **Phase 3** (weeks 5-6): Sourcing and quotation screens, currency conversion, PDF generation and share; Sourcing → Shipping linkage
- **Phase 4** (week 7): Shipping tracker, Shipping Request handling, native Chatwoot chat screen, push notifications, offline sync, APK distribution
- **Phase 5**: Customer portal (auth, create requests, tracking views)
- **Phase 6**: Testing with both offices + pilot customers
- **Phase 7**: Pilot with five real leads / requests
- **Phase 8**: Iterate and harden

## 10. Decisions (resolved 2026-10-31)
See QUESTIONS.md. Summary: PDF quotes shared to WhatsApp manually; RMB/USD with admin-set INR rate; office-scoped visibility with super admin over all; no voice notes; sideloaded APK for everyone; backup downloads for super admin only.

## 11. License Notes
- Twenty core is AGPLv3 — free for internal commercial use across both offices
- Paid modules like row-level permissions: $19 per user per month even self-hosted
- Chatwoot is MIT — fully free and open source
