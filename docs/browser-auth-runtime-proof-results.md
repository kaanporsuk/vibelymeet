# Browser Auth Runtime Proof Results

Date: 2026-04-08  
Branch: `fix/event-registrations-rls-recursion`

## 1. Summary

This branch closes the authenticated-browser runtime failure caused by recursive RLS on `event_registrations`.

- `Schedule` now has hard runtime proof for authenticated render, real save, controlled rollback, and cleanup on production.
- `Referrals` now has hard runtime proof for the authenticated hub, canonical invite-link generation/copy, and browser-side `/invite?ref=` handoff into `/auth?ref=...`.
- `OneSignal` now has hard runtime proof for an authenticated production browser with a real worker, granted permission, live subscription ID, and DB-synced `notification_preferences`.
- `Vibe Studio` now has hard runtime proof for authenticated open/read health. After the Supabase policy fix deployed in this branch, `/vibe-studio` renders the real studio surface instead of the prior failure shell.

The branch also proved an environment boundary precisely:

- Historical smoke sessions for `2cf4...` and `2a09...` still exist in local Chrome Local Storage, but their refresh tokens are no longer valid in production (`refresh_token_not_found`). They are not reusable proof sessions.

## 2. Exact commands and harness

Primary harness added in this branch:

- `npm run proof:browser-auth`
- Backed by `scripts/browser-auth-runtime-proof.mjs`

One-off supporting proof used during execution:

- Chrome Local Storage inspection to recover stored auth-session JSON
- Direct refresh-token replay against Supabase auth to test smoke-session reuse
- Live SQL against the linked Supabase project for policy inspection and DB-state confirmation
- `supabase migration list`
- `supabase db push --include-all --yes`
- Focused post-fix authenticated route check for `/dashboard`, `/vibe-studio`, and `/settings/referrals`

## 3. Proof outcome matrix

| Area | Check | Result | Exact evidence | Blocker / note |
|---|---|---|---|---|
| Schedule | Authenticated `/schedule` render | Hard pass | Real browser session loaded `My Schedule`, `Availability`, `My Vibe Schedule`, and the `Pending / Upcoming / History` tabs on `https://www.vibelymeet.com/schedule`. | Current session had empty live buckets, so this proves empty-state rendering only. |
| Schedule | Save | Hard pass | Clicking the first slot changed `2026-04-08_morning` from neutral to `Open`; authenticated browser query returned `[{\"slot_key\":\"2026-04-08_morning\",\"status\":\"open\"}]`. | — |
| Schedule | Rollback / error state | Hard pass | Forced the next `POST /rest/v1/user_schedules` to return 500. The attempted `2026-04-08_afternoon` write left no persisted row (`[]`) and the UI returned to `Afternoon`. Console logged `Failed to sync schedule`. | — |
| Schedule | Cleanup / remove | Hard pass | After removing the saved morning slot, authenticated browser query for `2026-04-08_morning` returned `[]`. | — |
| Schedule | Pending / upcoming / history buckets with real data | Partial | Route renders the three buckets and current-session counts are all zero. | A reusable authenticated proof account with live plans could not be established; stored smoke sessions are stale. |
| Schedule | Reminder-routing truth | Blocked | No live reminders existed for the reusable current session. | Needs a valid authenticated account with accepted plan/reminder data. |
| Schedule | Chat -> schedule consistency through authenticated UI | Blocked in this branch | Prior branch already hard-proved server-owned chat/date-suggestion linkage from live data. | Browser-side authenticated proof for the smoke pair is blocked by stale smoke sessions. |
| Referrals | Authenticated hub route | Hard pass | The real protected route is `/settings/referrals`, not `/referrals`. Authenticated browser rendered `Invite friends`, status card, and canonical link UI. | This closes the earlier route ambiguity. |
| Referrals | Invite link generation | Hard pass | Authenticated browser rendered `https://vibelymeet.com/invite?ref=27b4b3bd-d441-4903-88a5-e25cf7acfa96`. | — |
| Referrals | Copy path | Hard pass | Clicking `Copy link` produced the success toast and wrote the exact canonical invite URL. | Share-sheet invocation was not used because headless automation does not provide a real system share target. |
| Referrals | `/invite?ref=` landing | Hard pass | Fresh unauthenticated browser navigated from `/invite?ref=27b4...` to `/auth?ref=27b4...`; `localStorage.vibely_referrer_id` was set to the same id. | — |
| Referrals | Practical attribution (`referred_by` set-once / not overwritten) | Blocked | Current authenticated user still has `referred_by = null`. | No second valid authenticated browser session was recoverable for a safe real attribution test. |
| Vibe Studio | Authenticated open/read path | Hard pass | After deploying `20260408173000_event_registrations_rls_recursion_fix.sql`, `npm run proof:browser-auth` loaded `/vibe-studio` with `VIBE STUDIO`, `Show your energy before the first chat.`, `No video yet`, and `Create your Vibe Video`. The proof harness recorded `events: []` for the route, and a focused authenticated route check showed `/dashboard`, `/vibe-studio`, and `/settings/referrals` rendering without recursive Supabase 500s. | This closes the prior authenticated runtime blocker. |
| Vibe Studio | Upload/create / processing / ready / replace / delete / caption save | Blocked by auth/data availability | The route is healthy again, but the reusable current session only proves the empty/no-video state. | Fresh smoke auth material or a safe dedicated test media flow is still needed for end-to-end media lifecycle proof. |
| OneSignal | Authenticated worker registration | Hard pass | Real authenticated browser had service worker scope `https://www.vibelymeet.com/` with active script `OneSignalSDKWorker.js?...`. | — |
| OneSignal | Existing permission state | Hard pass | `Notification.permission === "granted"` in the real copied Chrome session. | — |
| OneSignal | Subscription identity path | Hard pass | Browser `PushSubscription.id` was `6a43beeb-c125-4473-9f47-9eb63f26629f`; DB `notification_preferences.onesignal_player_id` for the same authenticated user matched that exact id and `onesignal_subscribed = true`. | — |
| OneSignal | Fresh prompt path | Partial / blocked-by-environment | Fresh profile with valid injected current session started at `Notification.permission === "default"`, showed the in-app enable flow, then the headless browser transitioned to `denied` and OneSignal logged `Permission blocked`. | This proves the app attempted the prompt path, but the automation environment cannot simulate a human grant outcome. |
| OneSignal | Delivery path | Blocked | Current user has a live subscription row but no recent `push_notification_events` or `notification_log` rows to use as branch-local delivery evidence. | Needs either a safe test send or existing fresh backend event. |
| OneSignal | Click / deep-link path | Blocked | No delivered notification was available to click in this session. | Needs real non-headless browser/device notification interaction. |

## 4. Exact runtime blockers isolated

### A. Smoke sessions are stale, not merely missing

Recovered local Chrome Local Storage contains historical auth records for:

- `2cf4a5af-acc7-4450-899d-0c7dc85139e2`
- `2a0995e1-8ec8-4a11-bdfe-0877c3383f5c`

Direct Supabase refresh replay for the newest `2cf4...` record returned:

- `400 refresh_token_not_found`
- Message: `Invalid Refresh Token: Refresh Token Not Found`

Implication:

- The smoke sessions are no longer reusable proof identities from local artifacts alone.
- Remaining smoke-account-only checks are genuinely blocked by stale auth material, not by lack of effort in this branch.

### B. Recursive RLS root cause is fixed and deployed

Exact root cause:

- Recursive policy: `Users can view registrations for shared events`
- Current-source migration that reintroduced the self-reference: `supabase/migrations/20260405103000_event_admission_rpc_auth_stripe_settle.sql`
- Dependent co-attendee policies: `Users can view event participant profiles` in `supabase/migrations/20251227012106_b28f04de-470b-434d-b31a-00931a538f09.sql` and `Users can view event participants profile vibes` in `supabase/migrations/20260118074329_b2d606c5-65fc-4661-978c-0f55db05d39d.sql`

Why it failed:

- The live `event_registrations` `SELECT` policy evaluated `EXISTS (...) FROM public.event_registrations er ...` against the same table it protected.
- `profiles` and `profile_vibes` event-participant visibility depended on `event_registrations`, so authenticated reads like `fetchMyProfile()` and route-level profile hydration inherited the same recursion and surfaced as browser 500s.

Exact fix applied:

- Added `supabase/migrations/20260408173000_event_registrations_rls_recursion_fix.sql`
- Replaced the recursive `event_registrations` policy with `auth.uid() = profile_id OR public.is_registered_for_event(auth.uid(), event_id)`
- Added `public.viewer_shares_event_with_profile(uuid)` as a `SECURITY DEFINER` helper for the `profiles` and `profile_vibes` co-attendee policies
- Deployed the migration with `supabase db push --include-all --yes`

Post-fix runtime evidence:

- Live `pg_policies` now shows the non-recursive definitions:
  - `event_registrations`: `((auth.uid() IS NOT NULL) AND ((auth.uid() = profile_id) OR is_registered_for_event(auth.uid(), event_id)))`
  - `profiles`: `viewer_shares_event_with_profile(id)`
  - `profile_vibes`: `viewer_shares_event_with_profile(profile_id)`
- Post-deploy proof rerun shows `/vibe-studio` loading the studio UI instead of the failure shell.
- Post-deploy route checks for `/dashboard`, `/vibe-studio`, and `/settings/referrals` only surfaced aborted third-party telemetry noise, not recursive Supabase 500s.

## 5. Exact fix applied and next branch

For the real production defect:

- Branch used: `fix/event-registrations-rls-recursion`
- Migration added: `supabase/migrations/20260408173000_event_registrations_rls_recursion_fix.sql`
- Cloud impact: Supabase migration deploy was required and was applied in this branch

For the remaining environment-only proof gap after that:

- Recommended branch: `qa/fresh-smoke-browser-proof`
- Scope:
  - establish fresh reusable credentials or session material for the repo smoke accounts
  - rerun non-empty schedule bucket, attribution, and Vibe Studio media-state proofs

## 6. Current readiness judgment

Native/web readiness is improved but still **No-Go** for a clean readiness call.

What is now solid:

- rebuildability remains closed from the prior branch
- authenticated schedule mutation proof exists
- authenticated referrals hub + invite landing proof exists
- authenticated OneSignal worker/subscription/browser-state proof exists

What still blocks a confident go-call:

- no reusable smoke browser session for non-empty schedule/referral/media proofs
- no interactive human-accepted push prompt / click-through proof
- existing provider/device blockers from prior readiness docs still remain
