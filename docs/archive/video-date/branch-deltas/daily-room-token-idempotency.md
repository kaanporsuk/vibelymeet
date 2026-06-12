# Daily Room Token Idempotency Delta

Branch: `fix/daily-room-token-idempotency`

## Summary

This branch hardens the `daily-room` Edge Function so video dates and match calls resolve Daily room/token state from canonical server-owned rows. Retried joins reuse the same room and receive fresh participant-specific tokens instead of drifting into avoidable duplicate-call, missing-room, or provider-room-deleted states.

## Routes Changed

- Added: none.
- Removed: none.
- Changed: none.

## Edge Functions Changed

- `supabase/functions/daily-room`
  - `join_date_room` now resolves the deterministic video-date room just like `create_date_room` / `prepare_date_entry`; it no longer requires `video_sessions.daily_room_name` to already be present before issuing a token.
  - `create_match_call` now treats same-caller retry of an existing open call as idempotent when match/caller/callee/type match, returning the existing `match_calls` room metadata plus a fresh caller token.
  - `answer_match_call` now treats an already-`active` callee retry as idempotent and returns a fresh callee token for the stored room.
  - `join_match_call` / `answer_match_call` verify and recover the stored Daily room before token issuance if provider state is missing or expired.
  - `delete_room` skips physical Daily deletion for video dates and for `ringing` / `active` match calls; terminal match-call deletion remains allowed and repeated deletion is idempotent.

## Schema / Storage Changes

- No migrations.
- No new tables, columns, indexes, RPCs, storage buckets, or RLS policy changes.

## Env / Secrets

- No new env vars or secrets.
- Existing Daily and Supabase Edge Function secrets are unchanged.

## Provider / Dashboard Changes

- No Daily dashboard changes.
- No Supabase dashboard changes.
- No Vercel dashboard changes.

## Deploy Requirements

- Supabase DB deploy: not needed.
- Supabase Edge deploy: deploy only `daily-room` after merge.
- Web deploy: no web source changed; hosting deploy should not be required by this branch.
- Native deploy: no native source changed; app-store/TestFlight/Play builds are not required by this branch.

## Validation

- `npm run test:daily-room-contract` (7 contract tests for canonical room resolution, participant-scoped token properties, provider already-exists handling, provider missing/expired recovery planning, match-call retry/answer idempotency, and cleanup safety).
- Full lint/typecheck/build status is recorded in the PR and closure report.

## Manual QA Required

### Video Date

1. User A joins a live video date from web.
2. User B joins the same session from native.
3. Refresh/retry web while native backgrounds/foregrounds during join.
4. Confirm both clients join the same Daily room and receive audio/video.
5. Confirm `video_sessions` has one `daily_room_name` and one `daily_room_url`.
6. Confirm no avoidable 403 appears in client, Supabase, or Daily logs.
7. Have one user leave while the other is still joining; confirm the room is not physically deleted before terminal cleanup.

### Match Call

1. Start a voice call, then quickly retry from the caller.
2. Confirm same-caller retry does not crash or show duplicate active-call failure.
3. Answer from the peer on the other platform; confirm both use the same room.
4. Repeat with a video call.
5. End normally and confirm cleanup only occurs after terminal state.

## Risks / Rollback

- Main risk: `daily-room` Edge Function behavior. Rollback by redeploying the prior `daily-room` function version or reverting this branch and redeploying only `daily-room`.
- Since there is no schema change, rollback does not require a DB migration.
- If provider recovery misbehaves, temporarily rely on existing terminal room cleanup workers while redeploying the previous function.
