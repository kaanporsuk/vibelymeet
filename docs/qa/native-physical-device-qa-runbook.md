# Native Physical-Device QA Runbook

## Purpose

This runbook covers the Stream 16 physical-device QA pass for Vibely native runtime surfaces: Ready Gate, video dates, media, push deep links, reconnect, stale links, post-date recovery, and duplicate side-effect suppression.

This pass must use controlled internal test users and test events only. Do not use real users' media, do not send broad production pushes, and do not mutate production media outside the specific owned test accounts.

## Environment Status From Stream 16

Local Xcode is installed at:

- `/Applications/Xcode.app/Contents/Developer`

Physical-device execution was not completed in the Codex environment because Xcode reported the available iPhones as unavailable/offline:

- `OKP`, iPhone 15 Pro Max: unavailable
- `Zeliha iPhone'u`, iPhone 14 Pro Max: unavailable

The runbook below is therefore the exact user-run checklist for a Mac with an unlocked, trusted physical device.

## Safety Rules

- Do not run Docker.
- Do not run local Supabase.
- Do not run `supabase db push`.
- Do not deploy Edge Functions.
- Do not run EAS for this QA pass unless separately approved.
- Do not add native modules.
- Do not import or require `expo-av`.
- Do not upload real user Vibe Videos or profile media.
- Use controlled internal users, owned test phone numbers, owned test emails, owned test media, and a test event.
- For push testing, send only to the controlled internal test user/device.

## Device Setup

1. Use a physical iPhone that is unlocked and trusted by macOS.
2. Connect the iPhone over USB or enable trusted network debugging.
3. Confirm Xcode sees the device:

```bash
xcrun devicectl list devices
xcrun xctrace list devices
```

Expected: the device appears as available/connected, not unavailable/offline.

4. Confirm the native app can run locally:

```bash
cd apps/mobile
npm run typecheck
npm run ios -- --device
```

If `npm run ios -- --device` cannot select the device automatically, open the iOS workspace/project through Xcode or use the device picker exposed by Expo CLI. Do not use EAS for this pass unless explicitly approved.

5. Install a build configured for the same Supabase project used by production QA.
6. Enable camera, microphone, photo library, and notification permissions when prompted.
7. Enable device screen recording if you need visual evidence.

## Test Users And Fixtures

Use four controlled internal accounts:

- `User A`: primary native tester on Device A.
- `User B`: partner tester on Device B or web.
- `User C`: secondary native tester for native-to-native Ready Gate/date paths.
- `Admin`: can create/adjust the controlled test event if needed.

Use one controlled test event:

- Event state: active during the main pass.
- Duration: long enough to complete multiple Ready Gate and date cycles.
- Capacity: at least 3 test users.
- Media: test-only Vibe Video, profile image, event cover, and voice clip assets.

Suggested naming:

- Event title: `QA Native Physical Device Stream 16`
- Test Vibe Video caption: `stream-16-device-qa`
- Test voice message: short non-sensitive clip such as "Stream 16 test."

## Expected Backend Truth Checklist

Use Supabase dashboard SQL editor or an internal admin view for read-only verification. Replace IDs with controlled test IDs.

Video session truth:

```sql
select
  id,
  event_id,
  participant_1_id,
  participant_2_id,
  ready_gate_status,
  state,
  phase,
  ready_gate_expires_at,
  daily_room_name,
  daily_room_url,
  participant_1_joined_at,
  participant_2_joined_at,
  ended_at,
  ended_reason
from public.video_sessions
where id = '<session_id>';
```

Registration truth:

```sql
select
  profile_id,
  event_id,
  queue_status,
  current_room_id,
  current_partner_id,
  active_session_id
from public.event_registrations
where event_id = '<event_id>'
  and profile_id in ('<user_a>', '<user_b>', '<user_c>');
```

Media truth:

```sql
select
  id,
  bunny_video_uid,
  bunny_video_status,
  avatar_url,
  photos
from public.profiles
where id in ('<user_a>', '<user_b>', '<user_c>');
```

Notification preference truth:

```sql
select
  user_id,
  mobile_onesignal_player_id,
  mobile_onesignal_subscribed,
  onesignal_player_id,
  onesignal_subscribed
from public.notification_preferences
where user_id in ('<user_a>', '<user_b>', '<user_c>');
```

Expected high-level states:

- Ready Gate pre-date: `ready_gate_status` moves through queued/ready/both-ready owned by backend RPCs.
- Date routeable: `daily_room_name` and `daily_room_url` exist before the native `/date/[id]` route joins Daily.
- Joined: participant joined timestamp for the joining user is set after Daily join.
- Ended: `ended_at` and `ended_reason` reflect terminal truth; stale clients recover from this backend truth.
- Post-date: survey appears only for date-phase terminal sessions where survey is expected.

## QA Matrix

### 1. Native Sign In And Session Restore

1. Fresh install or clear app data for Device A.
2. Sign in as `User A`.
3. Kill and reopen the app.
4. Toggle airplane mode briefly, return online, reopen again.

Expected:

- Session restores without looping through auth.
- Home/dashboard loads protected content only after entry state is complete.
- No duplicate push identity/login loop is visible in logs.

Capture:

- Screen recording from launch through dashboard.
- Console logs if restore fails.

### 2. Native `/ready/[id]` Stale/Terminal Recovery

1. Create or identify a Ready Gate session for `User A` and `User B`.
2. Open `vibely://ready/<session_id>` or route directly to `/ready/<session_id>` on Device A.
3. From web/admin/test harness, terminalize or let the Ready Gate expire.
4. Foreground Device A.

Expected:

- Native route calls backend sync truth.
- Terminal copy is shown once.
- User returns to lobby/dashboard without retry loop.
- Duplicate terminal latches suppress repeated side effects.

Backend truth:

- `video_sessions.ready_gate_status` is terminal.
- `ended_reason` matches the terminal scenario.

### 3. Web-To-Native Ready Gate

1. `User A` on web and `User B` on Device A enter the same test event.
2. Trigger a match/Ready Gate.
3. Have web mark ready first, then native mark ready.

Expected:

- Native overlay reflects backend state.
- Native navigates to date only after prepare-entry succeeds.
- No duplicate navigation if realtime and focus events arrive together.

### 4. Native-To-Native Ready Gate

1. `User A` on Device A and `User C` on Device B enter the same event.
2. Trigger a match/Ready Gate.
3. Both mark ready.

Expected:

- Both devices route through Ready Gate.
- Date handoff is backend prepare-entry gated.
- Only one canonical video session is active for the pair.

### 5. Web-To-Native Video Date Handoff

1. Use web for one participant and native for the other.
2. Complete Ready Gate.
3. Native receives `/date/<session_id>`.

Expected:

- Native requests camera/mic only after date route truth is startable.
- Native obtains Daily room/token through `daily-room`.
- Both participants join the same Daily room.

Backend truth:

- `daily_room_name` is deterministic for the session.
- Joined timestamp is set for native participant.

### 6. Native-To-Native Video Date Handoff

1. Use two physical devices.
2. Complete Ready Gate and enter date on both.

Expected:

- Both devices join the same Daily room.
- Remote participant appears.
- No duplicate Daily join/token request loop.

### 7. Direct Stale `/date/[id]` Before Prepare-Entry

1. Copy a session ID that is still Ready Gate only and not provider-prepared.
2. Open `/date/<session_id>` directly on native.

Expected:

- Native refuses direct date entry.
- User is routed to `/ready/<session_id>`, event lobby, or dashboard based on backend truth.
- Camera/mic permission prompt does not appear before routeability is confirmed.

### 8. Event-Ended Ready Gate Recovery

1. Enter Ready Gate for the test event.
2. End/cancel/archive the controlled event from admin tooling.
3. Foreground native app or open `/ready/<session_id>`.

Expected:

- Native treats event inactive as terminal truth.
- No prepare-entry retry loop.
- User returns to lobby/dashboard with event-ended copy.

### 9. Event-Ended Stale Date Handoff

1. Keep a stale `/date/<session_id>` link from before event end.
2. End/cancel/archive the event.
3. Open the stale link on native.

Expected:

- Native refuses date entry from stale link.
- Date route clears stale transition latch and recovers to lobby/dashboard.

### 10. App Foreground/Focus During Ready Gate And Date

1. During Ready Gate, background Device A for 20 seconds, then foreground.
2. During video date, background Device A for 20 seconds, then foreground.
3. Repeat once while the other participant changes state.

Expected:

- Ready Gate foreground sync fetches backend truth.
- Date foreground path runs reconnect reconciliation.
- No duplicate terminal/date navigation.

### 11. Reconnect And Partner Disconnect

1. Start a native video date with two participants.
2. Kill network on Device B or background it long enough to simulate partner disconnect.
3. Restore Device B.

Expected:

- Device A enters partner-left/reconnect grace behavior.
- Device B can rejoin if still within allowed window.
- If timeout occurs, terminal reason is backend-owned and both clients recover.

### 12. Post-Date Survey Recovery

1. Complete a real test video date through the expected end flow.
2. Kill and reopen the native app before submitting the survey.
3. Reopen via dashboard/lobby/date route.

Expected:

- Pending post-date survey is recovered.
- Half-verdict pending state is visible where applicable.
- Submitting a verdict does not create duplicate match/session side effects.

### 13. Duplicate Daily Join/Token Suppression

1. During date entry, repeatedly background/foreground Device A.
2. Tap join/continue affordances rapidly if visible.
3. Trigger a network flap during prejoin.

Expected:

- `hasStartedJoinRef`, `prejoinAttemptRef`, and `joinAttemptNonce` suppress duplicate join loops.
- Daily token creation does not loop.
- App eventually joins or recovers with a clear retry path.

### 14. OneSignal Click Deep Link To Ready/Date/Chat

Only run if a controlled internal push is available.

1. Ensure Device A has notification permission and `mobile_onesignal_player_id`.
2. Send a controlled internal notification with `data.url = /ready/<session_id>`.
3. Repeat for `/date/<session_id>` and `/chat/<other_user_id>`.

Expected:

- Ready link routes through backend Ready Gate truth.
- Date link reconciles provider-prepared truth before date route.
- Chat link opens the correct peer chat.
- Foreground notification suppression does not hide relevant controlled tests unless currently viewing that same thread.

### 15. Vibe Video Playback/Upload Smoke

Only use a controlled internal test user and test media.

1. Record or select a short owned Vibe Video.
2. Upload through native profile/onboarding flow.
3. Wait for backend status to become ready.
4. Play it on native profile preview/fullscreen surfaces.
5. Delete it if the test flow includes cleanup.

Expected:

- Upload uses Bunny TUS path, not base64 materialization.
- `bunny_video_uid` becomes non-empty.
- `bunny_video_status` moves from uploading/processing to ready, or shows processing state without treating the user as having no video.
- Playback uses Bunny Stream HLS.
- No `expo-av` runtime path is used.

## Failure Capture

For every failure, capture:

- device model and iOS version
- app build type and git commit
- user IDs and event/session IDs
- exact route opened
- screen recording or screenshots
- Xcode device console excerpt filtered by Vibely markers
- relevant read-only backend truth query results
- whether network/background/foreground was involved

Useful log filters:

```bash
xcrun devicectl device log stream --device <device_identifier> | rg "Vibely|ready_gate|video_date|daily|OneSignal|Bunny|post_date"
```

If using Console.app, filter for:

- `native_ready_gate`
- `VIDEO_DATE_`
- `daily_room`
- `date_route_decision`
- `OneSignal`
- `vibe`

## Stop Conditions

Stop the pass and file a bug if any of these happen:

- native navigates to `/date/[id]` without backend prepare-entry/date-capable truth
- camera/mic prompt appears before date routeability is confirmed
- duplicate Daily token/join loop is observed
- Ready Gate terminal state loops or repeats terminal side effects
- stale event-ended links reach active date UI
- post-date survey is unrecoverable after app restart
- push date deep link bypasses backend date truth
- Vibe Video upload crashes due to memory/base64 behavior
- any `expo-av` runtime dependency appears

## Rollback Notes

This runbook does not require code or cloud changes. If QA reveals a bug:

1. Stop the device pass.
2. Preserve the evidence listed above.
3. Do not run DB push or deploy Edge Functions as part of the QA pass.
4. Fix only the scoped native surface if the bug is local/native.
5. If the bug requires backend/provider/dashboard changes, open a separate provider/backend task with exact steps and do not fold it into this runbook-only stream.
6. Re-run only the failed scenario plus any dependent Ready Gate/date/media/push scenarios after the fix.

## Completion Criteria

The pass is complete when:

- all 15 matrix items are either executed and passed, or explicitly deferred with reason
- all failures have captured evidence and scoped bug tracking
- local native typecheck passes for the tested commit
- no native modules, env vars, Edge Functions, or migrations changed unless separately approved
