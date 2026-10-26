# 10. Backend implementation plan

## Context
Qorloop today is a browser-only React demo (see [02-current-frontend.md](02-current-frontend.md)). Two separate mock data layers drive it:
- `src/demo/*`: the tested daily loop (recon, uploads, exports, seed), stored in localStorage through `useDemo()`.
- `src/context/AppContext.tsx` + `src/data/*` + `src/lib/pricing.ts`: a second product list that drives Marketplace Price, the catalogue column, the bulk modal and the compare toggle.

Login is fake, and team, settings and activity are static. This plan builds a real backend and connects every screen to it, so that every function in the app works on real data.

Agreed scope:
- **Full app, running locally.** Real auth with MFA, invites and roles; uploads; recon; pricing; file generation; every screen wired to the API.
- **Out of scope for now:** cloud deploy, provisioning script, Sentry and CI.
- **Stack:** Fastify, Drizzle and Better Auth, with Postgres in Docker.
- **Jobs and files:** a pg-boss job queue and local-disk storage behind a storage interface that can be swapped for S3 later.

The design follows `docs/03-architecture.md`, `docs/04-data-model.md` and `docs/05-business-rules.md`: tenant_id on every table, UUID keys, a tenant-scoped data layer, and an ownership rule for which fields the ERP file owns.

## Target layout (npm workspaces)
```
apps/web        current Vite app moved from ./src (must still build)
apps/api        Fastify server + pg-boss worker (same process locally, `--worker` flag splits later)
packages/core   pure logic: pricing, recon, uploads (detect/map/parse/review), exports, barcode, money
packages/db     Drizzle schema, migrations, seed (port of src/demo/seed.ts)
packages/shared zod DTOs, API types, role→permission map (used by api + web)
docker-compose.yml  postgres:16 (+ mailpit for invite/reset emails)
docs/decisions/ 0001-api-fastify.md, 0002-orm-drizzle.md, 0003-auth-better-auth.md, 0004-jobs-pgboss-local-storage.md
```
Step 0: tag the current `main` as `demo-v1` (task F1). Record the four stack choices above as decision notes in `docs/decisions/`.

## 1. packages/core: one engine (merging the two pricing models)
- Move these from `src/demo` into core, with their tests: `recon.ts`, `uploads.ts`, `exports.ts`, `format.ts` and `normalizeBarcode`. Move `src/lib/pricing.ts` too, minus its DOM helpers.
- Refactor the functions to take a plain `TenantSnapshot` instead of `DemoState`. The snapshot holds products, listings, rules, settings, templates, latest uploads and `now`. The API loads a snapshot from the database, and the functions stay pure.
- In `reconRow`, replace `expectedPrice(markupPct)` with the `resolveMarketplacePrice()` engine:
  - order: offer → product → subcategory → category → marketplace (advanced) → default
  - compute **both** expected prices (ERP reference and Marketplace reference) and a mismatch flag for each
- Money: compute in integer fils (`Math.round(x*1000)`), with helpers in `core/money.ts`. Rounding options are exact, 0.05, 0.25 and 0.50 (Q13 default).
- Exports: escape formula injection in cells (`= + - @` get a `'` prefix). Name files `{Mp}_{Kind}_{DDMonYYYY}_{HHmm}` in Asia/Qatar time.
- Keep `src/demo/__tests__/flow.test.ts` green after porting. Add tests for:
  - pricing order and rounding
  - the dual-reference flags
  - barcode GTIN-14 normalisation
  - the 20% invalid-rows rejection

## 2. packages/db: schema (Drizzle, Postgres 16)
These tables follow `docs/04-data-model.md`:
- **Tenancy and auth:** tenants, memberships, invitations, stores, tenant_settings, plus the Better Auth tables (user, session, account, verification, twoFactor)
- **Marketplaces:** marketplaces (global), tenant_marketplaces
- **Catalogue:** products, categories (with parent_id), category_mappings, listings
- **Pricing:** pricing_settings, category_price_rules, product_price_rules, product_offers, marketplace_price_rules
- **Uploads:** input_templates (versioned), uploads, upload_rows, upload_errors
- **Recon:** recon_rows, recon_summary
- **Outputs:** output_templates (global seed), generated_files
- **Audit:** activity_log, notifications

Rules for the schema:
- UUID primary keys, and `tenant_id` in every unique key
- money as `numeric(12,3)`
- the indexes listed in doc 04, including a pg_trgm index on `name_en`
- RLS policies written in a migration but left disabled

Seed (`npm run db:seed`):
- port `createSeed()`: the "Doha Fresh Markets" tenant, products, listings, uploads, categories and mappings
- the pricing seed from `src/data/pricingData.ts`, so the pricing screens keep their demo data
- one user per role: Owner, Admin, Catalogue Manager, Analyst
- seeded passwords, printed to the console

## 3. apps/api (Fastify)
**Plumbing**
- **Config:** `DATABASE_URL`, `TENANT_ID`, `AUTH_SECRET`, `STORAGE_DIR`, `SMTP_*`
- **Request context:** a request ID and a tenant resolver, `resolveTenant(req)`. It reads the `TENANT_ID` env now and can read the subdomain later, by changing only this one file.
- **Repositories (`apps/api/src/repos/*`):** the only code that touches Drizzle. Every query requires `ctx.tenantId`, and route handlers run no raw queries.
- **Auth (Better Auth, mounted at `/api/auth/*`):**
  - email and password with httpOnly SameSite cookies
  - the twoFactor plugin (TOTP and recovery codes), mandatory for Owners and for everyone when `mfa_required_for_all` is on
  - an idle and an absolute session timeout
  - rate limits on auth routes
- **Guard:** `requirePermission('products.edit')`, backed by the permission map in `packages/shared`. The Analyst role is read-only, and an Admin cannot grant Owner.
- **Re-auth:** a `requireRecentAuth` check for role changes, turning MFA off, and security settings.
- **Validation:** zod on every body and query, through `fastify-type-provider-zod`. The OpenAPI document is served at `/docs`.
- **Errors:** errors return `{error, message, requestId}`. Logs are pino JSON.

**Routes**

| Area | Endpoints |
|---|---|
| Session | `GET /me` (user, role, permissions, tenant, onboarding) |
| Team | list members, invite, resend, change role, remove; `POST /invitations/:token/accept` (sets name and password, verifies email). Emails go through nodemailer to Mailpit locally. |
| Tenant / onboarding | `GET/PATCH /tenant`, `PATCH /onboarding` (step), `POST /onboarding/complete`, `PATCH /marketplaces/:id` (enabled) |
| Settings | `GET/PATCH /settings` (tolerance, stock threshold, stale hours, MFA for all, analyst export) |
| Uploads | `POST /uploads` (multipart → disk → row status=processing → job). `GET /uploads` (history), `GET /uploads/:id` (status, step, progress, summary, review tabs, paged). `POST /uploads/:id/mapping` (save versioned mapping and reprocess), `POST /uploads/:id/apply`, `POST /uploads/:id/discard`, `GET /uploads/:id/errors.xlsx`. `POST /uploads/sample/:source` (loads `public/samples` files, so the demo walkthrough keeps working). |
| File mappings | `GET /input-templates`, `GET /input-templates/:source/suggest?uploadId=`, `PUT /input-templates/:id` (new version), `GET /output-templates`, `POST /output-templates/:mp/configure` |
| Catalogue | `GET /products` (cursor pagination; search on name, barcode and SKU; tabs and filters; includes the resolved Marketplace Price and its source). `GET /products/:id` (detail, recon rows per marketplace, history). `PATCH /products/:id` (Qorloop-managed fields only). `POST /products/activate` (returns activated and skipped rows with reasons). |
| Categories | CRUD for categories and subcategories; `GET/PUT /category-mappings` |
| Pricing | `GET/PATCH /pricing/settings`, CRUD `/pricing/category-rules`, `PUT/DELETE /products/:id/price-rule`, `PUT/DELETE /products/:id/offer`, `PUT /pricing/marketplace-rules/:mp`. `POST /pricing/bulk/preview` and `POST /pricing/bulk/apply` (by ids or by category). `GET /pricing/bulk-file/template` and `POST /pricing/bulk-file` (per-row review, then apply). |
| Recon / reports | `GET /dashboard` (recon_summary, freshness, needs-attention), `GET /reports/stock` and `GET /reports/price` (`?marketplace&reference&status&q&cursor`, counts match the summary), `GET /reports/export.xlsx` |
| Files | `POST /files/preview` (synchronous, uses core exports, returns blocked reasons), `POST /files` (job → writes .xlsx/.csv to disk → generated_files row), `GET /files` (30-day history), `GET /files/:id/download` (short-lived signed token) |
| Activity | `GET /activity` (filters), plus product history through the product detail |

**Jobs (pg-boss, `apps/api/src/jobs/*`)**
- **`process-upload`:** scan → check → detect → read → review. It does these steps:
  - checks the file type, the 25 MB limit, and rejects macros or encrypted files
  - parses .xlsx, .xls and .csv with SheetJS
  - tries `detectTemplate`, then the wrong-file guard
  - leaves status `needs_mapping` or `needs_review`, and stores upload_rows and upload_errors
  - saves `step` and `progress` at each stage
- **`apply-upload`:** runs in one transaction with upserts keyed on (tenant, normalized_barcode), so it is idempotent. It also:
  - respects the ownership rule and the first-ERP-import rule (all products active)
  - writes activity entries per changed field
  - enqueues `recon-refresh`
- **`recon-refresh`:** builds a snapshot, runs core recon, and rewrites `recon_rows` and `recon_summary` for the tenant. It is also enqueued after pricing, settings, product and marketplace changes.
- **`generate-file`:** builds the rows with core exports and writes the file under `storage/tenants/{tenantId}/generated/...`.
- **Daily cleanup:** deletes generated files after 30 days and upload originals after 90.

**Storage interface:** `put/get/delete/signedUrl` (`apps/api/src/storage/local.ts`). Keys are prefixed `tenants/{id}/`.

## 4. apps/web: wire every screen to the API
- Add React Router with real URLs that replace `currentView`, for example `/dashboard`, `/catalogue/:id`, `/reports/price`, `/uploads/:id/review`. `navigate(view, opts)` keeps working as a thin wrapper, so the views change little.
- Add TanStack Query and a typed `apiClient` built on the shared zod DTOs. Use Vite's dev proxy (`/api` → `localhost:4000`).
- **Replace the two mock layers:**
  - `DemoProvider` becomes `ApiStoreProvider`, which keeps the `useDemo()` method names but implements them with queries and mutations. Uploads poll `GET /uploads/:id` every 2 s.
  - AppContext keeps only the UI state: toasts, modals, the compare reference and the upload modal. Products, pricing rules, team and output files now come from the API.
  - Unify the product type into the shared `ProductDto` (core fields, `marketplacePrice {price, source}`, per-marketplace recon). Then remove `src/data/mockData.ts` and `pricingData.ts`.
- **Auth screens:**
  - `LoginView` with a real login and a TOTP step
  - new screens: forgot and reset password, accept invitation, MFA setup (QR code and recovery codes), session expired
  - a re-auth dialog
  - 403, 404 and 500 pages that show the request ID
- **Settings:** fill in `SettingsView` with tabs for General and rules, Marketplaces, Team (invite, role, remove), Security (MFA for all, analyst export, own MFA) and Upload formats (read-only).
- **Permissions:** hide controls with `can(permission)` from the shared map.
- **Per-screen states:** loading skeletons, empty and error states on every screen, an offline banner, and lazy-loaded routes with `xlsx` split out to fix the bundle warning.
- **Cleanup:**
  - delete `PriceMismatchesView`
  - remove `.env.example` (Gemini) and `metadata.json`
  - rename the package to `qorloop-web`
  - keep the unrouted `AddProductView`, `CategoriesView` and `CategoryDetailView` out of navigation, as the docs say

## Build order (each step ends runnable)
1. Monorepo move, `packages/core` port and merge with tests green, and Docker Postgres with the Drizzle schema and seed.
2. API skeleton: tenant context, repos, Better Auth with MFA and invites, guards, `/me`. Web: router, API client, auth screens.
3. Uploads pipeline and jobs, mapping, review and apply, history, errors. Wire the upload modal, mapping, review, history and onboarding steps.
4. Catalogue, categories, new products, product detail and activity.
5. Pricing API, bulk changes and the bulk file. Wire the Markups view, BulkPriceModal and the catalogue column.
6. Recon refresh, dashboard and reports with the compare toggle. Wire the dashboard and both reports.
7. File preview and generate, history and download, category mapping. Wire GenerateFilesView.
8. Settings, team, security, re-auth, system pages and states. Delete the mock data.

## Key files to reuse
- `src/demo/recon.ts`, `uploads.ts`, `exports.ts`, `seed.ts`, `catalogData.ts` and `xlsxIO.ts` (the reading parts) → core, db/seed and the API
- `src/lib/pricing.ts` (`resolveMarketplacePrice`, `getBulkPatch`, `parsePriceCsv`) → `core/pricing`
- `src/demo/__tests__/flow.test.ts` → core tests
- `public/samples/*.xlsx` → the sample-upload endpoint and API integration tests

## Verification
- `docker compose up -d`, then `npm run db:migrate && npm run db:seed`, then `npm run dev`. The last command starts the web app on :3000 and the API and worker on :4000. Mailpit runs on :8025.
- `npm test`:
  - core unit tests, including the ported flow test
  - API integration tests (vitest plus a test database) for the daily loop, run against the sample files: upload ERP → apply → upload Talabat, Snoonu and Rafeeq → dashboard counts equal the report counts and the preview counts → generate a file and check its columns
  - the tenant-safety suite: two tenants in one database, and every endpoint group is asserted to see no data across tenants
  - a role-guard test that sends every mutating route as the Analyst and expects 403
- `npm run typecheck` and `npm run build` pass for all workspaces.
- Manual check in the browser:
  1. accept an Owner invitation from Mailpit, set up TOTP, finish onboarding
  2. upload the Keeta sample, which needs mapping; map it once, and see the second upload recognised automatically
  3. set a category rule, see the Marketplace price and the price report update, flip the compare toggle and see the counts change
  4. generate a Talabat file and download it
  5. invite a Catalogue Manager, log in as them, and see only the permitted controls
- Optional, as a follow-up: a Playwright smoke test of the flow above.
