# Video Date Partial Join Limbo

Branch: `fix/video-date-partial-join-limbo`

## Problem

When one participant reached the Daily room and the peer never appeared, the backend timeout path already ended the session as `partial_join_peer_timeout`. The user-driven peer-missing exit path was not fully aligned: web could end the session as generic `pre_date_manual_end`, and native could leave the local call without immediately terminalizing the database row.

## Root Cause

`mark_video_date_daily_joined` persisted authoritative joined evidence, and stale cleanup skipped `ready_gate_expired` whenever that evidence existed. The remaining gap was the peer-missing UI action after the first-remote watchdog fired. That path did not request the canonical partial-join terminal reason.

## Files Changed

- `supabase/migrations/20260501145000_video_date_peer_missing_manual_end.sql`
- `supabase/validation/video_date_end_to_end_hardening.sql`
- `shared/matching/activeSession.ts`
- `shared/matching/videoSessionDailyGate.test.ts`
- `shared/matching/videoDateEndToEndHardening.test.ts`
- `src/pages/VideoDate.tsx`
- `apps/mobile/app/date/[id].tsx`

## Schema / RPC / Function Changes

Adds a forward-only wrapper around `public.video_date_transition(uuid, text, text)`.

- Delegates all existing actions and ordinary end reasons to the prior implementation.
- Handles `p_action = 'end'` with `p_reason = 'partial_join_peer_timeout'` or legacy `peer_missing_timeout`.
- Applies the canonical `partial_join_peer_timeout` reason only when exactly one `participant_*_joined_at` column is present and the session has not reached date phase.
- Falls back to ordinary `ended_from_client` handling for date-phase rows or rows without partial-join evidence.
- Emits `video_date_transition / partial_join_peer_manual_end` observability with joined/missing participant metadata and joined evidence.

No new tables, columns, provider secrets, or environment variables.

## Supabase Deploy Requirement

Required: yes, because a migration changes the `video_date_transition` RPC.

Deploy only the new migration after merge:

```sh
supabase db push --linked --dry-run
supabase db push --linked
```

The linked project must remain `schdyxcunwcvddlcshwd`.

## Edge Function Deploy Requirement

Not required. No Edge Functions changed.

## Web / Native Deploy Requirement

Web changed; rely on the normal Vercel/Git deployment after merge and verify the deployment status if available.

Native changed; no app-store or TestFlight build is performed by this branch unless separately requested.

## Tests Run

- `npx tsx shared/matching/videoSessionDailyGate.test.ts` - pass
- `npx tsx shared/matching/videoDateEndToEndHardening.test.ts` - pass
- `npm run test:daily-room-contract` - pass
- `npx tsx shared/matching/videoDateHandshakePersistence.test.ts` - pass
- `npx tsx shared/matching/videoDatePrejoinAttempt.test.ts` - pass
- `npx tsx shared/matching/videoDatePrepareEntry.test.ts` - pass
- `npx tsx shared/observability/videoDateOperatorMetrics.test.ts` - pass
- `npx tsx shared/matching/dailyRoomFailure.test.ts` - pass
- `npx tsx shared/matching/videoDateExplicitDecisionSemantics.test.ts` - pass
- `npx tsx supabase/functions/_shared/matching/videoSessionFlow.test.ts` - pass
- `npx tsx supabase/functions/_shared/admin-video-date-ops.test.ts` - pass
- `npm run typecheck` - pass
- `npm run lint` - pass with existing warnings
- `npm run build` - pass with existing Vite chunk warnings
- `supabase db push --linked --dry-run` - pass, would push only `20260501145000_video_date_peer_missing_manual_end.sql`

## Manual QA Script

1. Prepare two test users registered for the same live event.
2. Move both into Ready Gate.
3. Let User A enter Daily from web.
4. Keep User B absent by closing native, disabling network, or delaying `/date/:sessionId`.
5. Confirm `participant_1_joined_at` or `participant_2_joined_at` is set in `video_sessions`.
6. Let the peer-missing watchdog appear for User A.
7. Tap back to lobby and confirm `ended_reason = 'partial_join_peer_timeout'`, not `ready_gate_expired` or `pre_date_manual_end`.
8. Repeat, but let User B join within the recovery window; confirm both users land in the same Daily room and stay in handshake/date state.
9. Repeat with User B absent until backend timeout; confirm `partial_join_peer_timeout` and no misleading survey.
10. Repeat with native joining first and web absent.
11. Check observability for `daily_join_success`, `partial_join_peer_manual_end` or `partial_join_peer_timeout`, joined evidence, and terminal reason metadata.

## Rollback Plan

If the migration causes unexpected behavior, ship a forward migration that renames the wrapper aside and restores `video_date_transition_20260501145000_peer_missing_end_base` as `video_date_transition`. Client changes are safe to leave in place because the restored RPC would degrade peer-missing end to the prior pre-date manual-end behavior.

## Known Risks

The fix deliberately terminalizes user-driven peer-missing exits when exactly one joined timestamp exists. A peer who tries to join after the present participant tapped back to lobby will see terminal session truth rather than recover into the room. Passive waiting still preserves the existing 90-second backend recovery window.
