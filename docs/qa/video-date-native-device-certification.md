# Video Date Native Device Certification

Date: 2026-06-13 (refreshed for the 2026-06 rebuild + acceptance follow-ups; original 2026-06-08)

Native source parity and static contracts are necessary, but they are not physical-device proof. This checklist certifies the Expo/native Video Date path on real iOS and Android devices. Headless web acceptance runs (including the 2026-06-12 production acceptance pass) never exercise a real push permission grant or a delivered notification — those are certifiable only here.

## Preconditions

- Use a disposable live or staging event with two eligible users.
- Use the current app build that contains the target commit. The build must include the client halves of PRs #1314 and #1316 (post-survey registration release with retry, lobby foreground-stamp throttle, forced-survey renavigation damper).
- Use two separate physical devices and two separate accounts.
- Confirm camera, microphone, push notification, and network permissions are available.
- Run `npm run test:video-date:red-flags` and `npm run test:video-date-v4` before device QA.
- Run `npm run check:video-date:invariants` before and after the device run when database credentials are available.
- For device certification or release sign-off, run `npm run check:video-date:invariants -- --warn-as-error` after both users submit feedback so stale missing `date_feedback` cannot pass as a successful native run.

## Required iOS And Android Scenarios

Run each scenario on both platforms unless a scenario explicitly covers a cross-device pairing.

- Mutual match inside the same event routes both users to the same Ready Gate session.
- Standalone `/ready/[id]` deep link opens actionable Ready Gate truth (entry proof no longer exists; readiness is the decisive direct commit).
- Ready Gate overlay path opens actionable Ready Gate truth.
- Push permission is granted for real on the device (OS prompt accepted), and a OneSignal player id is registered for the account (no `notification_no_player_id` failures for these users in `video_date_provider_outbox`).
- At least one Video Date notification (match, ready, or date event) is actually delivered to the lock screen / notification shade, and tapping it routes to the correct surface. This leg has never been exercised by any headless run and passes only with a real delivered notification.
- First Ready tap reaches `ready_a` or `ready_b`; second reaches `both_ready`.
- Post-ready room warmup never joins Daily before `/date/[id]`.
- `/date/[id]` takes route ownership after `both_ready`; lobby and Ready Gate do not bounce the user back.
- Both users join the same Daily room and show remote media.
- Background/foreground during warm-up does not mark the partner away while Daily is active.
- Delayed push or deep link into an active session lands on `/date/[id]`, not stale Ready Gate.
- Same-session route remount parks or reuses the active Daily call; it does not destroy and rebuild a joined call.
- Native event lobby stops readiness/status/queue/drain side effects while same-event `/date/[id]` or terminal survey recovery owns the session.
- Local Daily `participant-left` waits through the local grace window before partner-away signaling.
- Confirmed encounter promotes to `date` after both joined and both remote-seen evidence exists.
- Date end opens `PostDateSurvey` on `/date/[id]` and stops Daily/surface/reconnect/queue churn.
- Survey retry or app foreground recovery persists `date_feedback`.
- After feedback, the user returns to the expected lobby/deck/next Ready Gate state.

## Evidence To Record

- Build id, commit SHA, device model, OS version, app version, event id, and session id.
- Whether the user entered through overlay, standalone `/ready/[id]`, notification, or deep link.
- Push evidence: OS-level permission state, OneSignal player id presence (masked), the delivered notification (screenshot), and the surface it routed to on tap.
- Ready Gate RPC payloads for both users.
- Daily room name, provider participant ids, joined/left timestamps, and remote-seen timestamps.
- Screenshots or screen recordings for Ready Gate, live date, survey, and post-feedback next surface.
- `date_feedback` row ids for both users.
- Any RC/native diagnostics with tokens redacted.

## Pass Criteria

The native run passes only when both iOS and Android complete the full golden flow through `date_feedback` and expected next surface. A passing web run does not certify native, and passing static native tests do not certify physical devices.
