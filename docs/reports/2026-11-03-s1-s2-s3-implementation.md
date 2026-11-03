# Frontend S1–S3 implementation and checks

Date: 3 November 2026. Work is on local branch `feature/s1-s2-s3-frontend`. No push, database migration or authenticated backend/browser workflow was performed. The complete lint → Vitest → build sequence passed after the owner authorized stopping processes to free memory. Browser acceptance remains the owner's verification after the migration.

## Delivered behavior

- S1: real Settings behind `VITE_REAL_SETTINGS`, profile, strict comparison thresholds, days converted to whole API hours, export/MFA policies, fixed Asia/Qatar and QAR labels, reused pricing settings controls and read-only enabled-marketplace upload ages. `settings.edit` gates all settings saves; `settings.security` also gates MFA policy. General settings saves, including the reused pricing controls, send `expectedRevision`. Conflicts reload newer values and drop stale drafts. Price/stock threshold or pricing changes announce recomputation and mark dashboard queries for refresh/polling; profile changes refresh the authenticated store name.
- S2: Activity navigation/route, event group, actor, Qatar date range and product filters, newest-first server ordering, opaque cursor Load more, safe summary and expandable before/after displays. Product History requires both `activity.view` and `products.view`, displays the server's exact `coverageNotice`, and labels tenant-wide upload summaries as store-wide context. Missing differences remain absent. No raw event JSON is rendered.
- S3: session status before profile loading; distinct sign-out, expiry, verification and enrollment branches using API states/codes; return path through sign-in/MFA; permission and server failures remain errors. Request ID copy controls have a manual-copy fallback. The `/api/auth/me` 500 view retains “We could not reach Qorloop”. Browser offline and failed connections show a banner and retry active read queries; HTTP 4xx/5xx do not trigger offline. Mutations are never automatically replayed. CSRF rejection refreshes session state and rereads the current cookie on the next explicit save. No readiness call was added.

## Enable and verify

Add this public flag to `.env.local`, then restart Vite:

```dotenv
VITE_REAL_SETTINGS=true
```

History also needs the existing `VITE_REAL_CATALOGUE=true`. The existing real-data flags for dashboard/pricing/uploads/files keep their original behavior. Vitest resets every `VITE_REAL_*` flag and pins `VITE_API_BASE_URL` to same-origin, independent of `.env.local`.

The owner must first back up the demo database and apply backend migration `packages/db/prisma/migrations/202611030001_activity_indexes/migration.sql`. Follow `D:\Qorloop-backend\docs\settings-activity-api.md` for the approved migration and authenticated checks. This task did not run them.

Browser acceptance should include Owner/Admin/read-only Settings, fractional days and validation, a concurrent revision conflict, recompute/dashboard refresh, activity filter/paging, product history coverage/context, expired return navigation, both MFA branches, forbidden/missing/server errors with Request ID copy, and offline recovery without mutation replay. These are verification steps, not completed browser results.

## Files changed

| Area | Files |
| --- | --- |
| API contracts/client | `src/api/settings.ts`, `src/api/activity.ts`, `src/api/auth.ts`, `src/api/types.ts`, `src/api/client.ts`, `src/api/connectivity.ts` |
| Settings and reused pricing | `src/components/settings/RealSettingsView.tsx`, `src/components/settings/form.ts`, `src/components/views/SettingsView.tsx`, `src/components/pricing/RealPricingView.tsx`, `src/components/pricing/shared.tsx` |
| Activity/product history | `src/components/activity/ActivityView.tsx`, `src/components/catalogue/RealProductDetailView.tsx` |
| Shell/navigation | `src/App.tsx`, `src/types/index.ts`, `src/routes/paths.ts`, `src/components/layout/Sidebar.tsx`, `src/components/layout/Header.tsx` |
| Sessions and errors | `src/auth/AuthContext.tsx`, `src/components/auth/AuthGate.tsx`, `src/components/auth/LoginPage.tsx`, `src/components/auth/MfaPages.tsx`, `src/components/auth/SystemPages.tsx`, `src/components/auth/controls.tsx`, `src/components/common/States.tsx`, `src/components/common/OfflineBanner.tsx`, `src/lib/returnTo.ts` |
| New automated coverage | `src/api/__tests__/settingsActivity.test.ts`, `src/components/settings/__tests__/settings.test.tsx`, `src/components/activity/__tests__/activity.test.tsx`, `src/auth/__tests__/sessions.test.tsx`, `src/components/auth/__tests__/authGate.test.tsx`, `src/components/common/__tests__/errorsOffline.test.tsx` |
| Existing checks adjusted | `src/components/catalogue/__tests__/realCatalogue.test.tsx`, `src/components/pricing/__tests__/realPricing.test.tsx`, `src/components/recon/__tests__/realRecon.test.tsx`, `src/lib/__tests__/flags.test.ts`, `src/routes/__tests__/paths.test.ts`, `vitest.setup.ts` |
| Configuration/docs/check runner | `.env.example`, `src/lib/features.ts`, `scripts/check-frontend.ps1`, `docs/settings-activity.md`, this report |

## Check evidence and limits

| Check | Result |
| --- | --- |
| `npm run lint` | Passed in the final complete sequence. An earlier mock TypeScript call signature was corrected. |
| `npm test` | Passed: 21 files, 332 tests; 31.56 seconds. The final pre-test gate read 1629 MB; `--maxWorkers=2 --bail=1` was used. Earlier checks at 1264, 795 and 1267 MB did not start Vitest. |
| `npm run build` | Passed in the final complete sequence; Vite reports a bundle larger than 500 kB. |
| `git diff --check` | Passed. |
| Crash handling | No worker/process crash observed. No test process was started below the memory gate. |
| Real backend and browser acceptance | Pending owner backup/migration and browser verification. |

Run the equivalent lint → gated test → build sequence with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-frontend.ps1
```

The execution-policy option is limited to that child process. The runner checks Available MBytes immediately before Vitest, uses `--maxWorkers=2 --bail=1`, and stops after the first failed command, including a crash. The complete sequence subsequently finished successfully. Initial runs found two test-fixture issues: the store-form discard selector also matched the pricing form, and permission-denial fixtures lacked router context. Both were corrected before the final full run.

## Process cleanup and restoration

The owner authorized stopping processes and continuing validation. The confirmed Qorloop frontend and worker were stopped; Chrome, Phone Link and Teams (including Teams' own browser-runtime descendants) were closed to free enough memory. The IDE, databases, security software and system processes stayed running. No unrelated browser-runtime process was stopped.

The frontend and worker were restarted hidden with their existing `npm run dev` and `npm run dev:worker` scripts. The frontend subsequently returned HTTP 200; two worker Node processes were observed. Startup logs are local under `.cache/service-logs/` and were not dumped into chat. The API was not listening on port 4000 before this cleanup and remains offline; it was not started as a restoration step. No readiness, authenticated API or migration command was run. Chrome, Phone Link and Teams remain closed.

## Local commits

- S1: `758d83c` — settings, validation, permissions and revision updates.
- S2: `b60b0c0` — Activity and safe product History.
- S3: `db6984a` — session status, errors and offline recovery.
- S4: the local commit containing this report — automated coverage, check runner and review fixes. Use `git log --oneline -4` for its hash.

The S4 review fixes retain the old history placeholder when the flag is off, ensure restricted sessions go directly to the API-selected MFA page, avoid empty query-string suffixes, and integrate Settings with the existing comparison polling state.
