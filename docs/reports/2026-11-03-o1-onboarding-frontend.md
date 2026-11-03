# O1 frontend implementation and automated check results

Date: 3 November 2026. Branch: `feature/o1-onboarding`, based on the existing local S1–S3 frontend work. No push, migration or authenticated backend business mutation was performed. Browser acceptance remains pending the owner's verification.

## Enable

Add this public, non-secret line to `.env.local` and restart Vite:

```dotenv
VITE_REAL_ONBOARDING=true
```

The existing real-data flags still govern destination screens. Real upload, comparison, settings, pricing and file workflows respectively need the existing `VITE_REAL_UPLOADS`, `VITE_REAL_RECON`, `VITE_REAL_SETTINGS`, `VITE_REAL_PRICING` and `VITE_REAL_FILES` flags enabled. The onboarding flag does not override them. Vitest explicitly resets every real-data flag, including the new one, and the public API base URL independently of `.env.local`.

The only onboarding request is `GET /api/onboarding`, following the committed backend `docs/onboarding-api.md` and ADR 015. No body, tenant ID, skip/dismiss operation, persisted onboarding state or category step was introduced. The endpoint is schema-free and requires no onboarding migration. The API must be running the committed onboarding implementation before browser acceptance.

## Delivered behavior

- Owners/Admins with `settings.view` see the Get started checklist on Dashboard and Help & onboarding. Other roles make no onboarding request and see no checklist. An empty server step list also renders nothing.
- Required and optional steps are separate. Each renders the API title, plain description, status, action and recorded timestamp where present. Progress is the API `percent`; no click or local state completes a step. Optional work never contributes to the progress bar.
- `complete` hides the Dashboard card. Help & onboarding replaces its demo wizard when the flag is enabled and shows “You're all set” after required completion. Evidence loss can show incomplete progress again; there is no permanent local completion/dismiss flag.
- While incomplete, read-only evidence refreshes every 15 seconds to observe background work. Polling stops for complete/empty responses and errors. Shared error handling supplies connection wording/Try again with no Request ID for network failures, and Request ID/Copy for genuine 5xx responses when supplied. Existing session/MFA handling remains in charge of auth transitions.
- Upload apply/history, accepted/new comparison results, successful team changes/invitations, pricing saves/default restoration and successful file generation invalidate the onboarding query. Queuing work does not locally complete a step. Authentication/MFA transitions already clear workspace caches.
- Timestamps use Asia/Qatar. A null MFA timestamp is not fabricated or treated as incomplete. Per-marketplace rows represent applied-upload evidence, not enabled switches.

## Action targets

Every committed enum maps to an existing route; none is missing:

| Backend target | Frontend destination |
| --- | --- |
| `settings.security` | `/settings#security`; security section anchor works after settings load |
| `uploads.erp` | `/uploads?start=erp`; ERP preselected |
| `uploads.marketplace` | `/uploads?start=marketplace`; no source assumed, marketplace choice required; applied-upload evidence shown |
| `dashboard` | `/` |
| `team.invite` | `/settings/team?invite=1`; invitation form opens without sending anything |
| `settings.pricing` | `/pricing` |
| `generated-files` | `/files` |

Upload/invitation entry parameters are consumed with URL replacement so refresh/closing a dialog does not reopen it. The remaining query parameters are preserved. Other action-screen behavior and permissions remain governed by those screens and the server.

## Files changed

| Area | Files |
| --- | --- |
| Contract/flag | `src/api/onboarding.ts`, `src/lib/features.ts`, `.env.example`, `vitest.setup.ts` |
| Checklist, page, actions, refresh helper | `src/components/onboarding/OnboardingChecklist.tsx`, `OnboardingPage.tsx`, `OnboardingRouteActions.tsx`, `targets.ts`, `shared.ts` |
| Placement/navigation | `src/App.tsx`, `src/routes/paths.ts`, `src/components/layout/Header.tsx`, `src/components/views/DashboardView.tsx` |
| Route entry behavior | `src/context/AppContext.tsx`, `src/components/modals/UploadModal.tsx`, `src/components/uploads/RealUploadModal.tsx`, `src/components/views/TeamView.tsx`, `src/components/settings/RealSettingsView.tsx` |
| Evidence refresh integration | `src/components/uploads/RealUploadReviewView.tsx`, `src/components/uploads/RealUploadsHistoryView.tsx`, `src/components/recon/shared.tsx`, `src/components/pricing/shared.tsx`, `src/components/files/RealGenerateFilesView.tsx`; TeamView also invalidates after successful invitations/team changes |
| New coverage/fixtures | `src/api/__tests__/onboarding.test.ts`, `src/components/onboarding/__tests__/fixtures.ts`, `src/components/onboarding/__tests__/onboarding.test.tsx` |
| Existing coverage updated | `src/components/uploads/__tests__/realUploads.test.tsx`, `src/lib/__tests__/flags.test.ts`, `src/routes/__tests__/paths.test.ts` |
| Docs | `docs/onboarding.md`, this report |

## Automated check evidence

| Check | Result |
| --- | --- |
| Lint | Passed on final source |
| Memory gate before successful Vitest run | 2206 Available MBytes, above the required 1500 |
| Vitest | 24 files, 392 tests passed; 79.96 seconds; `--maxWorkers=2 --bail=1` |
| Build | Passed; existing bundle larger than 500 kB warning remains |
| Whitespace | `git diff --check` passed; staged changes checked before commits |
| Worker/process crash | None observed; no test process started below the memory gate |

Coverage includes the exact GET envelope/empty-role response, new-tenant Admin progress, Owner/null MFA time, out-of-order partial evidence, optional separation, completion hiding/reappearance, periodic completion refresh, all seven route mappings, upload preselection/marketplace choice, invitation dialog entry, network/proxy/500 copy states, completed-upload invalidation, comparison-result invalidation, and invitation refresh. Flags default off in every test.

Early test attempts were blocked below 1500 MB and did not start Vitest. The owner explicitly requested freeing memory. Prior cleanup authorization was used to close Chrome/Phone Link and temporarily stop the frontend; Windows was asked to release resident working-set pages from user applications without terminating them, losing unsaved work or changing persistent settings. Security/database/kernel processes were not targeted. The frontend was restored hidden on port 3000 after checks. The API and worker were already stopped and remain stopped (port 4000 not listening; worker Node count 0). No authentication responses or raw service logs were printed.

## Local logical commits

- Step 1: `0990392` — flagged contract/checklist, target map and docs.
- Step 2: `8e96f0c` — Dashboard/Help placement and functional action destinations.
- Step 3: `e9029f0` — derived-evidence query invalidations.
- Step 4: the local commit containing this report — coverage, polling review adjustment and final check evidence. Use `git log --oneline -4` for its hash.

## Unverified

The owner has not yet checked these O1 workflows in a browser against the real backend. Real-tenant progress, completion transitions after actual uploads/comparisons/invitations, security-anchor scrolling and full destination workflows remain browser acceptance work. No authenticated demo data was changed, and automated results do not establish that real-backend acceptance. Start/restart the API with its committed O1 code and enable the relevant screen flags before that check.
