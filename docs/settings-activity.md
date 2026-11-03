# Settings, Activity and session handling

Add `VITE_REAL_SETTINGS=true` to `.env.local` and restart Vite to enable real Settings, Activity and product History. History also requires `VITE_REAL_CATALOGUE=true`. The flag is public and contains no secret; leave it unset for the existing settings demo. Vitest stubs all real-data flags independently of `.env.local`.

Contracts: `D:\Qorloop-backend\docs\settings-activity-api.md` and the backend's 3 November 2026 implementation report. Settings uses the general revision endpoint, including its reused pricing controls, so all saves on this screen include `expectedRevision`. The separate Marketplace Price screen retains its existing pricing endpoints and permissions. A concurrent change reloads the latest general settings and drops the stale draft.

Store name, thresholds and export policy require `settings.edit`. MFA policy also requires `settings.security`. The screen shows days but validates and sends whole hours (1–8760); 0.5 days is the existing 12-hour default. Time zone and currency are fixed labels. Timestamps are displayed in Asia/Qatar.

Changing price tolerance, stock threshold or pricing queues comparison work in the backend. The screen displays that notice and invalidates product, dashboard-summary and report-row queries after saving. Profile, freshness and policy changes only show a saved notice. No recompute flag is invented in the response.

Real-backend browser verification is pending. The owner must back up the demo database and apply `202611030001_activity_indexes` before verifying these workflows. This frontend task does not run the migration or push commits.
