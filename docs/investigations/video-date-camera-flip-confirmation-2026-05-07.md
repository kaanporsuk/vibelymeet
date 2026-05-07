# Video Date Camera Flip Confirmation - 2026-05-07

Run tag: `camera-flip-confirm-20260507-1419-trt`

Status: **blocked for deployed-artifact confirmation** until web and native artifacts are built from the no-teardown camera-switch fix.

## Current Finding

The latest production web deployment visible from Vercel was built from `main` at commit `10db35b`:

- Deployment URL: `https://vibelymeet-ceafbqpky-okp805.vercel.app`
- Production aliases: `https://www.vibelymeet.com`, `https://vibelymeet.com`, `https://vibelymeet.vercel.app`
- Vercel target/status: `production` / `READY`
- Created: `2026-05-07T10:35:29.503Z` (`2026-05-07 13:35:29 +0300`)
- Build log source: `github.com/kaanporsuk/vibelymeet`, branch `main`, commit `10db35b`
- Local `HEAD`: `10db35b7df4fcefcabc80fb972bda3526cdbb524`

That deployed commit is **not** the same as the no-teardown working tree. `git show HEAD:` still contains the old camera-switch resend/teardown path:

- `CAMERA_SWITCH_HINT_RESEND_DELAY_MS`
- `cameraSwitchPublishSequenceRef`
- `cameraSwitchHintResendTimeoutRef`
- shared hint fields `publishSequence`, `publishRefreshApplied`, and `hintSequence`
- immediate camera-switch receiver reattach paths in `src/hooks/useVideoCall.ts`

The no-teardown fix is currently present in the dirty working tree, not in the deployed production commit. Do not mark this investigation complete against the current production deployment.

## Local Guardrails

Run against the fixed working tree after aligning the stale hardening test:

| Check | Result | Notes |
| --- | --- | --- |
| `npm run audit:video-date-remote-frame` | PASS | Confirms no direct web hint teardown, no native remount-on-hint, and removed resend plumbing. |
| `npx tsx shared/matching/videoDateEndToEndHardening.test.ts` | PASS | `132/132` passing after updating stale `publishSequence` expectations to protect the no-teardown contract. |

Guardrail caveat: these are green for the local fixed working tree. They do not prove the current production deployment is fixed because production is built from the local `HEAD` tree, while the no-teardown fix is still an uncommitted working-tree change.

## Source Audit Notes

The final local source audit now covers the original hint-receiver teardown and the same-track participant-update race:

- Web hint receiver arms `scheduleRemoteRenderValidation` with `REMOTE_CAMERA_SWITCH_FRESH_FRAME_TIMEOUT_MS`, and does not call `forceRemoteMediaReattach` directly on `app-message`.
- Web `participant-updated` no longer tears down the same persistent track during an active camera-switch watch. Same-track camera-switch candidates use the fresh-frame guard instead.
- Web `forceRemoteMediaReattach` still exists for genuine recovery paths, but `camera_switch_hint` scope is capped at one last-resort attempt after the freshness watcher times out.
- Native hint receiver records an active camera-switch watch, clears pending remounts, and starts a conservative Daily stats freshness watcher instead of remounting `<DailyMediaView />` immediately.
- Native same-track remount recovery waits `NATIVE_CAMERA_SWITCH_SAME_TRACK_REMOUNT_GRACE_MS`, skips while the camera-switch watch is active, and caps `camera_switch_hint` remount recovery to one last-resort attempt.
- The shared hint contract is one-shot and no longer carries resend fields. The parser tolerates legacy resend fields and drops them.
- The internal web `publishRefreshApplied` / `publish_refresh_applied` naming remains only on the local camera-switch commit telemetry path for analytics continuity; it is not part of the shared hint payload.

Plan reconciliation: the older attached fix plan mentioned native stats polling as a possible watchdog. The current working tree now includes that native freshness watcher using Daily `getCpuLoadStats()` with `getNetworkStats()` fallback when available. If neither API is available at runtime, the watcher logs `native_camera_switch_render_watch_unverified` and avoids remounting blindly.

Full local verification after the source audit:

| Check | Result | Notes |
| --- | --- | --- |
| `npm run audit:video-date-remote-frame` | PASS | Source regression guard for web/native no-teardown behavior and removed resend plumbing. |
| `npx tsx shared/matching/videoDateEndToEndHardening.test.ts` | PASS | `132/132` passing, including legacy-field tolerance and no-teardown assertions. |
| `npx tsc --noEmit -p tsconfig.app.json` | PASS | Web/app TypeScript compile. |
| `npm run typecheck` in `apps/mobile` | PASS | Native TypeScript compile. |
| `npm run lint` | PASS | Repo lint, including native hook dependency coverage. |
| `npm run typecheck:core` | PASS | Core typecheck. |
| `npm run build` | PASS | Production web bundle builds. |
| `git diff --check` | PASS | No whitespace errors. |
| Built VideoDate bundle signal scan | PASS | Built chunk contains `daily_camera_switch_no_reattach_needed` and none of the obsolete resend-field symbols. |

## Preview Deployment

The latest preview visible from Vercel is not the same commit as production or the local fixed tree:

- Deployment URL: `https://vibelymeet-ds6qwbz4f-okp805.vercel.app`
- Alias: `https://vibelymeet-git-codex-tighten-admin-user-detail-re-3ac3bc-okp805.vercel.app`
- Vercel target/status: `preview` / `READY`
- Created: `2026-05-07T10:18:45.184Z` (`2026-05-07 13:18:45 +0300`)
- Build log source: branch `codex/tighten-admin-user-detail-read-model`, commit `927ce6f`

Use a preview for VDBG only after redeploying the fixed commit/branch and re-recording the URL and commit here.

## Native Build Identity

Local Expo config:

- App name/slug: `Vibely` / `mobile`
- App version: `1.0.0`
- EAS build version observed in prior builds: `1`
- EAS profiles: `development` internal, `preview` internal, `production` store

EAS lookup for the current commit returned no builds:

- Command: `npx eas-cli build:list --git-commit-hash 10db35b7df4fcefcabc80fb972bda3526cdbb524 --limit 5 --platform all --json --non-interactive`
- Result: `count: 0`

Latest visible native builds are older and must not be used as fixed-native confirmation:

| Platform | Status | Profile | Distribution | Version | Commit | Created | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| iOS | ERRORED | `preview` | `INTERNAL` | `1.0.0 (1)` | `2854a5094e8153062f2e9b88e4d347d1259cc91c` | `2026-04-28T17:30:57.410Z` | Not usable for confirmation. |
| iOS | FINISHED | `preview` | `INTERNAL` | `1.0.0 (1)` | `8fee94c62785499a5e51ac6ff67cfbf023e1e906` | `2026-03-23T15:12:39.875Z` | Older commit and expired artifact. |
| Android | FINISHED | `production` | `STORE` | `1.0.0 (1)` | `7895b44c05f5cdb4028e4835baa93a914070a79d` | `2026-04-25T19:06:45.028Z` | Older commit. |

Native real-device confirmation requires a current iOS/Android build, or a clearly identified local dev-client build, from the same fixed commit as the web artifact.

## Device Matrix

Use disposable paired accounts and tag every note, screenshot, recording, Sentry search, and telemetry query with `camera-flip-confirm-20260507-1419-trt`.

For every sender -> receiver pair:

1. Record sender artifact identity and receiver URL/browser.
2. Join warm-up and wait until both videos render.
3. Flip front -> back -> front at least 5 times.
4. Record each flip timestamp and any receiver blackout duration.
5. Enter date phase and repeat the 5-flip sequence once.
6. Save receiver screen recording and sender PIP recording or screenshot.

Required cases:

- [ ] Native iOS app -> desktop Chrome web
- [ ] Native iOS app -> macOS Safari web
- [ ] Native Android app -> desktop Chrome web, if a current Android build is available
- [ ] iOS Safari mobile browser -> desktop Chrome web
- [ ] Android Chrome mobile browser -> desktop Chrome web
- [ ] Desktop web -> native iOS

## Expected Runtime Evidence

On a fixed web receiver with VDBG enabled, expect:

- `daily_camera_switch_render_hint_received`
- `daily_camera_switch_render_watch_started`
- `daily_camera_switch_no_reattach_needed`

On a normal camera flip, do not expect immediate `daily_remote_render_recovery_started` with `camera_switch_hint`. That event is only acceptable after the fresh-frame watcher times out on a real frozen path.

PostHog note: `daily_camera_switch_no_reattach_needed` is VDBG/Sentry breadcrumb evidence, not a `trackEvent`, unless a future build routes it elsewhere.

## Negative Tests

- Genuine freeze: block or heavily throttle the sender network for about 5 seconds after a camera-switch hint. Confirm the 3-second watcher escalates to exactly one `camera_switch_hint` recovery attempt or the existing recovery UI.
- Partner reconnect: background/foreground one participant or briefly disable network. Confirm real track changes/reconnects still reattach/recover.
- Video off/on: toggle camera off/on. Confirm the no-teardown camera-switch path does not mask intentional video-off state.

## Evidence Template

| Case | Sender artifact | Receiver artifact | Phase | Flip count | Max black frame | Expected logs present | Unexpected recovery? | Result | Evidence links |
| --- | --- | --- | --- | ---: | ---: | --- | --- | --- | --- |
| Native iOS -> Chrome | TBD | TBD | Warm-up | 0/5 | TBD | TBD | TBD | TBD | TBD |
| Native iOS -> Chrome | TBD | TBD | Date | 0/5 | TBD | TBD | TBD | TBD | TBD |
| Native iOS -> Safari | TBD | TBD | Warm-up | 0/5 | TBD | TBD | TBD | TBD | TBD |
| Native iOS -> Safari | TBD | TBD | Date | 0/5 | TBD | TBD | TBD | TBD | TBD |
| iOS Safari -> Chrome | TBD | TBD | Warm-up | 0/5 | TBD | TBD | TBD | TBD | TBD |
| iOS Safari -> Chrome | TBD | TBD | Date | 0/5 | TBD | TBD | TBD | TBD | TBD |
| Android Chrome -> Chrome | TBD | TBD | Warm-up | 0/5 | TBD | TBD | TBD | TBD | TBD |
| Android Chrome -> Chrome | TBD | TBD | Date | 0/5 | TBD | TBD | TBD | TBD | TBD |
| Desktop Chrome -> Native iOS | TBD | TBD | Warm-up | 0/5 | TBD | TBD | TBD | TBD | TBD |
| Desktop Chrome -> Native iOS | TBD | TBD | Date | 0/5 | TBD | TBD | TBD | TBD | TBD |

## Success Criteria

- No receiver black screen over 1 second during normal camera flips.
- No "Tap to resume" during normal camera flips.
- Same-track camera-switch hints show validation/no-reattach logs, not immediate `srcObject` teardown or native media remount.
- Genuine freeze/reconnect paths still recover or surface the expected retry UI.
- Source guardrails are green on the same commit as the deployed web/native artifacts.

## Required Follow-up Before Manual Confirmation

1. Commit the no-teardown fix and updated guardrail, or otherwise produce a clean branch/commit containing the fixed working tree.
2. Deploy web from that exact commit and re-run `vercel inspect` plus build-log commit verification.
3. Produce native iOS and Android builds from that exact commit, or explicitly limit confirmation to mobile-browser sender cases.
4. Re-run the two local guardrails against the deployed commit.
5. Run the real-device matrix and fill the evidence table above.
