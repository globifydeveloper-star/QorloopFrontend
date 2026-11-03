# Settings, Activity and session handling

Add `VITE_REAL_SETTINGS=true` to `.env.local` and restart Vite to enable real Settings, Activity and product History. History also requires `VITE_REAL_CATALOGUE=true`. The flag is public and contains no secret; leave it unset for the existing settings demo. Vitest stubs all real-data flags independently of `.env.local`.

Contracts: `D:\Qorloop-backend\docs\settings-activity-api.md` and the backend's 3 November 2026 implementation report. Settings uses the general revision endpoint, including its reused pricing controls, so all saves on this screen include `expectedRevision`. The separate Marketplace Price screen retains its existing pricing endpoints and permissions. A concurrent change reloads the latest general settings and drops the stale draft.

Store name, thresholds and export policy require `settings.edit`. MFA policy also requires `settings.security`. The screen shows days but validates and sends whole hours (1–8760); 0.5 days is the existing 12-hour default. Time zone and currency are fixed labels. Timestamps are displayed in Asia/Qatar.

Changing price tolerance, stock threshold or pricing queues comparison work in the backend. The screen displays that notice and invalidates product, dashboard-summary and report-row queries after saving. Profile, freshness and policy changes only show a saved notice. No recompute flag is invented in the response.

Real-backend browser verification is pending. The owner must back up the demo database and apply `202611030001_activity_indexes` before verifying these workflows. This frontend task does not run the migration or push commits.

Activity requires `activity.view`; product History also requires `products.view`. Actor filters use a user UUID or `system`; the team datalist is available with `team.view`, while former actors can still be filtered by ID. Date filters use Qatar time and are sent with `+03:00`. Load more passes the opaque cursor unchanged with the same applied filters. The UI preserves server order, renders safe summaries and before/after values, and never displays raw event JSON. History displays the server's exact coverage notice and labels tenant-wide entries as context, not evidence of a product change.

Session loading first calls `GET /api/auth/session`, then `/api/auth/me` only for an authenticated session. Explicit error codes distinguish sign-out, expiry, MFA enrollment, MFA verification and permission failures. Login/MFA rejected credentials do not trigger global expiry. The return path is carried through expiry, login and MFA as a validated local `next` path. `/auth/me` 500 retains “We could not reach Qorloop” and includes Request ID copy controls. Other server, missing-page, permission and connection errors use plain messages, Try again and Request ID copy where the server supplied an ID.

Connection failures and browser offline state show a banner. Active read queries retry on the online event and every 15 seconds while disconnected and the browser reports online. HTTP 4xx/5xx responses do not count as offline. Mutations are never automatically replayed. A CSRF rejection refreshes session status and the next explicit save rereads the CSRF cookie; the API supplies no token-refresh endpoint. If the cookie remains invalid, sign in again. The app does not call `/health/ready`.
