# Frontend S1–S3 polish

Date: 3 November 2026. Changes are committed locally on `feature/s1-s2-s3-frontend`; nothing was pushed. No credentials, cookies or tokens were printed.

## Changes

- Product History hides tenant-scoped store-wide upload entries by default. The unchecked “Show store-wide upload entries” toggle reveals them with their existing context label. Product-specific changes stay visible. The exact API coverage notice is preserved, including for empty/hidden-only results, which show “No changes recorded for this product yet”. Load more remains available when the current page contains only hidden uploads. The toggle resets when the product changes.
- Connection errors show “Qorloop can't reach the server. Check your connection and try again”. Request ID and Copy appear only when an ID exists. Server errors without an ID no longer ask the user to report one. Try again remains available.
- Activity From/To values were already empty by default. Clear filters already reset actor, event group, dates, product and validation errors. Regression coverage now explicitly verifies the initial values, omitted date query parameters, reset controls and unfiltered API query.
- Bulk pricing receives an explicit pending catalogue-count state. Its filter label shows “Counting...” while the first page is loading/refetching or old placeholder results remain. A stale zero does not produce “at most 0” or an empty-selection error during loading. Confirmed zero counts still display honestly once loading finishes. Next-page pagination does not invalidate the known total.

## Files changed

| Area | Files |
| --- | --- |
| History and Activity coverage | `src/components/activity/ActivityView.tsx`, `src/components/activity/__tests__/activity.test.tsx` |
| Error rendering and coverage | `src/components/common/States.tsx`, `src/components/common/__tests__/errorsOffline.test.tsx` |
| Catalogue/bulk count state and coverage | `src/components/catalogue/RealCatalogueView.tsx`, `src/components/pricing/BulkPriceChangeDialog.tsx`, `src/components/pricing/__tests__/priceChange.test.tsx` |
| Existing no-ID error expectations | `src/components/catalogue/__tests__/realCatalogue.test.tsx`, `src/components/pricing/__tests__/realPricing.test.tsx`, `src/components/recon/__tests__/realRecon.test.tsx` |
| Report | This file |

## Automated check results

The complete `scripts/check-frontend.ps1` lint → gated Vitest → build sequence passed.

| Check | Result |
| --- | --- |
| Lint | Passed |
| Memory gate before final Vitest run | 1992 Available MBytes, above the required 1500 |
| Vitest | 21 files, 339 tests passed; 24.50 seconds; `--maxWorkers=2 --bail=1` |
| Build | Passed; existing warning for a bundle larger than 500 kB remains |
| Whitespace | `git diff --check` passed |
| Worker/process crash | None observed |

Earlier gates at 1086 and 1357 MB did not start Vitest. The previously authorized temporary cleanup stopped the two frontend servers, API and worker. Chrome was also closed when stopping only development services did not meet the gate. The IDE, databases, security software and system processes remained running. Both frontend servers, the API and worker were restored using their existing npm commands and hidden windows after validation. Startup logs are local under `.cache/service-logs/` and were not printed. Chrome remains closed.

## Unverified

Authenticated browser behavior against the real backend remains pending owner verification. No migration, authenticated API mutation or readiness check was performed. Automated results do not establish browser acceptance or migration status.
