# Mobile — Sprint 5: Live Video-Date Parity

Sprint 5 implements the real video date room on mobile using the same backend and Daily.co contracts as web. Cross-platform calls (mobile–web, mobile–mobile) are supported.

## Repo contracts used

### Video provider and join flow
- **Provider:** Daily.co. Web uses `@daily-co/daily-js` (browser); mobile uses `@daily-co/react-native-daily-js` with the same backend.
- **Token/room:** Edge Function `daily-room` with body `{ action: "create_date_room", sessionId }`. Backend looks up `video_sessions` by id, enforces **both participants ready** (`ready_gate_status = both_ready`) or an in-progress session (handshake/date) for rejoin, ensures `daily_room_name` / room on Daily API, creates meeting token, returns `{ room_name, room_url, token }`. Errors include JSON `code` (e.g. `READY_GATE_NOT_READY`, `SESSION_ENDED`) for client diagnostics. Mobile classifies failures in `getDailyRoomToken` (see `docs/native-video-date-hardening-deploy.md`).
- **Join:** Client calls `Daily.createCallObject()`, then `call.join({ url: room_url, token })`. Same semantics as web.

### Video date state model
- **Session:** `video_sessions` (participant_1_id, participant_2_id, event_id, state, phase, ended_at, handshake_started_at, date_started_at, daily_room_name, daily_room_url). Mobile loads via `useVideoDateSession` and subscribes to realtime `video_sessions` for phase/ended updates.
- **Enter handshake:** RPC `video_date_transition(p_session_id, p_action: 'enter_handshake')` — idempotent, starts server-owned handshake timer. Mobile calls before or when joining if `handshake_started_at` is null.
- **End:** RPC `video_date_transition(p_session_id, p_action: 'end', p_reason)` — idempotent. Mobile calls on "End date" and when leaving.
- **Room cleanup:** Edge Function `daily-room` with body `{ action: "delete_room", roomName }`. Mobile calls after leaving the call (best-effort).

### End/leave flow
- **Web:** `endCall()` (Daily leave + destroy), then `daily-room` delete_room, then `video_date_transition` end; optionally `leave_matching_queue` if event context. Mobile mirrors: leave Daily call, delete_room, video_date_transition end, leave_matching_queue when event_id present, then navigate to event lobby or tabs.

### Realtime
- **Web:** Subscribes to `video_sessions` UPDATE for phase/timer and ended_at. Mobile subscribes in `useVideoDateSession`; when state becomes `ended`, mobile leaves the Daily call and cleans up, then shows "Date ended" and navigates on Continue.

## Implemented in Sprint 5

1. **Video date API** (`lib/videoDateApi.ts`): `useVideoDateSession(sessionId, userId)` — loads session + partner, phase, timeLeft; realtime subscription for phase/ended. Helpers: `getDailyRoomToken(sessionId)`, `enterHandshake(sessionId)`, `endVideoDate(sessionId, reason?)`, `deleteDailyRoom(roomName)`.
2. **Video date screen** (`app/date/[id].tsx`): Loads session/partner; requests camera/mic permissions (Android runtime prompts + iOS via `expo-camera`); gets token via `daily-room` create_date_room; calls `enter_handshake` if needed; creates Daily call object, joins with url+token; renders `DailyMediaView` for local and remote; End button triggers leave, delete_room, video_date_transition end, leave_matching_queue (if event), navigate. Handles loading, error, "Date ended", and in-call UI. Realtime: when backend sets session to ended, client leaves and shows ended state.

## Video provider integration

- **SDK:** `@daily-co/react-native-daily-js` + `@daily-co/react-native-webrtc` (exact version 124.0.6-daily.1). Expo: `@daily-co/config-plugin-rn-daily-js` in `app.json` plugins.
- **Native config:** iOS: `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`, `UIBackgroundModes` including `voip`. Android: permissions and foreground service are configured by the Expo config plugin (development build required; not Expo Go).
- **Same backend:** No new Edge Functions or RPCs; mobile uses existing `daily-room` and `video_date_transition`.

## Backend / shared changes

Sprint 5 originally used existing `video_sessions`, `daily-room`, and `video_date_transition` without new **names**. A later hardening pass (merged to `main`, see `docs/native-video-date-hardening-deploy.md`) added:

- **Migration** `20260404140000_video_date_enter_handshake_ready_gate_guard.sql` — stricter `video_date_transition('enter_handshake')` (ready gate + ended sessions).
- **`daily-room` Edge Function** — same actions, with readiness checks before issuing tokens and JSON `code` on errors.

## Web impact

- **Runtime:** Web still calls `daily-room` `create_date_room` from `useVideoCall`. Deployed backend may return **403** / **410** with a `code` when the session is not ready or has ended; the current web client shows a generic toast (no `code`-specific copy).
- **Source:** Hardening did not modify web source files; behavior depends on the deployed Supabase project.

## Remaining gaps after Sprint 5

- **Post-date survey:** Web shows in-call survey after end; mobile shows "Date ended" + Continue only. Survey can be added in a later sprint.
- **Handshake timer / vibe / extend:** Web has handshake countdown, mutual vibe check, and credit-based extend; mobile shows phase + timer but does not implement vibe buttons or extend (can be added later).
- **Device validation:** Real device or dev-client build required to validate Daily on device; Expo Go does not support the Daily native modules.

## What Sprint 6 covers

RevenueCat entitlements and release hardening. See `docs/mobile-sprint6.md`.

## Checks

- **Web:** `npm run typecheck:core`, `npm run build`, `./scripts/run_golden_path_smoke.sh` (from repo root).
- **Mobile:** `cd apps/mobile && npm run typecheck`. Native video requires a development build (`npx expo prebuild` + run on device/simulator).
