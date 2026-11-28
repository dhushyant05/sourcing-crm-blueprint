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
