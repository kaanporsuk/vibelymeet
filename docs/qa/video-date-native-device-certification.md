# Video Date Native Device Certification

Date: 2026-06-08

Native source parity and static contracts are necessary, but they are not physical-device proof. This checklist certifies the Expo/native Video Date path on real iOS and Android devices.

## Preconditions

- Use a disposable live or staging event with two eligible users.
- Use the current app build that contains the target commit.
- Use two separate physical devices and two separate accounts.
- Confirm camera, microphone, push notification, and network permissions are available.
- Run `npm run test:video-date:red-flags` and `npm run test:video-date-v4` before device QA.
- Run `npm run check:video-date:invariants` before and after the device run when database credentials are available.

## Required iOS And Android Scenarios

Run each scenario on both platforms unless a scenario explicitly covers a cross-device pairing.

- Mutual match inside the same event routes both users to the same Ready Gate session.
- Standalone `/ready/[id]` deep link opens actionable Ready Gate truth and records entry proof.
- Ready Gate overlay path opens actionable Ready Gate truth and records entry proof.
- First Ready tap reaches `ready_a` or `ready_b`; second reaches `both_ready`.
- Post-ready room warmup never joins Daily before `/date/[id]`.
- `/date/[id]` takes route ownership after `both_ready`; lobby and Ready Gate do not bounce the user back.
- Both users join the same Daily room and show remote media.
- Background/foreground during warm-up does not mark the partner away while Daily is active.
- Delayed push or deep link into an active session lands on `/date/[id]`, not stale Ready Gate.
- Same-session route remount parks or reuses the active Daily call; it does not destroy and rebuild a joined call.
- Local Daily `participant-left` waits through the local grace window before partner-away signaling.
- Confirmed encounter promotes to `date` after both joined and both remote-seen evidence exists.
- Date end opens `PostDateSurvey` on `/date/[id]` and stops Daily/surface/reconnect churn.
- Survey retry or app foreground recovery persists `date_feedback`.
- After feedback, the user returns to the expected lobby/deck/next Ready Gate state.

## Evidence To Record

- Build id, commit SHA, device model, OS version, app version, event id, and session id.
- Whether the user entered through overlay, standalone `/ready/[id]`, notification, or deep link.
- Ready Gate RPC payloads for both users.
- Daily room name, provider participant ids, joined/left timestamps, and remote-seen timestamps.
- Screenshots or screen recordings for Ready Gate, live date, survey, and post-feedback next surface.
- `date_feedback` row ids for both users.
- Any RC/native diagnostics with tokens redacted.

## Pass Criteria

The native run passes only when both iOS and Android complete the full golden flow through `date_feedback` and expected next surface. A passing web run does not certify native, and passing static native tests do not certify physical devices.
