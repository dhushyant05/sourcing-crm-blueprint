# Email channel: setup (off by default)

The email channel turns email into conversations in the staff inboxes:

- **Customer email** goes to the **Customer support** inbox. India roles, the Marketplace Team and super admin can see it. China never can.
- **Supplier email** goes to the new **Supplier email** inbox. China roles and super admin can see it. India and the Marketplace Team never can.
- A sender we already know decides the side, whichever address they wrote to. A known supplier writing to support@ goes to China, and a known customer writing to suppliers@ goes to India.
- Staff replies are sent by email with In-Reply-To and References headers, so they thread in the customer's or supplier's mail client. Internal notes are never emailed.
- Attachments go through the normal upload checks (type sniffing, 10 MB each, at most 5). Anything rejected is listed in a staff-only note.
- A thread links to a lead automatically when the subject or body contains an `SE-YYMM-NNNN` reference. Supplier mail always links. Customer mail links only if the sender is that lead's own contact.
- Staff can get an "unread chat messages" email at most once an hour. It contains only counts and a link. Each person can turn it off under **Settings → Notifications** (it is on by default).

Nothing is received or sent until the steps below are done.

## 1. Pick a provider

The built-in adapter is for **Postmark** (inbound webhook plus outbound API). `EMAIL_PROVIDER=generic` accepts any relay that can POST JSON to us and accept JSON from us. See `server/src/email-channel.ts` for the formats.

## 2. DNS for sourceeasy.in (GoDaddy, ns69/ns70.domaincontrol.com)

As of 27 Nov 2026, sourceeasy.in has **no MX record, no SPF record and no DKIM record**. It does have `_dmarc` with `p=quarantine`, so mail we send without SPF/DKIM will land in spam.

Add the following:

| Record | Host | Value |
|---|---|---|
| MX | `@` (or an inbound subdomain such as `mail`) | the provider's inbound MX, e.g. `inbound.postmarkapp.com` priority 10 |
| TXT (SPF) | `@` | `v=spf1 include:spf.mtasv.net ~all` (use your provider's include) |
| TXT (DKIM) | `<selector>._domainkey` | the key the provider shows |
| CNAME (Return-Path) | `pm-bounces` | `pm.mtasv.net` (Postmark) |

If sourceeasy.in already receives mail somewhere else (Google Workspace, Zoho and so on), **do not replace that MX**. Point a subdomain (for example `mail.sourceeasy.in`) at the provider, or set up forwarding from support@ and suppliers@.

## 3. Provider settings

- Inbound webhook URL: `https://sourceeasy.in/api/email/inbound`. Authenticate with HTTP Basic (`https://inbound:<EMAIL_INBOUND_SECRET>@sourceeasy.in/api/email/inbound`) or the header `Authorization: Bearer <EMAIL_INBOUND_SECRET>`.
- Make the sending addresses verified senders: support@, suppliers@ and notifications@.

## 4. Server `.env` (in /opt/sourceeasy/infra/server1-twenty)

```
EMAIL_CHANNEL_ENABLED=true
EMAIL_PROVIDER=postmark
EMAIL_API_TOKEN=<Postmark server token>
EMAIL_INBOUND_SECRET=<random string, 24+ characters>
EMAIL_CUSTOMER_ADDRESS=support@sourceeasy.in
EMAIL_SUPPLIER_ADDRESS=suppliers@sourceeasy.in
EMAIL_NOTIFY_FROM=notifications@sourceeasy.in
EMAIL_FROM_NAME=Source Easy
```

Then run `docker compose up -d api`. A super admin can check readiness, which never shows secrets, at `GET /api/email/status`.

## Turning it off

Set `EMAIL_CHANNEL_ENABLED=false` and run `docker compose up -d api`. The inbound URL then returns 404, and email threads that already exist stay readable.
