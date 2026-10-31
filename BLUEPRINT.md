# Twenty Sourcing CRM App Blueprint

## 1. Purpose
A cross-border sourcing operation with an India office capturing leads and delivering to clients, and a China office sourcing products and returning cost and specs. The app tracks every handoff in one pipeline.

## 2. Tech Stack
- Flutter for iOS and Android with a modern Material 3 design
- GraphQL and REST against a self-hosted Twenty instance
- Offline sync with local SQLite
- Push notifications via FCM
- Chatwoot embedded as a slide-up chat panel reachable from any screen

## 3. Twenty Custom Objects
- **Lead**: client name, contact, source channel, status, assigned office, Chatwoot conversation link
- **Sourcing Request**: product description, quantity, target price, deadline, assigned China agent
- **Quotation**: unit cost, total cost, currency, validity date, PDF attachment
- **Client Approval**: status, approver, timestamp, notes
- **Shipping Order**: forwarder, tracking number, container type, ETD, ETA, customs status

## 4. Workflows (10 Steps)
1. India captures lead from Chatwoot webhook or manual entry
2. Lead assigned to a China agent with automatic notification
3. China logs supplier options and sample status
4. Quotation created in yuan or dollars, converted to rupees for display
5. India shares quote with client as generated PDF or copied details
6. Client approves or requests revision
7. On approval, shipping order created
8. China coordinates forwarder and booking
9. Tracking updates flow back to India
10. Delivery confirmed and lead closed with win-loss reason

## 5. Roles and Permissions
- **India role**: leads, quotations, approvals, shipping; not raw China supplier costs
- **China role**: sourcing requests, quotations, shipping; not client pricing or margins
- **Admin**: everything
- Approximate separation using custom office tags and filtered views (row-level security is a paid module)

## 6. Chatwoot Integration
- Self-hosted alongside Twenty in one Docker Compose file, OR on a separate VPS (see note below)
- Separate domain like chat.yourcompany.com
- Webhook on conversation created creates a Lead in Twenty
- Twenty webhook on lead assignment notifies the China team in Chatwoot
- WhatsApp Business connected free on self-hosted; Meta charges per outbound message outside the 24-hour window
- Chat widget embedded in the same webpage, not a separate page
- Captain AI assistant V1 is retired; automated replies need a custom build on the API
- **Separate VPS option**: Yes. Chatwoot can run on its own VPS with its own domain. You'd point the webhook URLs at the Twenty instance over the public internet or a private link. This isolates resource usage and lets you scale each independently, at the cost of one extra monthly bill and slightly more network latency on webhooks.

## 7. Mobile App Screens
- Dashboard with pipeline summary
- Lead list with filters by office and status
- Lead detail with timeline of every handoff
- Sourcing request form for China
- Quotation view with currency toggle
- Approval screen with accept and reject
- Shipping tracker with map
- Chat panel via bottom tab or floating button on every screen
- Business card scanner for quick lead capture
- Offline mode queues changes and syncs when back online

## 8. Build Plan (7 Phases)
- **Phase 1** (weeks 1-2): Twenty self-hosted, custom objects, basic permissions, Docker Compose with Chatwoot
- **Phase 2** (weeks 3-4): Flutter app shell, auth, lead list and detail, GraphQL layer
- **Phase 3** (weeks 5-6): Sourcing and quotation screens, currency conversion, PDF generation
- **Phase 4** (week 7): Shipping tracker, Chatwoot panel, push notifications, offline sync
- **Phase 5**: Testing with both offices
- **Phase 6**: Pilot with five real leads
- **Phase 7**: Iterate and harden

## 9. Open Questions (Revised)
1. Should client quotes go out as an auto-generated PDF, or should India staff paste details into WhatsApp manually?
2. Which currency should display by default for each office — rupees for India, yuan for China, or a single global default?
3. Should China agents see raw supplier contact details inside the app, or only through a separate channel?
4. Do we need voice-note capture for factory visits and supplier calls?
5. One shared VPS for Twenty and Chatwoot, or split them across two servers?
6. Who owns user-account administration day to day?
7. What is the backup and disaster-recovery plan for both instances?
8. Sideload the APK for China staff, or publish to the Play Store and App Store?

## 10. License Notes
- Twenty core is AGPLv3 — free for internal commercial use across both offices
- Paid modules like row-level permissions: $19 per user per month even self-hosted
- Chatwoot is MIT — fully free and open source
