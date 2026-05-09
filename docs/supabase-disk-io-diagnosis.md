# Supabase Disk IO Diagnosis — Vibely (project `schdyxcunwcvddlcshwd`)

> Repo-grounded audit. **No production changes performed.** Live DB-level diagnostics (pg_stat_statements, table-size, dead tuples, cache-hit ratio) were not collected in this pass and are listed as follow-up evidence in Appendix A.

**Date:** 2026-05-09
**Working tree:** `Git/vibelymeet/` (linked to Supabase project ref `schdyxcunwcvddlcshwd` per `supabase/.temp/linked-project.json`)
**Method:** static repo audit only — three parallel exploration passes (frontend polling/realtime, Edge Functions + crons, migrations/RPCs/indexes), with the highest-impact claims verified by direct file reads.

---

## 1. Executive summary

**Top-line read:** the Disk IO pressure is **mixed** — partly write-amplification from realtime + audit-style writes, partly a small number of high-frequency client polls and cron-driven scans, and possibly small index/scan inefficiencies in newer admin read models. It is **not** a single runaway query; it's the sum of many small but very frequent operations.

**Recommendation on compute:** an immediate compute-tier bump is reasonable as a short-term shock absorber **only if** Disk IO is currently saturating the budget and on-call needs headroom. It is **not a substitute** for the fixes in §10 — without those, the same bump will be consumed within weeks as user count grows.

**Top three causes (ranked by likely contribution):**

1. **Admin realtime fan-out** — 14 unfiltered `postgres_changes` channels in `useAdminRealtime` invalidating overview/engagement queries on every mutation across `messages`, `profiles`, `matches`, `events`, `event_registrations`, `daily_drops`, `notification_log`, `user_reports`, `support_*`, `photo_verifications`, `admin_notifications`. The `messages` INSERT subscription alone triggers two heavy aggregation refetches per message app-wide.
2. **Per-minute pg_cron jobs without jitter** — at least 6 jobs at `* * * * *` (event-reminders-enqueue, event-reminders-sweep-stale-claims, event-lifecycle-auto-finalize, video-date-room-cleanup-minutely, post-date-half-verdict-timeout, date-reminder-cron) plus several `*/5 * * * *`. Most fire at `:00` simultaneously (thundering herd) and several scan tables that may lack the right partial index.
3. **Daily `generate-daily-drops` batch** — full `profiles` scan with 19 columns and a JS-side filter (no WHERE pushdown for `discoverable`/`account_paused`/`discovery_mode`), followed by chunked reads of `matches`, `blocked_users`, `user_reports`, `daily_drop_cooldowns`, `event_registrations`, `events`, `vibe_tags`, `profile_vibes`, then a bulk insert into `daily_drops` and a 25-concurrent fan-out to `send-notification`. One spike per day, but a large one.

Secondary contributors: 15 s `get_event_deck` polling per lobby user, 4 s web chat outbox tick, 3-min badge count + AppState-triggered refetch on every mobile foreground (no debounce), `event-reminder-queue` claim/deliver split (2–3 UPDATEs per delivery + per-minute stale-claim sweeper), and the recently added `user_notifications` table (4 partial indexes, no retention).

### Confirmed vs hypothesis

| | Confirmed by code reading | Pending live DB evidence |
|---|---|---|
| Cron schedules and frequencies | ✅ | — |
| Polling intervals and payloads | ✅ | — |
| Edge Function read/write patterns | ✅ | — |
| Realtime channel fan-out | ✅ | — |
| Existing index inventory on hot tables | ✅ (from migrations) | Live `pg_stat_user_indexes.idx_scan` to confirm usage |
| Whether each cron predicate is actually using its index | — | EXPLAIN ANALYZE in Studio |
| Whether the `events` finalize predicate seq-scans | — | EXPLAIN ANALYZE |
| Top IO consumers ranked by `shared_blks_read` | — | `pg_stat_statements` |
| Cache hit ratio, temp-file pressure, dead-tuple stats | — | `pg_statio_*`, `pg_stat_database` |

---

## 2. Evidence table

| # | Sev | Surface | File / Function / Table | Code evidence | Why it raises Disk IO | Recommended fix | Risk | Expected impact | How to validate |
|---|-----|---------|------------------------|---------------|-----------------------|----------------|------|-----------------|----------------|
| 1 | **High** | Admin dashboard | [src/hooks/useAdminRealtime.ts:80-223](../src/hooks/useAdminRealtime.ts#L80-L223) | 14 channels with `event:'*'` and no `filter:`; `messages` INSERT cascades to `invalidateOverview()` + `invalidateEngagement()` per message | Every admin viewing dashboard receives a realtime push for every mutation app-wide; each push refetches expensive aggregations | Add `filter:` (e.g., scope `messages` to `created_at>=now()-1h` or eliminate; debounce all invalidations 1.5–3 s; don't invalidate engagement on per-message INSERT) | Low — admin-only UI | Removes a steady high-frequency refetch loop on heavy RPCs | Watch `admin_get_engagement_analytics` invocation rate before/after |
| 2 | **High** | Cron | `event-reminders-sweep-stale-claims` `* * * * *` ([20260508141000_event_reminder_queue_claim_deliver_split.sql:240](../supabase/migrations/20260508141000_event_reminder_queue_claim_deliver_split.sql#L240)) | Calls `unclaim_stale_event_reminder_queue_rows(120, 500)` every minute | Index probe + UPDATEs on every claimed row past TTL; runs even when queue is empty; no jitter | Move to `*/2` or `*/5` once steady-state delivery latency is observed; verify `idx_event_reminder_queue_stale_claims` is being used (EXPLAIN) | Low — sweeper is a safety net | Halves probe rate | `cron.job_run_details` runtime, EXPLAIN on the sweeper |
| 3 | **High** | Cron | `event-lifecycle-auto-finalize` `* * * * *` ([20260508103000_event_lifecycle_auto_finalization.sql](../supabase/migrations/20260508103000_event_lifecycle_auto_finalization.sql)) | `finalize_due_events()` looks for `archived_at IS NULL AND ended_at IS NULL AND event_date + duration <= now()` | If no partial index covers the predicate, this is a per-minute seq scan of `events` | Confirm index. If absent, propose a partial index such as `(event_date) WHERE archived_at IS NULL AND ended_at IS NULL` (do not create blindly — verify with EXPLAIN first) | Low — index migration is reversible | Replaces seq scan with bounded index probe | EXPLAIN ANALYZE on `finalize_due_events()` SQL |
| 4 | **High** | Cron | `date-reminder-cron` `* * * * *` ([supabase/functions/date-reminder-cron/index.ts](../supabase/functions/date-reminder-cron/index.ts)) | Two scans of `date_plans` (30 m / 5 m windows), then **N+1 lookup** of `date_suggestions` per matched plan, then per-user `send-notification` invoke | 1440 runs/day × N+1 RPC calls = many small queries | Fold proposer/recipient IDs into `date_plans` (denormalize) so the suggestion lookup is removed; or batch-fetch suggestions by `IN(plan_ids)`; cache event titles likewise | Med — denormalization needs guard | Eliminates N+1 on the hottest reminder cron | Count `date_suggestions` SELECT calls/min from `pg_stat_statements` |
| 5 | **High** | Cron | `event-reminders-enqueue` `* * * * *` + `claim_due_event_reminder_queue_rows()` claims up to 100 rows/min ([supabase/functions/event-reminders/index.ts:112-125](../supabase/functions/event-reminders/index.ts#L112-L125)) | Per-claimed row, separate `event_registrations` SELECT inside the loop | N+1; per-row `mark_event_reminder_queue_row_delivered` is another UPDATE | Pre-join `admission_status` into the claim RPC return rows; or upsert `event_registrations` snapshot into the queue row at enqueue time | Low | Removes 1 UPDATE + 1 SELECT per delivered row | `pg_stat_statements` for `event_registrations` SELECT |
| 6 | **High** | Daily batch | [supabase/functions/generate-daily-drops/index.ts:421-489](../supabase/functions/generate-daily-drops/index.ts#L421-L489) | `profiles.select('id,name,gender,interested_in,age,…discovery_audience').or('is_suspended.is.null,is_suspended.eq.false')` then JS filters on `discoverable`, `discovery_mode`, `account_paused`, `last_seen_at` | One full `profiles` scan; followed by chunked reads of 6 dependent tables and a bulk insert to `daily_drops`; 25-concurrent fan-out to `send-notification` | (a) Push the JS predicate into SQL via a partial/expression index `(last_seen_at, updated_at) WHERE NOT is_suspended AND discoverable IS NOT FALSE AND COALESCE(account_paused,false)=false`. (b) Replace inline `send-notification` fan-out with a queue table drained by a separate worker (matches the `event-reminders` pattern). | Med — index design must be verified | Cuts the daily IO spike substantially | Compare run duration in `daily_drop_generation_runs` |
| 7 | **High** | Lobby polling | [src/hooks/useEventDeck.ts:39-40](../src/hooks/useEventDeck.ts#L39-L40) and [apps/mobile/lib/eventsApi.ts:602-603](../apps/mobile/lib/eventsApi.ts#L602-L603) | `refetchInterval: 15000, staleTime: 10000`, `get_event_deck(p_limit:50)` | Per active lobby user, one RPC every 15 s; payload includes 50 hydrated profiles (photos, prompts, vibes, location) | Increase to 30–45 s; have realtime push lobby joins/leaves to invalidate; reduce payload to `id, name, age, primary_photo_url, vibe_tags`, hydrate the rest on tap | Low — UX impact bounded | Linear reduction in deck RPC volume | RPC count for `get_event_deck` from logs |
| 8 | **Med** | Web chat outbox | [src/contexts/WebChatOutboxContext.tsx:403-405](../src/contexts/WebChatOutboxContext.tsx#L403-L405) | `setInterval(tick, 4000)` always running while tab is open; tick polls `messages.select('id')` for hydration confirmation | 4 s tick × N web tabs; runs even when outbox empty | Short-circuit when outbox empty; use per-message exponential backoff; ride realtime INSERT instead of polling | Low | Removes the always-on 4 s wakeup | Wall-clock SELECTs/min on `messages` |
| 9 | **Med** | Mobile badge | [apps/mobile/lib/useBadgeCount.ts:43-92](../apps/mobile/lib/useBadgeCount.ts#L43-L92) | 3 count queries (`messages`, `daily_drops×2`); `refetchInterval: 180_000`; `AppState change → 'active'` invalidates with **no debounce** | Foreground events fire frequently (lock/unlock); each fires 3 head:true count queries; the OR-filter on `daily_drops` may not use a perfect index | Debounce AppState invalidate (skip if last fetch <30 s); replace with one RPC returning `{unread, drops_a, drops_b}` to amortize round-trips | Low | Cuts duplicate counts on bouncy foregrounds | Count queries/min on `messages` and `daily_drops` |
| 10 | **Med** | Realtime fan-out | [src/hooks/useEvents.ts:32-59](../src/hooks/useEvents.ts#L32-L59) | `events-realtime` channel: `event:'*'` on `events` and `event_registrations`, no filter; invalidates 6–7 query keys per change | Every event/registration mutation pushes to **all** logged-in users; combined with per-minute `finalize_due_events`, every user gets per-minute invalidations during peak | Filter to user-relevant scope (city, registered events) or move event list to a 60 s `staleTime` and rely on `refetch` on dashboard return | Med — touches global home data freshness | Removes the per-minute global broadcast | Count `events` realtime payloads per session |
| 11 | **Med** | Cron + per-row API | [supabase/functions/match-call-room-cleanup/index.ts:44-52](../supabase/functions/match-call-room-cleanup/index.ts#L44-L52) and [video-date-room-cleanup/index.ts:181-190](../supabase/functions/video-date-room-cleanup/index.ts#L181-L190) | `*/5 * * * *`, scan + per-row Daily.co DELETE | DB cost is bounded (`limit 40`); the heavier cost is external API + per-row UPDATE | Confirm partial indexes exist on `(ended_at) WHERE provider_deleted_at IS NULL` and on `(ended_at) WHERE daily_room_name IS NOT NULL`; otherwise the scans are a sequential probe | Low | Bounded; mostly external API cost | EXPLAIN on the SELECTs |
| 12 | **Med** | Recently added | [20260509143000_user_notifications_live_attention_center.sql](../supabase/migrations/20260509143000_user_notifications_live_attention_center.sql) | `user_notifications` has 4 partial indexes (timeline, unseen, unread, group); `mark_*` RPCs UPDATE multiple state columns | Every state transition (seen → read → opened → dismissed) maintains 4 indexes; bulk mark-read updates dozens of rows in one txn | Add a retention worker (delete dismissed > 30 d, hard-delete > 90 d). Confirm the unread/unseen partial indexes are actually used; consider collapsing `seen_at` and `read_at` into one ordered enum if the analytics value is low. | Low | Bounds growth of a brand-new hot table | Table size + index size in `pg_stat_user_indexes` |
| 13 | **Med** | Notifications client | [src/hooks/useNotificationInbox.ts:75-167](../src/hooks/useNotificationInbox.ts#L75-L167) | 3 queries (rows + 2 counts) all invalidated together on every realtime event | Cascading refetches per notification | Patch counts incrementally on the client; only refetch row list when the page is visible | Low | Cuts 2 of 3 refetches per event | RPC count on `mark_*` paths |
| 14 | **Med** | Polling | [src/hooks/useAdminEngagementAnalytics.ts:141-142](../src/hooks/useAdminEngagementAnalytics.ts#L141-L142) | `refetchInterval: 30_000` on `admin_get_engagement_analytics()` | 30-day windowed scans on 6 hot tables every 30 s while dashboard open | Increase to 120 s; or memoize server-side for 60 s; or make the dashboard pull on tab-focus only | Low | 4× reduction in heaviest admin read | Watch RPC duration in logs |
| 15 | **Low** | Lobby fallback | [src/components/lobby/ReadyGateOverlay.tsx:1669-1693](../src/components/lobby/ReadyGateOverlay.tsx#L1669-L1693) | `intervalMs = realtimeDegraded ? 1_000 : 2_000` — this is **not** a 1 s loop in normal operation | Only an issue when realtime degrades; bounded by `dateNavigationStartedRef` | Add jitter; cap fallback poll rate at 5 s with exponential backoff after 3 misses | Low | Avoids storms when realtime stalls | Look for log spikes during realtime brownouts |
| 16 | **Low** | Webhook audit | [supabase/functions/stripe-webhook/index.ts](../supabase/functions/stripe-webhook/index.ts), [revenuecat-webhook/index.ts](../supabase/functions/revenuecat-webhook/index.ts) | `payment_observability_logs` insert per event | Append-only, but unbounded growth | Add a retention cron (e.g., delete > 180 d) | Low | Bounds long-term table size | Table size growth chart |

(Severity is repo-grounded; final ranking should be reconfirmed against live `pg_stat_statements`.)

---

## 3. Route / file / function map

**Web routes likely contributing** (`src/pages/*.tsx`, mounted in [src/App.tsx](../src/App.tsx)):

- `Dashboard` (events list + 30 s poll), `EventLobby` (deck poll + ready gate), `Chat` (outbox runner), `NotificationInbox`, all `Admin*` pages.

**Hooks doing the heavy lifting:**

- [src/hooks/useAdminRealtime.ts](../src/hooks/useAdminRealtime.ts) (14 channels)
- [src/hooks/useAdminEngagementAnalytics.ts](../src/hooks/useAdminEngagementAnalytics.ts) (30 s aggregation poll)
- [src/hooks/useAdminOverviewDashboard.ts](../src/hooks/useAdminOverviewDashboard.ts) (30 s poll)
- [src/hooks/useEventDeck.ts](../src/hooks/useEventDeck.ts) (15 s lobby poll)
- [src/hooks/useEvents.ts](../src/hooks/useEvents.ts) (`useRealtimeEvents` global)
- [src/hooks/useNotificationInbox.ts](../src/hooks/useNotificationInbox.ts)
- [src/hooks/useDailyDrop.ts](../src/hooks/useDailyDrop.ts)
- [src/hooks/useMatchQueue.ts](../src/hooks/useMatchQueue.ts)
- [src/hooks/useRealtimeMessages.ts](../src/hooks/useRealtimeMessages.ts)
- [src/contexts/WebChatOutboxContext.tsx](../src/contexts/WebChatOutboxContext.tsx)
- [apps/mobile/lib/useBadgeCount.ts](../apps/mobile/lib/useBadgeCount.ts)
- [apps/mobile/lib/useNotificationInbox.ts](../apps/mobile/lib/useNotificationInbox.ts)
- [apps/mobile/lib/eventsApi.ts](../apps/mobile/lib/eventsApi.ts) (mobile event deck)

**Edge Functions / Crons of interest** (full inventory in §5 + Appendix B):

- High-frequency: `event-reminders`, `date-reminder-cron`, `process-waitlist-promotion-notify-queue`, `match-call-room-cleanup`, `video-date-room-cleanup`, `post-date-half-verdict-timeout`, `event-lifecycle-auto-finalize`, `event-reminders-sweep-stale-claims`.
- Daily: `generate-daily-drops`, `check-daily-drop-health`, `daily-drop-health-alert`.
- Webhooks: `stripe-webhook`, `revenuecat-webhook`, `video-webhook`, `push-webhook`.
- Heavy fan-out: `send-notification`, `send-message`.

**Tables most touched** (and § with details):

- Hot read-write: `messages`, `event_swipes`, `matches`, `daily_drops`, `event_registrations`, `event_reminder_queue`, `user_notifications`, `notification_log`.
- Hot read-mostly: `profiles`, `events`, `support_tickets`.
- Audit/append: `admin_activity_logs`, `payment_observability_logs`, `daily_drop_generation_runs`, `video_date_launch_latency_checkpoints`, `event_loop_observations`.

**RPCs of note:**

- `handle_swipe()` ([20260507194000](../supabase/migrations/20260507194000_tier_config_swipe_idempotency_repair.sql))
- `admin_get_engagement_analytics()` ([20260507201000](../supabase/migrations/20260507201000_admin_engagement_analytics_read_model.sql))
- `admin_get_support_inbox()` ([20260507180000](../supabase/migrations/20260507180000_admin_support_inbox_governed.sql))
- `claim_due_event_reminder_queue_rows()` / `unclaim_stale_event_reminder_queue_rows()` ([20260508141000](../supabase/migrations/20260508141000_event_reminder_queue_claim_deliver_split.sql))
- `finalize_due_events()` ([20260508103000](../supabase/migrations/20260508103000_event_lifecycle_auto_finalization.sql))
- `expire_pending_daily_drops()` / `apply_drop_cooldown()` ([20260509220000](../supabase/migrations/20260509220000_daily_drop_cooldown_and_expire_rpcs.sql))
- `mark_notifications_seen/read/opened/dismissed()` and `mark_all_notifications_read()` ([20260509143000](../supabase/migrations/20260509143000_user_notifications_live_attention_center.sql))

**Env / config:**

- `supabase/config.toml` — many cron-triggered Edge Functions disable JWT (`verify_jwt = false`) and rely on a CRON_SECRET bearer; cron scheduling itself is rewired to read from Vault ([20260509230000](../supabase/migrations/20260509230000_rewire_guc_crons_to_vault.sql)).

---

## 4. Polling / realtime inventory

| Source | File / line | Trigger | Frequency | Query/RPC | Read/Write | Cleanup | Recommendation |
|---|---|---|---|---|---|---|---|
| Global RQ default | [src/lib/queryClient.ts:10](../src/lib/queryClient.ts#L10) | All queries | `staleTime: 30_000` | n/a | n/a | n/a | Increase global staleTime to 60 s; per-query opt-in to lower values |
| Event deck (web) | [src/hooks/useEventDeck.ts:39](../src/hooks/useEventDeck.ts#L39) | While in lobby | 15 s | `get_event_deck(50)` | Read | RQ unmount | 30–45 s + push-only updates |
| Event deck (mobile) | [apps/mobile/lib/eventsApi.ts:602](../apps/mobile/lib/eventsApi.ts#L602) | While in lobby | 15 s | `get_event_deck(50)` | Read | RQ unmount | Same |
| Web chat outbox tick | [src/contexts/WebChatOutboxContext.tsx:403](../src/contexts/WebChatOutboxContext.tsx#L403) | Always while tab open | 4 s | local + occasional `messages.select('id')` | Read | clearInterval | Skip when empty; rely on realtime |
| Mobile badge | [apps/mobile/lib/useBadgeCount.ts:71](../apps/mobile/lib/useBadgeCount.ts#L71) | Background + AppState | 180 s + every foreground | 3 count queries | Read | RQ unmount | Debounce AppState; consolidate into one RPC |
| Mobile unread tab | [apps/mobile/app/(tabs)/_layout.tsx:45](../apps/mobile/app/(tabs)/_layout.tsx#L45) | Tab visible | 180 s | unread RPC | Read | RQ unmount | Keep |
| Daily drop tab badge (mobile) | [apps/mobile/lib/useDailyDropTabBadge.ts:32](../apps/mobile/lib/useDailyDropTabBadge.ts#L32) | While shell mounted | 60 s | drop count | Read | RQ unmount | Push via realtime instead |
| Web dashboard | [src/pages/Dashboard.tsx:291](../src/pages/Dashboard.tsx#L291) | While visible | 30 s | dashboard payload | Read | RQ unmount | 60 s |
| Admin overview | [src/hooks/useAdminOverviewDashboard.ts:113](../src/hooks/useAdminOverviewDashboard.ts#L113) | Admin dashboard | 30 s | overview RPC | Read | RQ unmount | 60 s |
| Admin engagement | [src/hooks/useAdminEngagementAnalytics.ts:141](../src/hooks/useAdminEngagementAnalytics.ts#L141) | Admin dashboard | 30 s | `admin_get_engagement_analytics()` | Read | RQ unmount | 120 s + tab-focus |
| Admin live event metrics | [src/components/admin/AdminLiveEventMetrics.tsx:466,521,561](../src/components/admin/AdminLiveEventMetrics.tsx#L466) | Admin live | 10/15/60 s | live queue, payment, analytics RPCs | Read | RQ unmount | 30/30/120 s |
| Admin reports/notifications/operations | various `admin/*Panel.tsx` | Admin | 30–60 s | various | Read | RQ unmount | Consolidate; pull on tab focus |
| Ready Gate fallback | [src/components/lobby/ReadyGateOverlay.tsx:1671](../src/components/lobby/ReadyGateOverlay.tsx#L1671) | While in gate | 2 s normal, 1 s if degraded | reconcile RPC | Read | clearInterval | Add jitter; cap fallback to 5 s + backoff |
| Admin realtime (14 ch) | [src/hooks/useAdminRealtime.ts:80-223](../src/hooks/useAdminRealtime.ts#L80-L223) | Mutations | Push | n/a | Read trigger | removeChannel | Add filters; debounce all invalidations 1.5 s+ |
| Global events realtime | [src/hooks/useEvents.ts:32-59](../src/hooks/useEvents.ts#L32-L59) | Mutations | Push | n/a | Read trigger | removeChannel | Filter by viewer scope |
| Match queue realtime | [src/hooks/useMatchQueue.ts:290-320](../src/hooks/useMatchQueue.ts#L290-L320) | Mutations | Push | refresh queue | Read | removeChannel | Keep |
| Messages realtime | [src/hooks/useRealtimeMessages.ts:120-150](../src/hooks/useRealtimeMessages.ts#L120-L150) | Mutations | Push | thread invalidate | Read | removeChannel | Patch incrementally instead of invalidate |
| Notifications realtime | [src/hooks/useNotificationInbox.ts:131-141](../src/hooks/useNotificationInbox.ts#L131-L141) | Mutations | Push | 3-query refetch | Read | removeChannel | Patch counts incrementally |
| Entitlements / Premium / Subscription realtime | profiles/subscriptions | Push | n/a | Read | removeChannel | Keep but ensure not duplicated across providers |
| Typing broadcast | [src/hooks/useTypingBroadcast.ts:28-43](../src/hooks/useTypingBroadcast.ts#L28-L43) | Keystroke | Broadcast (no DB) | n/a | n/a | removeChannel | Debounce per match |

> Realtime traffic itself isn't Disk IO, but each realtime event the client receives commonly triggers a refetch (read) of an indexed-but-non-trivial query. The fan-out math is: **(mutations/sec) × (subscribers per mutation) × (refetch IO per subscriber)**.

---

## 5. Cron and Edge Function inventory (write/read amplification)

### Schedule summary (verified from migrations)

| Job | Schedule | Source migration / file |
|---|---|---|
| `event-reminders-enqueue` | `* * * * *` | `20260319140001_*` (legacy SQL `send_event_reminders()`) |
| `event-reminders-sweep-stale-claims` | `* * * * *` | [20260508141000](../supabase/migrations/20260508141000_event_reminder_queue_claim_deliver_split.sql#L240) |
| `event-lifecycle-auto-finalize` | `* * * * *` | [20260508103000](../supabase/migrations/20260508103000_event_lifecycle_auto_finalization.sql) |
| `video-date-room-cleanup-minutely` | `* * * * *` | `20260501115000_*` |
| `post-date-half-verdict-timeout` | `* * * * *` | `20260501104000_*` |
| `date-reminder-cron` | `* * * * *` | rewired to Vault in [20260509230000](../supabase/migrations/20260509230000_rewire_guc_crons_to_vault.sql) |
| `process-waitlist-promotion-notify-queue` | `* * * * *` | rewired in same |
| `match-call-room-cleanup` | `*/5 * * * *` | rewired in same |
| `expire-video-date-reconnect-graces` | `*/5 * * * *` | `20260409110000_*` |
| `monthly-credit-replenish` | `5 0 1 * *` | rewired in same |
| `generate-daily-drops` | `0 18 * * *` | [20260509210000](../supabase/migrations/20260509210000_daily_drop_cron_observability.sql) |
| `generate-daily-drops-retry` | `5 18 * * *` | same |
| `daily-drop-health-alert` | `30 18 * * *` | rewired in same |
| `unschedule_missing_function_crons` | (run-once) | [20260509231000](../supabase/migrations/20260509231000_unschedule_missing_function_crons.sql) |

**Observation:** at minute boundaries (`:00`), 6+ Edge Functions kick off simultaneously and pull connections concurrently — classic thundering herd. Adding a per-job offset (`1 * * * *`, `2 * * * *`, …) costs nothing and smooths Disk IO spikes.

### Highest-IO functions (verified)

1. **`generate-daily-drops`** ([index.ts:421](../supabase/functions/generate-daily-drops/index.ts#L421)) — full `profiles` scan (19 columns), JS-side filter on `discoverable`/`account_paused`/`discovery_mode`, then chunked reads of `matches`, `blocked_users`, `user_reports`, `daily_drop_cooldowns`, `event_registrations`, `events`, `vibe_tags`, `profile_vibes`. Bulk insert into `daily_drops`. Per-user push fan-out at concurrency 25. **Single biggest daily IO event.**
2. **`event-reminders`** ([index.ts:112-125](../supabase/functions/event-reminders/index.ts#L112-L125)) — RPC claim of 100 rows + per-row `event_registrations` SELECT + `mark_*` UPDATE per row. 1440 runs/day.
3. **`date-reminder-cron`** ([index.ts:38-109](../supabase/functions/date-reminder-cron/index.ts#L38-L109)) — two `date_plans` scans/min + N+1 `date_suggestions` lookups + per-user `send-notification` invokes.
4. **`match-call-room-cleanup` / `video-date-room-cleanup`** — bounded `limit 40` scans every 5 min; per-row Daily.co API call + UPDATE. DB cost is moderate, IO bounded.
5. **`process-waitlist-promotion-notify-queue`** — N+1 event title lookup; minor but per-minute.
6. **`send-notification`** (called from many of the above) — `profiles` lookup for push token + `notifications_inbox` INSERT + OneSignal POST. The fan-out from `generate-daily-drops` produces thousands of invocations in a short window.

(Full Edge Function inventory in Appendix B.)

---

## 6. Query and payload audit

| Pattern | Worst offenders | File | Why it matters |
|---|---|---|---|
| Full table scan in JS | `profiles` filter for daily drops | [generate-daily-drops/index.ts:421-489](../supabase/functions/generate-daily-drops/index.ts#L421-L489) | Pushdown to SQL with a partial index would shrink the result by ~70–90 % depending on user activity |
| Wide `select('*')` on hot tables | `daily_drops`, `event_swipes`, `messages`, `notifications` | various web/mobile hooks | Forces full row reads; jsonb columns (`pick_reasons`, `data`, `action`) are expensive |
| Nested selects | `events(*, profiles(*))`-style | spot-checked — none on hot paths in current code | OK |
| Unbounded reads | `useNotificationInbox` is bounded to 80; `useEvents` returns all events ordered by date | [src/hooks/useEvents.ts:67-75](../src/hooks/useEvents.ts#L67-L75) | `events` has lifecycle filters elsewhere; verify the dashboard query uses `is_active`/`ended_at IS NULL` |
| Repeated refetches | 3-query pattern in `useNotificationInbox` and `useBadgeCount` | see §4 | One realtime event = three reads |
| Oversized payloads | `get_event_deck` returns 50 hydrated profiles | [src/hooks/useEventDeck.ts](../src/hooks/useEventDeck.ts) | Trim to summary fields; hydrate on tap |
| Duplicated profile hydration | `useDailyDrop` fetches partner profile via `get_profile_for_viewer` per drop, including history of past 14 drops | [src/hooks/useDailyDrop.ts:111-236](../src/hooks/useDailyDrop.ts#L111-L236) | Batch partner fetch; cache aggressively |

---

## 7. Write-amplification audit

| Source | Writes per event | Notes |
|---|---|---|
| `event_reminder_queue` claim/deliver/release split | **2–3 UPDATEs per delivered row + sweeper UPDATE on stale claims** | Delivery requires claim-UPDATE → mark-UPDATE; failure adds release-UPDATE; sweeper UPDATEs unclaim |
| `admin_*` mutations | 1 mutation + 1 audit row to `admin_activity_logs` (some also to `support_ticket_events`) | Indexed (`created_at`, `admin_id`, `target`) — index maintenance × 3 per insert |
| `messages` INSERT | 1 INSERT + AFTER INSERT trigger UPDATE on `matches.last_message_at` | Match row update on every chat message |
| `event_registrations` INSERT/DELETE | trigger maintains `events.current_attendees` | Plus realtime fan-out (§4) |
| `support_ticket_replies` INSERT | trigger UPDATEs `support_tickets.status` and `updated_at` | Compounds with admin audit log |
| `user_notifications` state changes | UPDATE seen_at → UPDATE read_at → UPDATE opened_at → UPDATE dismissed_at, each maintains 4 partial indexes | Bulk mark-read RPC compounds this |
| `daily_drops` state machine | UPDATE per transition (view → opener_sent → reply_sent → expired) | 6 indexes maintained per UPDATE |
| `video_sessions` lifecycle | multiple BEFORE triggers + `video_session_refund_on_end` AFTER trigger | Heaviest per-row-write profile in the system; bounded by event volume |
| Webhook audits (`payment_observability_logs`) | 1 INSERT per webhook | Append-only; needs retention |

---

## 8. Index and migration review

### Existing indexes worth knowing (verified)

- `admin_activity_logs`: `created_at DESC`, `admin_id`, `(target_type, target_id)` — adequate. **Note: an earlier exploration pass mistakenly reported "PK only"; that is wrong. See [20260120205733...sql:34-36](../supabase/migrations/20260120205733_6f220346-9a7e-48a0-a509-f92bd3b3f466.sql#L34-L36).**
- `event_swipes`: `UNIQUE (event_id, actor_id, target_id)` + `idx_event_swipes_mutual (event_id, target_id, actor_id, swipe_type)`.
- `messages`: `idx_messages_match_unread (match_id, read_at) WHERE read_at IS NULL`, `idx_messages_match_id`, `idx_messages_ref_kind (match_id, message_kind, ref_id)`, `idx_admin_engagement_messages_created_at (created_at)`.
- `event_reminder_queue`: `idx_event_reminder_queue_pending (created_at) WHERE delivered_at IS NULL AND claimed_at IS NULL`, `idx_event_reminder_queue_stale_claims (claimed_at) WHERE delivered_at IS NULL AND claimed_at IS NOT NULL`.
- `user_notifications`: 4 partial indexes for timeline, unseen, unread, group.
- `daily_drops`: per-user-and-date indexes plus `(status, expires_at)` and admin engagement helpers.

### Likely missing indexes (only proposed where evidence is concrete; **do NOT apply without EXPLAIN confirmation**)

- `events` — partial index supporting `finalize_due_events()` predicate `archived_at IS NULL AND ended_at IS NULL AND event_date + duration_minutes*interval '1 minute' + interval '10 minutes' <= now()`. A candidate is `(event_date) WHERE archived_at IS NULL AND ended_at IS NULL`. Confirm with `EXPLAIN ANALYZE` against live data first.
- `profiles` — composite covering daily-drops eligibility: `(is_suspended, account_paused, discoverable, discovery_mode, last_seen_at DESC)` partial `WHERE COALESCE(is_suspended,false)=false`. Only worth it if `EXPLAIN` shows the scan is the bottleneck; index maintenance cost is non-trivial since `last_seen_at` updates frequently.

### Risky indexes (write-amplifying)

- `idx_admin_engagement_messages_created_at` is a non-partial index on a high-write table; it pays for analytics. Acceptable but worth confirming usage in `pg_stat_user_indexes` — drop if unused.
- `user_notifications`'s 4 partial indexes are justified by the read pattern, but every state UPDATE re-evaluates predicate membership.

### Recently merged migrations to keep an eye on

- `20260507194000_tier_config_swipe_idempotency_repair.sql` adds an EXISTS check before `handle_swipe_base()`; minor extra read per swipe.
- `20260507201000` + `20260507204000` add 6 indexes for engagement analytics on hot tables (write amplification trade-off).
- `20260508141000` claim/deliver split — main source of the queue UPDATE amplification.
- `20260508103000` — finalize cron + admin event RPCs that double-write to audit.
- `20260509143000` — new `user_notifications` table; **no retention** — see §9.

### Materialized views

None found. All admin read models are runtime RPCs.

---

## 9. Retention review

| Table | Growth | Retention today | Recommendation |
|---|---|---|---|
| `messages` | High (chat) | None | Archive > 12 mo to cold table; consider partial drop of `idx_admin_engagement_messages_created_at` if the analytics window is 90 d |
| `event_swipes` | Spiky during events | None | Archive after `events.archived_at` |
| `user_notifications` | High (every match/event/message) | None | Worker: hard-delete `dismissed_at < now() - 30 d` and `created_at < now() - 90 d` |
| `admin_activity_logs` | Mod | None | Archive > 12 mo; live query window can stay smaller |
| `event_reminder_queue` | Variable | None visible | Worker: delete `delivered_at < now() - 7 d` |
| `daily_drops` | Linear daily | None | Archive `drop_date < now() - 90 d` |
| `payment_observability_logs` | Per-webhook | None | Delete > 180 d |
| `video_date_launch_latency_checkpoints`, `event_loop_observations` | Telemetry, append-only | None | Delete > 30 d (telemetry has limited value past that window) |

---

## 10. Capacity recommendation

**Short answer:** *if* live evidence (Supabase Studio → Database → Reports → Disk IO) shows you are persistently at or above the IO budget under normal load, a one-tier compute bump is reasonable as cover while §11's fixes land. *If* IO spikes are concentrated around the daily-drops generation window, the per-minute crons at `:00`, or specific admin sessions, then **fixes will outperform a compute upgrade** because the underlying patterns are amplifying linearly with users.

After upgrading (or before, if you choose to fix-only), monitor:

- Disk IO percentile (peak vs steady-state).
- `pg_stat_statements` top-10 by `total_exec_time` and `shared_blks_read`.
- `cron.job_run_details` for runtime drift on per-minute crons.
- `pg_stat_user_indexes` for unused indexes (drop candidates).
- Sequential scan rate on `events`, `profiles`, `daily_drops`.

Apply fixes in this order after the upgrade (none of these require a compute bump to be effective):

1. Admin realtime filter + debounce (§2 row 1) — biggest steady-state win.
2. `date-reminder-cron` and `event-reminders` N+1 removal (§2 rows 4, 5) — minute-by-minute relief.
3. `generate-daily-drops` SQL pushdown + queue-based fan-out (§2 row 6) — kills the daily spike.
4. Cron jitter (§5 final note).
5. Retention workers (§9).

---

## 11. Top 5 next actions (ranked by impact / risk / effort)

1. **Filter and debounce the admin realtime fan-out.** Edit [src/hooks/useAdminRealtime.ts](../src/hooks/useAdminRealtime.ts) to (a) drop or filter the `messages` INSERT subscription so it doesn't trigger overview/engagement refetches; (b) add a 1.5–3 s debounce around `invalidateEngagement` matching the existing 750 ms debounce on `invalidateOverview`. **Risk:** low (admin-only). **Effort:** ~1 hr.
2. **Remove the N+1 in `date-reminder-cron` and `event-reminders`.** Either denormalize `proposer_id`/`recipient_id` into `date_plans`, or batch the lookups via `IN (plan_ids)` / `IN (event_ids)`. Both functions run every minute. **Risk:** low–med (denormalization needs guards). **Effort:** half a day.
3. **Confirm or add a partial index on `events` for `finalize_due_events()`.** Run `EXPLAIN ANALYZE` first. If a seq scan is confirmed, propose `CREATE INDEX … WHERE archived_at IS NULL AND ended_at IS NULL` in a fresh migration. **Risk:** low. **Effort:** under an hour incl. EXPLAIN.
4. **Decouple `generate-daily-drops` notification fan-out via a queue.** Insert into a `daily_drop_notifications` queue table, drained by a small worker on a 1-min cron (mirrors `event-reminders`). Removes the 25-concurrent inline `send-notification` invokes. **Risk:** low–med (introduces a new queue). **Effort:** 1–2 days.
5. **Add retention for `user_notifications` and `event_reminder_queue`.** New cron (15-min cadence) that batch-deletes per the rules in §9. Smallest effort with the longest-term payoff. **Risk:** low. **Effort:** ~half day.

---

## Appendix A: DB-level evidence to collect (not done in this pass)

The following pieces of evidence should be pulled from Supabase Studio or via authorized read-only SQL — they are *not* in this report:

- `pg_stat_statements` ordered by `shared_blks_read` and `total_exec_time` (top 25)
- `pg_stat_user_tables.{seq_scan, idx_scan, n_dead_tup, n_live_tup}` for hot tables
- `pg_stat_user_indexes.{idx_scan}` for unused indexes
- `cron.job_run_details` last 24 h — runtime distributions per job
- Disk IO time-series and peak window
- Cache hit ratio (`pg_statio_user_tables.heap_blks_hit / (heap_blks_hit + heap_blks_read)`)
- Temp file pressure (`pg_stat_database.temp_files`)

When that evidence is available, re-rank §2 and §11 against actual measurements.

---

## Appendix B: Edge Function inventory (55 functions)

> Compiled by direct read of [supabase/functions/](../supabase/functions/). Trigger column: cron / webhook / client / admin. Schedule given when verified from a migration. IO risk is repo-grounded.

| # | Function | Trigger | Schedule | Reads | Writes | IO risk |
|---|---|---|---|---|---|---|
| 1 | generate-daily-drops | cron + admin | `0 18 * * *` (+ retry `5 18 * * *`) | profiles(*), matches, blocked_users, user_reports, daily_drop_cooldowns, event_registrations, events, vibe_tags, profile_vibes, daily_drops(count) | daily_drops bulk, daily_drop_generation_runs, admin_activity_logs | **CRITICAL** |
| 2 | check-daily-drop-health | cron + admin | `30 18 * * *` (alert) | daily_drop_generation_runs, daily_drops count | — (Resend email) | LOW |
| 3 | date-reminder-cron | cron | `* * * * *` | date_plans (×2), date_suggestions (N+1) | date_plans UPDATE, send-notification invoke | **HIGH** |
| 4 | event-reminders | cron | `* * * * *` | event_reminder_queue claim, event_registrations (N+1) | queue UPDATE, send-notification invoke | **HIGH** |
| 5 | match-call-room-cleanup | cron | `*/5 * * * *` | match_calls scan limit 40 | match_calls UPDATE | MED-HIGH |
| 6 | video-date-room-cleanup | cron | `* * * * *` (minutely) | video_sessions scan limit 40 | video_sessions UPDATE | MED-HIGH |
| 7 | credit-replenish | cron | `5 0 1 * *` monthly | subscriptions (RPC) | credits via RPC | MED |
| 8 | process-waitlist-promotion-notify-queue | cron | `* * * * *` | queue, events (N+1) | queue UPDATE, send-notification invoke | MED |
| 9 | process-media-delete-jobs | admin (manual cron) | — | media_delete_jobs SKIP LOCKED claim, media_assets | media_delete_jobs UPDATE; Bunny DELETE | MED |
| 10 | post-date-verdict-reminders | cron / edge | — | RPC claim + stale mark | RPC update; send-notification invoke | MED |
| 11 | date-suggestion-expiry | cron / edge | — | date_suggestions ×2 | date_suggestions UPDATE, transition log INSERT, send-notification | LOW-MED |
| 12 | send-notification | client + cron fanout | — | profiles push token, prefs | notifications_inbox INSERT, OneSignal POST | MED-HIGH |
| 13 | send-message | client | — | profiles, blocked_users ×2, messages, media_assets | messages INSERT, chat_message_media, notifications_inbox, send-notification | MED |
| 14 | swipe-actions | client | — | matches, video_sessions, event_participants (RPC) | matches/video_sessions INSERT via RPC; send-notification | MED |
| 15 | daily-drop-actions | client | — | daily_drops (RPC) | daily_drops UPDATE, transition log, send-notification | MED |
| 16 | post-date-verdict | client | — | video_sessions, user_verdicts | user_verdicts INSERT/UPDATE, send-notification | MED |
| 17 | date-suggestion-actions | client | — | date_suggestions, matches | date_suggestions UPDATE, transition log, send-notification | MED |
| 18 | stripe-webhook | webhook | — | stripe_event_ticket_checkout_intents, subscriptions, user_roles | intents UPDATE, payment_observability_logs INSERT, subscriptions UPDATE | MED |
| 19 | revenuecat-webhook | webhook | — | subscriptions, roles | subscriptions UPDATE, payment_observability_logs INSERT | MED |
| 20 | video-webhook | webhook | — | video_sessions (RPC) | video_sessions UPDATE, vibe_video_logs INSERT | LOW-MED |
| 21 | push-webhook | webhook | — | — | push_delivery_logs INSERT | LOW |
| 22 | create-video-upload | client | — | video_sessions, roles | media_assets INSERT, vibe_video_logs INSERT | LOW |
| 23 | upload-image | client | — | profiles, media_assets | media_assets INSERT, profiles UPDATE | LOW |
| 24 | upload-voice | client | — | media_assets | media_assets INSERT | LOW |
| 25 | upload-chat-video | client | — | messages, media_assets | chat_message_media INSERT, media_assets INSERT | LOW |
| 26 | create-event-checkout | client | — | events, event_registrations, subscriptions | stripe_event_ticket_checkout_intents INSERT, payment_observability_logs INSERT | LOW |
| 27 | create-credits-checkout | client | — | profiles, subscriptions | stripe_checkout_intents INSERT, payment_observability_logs INSERT | LOW |
| 28 | sync-vibe-video-status | client | — | video_sessions, Bunny API | video_sessions UPDATE, vibe_video_logs INSERT | LOW-MED |
| 29 | send-email | admin | — | — (Resend) | — | LOW |
| 30 | send-support-reply | admin | — | support_tickets, profiles | support_messages INSERT, send-notification | LOW |
| 31 | event-notifications | admin | — | events, profiles | — (Resend) | LOW |
| 32 | delete-account | client | — | profiles, messages, matches | profiles UPDATE soft-delete, auth.users delete | LOW |
| 33 | cancel-deletion | client | — | profiles | profiles UPDATE | LOW |
| 34 | request-account-deletion | client | — | — | deletion_requests INSERT | LOW |
| 35 | phone-verify | client | — | auth.users, profiles | profiles UPDATE | LOW |
| 36 | email-verification | client | — | — | auth.users / profiles UPDATE | LOW |
| 37 | verify-admin | admin | — | user_roles | — | LOW |
| 38 | admin-review-verification | admin | — | verification_documents, profiles | verification_documents UPDATE, profiles UPDATE | LOW-MED |
| 39 | admin-proof-selfie-sign | admin | — | — (Bunny signing) | — | LOW |
| 40 | admin-video-date-ops | admin | — | video_sessions, matches (RPC) | video_sessions UPDATE, admin_activity_logs INSERT | LOW-MED |
| 41 | admin-media-lifecycle-controls | admin | — | media_assets, media_delete_jobs | media_delete_jobs INSERT, admin_activity_logs INSERT | LOW-MED |
| 42 | admin-data-export | admin | — | profiles bulk export, activity logs | admin_data_export_jobs INSERT | MED |
| 43 | create-checkout-session | client | — | subscriptions, profiles | stripe_checkout_intents INSERT, payment_observability_logs INSERT | LOW |
| 44 | create-portal-session | client | — | subscriptions | — (Stripe API) | LOW |
| 45 | delete-vibe-video | client | — | video_sessions, media_assets | media_assets UPDATE, media_delete_jobs INSERT | LOW |
| 46 | get-chat-media-url | client | — | chat_message_media, media_assets | — (Bunny signing) | LOW |
| 47 | chat-thread-page | client | — | messages, profiles, media_assets | — | LOW |
| 48 | daily-room | client | — | match_calls, video_sessions, participants | match_calls/video_sessions INSERT, daily_room_logs INSERT | MED |
| 49 | send-game-event | client | — | — | game_events INSERT, send-notification | LOW |
| 50 | geocode | client | — | — (OSM) | — | LOW |
| 51 | forward-geocode | client | — | profiles location, event filters | — | LOW |
| 52 | record-growth-attribution | client | — | — | referral_tokens INSERT | LOW |
| 53 | sync-revenuecat-subscriber | client | — | subscriptions, roles | subscriptions UPDATE, payment_observability_logs INSERT | LOW-MED |
| 54 | health | monitoring | — | — | — | NEGLIGIBLE |
| 55 | upload-event-cover | client | — | events, media_assets | media_assets INSERT, events UPDATE | LOW |

---

## Appendix C: Audit method and provenance

This document is the output of three parallel exploration passes followed by direct file verification of the highest-impact claims. Specifically:

- Frontend / mobile / web client surfaces (polling, realtime, RQ config) — exploration pass 1.
- Edge Functions and pg_cron schedules — exploration pass 2.
- Migrations / RPCs / indexes / triggers — exploration pass 3.
- Direct read-back of `useEventDeck.ts`, `WebChatOutboxContext.tsx`, `ReadyGateOverlay.tsx`, `useAdminRealtime.ts`, `useBadgeCount.ts`, `generate-daily-drops/index.ts`, `useEvents.ts`, and the `admin_activity_logs` migration to verify or correct individual findings.

Corrections applied to raw exploration output before publishing:

- `admin_activity_logs` was incorrectly reported as "PK only." The actual indexes (verified at [20260120205733...sql:34-36](../supabase/migrations/20260120205733_6f220346-9a7e-48a0-a509-f92bd3b3f466.sql#L34-L36)) cover `created_at DESC`, `admin_id`, and `(target_type, target_id)`.
- The Ready Gate fallback poll was reported as "always 1 s." The verified value at [ReadyGateOverlay.tsx:1671](../src/components/lobby/ReadyGateOverlay.tsx#L1671) is `realtimeDegraded ? 1_000 : 2_000`. Severity downgraded.
- `refetchOnWindowFocus`/`refetchOnMount` were called out as misconfigurations. They are React Query defaults (true) and not the lever; the actual lever is the global `staleTime: 30_000` set at [queryClient.ts:10](../src/lib/queryClient.ts#L10).

No live database queries were executed against the production project. No code, migrations, or provider configuration was changed by this audit.
