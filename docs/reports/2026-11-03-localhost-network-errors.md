# Localhost network-error follow-up

Date: 3 November 2026. Local commit only; no push. API remains stopped as requested.

## Findings and change

The shared page helper, rejected-fetch normalization, Activity/History/Settings page coverage, and real 5xx Request ID/Copy behavior already exist in commit `7fe2f26`. Before this follow-up, unauthenticated reads through the running frontend for `/api/activity`, `/api/settings` and `/api/auth/session` each returned `503 UPSTREAM_UNREACHABLE` with the API stopped. That marker is normalized as a network error by the shared client. Only safe status/code metadata was inspected; no credentials, cookies, tokens or raw logs were printed.

The proxy's connection classifier previously inspected only the outer error code. This follow-up also recognizes nonempty aggregates whose nested errors are all explicit connection failures. This covers localhost/dual-stack refusal error shapes without labeling unknown, empty or mixed aggregates as connection failures. The observed frontend log contains AggregateError and ECONNREFUSED; the live reads already returned the correct marker, so this does not establish that a missing outer code caused the reported browser screen.

The isolated live proxy regression now runs against both IPv4 and `localhost`: a real upstream 500 retains its Request ID, then stopping that upstream produces the network marker without a Request ID. New cases also cover aggregates without an outer code and reject unknown/mixed aggregates. Genuine upstream HTTP 5xx handling, 401/session handling, and the existing shared page helper remain unchanged.

The frontend alone was reloaded after validation to load the proxy helper. The API was not started. Because this environment can disable HMR, an already-open browser should fully reload (`Ctrl+Shift+R`) to load the committed API-client/shared-helper code. A stale client is a possible explanation for the generic message, not a confirmed browser diagnosis.

## Files changed

- `scripts/devApiProxy.ts`: recognize explicit nested connection failures.
- `scripts/__tests__/devApiProxy.test.ts`: localhost live proxy and aggregate-error regressions.
- This report.

## Checks

| Check | Result |
| --- | --- |
| Lint | Passed |
| Memory gate | 2135 Available MBytes before the successful run; attempts below 1500 did not start tests |
| Vitest | 22 files, 362 tests passed; 27.10 seconds; `--maxWorkers=2 --bail=1` |
| Build | Passed; existing bundle-size warning remains |
| Worker/process crash | None observed |

The existing process-cleanup authorization was used to close Chrome/Phone Link and release IDE resident working-set pages without closing the IDE, losing unsaved work or changing persistent settings. The API remained stopped throughout. No migration, readiness call or authenticated backend mutation was performed.

## Unverified

Actual rendering in the user's existing authenticated browser remains unverified. The generic browser screen was not reproduced in this turn: live proxy responses were already correctly marked. The page rendering and Request ID/Copy cases passed as automated checks. If the generic screen persists after a full reload, the exact browser origin/port and safe response status/code are still needed to identify a different frontend or gateway path.
