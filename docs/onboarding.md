# O1 Get started

Add `VITE_REAL_ONBOARDING=true` to `.env.local` and restart Vite. This reads `GET /api/onboarding`; it creates no completion/dismiss records or browser storage. The backend contract is `D:\Qorloop-backend\docs\onboarding-api.md`, with evidence semantics in ADR 015. No migration is required for that endpoint.

Owners/Admins with `settings.view` receive the checklist. Other roles and empty step lists render nothing. Only the four API-required steps count toward the API's `percent`; optional work is labelled separately. The Dashboard card hides on `complete`; Help & onboarding shows a completed empty state. No category/profile step or fabricated timestamp is added. Evidence times are displayed in Asia/Qatar; MFA can be done with a null timestamp.

Every committed target has a real route:

| Target | Route/action |
| --- | --- |
| `settings.security` | `/settings#security` |
| `uploads.erp` | `/uploads?start=erp`, opening upload with ERP preselected |
| `uploads.marketplace` | `/uploads?start=marketplace`, opening marketplace choice without assuming a source |
| `dashboard` | `/` |
| `team.invite` | `/settings/team?invite=1`, opening the invitation form |
| `settings.pricing` | `/pricing` |
| `generated-files` | `/files` |

No target lacks a route. Action screens retain their existing independent flags. To complete real workflows, also enable the relevant existing `VITE_REAL_UPLOADS`, `VITE_REAL_RECON`, `VITE_REAL_SETTINGS`, `VITE_REAL_PRICING` and `VITE_REAL_FILES` flags; otherwise their existing sample-data labeling/mode applies. The onboarding flag does not silently override other feature flags.

Browser acceptance against the real backend remains pending owner verification. No authenticated business mutation or migration is performed as part of implementing the frontend.

Progress is invalidated when an applied upload is observed on Review/Upload history, when a new comparison timestamp arrives, after recompute acceptance, after successful team changes/invitations, after pricing saves (including restoring defaults), and after successful file generation. Upload/comparison queue acceptance never locally completes a step. Authentication/MFA transitions clear the cached workspace as before, so the next checklist reads fresh evidence. No skip/dismiss action or browser completion flag exists.

While visible progress is incomplete, the checklist also refreshes its GET every 15 seconds so background comparison/upload evidence can complete without another click. Polling stops for complete/empty responses or errors; errors retain explicit Try again and the shared connection-recovery behavior.
