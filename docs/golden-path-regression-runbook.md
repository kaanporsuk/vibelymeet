# Vibely Golden Path Regression Runbook

## Purpose

Use this runbook before releases and after auth, event, lobby, swipe, Ready Gate, video-date, post-date, chat, or admin changes. It combines repeatable scripted checks with the manual flows that still require real accounts/devices.

The video-date hardening baseline is closed and documented in `docs/video-date-hardening-closure-handoff.md`. Treat that handoff as the source of truth for video-date ownership boundaries, deploy history, rollback notes, and regression commands.

For seeded live/staging setup of the remaining manual two-user/device/admin checks, use `docs/qa/video-date-seeded-runtime-qa-pack.md`.

## Scripted Harness

Run from the repo root:

```bash
./scripts/run_golden_path_smoke.sh
```

This default quick mode verifies repo prerequisites with `npm run typecheck:core` and `npm run build`.

For the hardened video-date loop:

```bash
./scripts/run_golden_path_smoke.sh --video-date
```

This runs full typecheck, lint, build, the video-date hardening tests, admin ops helper tests, and `git diff --check`.

For release-grade local confidence:

```bash
./scripts/run_golden_path_smoke.sh --full
```

When database work is in scope, add:

```bash
./scripts/run_golden_path_smoke.sh --video-date --db-dry-run
```

or run directly:

```bash
supabase db push --linked --dry-run
```

Expected result after a synced deploy: `Remote database is up to date`.

Optional existing automation:

```bash
npm run test:e2e
cd apps/mobile && MAESTRO_RUN=1 npm run rc-smoke
```

The Playwright layer is a shell smoke only. The Maestro layer requires a device/simulator with the RC build. Do not treat either as a substitute for the manual golden path below.

## Coverage Map

| Area | Scripted | Manual |
| --- | --- | --- |
| Auth/session shell | Type/build, optional Playwright shell | Sign-in, sign-out, onboarding gate, session refresh |
| Event registration/lobby | Type/build | Register, enter lobby, deck loads, event-ended handling |
| Swipe/match/Ready Gate | Video-date tests cover shared contracts | Two-user swipe, Ready Gate routing/countdown/reconnect |
| Video date join/timer/end | Video-date tests cover shared contracts | Daily room join, timer, refresh/rejoin, end flow |
| Post-date survey continuity | Video-date hardening test | Survey submit to Ready Gate/lobby/empty/event-ended |
| Chat/match creation | Type/build | Match thread created, send-message, notification/deep link |
| Admin Video Date Ops | Admin helper test | Admin panel loads, non-admin 403, aggregate-only data |

## Manual Golden Path

### 1. Auth And Session

| Step | Action | Expected outcome |
| --- | --- | --- |
| 1.1 | Open app unauthenticated and visit `/dashboard` | Redirects to auth/onboarding; no private content leaks. |
| 1.2 | Sign in with a test user | Lands on dashboard or intended post-auth route. |
| 1.3 | Reload the app | Session restores without a blank screen or auth loop. |
| 1.4 | Sign out | Private routes are no longer accessible. |

### 2. Event Registration And Lobby

| Step | Action | Expected outcome |
| --- | --- | --- |
| 2.1 | Open Events and select a live seeded event | Event detail loads with valid registration CTA/state. |
| 2.2 | Register or enter as an eligible user | Backend registration succeeds; lobby route opens. |
| 2.3 | Wait for deck load | Cards appear, or a truthful empty/event-ended state appears. |
| 2.4 | Reload lobby | User returns to the same backend-derived lobby state. |

### 3. Swipe, Match, And Ready Gate

| Step | Action | Expected outcome |
| --- | --- | --- |
| 3.1 | Put two test users in the same live event lobby | Both users see eligible cards without client-created lifecycle state. |
| 3.2 | Mutual-swipe nearly simultaneously | Only one active `video_sessions` row exists for the pair. |
| 3.3 | Confirm both clients route | Both users arrive at the same Ready Gate when `video_session_id` is returned. |
| 3.4 | Reload or reconnect during Ready Gate | Countdown derives from `ready_gate_expires_at` when available. |
| 3.5 | Trigger ready/skip/snooze | Existing backend transition actions work; no direct lifecycle writes. |

### 4. Video Date Join, Timer, And End

| Step | Action | Expected outcome |
| --- | --- | --- |
| 4.1 | Both users mark ready | Ready Gate transitions to the video-date route. |
| 4.2 | Join Daily room | Both clients join the same valid room/token path. |
| 4.3 | Refresh or rejoin during the date | Server truth restores the correct phase/timer. |
| 4.4 | Let timer corrections occur, if applicable | Meaningful drift corrections emit timer reconciliation analytics only once per correction. |
| 4.5 | End the date | Backend session state reaches the expected terminal/post-date state. |

### 5. Post-Date Survey Continuity

| Step | Action | Expected outcome |
| --- | --- | --- |
| 5.1 | Submit the post-date survey | User sees a calm continuity bridge/status, not a dead transition. |
| 5.2 | If a queued/activated session exists | User routes to Ready Gate with pending session preserved. |
| 5.3 | If a fresh deck candidate exists | User returns to lobby with a fresh card/state. |
| 5.4 | If no candidate exists | User sees the calm empty state. |
| 5.5 | If event is over | Event-ended/last-chance state wins over other post-survey states. |

### 6. Chat And Match Creation

| Step | Action | Expected outcome |
| --- | --- | --- |
| 6.1 | Complete a successful mutual-match/date path | Match/chat record exists as expected for the product flow. |
| 6.2 | Open `/chat/:matchId` | Thread loads for both participants only. |
| 6.3 | Send a message | `send-message` path writes one message and emits the correct notification/deep link. |
| 6.4 | Retry quickly | No duplicate message/notification regression. |

### 7. Admin Video Date Ops

| Step | Action | Expected outcome |
| --- | --- | --- |
| 7.1 | Log in as admin and open `/kaan/dashboard` | Admin dashboard loads. |
| 7.2 | Go to Event Analytics and select a live/recent event | Video Date Ops shows 24h and 7d windows. |
| 7.3 | Inspect returned metrics | Data is aggregate-only and contains no user PII. |
| 7.4 | Call `admin-video-date-ops` as non-admin | Request returns 403. |
| 7.5 | Cross-check one metric against SQL/PostHog | Values are directionally consistent with backend truth. |

### 8. Native Smoke

| Step | Action | Expected outcome |
| --- | --- | --- |
| 8.1 | Run `cd apps/mobile && npm run typecheck` | Native TypeScript passes. |
| 8.2 | Launch RC build manually or with Maestro | App opens to the expected auth/shell state. |
| 8.3 | Repeat Ready Gate/date/survey path on native | Routing and continuity match web behavior. |

## Pass Criteria

- Scripted harness exits 0 for the selected mode.
- No console errors block the manual flow.
- No Supabase function errors appear for the tested paths.
- Video-date lifecycle state remains backend-owned.
- Admin ops remains aggregate-only and admin-gated.
- Any known limitation is recorded before release.

## What Remains Manual

- Seeded two-user simultaneous swipe timing.
- Daily room media/device behavior.
- Native device/simulator verification.
- PostHog timer-drift trend inspection.
- Admin metric cross-check against production SQL/PostHog.

Use `docs/qa/video-date-seeded-runtime-qa-pack.md` to make those manual checks repeatable.
