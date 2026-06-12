# Review Comments 1262-1280 Follow-ups

Date: 2026-06-10
Branch: `codex/review-comments-1262-1280-followups`

## Scope

Thread-aware GitHub review scan covered the 18 most recent merged PRs by `mergedAt`, processed chronologically: #1262, #1263, #1264, #1265, #1266, #1267, #1268, #1269, #1270, #1271, #1272, #1273, #1275, #1276, #1277, #1278, #1279, and #1280.

No Copilot-authored review comments were present in that set. Codex comments with actionable findings were found on #1262, #1264, #1267, #1268, #1277, #1279, and #1280.

## Already Addressed On Main

- #1262 surface-claim lease/backoff feedback is covered by `shared/matching/reviewComments1256_1262Followups.test.ts` and the current `SURFACE_NOT_CLAIMABLE` no-backoff guard behavior.
- #1264 Daily joined RPC argument-name feedback is covered by `supabase/migrations/20260609112843_video_date_active_entry_join_arg_name_repair.sql` and regenerated types preserving `p_entry_attempt_id`.
- #1266 prewarm adoption feedback was already resolved/outdated in GitHub and superseded by the current Daily adoption guards.

## Implemented In This Branch

- New forward migration `supabase/migrations/20260610022531_review_comments_1262_1280_followups.sql`.
- Repairs event registrations that kept a live `current_room_id` but lost partner/status truth while stale Mystery Match suppression was cleared.
- Replaces the post-auto-next `handle_swipe_20260601183000_deck_authority_base(...)` wrapper so a delegated `match_queued` fallback is promoted into a normal Ready Gate session instead of expiring the only reciprocal-swipe session.
- Updates `scripts/audit-video-date-ultimate-design.mjs` for `EntryPhaseTimer` paths and neutral `entryStartedAt` aliases.
- Removes removed RPCs from the current critical-RPC existence claim in `docs/supabase-live-backend-audit.md`.
- Documents the #1277 Match Calls provider-room cleanup limitation: after `match_calls` and `match-call-room-cleanup` were already removed from linked cloud, a forward migration cannot reconstruct deleted room-name inventory.
- Adds `shared/matching/reviewComments1262_1280Followups.test.ts` and wires it into `npm run test:video-date:red-flags` and `npm run test:video-date-v4`.

## Proof Boundary

This is review-comment hardening and cloud-alignment work. It is not Video Date product acceptance. The acceptance bar remains a fresh disposable two-user production run through match, Ready Gate, same Daily room, stable bilateral provider-backed media/date, date end, and persisted `date_feedback` for both users.
