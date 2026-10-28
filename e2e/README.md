# Browser tests (real backend)

These tests drive the real app in Chromium against the real NestJS API and PostgreSQL. Nothing is mocked.

1. Start PostgreSQL and Redis, then in the **backend** repo (Node 24):
   ```bash
   export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/qorloop_e2e
   export AUTH_SECRET=test-only-secret-at-least-thirty-two-characters
   export APP_ORIGIN=http://dohafresh.localhost:3000
   npm run db:migrate
   npm run dev          # API on :4000
   ```
2. In **this** repo: `npm run e2e` (starts the Vite dev server on :3000, which proxies `/api` to :4000).

Environment: `QORLOOP_BACKEND_DIR` (default `../QorLoopBackend`) — used only to read single-use tokens that
production delivers by email; `E2E_BASE_URL`; `PLAYWRIGHT_CHROMIUM_EXECUTABLE` for a pre-installed browser.
