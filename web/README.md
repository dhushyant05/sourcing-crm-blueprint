# Source Easy — web dashboard

React 19 + Vite + TypeScript + Tailwind (Inter, light/dark). Talks **only** to the Source Easy server (`/api`, same origin).
No Twenty URL or API key is ever in the browser; the server filters data by role.

```bash
cd web
npm ci
npm run dev          # http://localhost:5173, proxies /api to http://localhost:8080 (API_URL to override)
npm run build        # dist/ is served by server/ (WEB_DIR) — see server/Dockerfile
npm run screenshots  # demo-mode screenshots (needs Chrome at /usr/bin/google-chrome)
node scripts/role-screenshots.mjs  # real-login role screenshots; first run `npx tsx scripts/demo-server.ts` in server/
```

* **Live mode** — email + password from your admin. The session JWT lives in `sessionStorage` only.
  Navigation follows the role (Suppliers for China/super, Team for admins, backup links for super admin).
* **Demo mode** — "Explore with demo data" loads in-memory seed data; the "View as" menu previews roles.
