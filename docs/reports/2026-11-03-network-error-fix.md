# Frontend network/data-error fix

Date: 3 November 2026. Local change only; no push, migration or authenticated backend mutation.

## Cause and fix

Fetch rejection was already represented as a network error, but a stopped API behind Vite takes a different path: Vite returns an empty HTTP 502 for the refused upstream connection. The browser receives an HTTP response from Vite, so the client previously classified it as a generic server failure. Changing only the error-screen wording could not fix that path.

The development proxy now marks failure to obtain an upstream response with a safe `UPSTREAM_UNREACHABLE` envelope and no backend Request ID. Both JSON and binary API clients normalize that explicit marker to the same network error as a rejected fetch. An ordinary upstream 5xx, including an empty 502 or a 503 `UNAVAILABLE`, remains an HTTP server error. No status-only, missing-ID or empty-body heuristic is used to claim a network failure. The proxy preserves the existing target, Host/Origin behavior and cookie/CSRF flow.

`src/api/errors.ts` is the shared page-error presentation helper for network, session/MFA, forbidden, missing resource, server and other errors. Network messages are exactly:

> Qorloop can't reach the server. Check your connection and try again.

Network errors always omit Request ID/Copy and take precedence over page-specific loading-error titles. Try again remains available. Genuine HTTP errors retain response Request IDs and Copy when present. Existing AuthContext session transitions remain in charge of 401/MFA navigation.

Activity, History, Settings, catalogue, pricing, reconciliation, generated-files and team pages already used the common ErrorState. The remaining upload status/review-row/error-row, product-category lookup and generated-file progress query errors now use it too. Upload/download body connection loss is normalized without treating request cancellation as offline. Mutation-specific validation/conflict flows are retained.

The Vite configuration must be reloaded/restarted to use the proxy change; the previously running frontend was restarted after validation.

## Files changed

- API normalization/presentation: `src/api/client.ts`, `src/api/errors.ts`, `src/api/network.ts`.
- Development proxy: `vite.config.ts`, `scripts/devApiProxy.ts`.
- Shared/page rendering: `src/components/common/States.tsx`, `src/components/catalogue/RealProductDetailView.tsx`, `src/components/files/RealGenerateFilesView.tsx`, `src/components/uploads/RealColumnMappingView.tsx`, `src/components/uploads/RealUploadReviewView.tsx`.
- Automated coverage: `scripts/__tests__/devApiProxy.test.ts`, `src/api/__tests__/client.test.ts`, `src/components/activity/__tests__/activity.test.tsx`, `src/components/settings/__tests__/settings.test.tsx`, `src/components/common/__tests__/errorsOffline.test.tsx`, `src/components/pricing/__tests__/priceChange.test.tsx`.
- Report: this file.

## Check evidence

| Check | Result |
| --- | --- |
| Lint | Passed on final source |
| Vitest | 22 files, 357 tests passed; final run 42.79 seconds; `--maxWorkers=2 --bail=1` |
| Memory gate | Final run: 2045 Available MBytes; initial successful run: 1709 MB. All attempts below 1500 MB stopped before starting Vitest. |
| Build | Passed on final source; existing bundle-size warning remains |
| Isolated live proxy case | Real local upstream returns 500 with Request ID, then is stopped; the same Vite proxy returns the marked connection-failure response with no Request ID. Both behaviors passed. The temporary servers close in cleanup. |
| Page cases | Activity, Product History and Settings cover rejected fetch, refused-proxy marker, successful read retry, and genuine 500 with Request ID/Copy. |
| Worker/process crash | None observed |

Memory cleanup used the owner's existing process-stop authorization: Chrome/Phone Link were closed and the running frontend/API/worker were temporarily stopped. Windows was also asked to release IDE resident working-set pages without terminating the IDE or discarding unsaved work; no persistent system setting changed. The three Qorloop development services were restored hidden using their existing npm commands after validation. Startup logs remain local under `.cache/service-logs/` and were not printed. No credentials were printed.

## Unverified

Authenticated browser acceptance against the user's real backend remains unverified. The automated stopped-upstream case uses isolated local servers, not the real backend or its database. No migration or readiness check was run. A production reverse proxy that generates its own HTTP errors remains an HTTP server-error source unless it explicitly identifies an upstream connection failure; this change configures the repository's Vite development proxy.
