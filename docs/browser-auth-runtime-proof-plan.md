# Browser Auth Runtime Proof Plan

Date: 2026-04-08  
Branch: `qa/browser-auth-runtime-proof`

This stream is proof-only. The goal is to close the remaining authenticated browser/runtime gaps with live evidence from production-serving routes, not static code inspection.

## 1. Exact proof targets

### Schedule

- Authenticated render of `/schedule`
- Save path for a real availability slot
- Rollback path when a real write fails
- Pending / upcoming / history bucket rendering
- Reminder-routing truth if a live reminder is available
- Chat -> schedule consistency only if an authenticated proof account with real match/suggestion data can be recovered

### Referrals

- Authenticated referrals hub route
- Canonical invite link generation and copy/share path
- Public `/invite?ref=...` landing behavior in a JS-capable browser
- Practical attribution behavior (`referred_by` set-once / not overwritten) only if a second valid authenticated proof session can be established safely

### Vibe Studio

- Authenticated open of `/vibe-studio`
- Upload/create, processing, ready, replace/delete, caption save if a valid proof account and writable studio state are available
- If the route fails before feature interaction, isolate the backend/root-cause blocker precisely

### OneSignal

- Authenticated production browser worker registration
- Current permission/subscription state in a real browser session
- Live browser subscription identity vs `notification_preferences` sync
- Permission prompt path only if the browser automation environment permits a real prompt outcome
- Delivery/click/deep-link only if existing tooling can safely exercise it without provider-side drift

## 2. Routes and surfaces under test

- `/dashboard`
- `/schedule`
- `/settings/referrals`
- `/invite?ref=<user-id>`
- `/vibe-studio`
- Production OneSignal worker scope under `https://www.vibelymeet.com/`

## 3. Smoke identity and session strategy

Attempt order for authenticated access:

1. Reuse the existing local Chrome authenticated session by copying the `Default` profile into a temporary proof profile.
2. Recover any repo-known smoke sessions from Chrome Local Storage if present.
3. Attempt safe session refresh before declaring a smoke session unusable.
4. Use the minimal added browser harness only after the above reuse paths are exhausted.

Observed local session strategy outcome:

- A reusable current authenticated browser session exists locally for user `27b4b3bd-d441-4903-88a5-e25cf7acfa96`.
- Historical smoke sessions for `2cf4a5af-acc7-4450-899d-0c7dc85139e2` and `2a0995e1-8ec8-4a11-bdfe-0877c3383f5c` are still present in Chrome Local Storage artifacts.
- Those smoke sessions must not be assumed usable until refresh succeeds. If refresh fails, they count as environment blockers, not proof.

## 4. Browser automation availability

- No checked-in browser-auth proof harness existed at branch start.
- Minimal proof-only automation is added in this branch:
  - `playwright` dev dependency
  - `scripts/browser-auth-runtime-proof.mjs`
  - `npm run proof:browser-auth`

The harness is intentionally narrow. It copies the current Chrome profile into a temp directory, launches production routes in Chrome, captures authenticated route state, runs schedule save/rollback proof, proves referrals hub + invite landing, snapshots OneSignal browser state, and records the current Vibe Studio failure.

## 5. What can be proven here

Hard-pass capable in this environment:

- Authenticated route rendering for any route reachable from the copied current Chrome session
- Real schedule write success and rollback by forcing a controlled request failure
- Authenticated referrals hub and unauthenticated invite landing
- Existing OneSignal permission/subscription/worker state for a real authenticated browser session
- Backend-linked blockers exposed by authenticated runtime failures

Likely blocked unless a second valid session/device is recovered:

- Non-empty pending/upcoming/history schedule buckets for the repo smoke pair
- Authenticated referral attribution set-once behavior
- Vibe Studio ready/replace/delete/caption flows on the known smoke video account
- Human-approved notification prompt acceptance
- Push click/deep-link proof from a delivered browser notification

## 6. User intervention threshold

User intervention should only be required if all grounded local paths fail:

- No reusable authenticated browser session exists locally
- Stored smoke sessions cannot be refreshed
- Headless/browser automation cannot produce a permission/click path that matches production behavior

If that happens, the blocker must be reported precisely with the smallest exact next branch or manual capability needed.

## 7. Hard pass / fail criteria

| Target | Hard pass criteria | Fail criteria | Blocked criteria |
|---|---|---|---|
| Schedule render | `/schedule` loads in authenticated browser and exposes live schedule UI | Route crashes or never resolves due app defect | No valid authenticated session |
| Schedule save | Slot turns open and authenticated row query returns persisted `user_schedules` row | Slot never persists | No writable authenticated session |
| Schedule rollback | Forced failing write leaves no persisted row and UI returns to pre-click state | Failed write leaves drifted UI or DB state | Cannot safely force failure |
| Referrals hub | `/settings/referrals` renders for authenticated user with canonical invite link | Route missing/broken | No valid authenticated session |
| Invite landing | `/invite?ref=` lands on `/auth?ref=...` and browser preserves ref state | Ref is dropped or route fails | Browser runtime unavailable |
| Attribution set-once | Live runtime write proves initial set and non-overwrite | `referred_by` can be overwritten or self-set | No safe second authenticated account |
| Vibe Studio open | `/vibe-studio` renders authenticated studio state | Route fails on real runtime | No valid authenticated session |
| OneSignal state | Browser shows real worker + permission/subscription state and DB row matches | Worker/subscription path is broken | Prompt/click path needs interactive capability |

## 8. Expected closure shape

At branch close every target should be classified as:

- `Hard pass` with real route/browser evidence
- `Fail` with precise runtime blocker and likely root cause
- `Blocked` with an exact missing capability or stale-session boundary
