# Remove Post-Date Instant Next

Date: 2026-06-09

## Scope

This cleanup removes the post-date instant-next and queued auto-promotion path from the Video Date golden flow. The supported path is now:

Event Lobby deck/swipe -> direct mutual match -> Ready Gate -> `prepare_date_entry` -> Video Date -> post-date survey -> `date_feedback` -> lobby/chat/wrap-up.

## Removed

- Web/native post-date survey queue drain and instant-next routing.
- Web/native Event Lobby queued count polling, queue hints, queue drain fallback, and queued convergence UI.
- Native notification queued-session rescue.
- Shared queue-drain eligibility/reason-copy helpers.
- Client feature flags `video_date.post_date_instant_next_v2` and `video_date.outbox_v2.drain_match_queue`.
- Public/backend queue drain, queue hint, queued promotion, and pending-feedback queue-drain RPC surfaces.
- Admin/operator queue-drain health and survey-to-next-gate metrics.

## Backend Migration

Forward migration:

- `supabase/migrations/20260610000100_remove_post_date_instant_next.sql`

The migration deletes the removed feature flags, expires existing queued sessions, rejects processing `drain_match_queue` commands, rewrites lobby foreground to heartbeat only, rewrites post-date routing so it never returns another Ready Gate or Video Date, strips legacy queue-drain counters from the Sprint 7 ops payload, and drops the removed public/helper RPC chain. A later review follow-up, `20260610022531_review_comments_1262_1280_followups.sql`, supersedes the original non-session conversion wrapper so any delegated `match_queued` fallback is promoted into the same session as a normal Ready Gate `match` instead of burning reciprocal swipes.

## Preserved

- Event Lobby deck/swipe.
- Direct mutual match into Ready Gate.
- Ready Gate and mark-ready flow.
- `prepare_date_entry`, Video Date, Daily room entry, and date lifecycle.
- Post-date survey and persisted `date_feedback`.
- Chat, `matches`, and the global `match_id` contract.

## Proof Boundary

This is source/cloud implementation evidence, not product acceptance. Linked Supabase cloud is applied through `20260610000100_remove_post_date_instant_next.sql`, and generated Supabase types were regenerated from the linked project without reintroducing the removed RPCs. Video Date is not fixed until a fresh disposable two-user production run proves match -> Ready Gate -> same Daily room -> stable bilateral provider-backed media/date -> date end -> both users persist `date_feedback`.
