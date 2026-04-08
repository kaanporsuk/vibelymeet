# Browser Auth Runtime Proof Results

Date: 2026-04-08  
Branch: `qa/fresh-smoke-proof-bootstrap`

## 1. Summary

This branch replaces the stale-Chrome smoke dependency with a repeatable fresh smoke bootstrap path and closes most of the remaining smoke/data-dependent browser-proof gaps.

- `Schedule` now has hard runtime proof for authenticated render, real save, controlled rollback, cleanup, non-empty `Pending / Upcoming / History` buckets, and reminder-routing truth on fresh smoke data.
- `Referrals` now has hard runtime proof for the authenticated hub, canonical invite-link generation/copy, browser-side `/invite?ref=` handoff into `/auth?ref=...`, set-once attribution, self-ref rejection, and repeat-attempt immutability on fresh smoke auth.
- `OneSignal` now has hard runtime proof for an authenticated production browser with a real worker, granted permission, live subscription ID, and DB-synced `notification_preferences`.
- `Vibe Studio` now has hard runtime proof for authenticated open/read health, ready-state render, caption save/revert, and create/upload-entry plus delete cleanup on fresh smoke accounts.

The branch also proved an environment boundary precisely:

- Historical smoke sessions for `2cf4...` and `2a09...` still exist in local Chrome Local Storage, but their refresh tokens are no longer valid in production (`refresh_token_not_found`).
- Repo-side proof no longer depends on those stale artifacts alone: `npm run proof:smoke-bootstrap` now resets fresh smoke credentials, seeds tagged proof data, and runs fresh-session browser proof.

## 2. Exact commands and harness

Primary harnesses used across the latest proof streams:

- `npm run proof:browser-auth`
- `npm run proof:smoke-bootstrap`
- `node scripts/fresh-smoke-proof-bootstrap.mjs cleanup`
- Backed by `scripts/browser-auth-runtime-proof.mjs`
- Backed by `scripts/fresh-smoke-proof-bootstrap.mjs`

One-off supporting proof used during execution:

- Chrome Local Storage inspection to recover stored auth-session JSON
- Direct refresh-token replay against Supabase auth to test smoke-session reuse
- Live SQL against the linked Supabase project for policy inspection and DB-state confirmation
- `supabase db query --linked` (script-backed smoke auth reset + tagged proof-state cleanup)
- `supabase migration list`
- `supabase db push --include-all --yes`
- Focused post-fix authenticated route check for `/dashboard`, `/vibe-studio`, and `/settings/referrals`

## 3. Proof outcome matrix

| Area | Check | Result | Exact evidence | Blocker / note |
|---|---|---|---|---|
| Schedule | Authenticated `/schedule` render | Hard pass | Real browser proof loaded `My Schedule`, `Availability`, `My Vibe Schedule`, and the `Pending / Upcoming / History` tabs on `https://www.vibelymeet.com/schedule`. The fresh smoke bootstrap proof also rendered non-empty bucket data for the tagged smoke pair. | — |
| Schedule | Save | Hard pass | Clicking the first slot changed `2026-04-08_morning` from neutral to `Open`; authenticated browser query returned `[{\"slot_key\":\"2026-04-08_morning\",\"status\":\"open\"}]`. | — |
| Schedule | Rollback / error state | Hard pass | Forced the next `POST /rest/v1/user_schedules` to return 500. The attempted `2026-04-08_afternoon` write left no persisted row (`[]`) and the UI returned to `Afternoon`. Console logged `Failed to sync schedule`. | — |
| Schedule | Cleanup / remove | Hard pass | After removing the saved morning slot, authenticated browser query for `2026-04-08_morning` returned `[]`. | — |
| Schedule | Pending / upcoming / history buckets with real data | Hard pass | `npm run proof:smoke-bootstrap` seeded tagged smoke proposals and accepted plans, then rendered `Pending (1)`, `Upcoming (1)`, and `History (6)` on `/schedule`. The browser proof confirmed the tagged smoke records were visible in all three buckets. | Existing historical cancelled smoke suggestions still contribute to the total history count, but the tagged proof record is visible there. |
| Schedule | Reminder-routing truth | Hard pass | Fresh smoke proof seeded an accepted plan starting within the next hour. `/schedule` rendered `Upcoming Dates` with partner `Direk` and a live countdown, and `/dashboard` rendered the same countdown chip (`19m 36sDirek`). | — |
| Schedule | Chat -> schedule consistency through authenticated UI | Already hard-proved | Prior live-data proof already showed `messages.message_kind='date_suggestion'` rows and persisted `date_suggestions` linkage for the smoke match. This branch did not need to re-open that already-closed backend-owned proof. | — |
| Referrals | Authenticated hub route | Hard pass | The real protected route is `/settings/referrals`, not `/referrals`. Authenticated browser rendered `Invite friends`, status card, and canonical link UI. | This closes the earlier route ambiguity. |
| Referrals | Invite link generation | Hard pass | Authenticated browser rendered `https://vibelymeet.com/invite?ref=27b4b3bd-d441-4903-88a5-e25cf7acfa96`. | — |
| Referrals | Copy path | Hard pass | Clicking `Copy link` produced the success toast and wrote the exact canonical invite URL. | Share-sheet invocation was not used because headless automation does not provide a real system share target. |
| Referrals | `/invite?ref=` landing | Hard pass | Fresh unauthenticated browser navigated from `/invite?ref=27b4...` to `/auth?ref=27b4...`; `localStorage.vibely_referrer_id` was set to the same id. | — |
| Referrals | Practical attribution (`referred_by` set-once / repeat-attempt immutability / self-ref rejection) | Hard pass | `npm run proof:smoke-bootstrap` reset `profiles.referred_by`, proved `/invite?ref=2cf4...` stored the ref in browser local storage, injected a fresh smoke auth session, then confirmed `/settings/referrals` rendered `You joined from Kaan's invite` with `Existing referred_by: 2cf4...`. Repeating `/auth?ref=2cf4...` left `referred_by` unchanged, and self-ref on the source smoke account left `referred_by = null` with the stored ref cleared. | The repeat-attempt immutability proof reused the same referrer id rather than introducing a third dedicated referrer account. |
| Vibe Studio | Authenticated open/read path | Hard pass | After deploying `20260408173000_event_registrations_rls_recursion_fix.sql`, `npm run proof:browser-auth` loaded `/vibe-studio` with `VIBE STUDIO`, `Show your energy before the first chat.`, `No video yet`, and `Create your Vibe Video`. The proof harness recorded `events: []` for the route, and a focused authenticated route check showed `/dashboard`, `/vibe-studio`, and `/settings/referrals` rendering without recursive Supabase 500s. | This closes the prior authenticated runtime blocker. |
| Vibe Studio | Ready render + caption save/revert | Hard pass | Fresh smoke proof opened `/vibe-studio` on `2cf4...` and rendered `Ready`, `Your Vibe Video is live`, and the existing caption `Yeyyyy !! 🤩`. The browser then saved caption `[fresh-smoke-proof-bootstrap] caption` and restored the original caption, with DB reads confirming both transitions. | — |
| Vibe Studio | Create/upload entry + delete cleanup | Hard pass | Fresh smoke proof opened `/vibe-studio` on `2a09...`, confirmed the `No video yet` state, called `create-video-upload`, reloaded to the `Uploading` state with `bunny_video_status='uploading'`, then called `delete-vibe-video` and returned to `No video yet` with `bunny_video_uid = null` and `bunnyRemoteDeleteOk = true`. | This proves entry-state creation and cleanup, not a completed binary upload/webhook-ready cycle. |
| Vibe Studio | Fresh binary upload -> processing -> ready / replace | Narrow remaining blocker | The bootstrap proof did not upload a real binary through tus to webhook-ready completion, and did not replace the already-ready primary smoke video. | Needs either a third dedicated smoke media account or a safe reversible binary-upload proof path. |
| OneSignal | Authenticated worker registration | Hard pass | Real authenticated browser had service worker scope `https://www.vibelymeet.com/` with active script `OneSignalSDKWorker.js?...`. | — |
| OneSignal | Existing permission state | Hard pass | `Notification.permission === "granted"` in the real copied Chrome session. | — |
| OneSignal | Subscription identity path | Hard pass | Browser `PushSubscription.id` was `6a43beeb-c125-4473-9f47-9eb63f26629f`; DB `notification_preferences.onesignal_player_id` for the same authenticated user matched that exact id and `onesignal_subscribed = true`. | — |
| OneSignal | Fresh prompt path | Partial / blocked-by-environment | Fresh profile with valid injected current session started at `Notification.permission === "default"`, showed the in-app enable flow, then the headless browser transitioned to `denied` and OneSignal logged `Permission blocked`. | This proves the app attempted the prompt path, but the automation environment cannot simulate a human grant outcome. |
| OneSignal | Delivery path | Blocked | Current user has a live subscription row but no recent `push_notification_events` or `notification_log` rows to use as branch-local delivery evidence. | Needs either a safe test send or existing fresh backend event. |
| OneSignal | Click / deep-link path | Blocked | No delivered notification was available to click in this session. | Needs real non-headless browser/device notification interaction. |

## 4. Exact runtime blockers isolated

### A. Fresh smoke bootstrap path replaces stale Chrome dependency

Recovered local Chrome Local Storage contains historical auth records for:

- `2cf4a5af-acc7-4450-899d-0c7dc85139e2`
- `2a0995e1-8ec8-4a11-bdfe-0877c3383f5c`

Direct Supabase refresh replay for the newest `2cf4...` record returned:

- `400 refresh_token_not_found`
- Message: `Invalid Refresh Token: Refresh Token Not Found`

Implication:

- The historical smoke sessions are no longer reusable proof identities from local artifacts alone.
- This branch removes that blocker by adding `scripts/fresh-smoke-proof-bootstrap.mjs` plus `npm run proof:smoke-bootstrap`.
- The new bootstrap path writes/refreshes an untracked local `.env.cursor.local`, resets the smoke users' password hashes through `supabase db query --linked`, resets `profiles.referred_by`, cleans tagged proof rows, seeds tagged schedule proposals/plans, and then runs fresh-session browser proof against those accounts.
- Fresh smoke proof is now repeatable from repo-side tooling without depending on stale Chrome session artifacts.

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

## 5. Exact fix/bootstrap applied and next branch

For the recursive runtime defect:

- Branch used: `fix/event-registrations-rls-recursion`
- Migration added: `supabase/migrations/20260408173000_event_registrations_rls_recursion_fix.sql`
- Cloud impact: Supabase migration deploy was required and was applied in this branch

For the fresh smoke bootstrap closure:

- Branch used: `qa/fresh-smoke-proof-bootstrap`
- Script added: `scripts/fresh-smoke-proof-bootstrap.mjs`
- Package entry added: `npm run proof:smoke-bootstrap`
- Cloud impact: no migration or deploy was required; proof used linked SQL execution plus authenticated runtime routes

For the remaining narrow browser/runtime gap after that:

- Recommended branch (only if needed): `qa/fresh-vibe-upload-processing-proof`
- Scope:
  - use a safe dedicated smoke media account or reversible upload path
  - exercise actual tus upload -> webhook processing -> ready
  - prove replace flow without sacrificing the existing ready smoke video

## 6. Current readiness judgment

Native/web readiness is improved but still **No-Go** for a clean readiness call.

What is now solid:

- rebuildability remains closed from the prior branch
- authenticated schedule mutation proof exists
- authenticated referrals hub + invite landing proof exists
- fresh smoke schedule bucket + reminder proof now exists
- fresh smoke referral attribution proof now exists
- fresh smoke Vibe Studio ready/caption/create/delete proof now exists
- authenticated OneSignal worker/subscription/browser-state proof exists

What still blocks a confident go-call:

- no interactive human-accepted push prompt / click-through proof
- no fresh end-to-end binary upload -> processing -> ready / replace proof on a safe dedicated smoke media account
- existing provider/device blockers from prior readiness docs still remain
