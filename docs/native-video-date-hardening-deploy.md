# Native video date startup hardening — deploy delta

**Status:** Merged to `main` (PRs #192 / #193). Use this doc for deploy history and operator checklist.

## What changed

1. **Edge Function `daily-room`**
   - `create_date_room` and `join_date_room` enforce ready-gate / in-call rules before issuing a Daily token.
   - JSON error bodies include a stable `code` string (`UNAUTHORIZED`, `SESSION_NOT_FOUND`, `ACCESS_DENIED`, `SESSION_ENDED`, `READY_GATE_NOT_READY`, `DAILY_PROVIDER_ERROR`, etc.) for client classification.
   - Unhandled errors return **503** with `code: DAILY_PROVIDER_ERROR` (previously 500 + generic message).

2. **Database migration `20260404140000_video_date_enter_handshake_ready_gate_guard.sql`** (timestamp chosen to avoid collision with `20260402120000_onboarding_drafts` in `schema_migrations.version`)
   - `video_date_transition('enter_handshake')` rejects ended sessions and requires `both_ready` (or session already in `handshake`/`date` for rejoin/legacy), matching the Edge Function policy.

3. **Mobile**
   - `getDailyRoomToken` returns classified failures (no secrets); Sentry breadcrumbs/messages on token and handshake failures.
   - iOS requests camera/mic via `expo-camera` before Daily join; `hasStartedJoinRef` reset on failures; join effect no longer depends on `joining` (avoids spurious cancellation).
   - `useActiveSession`: `in_ready_gate` routes to `/ready/[id]`; `in_handshake` / `in_date` still route to `/date/[id]`.
   - Ready Gate overlay no longer sets `in_date` before video starts; handshake queue status is updated when the date screen starts Daily.

## Deploy checklist (Supabase cloud)

| Artifact | Action |
|----------|--------|
| Migration `20260404140000_video_date_enter_handshake_ready_gate_guard.sql` | Apply to production database (e.g. `supabase db push` or linked CI). |
| Edge Function `daily-room` | Deploy function bundle (e.g. `supabase functions deploy daily-room`). |

**Order:** Apply migration first, then deploy the Edge Function (or together in one release window). Mobile/Web binaries can ship after or with backend; older clients still receive non-2xx + JSON `code` on violations.

## Web impact

- **Behavior:** Users who open `/date/:id` before `both_ready` will get `create_date_room` **403** + `READY_GATE_NOT_READY` (same as native). Existing `useVideoCall` toast remains generic unless a future web pass maps `code`.
- **Source:** The hardening PRs did not change web app source; web behavior still follows whatever `daily-room` + DB are deployed in Supabase.

## Remaining client-owned `video_sessions` writes (later sprint)

- Native: `getOrSeedVibeQuestions` still performs a conditional seed write for `vibe_questions`.
- Post-date verdict (screen 1) uses `post-date-verdict` → `submit_post_date_verdict` (see migration `20260403120000_submit_post_date_verdict.sql`); optional survey fields may still PATCH `date_feedback` from clients.
