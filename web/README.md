# Source Easy — web dashboard

React 19 + Vite + TypeScript + Tailwind (Inter, light/dark). Talks to Twenty's GraphQL API directly from the browser.

```bash
cd web
npm ci
npm run dev          # http://localhost:5173
npm run build        # static files in dist/ — serve behind the same reverse proxy as Twenty
npm run screenshots  # rebuilds docs/screenshots (needs Chrome at /usr/bin/google-chrome)
```

* **Demo mode** — "Explore with demo data" on the login screen loads in-memory seed data
  (with a short artificial delay so skeletons show). The "View as" menu switches role.
* **Live mode** — enter the Twenty URL and an API key (Twenty → Settings → APIs). The key lives in
  `sessionStorage` only and is never written to disk. Twenty must allow CORS from the dashboard origin
  (or serve `dist/` from the same host).
