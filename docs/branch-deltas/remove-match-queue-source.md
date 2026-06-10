# Remove Match-Queue Branch At The Swipe Source

Date: 2026-06-10
Branch: `codex/remove-match-queue-source`

## Scope

Aggressively simplify the Vibely Video Date golden flow by fully removing the remaining match queue / drain / rescue subsystem. Golden flow preserved: Event Lobby -> pass/vibe -> immediate mutual match -> Ready Gate -> `prepare_date_entry`/`prepare_entry` -> `/date/:sessionId` -> post-date survey -> return.

## Already Removed On Main (prior PRs)

- Client `useMatchQueue`, `drainMatchQueue`, `getQueuedMatchCount`, queue-hint polling, and queued notification-deep-link rescue (PRs through #1281). Zero active source references remain.
- Backend `drain_match_queue`, `drain_match_queue_v2`, `get_video_date_queue_hint_v1`, and `promote_ready_gate_if_eligible` (migration `20260610000100_remove_post_date_instant_next.sql`).
- Post-date instant-next promotion (`20260610000100`), and the `match_queued` -> Ready Gate `ready` conversion wrapper (`20260610022531`). After these, production never persisted a queued session — but the swipe source still created one transiently and the wrapper promoted it.

## Implemented In This Branch

- New forward migration `supabase/migrations/20260610120000_remove_match_queue_source_always_ready.sql`:
  - `handle_swipe_20260506090000_stale_room_base(...)` (the deepest INSERT-bearing base) now always inserts a single `ready` Ready Gate session for a mutual match (`ready_gate_status = 'ready'`, `ready_gate_expires_at = now() + 30s`, `queued_expires_at = NULL`) and returns `result = 'match'`, `immediate = true`. The `v_create_queued`/`v_has_queued_session`/presence computation and the entire queued branch (`match_queued` return, `ready_gate_status = 'queued'` insert, 10-minute `queued_expires_at`) are removed. All other guards (auth, registration, event-active, terminal-encounter/block/report/discoverability, advisory locks, idempotency, Super Vibe caps, already-matched ON CONFLICT path) are preserved verbatim.
  - `handle_swipe_20260601183000_deck_authority_base(...)` collapses to a pass-through over `handle_swipe_20260610000100_auto_next_base(...)`; the dead `match_queued` -> Ready Gate promotion is removed.
- Removes dead queue-drain admin analytics from `supabase/functions/_shared/admin-video-date-ops.ts` (`summarizeQueueDrain`, `QueueDrainSummary`/`QueueDrainInputRow`/`QueueDrainReasonCount`, `EXPECTED_QUEUE_DRAIN_NO_OP_REASON_CODES`, helpers) and the matching tests. Drain commands no longer exist, so nothing produced its input. `summarizeSwipeRecovery` and the rest of operator metrics are untouched.
- Adds `shared/matching/matchQueueSourceRemovalContracts.test.ts`, wired into `npm run test:video-date:red-flags` and `npm run test:video-date-v4`.
- Updates `docs/video-date-success-command-center.md` with a dated implementation entry.

## Intentionally Left In Place (inert / documented follow-up)

- `video_sessions.queued_expires_at` column, the `p_queued_expires_at` parameter of `video_session_blocks_global_active_conflict(...)`, and the `'queued'` value in `ready_gate_status` / `queue_status`. After this change they have no live writer (always NULL / never set). Physically dropping them cascades into the shared global-active-conflict guard signature and generated types and cannot be end-to-end verified here; tracked as a clean follow-up.
- Phase 6 queue-fairness views and `get_video_date_queue_fairness_health(...)` are kept: they are an operator-observability surface read by the `admin-video-date-ops` Edge Function and `shared/observability/videoDateOperatorMetrics.ts`, independent of the matching queue flow. With no queued sessions they report empty/healthy.

## Behavior Note

This is behavior-preserving relative to current production: post-`20260610022531`, every mutual match already resolved to a `ready` Ready Gate session (the wrapper promoted any transient `match_queued`). This change makes that the source behavior and deletes the queued intermediate state and the now-dead promotion path.

## Schema-Shape Note

No tables, columns, views, or function signatures were added or removed; only two function bodies changed. Generated `src/integrations/supabase/types.ts` is unchanged and was not regenerated.

## Verification

- `rg "useMatchQueue|drain_match_queue|promote_ready_gate_if_eligible|get_video_date_queue_hint|match_queued|queued_expires_at|queue_drain" src apps/mobile shared supabase/functions` — only expected residue: kept-inert `queued_expires_at` in generated types, the kept fairness operator surface, and absence-asserting tests.
- `npm run typecheck`, `npm run lint`.
- `npm run test:video-date-v4`, `npm run test:video-date:red-flags`, `npm run test:event-lobby-regression`, `shared/matching/matchQueueSourceRemovalContracts.test.ts`.
- `supabase db lint --linked --schema public --fail-on error`, `supabase db push --linked --dry-run`.

## Proof Boundary

This is a simplification/cleanup pass, not Video Date product acceptance. The acceptance bar remains a fresh disposable two-user production run through match, Ready Gate, same Daily room, stable bilateral provider-backed media/date, date end, and persisted `date_feedback` for both users.
