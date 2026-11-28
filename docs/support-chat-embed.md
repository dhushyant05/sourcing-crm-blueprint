# Support chat embed (Fortune Engineering)

Partner sites can embed the Source Easy customer support chat. Their chats land in the same
**Customer support** team inbox (India staff, Marketplace Team, super admin; never China), tagged with
the site they came from.

## Embed

```html
<script src="https://sourceeasy.in/embed/support-chat.js" data-site="fortune_engineering"
        data-logo="/logos/fortune.webp" defer></script>
```

The partner CSP must allow `https://sourceeasy.in` in `script-src` and `connect-src`. The widget runs in a
shadow root, follows the page language (`/zh-cn/` → Simplified Chinese, otherwise English), and is
mobile full-screen under 640 px.

## API (`/api/embed/support/*`)

| Route | Purpose |
| --- | --- |
| `GET /status` | Desk hours, brand, anti-bot challenge |
| `POST /start` | Pre-chat form → `{ token, conversation }` |
| `GET /conversation` | The visitor's conversation |
| `POST /messages` | Guest message (text, ≤ 2000 chars, ≤ 3 links) |
| `GET /messages/:mid/files/:fid` | Staff attachment download |
| `GET /stream` | Realtime SSE (read with `fetch`, token in header) |

- **CORS**: exact allowlist only, no credentials, no wildcard. Default
  `https://fortuneengineering.in`, `https://www.fortuneengineering.in`; override with
  `SUPPORT_EMBED_ORIGINS="https://origin=fortune_engineering,..."`. Other origins (and requests without an
  `Origin`) get `403` and no CORS headers.
- **Visitor token**: `v1.<site>.<random>.<hmac>` kept in the partner site's `localStorage` and sent as
  `X-Support-Token`. Only the hash of the random part is stored and the visitor row is tagged with its
  site, so a token never works on another site, and Source Easy's httpOnly cookie never works on the embed.
- **Spam**: honeypot field, signed time challenge (≥ 2 s), 16 KB body cap, 5 new chats / IP / hour,
  20 messages / visitor / 10 min, 60 messages / IP / 10 min, link limit.

## Staff inbox

`chat_conversations.source_site` (`sourceeasy` | `fortune_engineering`, migration
`1765100000000_support_source_site.sql`, existing rows `sourceeasy`). The Customer support inbox shows a
site badge and an *All sites / Source Easy / Fortune Engineering* filter
(`GET /api/chat/inboxes/:id/conversations?site=`). Convert-to-lead notes the site in the lead's enquiry
message. Guests see staff first names and "Fortune Engineering" for system messages; internal notes,
assignment and contact fields never reach the widget.

## Online / Offline presence

The widget shows **Online – we usually reply in a few minutes** (green dot) only while a support staff member is really there,
otherwise **Offline – leave a message and we'll reply soon** (grey dot). Leaving a message while offline still works.

- Who counts: active India-side / Marketplace / super-admin users who can work the Customer support desk (never China, never suppliers),
  who are connected and haven't set themselves **Away**.
- "Connected" = an open staff live stream (web app, floating chat or staff app) or a web-app heartbeat within about 2 minutes.
  Stored in Redis with TTLs: `se:presence:seen:<userId>` (120 s) and `se:presence:away:<userId>` (`manual` 16 h, `auto` 150 s).
- Staff switch Available/Away in the floating chat header; the web app marks a person away automatically after 15 idle minutes
  (choose Off / 5 / 15 / 30 in the same menu).
- Public endpoints return only `{ "online": true|false }` (no names or counts), cached about 10 s:
  `GET /api/support/presence` (Source Easy) and `GET /api/embed/support/presence` (CORS allowlist, same as the rest of the embed).
  The existing `/status` endpoints carry the same live `online` value (+ `label`).
- Widgets poll every 45 s while the tab is visible. Only HTTPS fetch is used: no WebSocket and no images, so the Fortune Engineering CSP
  (`connect-src https://sourceeasy.in`, `img-src 'self' data:`) needs no change and the `<script>` tag is unchanged.
- Staff endpoints: `GET/PUT /api/chat/presence`, `POST /api/chat/presence/heartbeat {active}`.
