# Qorloop

Qorloop (formerly "Shelf") is a product for GCC grocery and FMCG retailers who sell on delivery marketplaces (Talabat, Snoonu, Rafeeq, Keeta). The retailer uploads their ERP export and each marketplace's export. Qorloop shows which products have the wrong price or availability on each marketplace, and generates corrected files in each marketplace's own upload format.

In Phase 1, each supermarket or business gets **its own instance on its own subdomain** (e.g. `dohafresh.qorloop.com`). Underneath, the code is built tenant-ready, so it can become a shared SaaS later without a rewrite. See [Architecture → Deployment model](docs/03-architecture.md).

Globify Software Solutions is building it for a client who will sell it as SaaS. The codebase is covered by an NDA.

> **Status (22 Oct 2026):** this repo holds a clickable **front-end demo** that runs entirely in the browser on mock data. The design is partially approved. **Phase 1 development starts now. Target: the product on staging, ready for testing, by Friday 20 Nov 2026.**

---

## Start here

Read these in order (about an hour in total):

| # | Doc | What it tells you |
|---|---|---|
| 1 | [Product overview](docs/01-product-overview.md) | The problem, the users, the daily loop, glossary, client decisions so far |
| 2 | [Current front end](docs/02-current-frontend.md) | What this repo contains today, what is mock, known gaps |
| 3 | [Architecture](docs/03-architecture.md) | The recommended stack, repo layout, multi-tenancy, file pipeline, environments |
| 4 | [Data model](docs/04-data-model.md) | Entities, fields, and which system owns each field |
| 5 | [Business rules](docs/05-business-rules.md) | Pricing, reconciliation, matching, upload and file-generation rules |
| 6 | [**Phase 1 plan (to 20 Nov)**](docs/06-phase-1-plan.md) | Week-by-week tasks, definition of done, what to cut if time runs out |
| 7 | [Later phases](docs/07-later-phases.md) | What comes after testing starts, up to launch and Phase 2 |
| 8 | [Open questions](docs/08-open-questions.md) | Decisions still pending, who owns each one, and the default we build on until answered |
| 9 | [Screen inventory](docs/09-screen-inventory.md) | All 76 blueprint screens with priority and status |
| 10 | [Backend plan](docs/10-backend-plan.md) | The chosen stack (Fastify, Drizzle, Better Auth, pg-boss), schema, API routes, jobs, web wiring, build order and verification |

Reference material in [`docs/reference/`](docs/reference/):

- `Qorloop_UIUX_Implementation_Blueprint.pdf`: the approved UX architecture (roles, journeys, sitemap, screen inventory, states, design system).
- `client-feedback-2026-10-15.md`: decisions from the client demo on 15 Oct (Marketplace Price, categories, theme).
- `marketplace-price-implementation-plan.md`: how Marketplace Price was designed in the demo.
- `demo-integration-notes.md` and `onboarding-wizard-spec.md`: the specs the demo was built from. They are useful for exact behaviour and wording.

The 14 original screen mockups (PNG) are in the shared project folder, not in git. Ask Globify for access.

---

## Run the demo

Requires Node 22+.

```bash
npm install
npm run dev        # http://localhost:3000. Any email and password log in.
npm test           # vitest: end-to-end tests of the daily loop (src/demo/__tests__)
npm run build      # production build to dist/
npm run samples    # regenerate public/samples/*.xlsx from the seed data
```

The demo is not deployed anywhere: it was presented to the client offline, from a local machine. `vercel.json` is only a leftover config. Tag the current state as `demo-v1` before restructuring (see Phase 1, task F1), so the offline demo can always be run again from that tag.

`.env.example` is left over from Google AI Studio (Gemini key). Nothing in the app uses it; remove it during setup.

---

## Repo map (today)

```
src/
  demo/            Browser-only "backend": data model, seed, recon, uploads, exports, store
                   (the business logic to port to the real backend; see docs/02)
  lib/pricing.ts   Marketplace Price engine (offer / product / category / marketplace / default)
  context/         AppContext: UI state, plus a second mock data set used by the pricing screens
  data/            Mock data for AppContext (mockData.ts, pricingData.ts)
  components/
    layout/        Sidebar, Header
    modals/        UploadModal, BulkPriceModal
    common/        Shared bits: ColumnMappingPanel, CompareAgainstToggle, PriceSourceChip…
    views/         One file per screen
public/samples/    Realistic ERP + marketplace sample files (.xlsx) for the demo
scripts/           make-samples.ts
```

---

## Working agreement

- **Branches:** `main` is always deployable. Work on `feature/<short-name>` and merge through a pull request, so Globify can review. Small PRs, at least daily.
- **Commits:** use plain, descriptive messages. Reference the task ID from the Phase 1 plan (e.g. `A3: TOTP enrolment`).
- **Decisions:** record any architecture or library choice as a short note in `docs/decisions/` (one file each: context, decision, why). The first ones are due in week 1.
- **Status:** post a short update every evening with done / next / blocked. Run a demo on staging every Friday.
- **Secrets:** never commit them. Use `.env` locally and the host's secret store for staging and prod.
- **Client data:** real retailer files must never go into git or a public URL. Store them in the private sample-data bucket.
- **Questions:** if a rule in these docs looks wrong, ask. Don't guess. Add it to [Open questions](docs/08-open-questions.md).
