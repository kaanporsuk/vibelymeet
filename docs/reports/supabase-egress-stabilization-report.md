# Supabase Egress Stabilization Report

Date: 2026-05-13
Project: `MVP_Vibe` / `schdyxcunwcvddlcshwd`
Scope: egress/client stabilization. Initial pass avoided schema changes; follow-up hardening adds one read-only dashboard RPC migration (`get_dashboard_visible_matches`) to move archive filtering before the visible-card limit.

## Evidence Summary

`pg_stat_statements` is useful but incomplete for Supabase egress. It sees database work, including Realtime internals, but not the full browser/Auth/Storage/Edge/CDN egress surface. Evidence is split below.

| Surface | Evidence | Assessment |
|---|---:|---|
| Database/PostgREST | Production auth `/home` trace: 28 requests, ~33.9 KB before. Patched local trace: 27 requests, ~35.1 KB. | Main boot chatter remains here, but high-risk overfetches were reduced: profile bootstrap select narrowed, dashboard matches limited, notification rows deferred. Date suggestions/date plans still dominate bytes. |
| RPC | Production auth trace: 9 calls, ~1.5 KB. Patched local: 8 calls, ~1.4 KB. | `get_my_location_data` dropped from 2 calls to 1 by cache/in-flight dedupe. `resolve_entry_state` now has timeout fallback. |
| Auth | Production auth trace: 1 `/auth/v1/user`, ~2.2 KB. Patched local: 0 network Auth calls on boot. | Bootstrap now uses the session user when present and only falls back to `getUser` with timeout. |
| Edge Functions | Production traces showed `/functions/v1/health` twice on anonymous and authenticated boot. Current code removes the normal browser boot health probe; the in-page guard caches the first health result per boot for stale bundles or hidden callers. | Normal browser boot should make zero health calls; any unexpected health caller is capped to one network attempt per boot. |
| Realtime | `supabase inspect db calls`: `realtime.list_changes` was top DB work: ~6.8M calls plus ~1.0M calls, ~63.1% of total statement execution time. | Realtime is the strongest systemic suspect. Client now exposes channel counts, prunes duplicates, removes all channels on logout, and narrows obvious broad listeners. |
| Storage | Boot trace did not show Supabase Storage downloads. `storage.objects` is write-heavy in table stats but not a boot egress source in this trace. | Leave intentional Supabase buckets such as `proof-selfies` alone. |
| Media/CDN | Auth boot loaded 2 Bunny/CDN photo assets, ~20.3 KB before and after. | Photo media was served from CDN. URL rewriting remains restricted to confirmed Bunny-backed `photos/`, `events/`, `voice/`, and `media/` paths. Chat video remains separate via `get-chat-media-url`. |

Cron inventory: 19 active cron jobs were observed read-only. Every-minute jobs include `send_event_reminders`, `expire_video_date_reconnect_graces`, `expire_stale_video_sessions`, `expire_stale_match_calls`, `finalize_due_events`, queue unclaiming, and several `net.http_post` Edge Function calls. No cron changes were made in this pass.

## Boot Trace Counts

Artifacts:
- Before deploy/current production: `artifacts/supabase-egress-traces/boot-trace-2026-05-12T23-15-23-073Z.json`
- After patch/local dev: `artifacts/supabase-egress-traces/boot-trace-2026-05-12T23-18-34-459Z.json`

Note: the local “after” trace was captured before the final `OfflineBanner` cleanup. Current code has no normal UI caller for `/functions/v1/health`; rerun the trace after deploy for definitive current counts.

| Trace | Requests | Estimated bytes | Health calls | Realtime opens | Notes |
|---|---:|---:|---:|---:|---|
| Anonymous `/home` before | 2 | 4 B | 2 | 0 | Redirected to `/auth`; both requests were `/functions/v1/health`. |
| Anonymous `/home` after | 1 | 2 B | 1 | 0 | Health cap active; diagnostics reported 1 network health call and 1 capped call. |
| Authenticated `/home` before | 43 | ~58.0 KB | 2 | 1 | Included `getUser`, 2 `get_my_location_data`, notification row fetch `select=*`, broad profile select. |
| Authenticated `/home` after | 39 | ~56.8 KB | 1 | 1 | Removed Auth network call, one location RPC, health duplicate, and notification rows. Large date-suggestion reads still dominate bytes. |

Top before/after request changes:
- `/functions/v1/health`: 2 -> 1 in the pre-cleanup local trace; current code removes the normal browser caller, so post-deploy expectation is 0 normal boot calls.
- `/rest/v1/rpc/get_my_location_data`: 2 -> 1.
- `/auth/v1/user`: 1 -> 0 on normal boot.
- `profiles` bootstrap select: ~1.1 KB broad row -> ~0.8 KB narrowed row.
- `user_notifications select=* limit=80`: 1 -> 0 on initial boot; rows now wait for the notification drawer.
- Dashboard matches now use `get_dashboard_visible_matches` so archived conversations are filtered server-side before the 5-card limit. The client keeps a narrow fallback for deploy-order safety if the RPC is temporarily missing.

## Code Changes

- Added production-safe boot diagnostics in `src/lib/browserDiagnostics.ts`: `window.__vibelyBootDiagnostics`, request counts/timing/bytes by surface, health counts, realtime channel counts, duplicate topics, and cleanup events.
- Added a one-network-attempt-per-boot cache/cap for `/functions/v1/health`; duplicate same-boot callers replay the captured first response and emit `browser.health_check_capped`.
- Added bootstrap timeout/finally guards in `src/contexts/AuthContext.tsx` for `getSession`, profile load, pause refresh, `getUser`, `resolve_entry_state`, notification logout clear, and `signOut`.
- Added retryable entry-state fallback so stalled Supabase access routes to recovery instead of trapping the global spinner.
- Added realtime lifecycle diagnostics and cleanup: instrumentation in `src/App.tsx`, duplicate pruning on route change/hidden/pagehide, and full channel removal on logout.
- Narrowed or removed broad realtime listeners:
  - Removed global `messages` listener from `WebHomeUnreadInvalidator`.
  - Filtered `event_registrations` realtime by `profile_id` on web and native.
  - Filtered `matches` realtime by both participant columns on web and native.
  - Removed broad `tier_config_overrides` realtime from web and native entitlements.
- Reduced dashboard boot traffic:
  - Cached/deduped `get_my_location_data` on web and native, with cache clears after logout, account switch, and location updates.
  - Deferred notification inbox rows until drawer open on web and native.
  - Paused home unread, event reminder, event deck, tab badge, daily-drop badge, and app badge polling in hidden/background states; moved home unread to 60 seconds.
  - Moved dashboard match visibility filtering into a read-only RPC, with profile fanout limited to 5 rows.
  - Narrowed schedule-hub/date-planning relation selects used by dashboard reminders and chat planning.
  - Narrowed count-only and mute-state reads to scalar columns instead of full rows.
- Reduced write churn:
  - Activity heartbeat is visible/foreground only and every 5 minutes on web and native.
  - Push sync signatures persist briefly in localStorage so unchanged `notification_preferences` upserts are skipped across boot/focus loops.
- Media routing: only confirmed Bunny-backed `photos/`, `events/`, `voice/`, and `media/` paths are rewritten to Bunny/CDN. Chat video remains resolved by `get-chat-media-url`; `proof-selfies` and other intentional Supabase buckets are untouched.
- Added `scripts/supabase-egress-boot-trace.mjs` and `npm run trace:supabase-egress`.
- Added native/mobile parity hardening: auth bootstrap/sign-out timeouts, stale entry-state guards, fallback entry-state recovery, duplicate realtime pruning on route/app-state changes, and full realtime cleanup on native sign-out.
- Added Playwright coverage in `e2e/boot-timeout.spec.ts` for stalled Supabase boot requests exiting the global spinner.

## Remaining Risks

- Realtime `list_changes` is still the largest provider-side signal. This pass reduced duplicate/broad client listeners, but other routes, native clients, or stale deployed bundles can still create churn.
- Some non-boot detail/admin routes still have broader reads (`event details`, `daily drop`, selected admin monitoring views); they were left for route-specific follow-up instead of changing unrelated UX surfaces in the egress hot path.
- Notification count queries still run on boot; row payloads are deferred, but exact counts remain a small DB workload.
- Cron/`net.http_post` activity is significant in `pg_stat_statements`; it was deliberately left unchanged because the requested first pass was frontend-only.
- The after trace was run locally against production Supabase before deployment. Re-run `npm run trace:supabase-egress` after deploy for definitive production counts.

## Verification

Original stabilization verification passed:
- `npm run test:browser-diagnostics`
- `npm run test:request-reduction-contract`
- `npm run lint` (one pre-existing warning in `src/hooks/useMatchCall.tsx`)
- `npm run build`
- Local Playwright sanity check: no Vite overlay, body rendered, no console/page errors.

Follow-up cleanup audit did not rerun web/native builds. No-build checks passed: browser diagnostics, request-reduction contracts, core TypeScript, mobile TypeScript, web app TypeScript, lint with the same pre-existing warning, Bunny/media contracts, notification inbox contracts, realtime/date-suggestion contracts, proof-selfie contracts, chat media cache, and `git diff --check`.

Post-deploy acceptance:
- Anonymous and authenticated `/home`: expected zero normal `/functions/v1/health` browser calls; max one network call per boot if a stale/hidden caller still invokes it.
- `window.__vibelyBootDiagnostics.realtime.duplicateActiveTopics` remains empty.
- Realtime channel count returns to baseline after route change/logout.
- No initial notification row fetch until the drawer opens.
- Authenticated boot keeps the reduced Auth/RPC/profile/query shape shown in the patched local trace.
