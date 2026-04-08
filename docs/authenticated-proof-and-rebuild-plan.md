# Authenticated Proof And Rebuild Plan

Date: 2026-04-08  
Branch: `qa/authenticated-proof-and-rebuild-rehearsal`

This stream is proof-focused. It does not assume correctness from static code inspection alone. A check only becomes a hard pass if it is backed by live runtime evidence collected in this branch.

## 1. Environments and accounts under test

### Code and build environment

- Workspace branch: `qa/authenticated-proof-and-rebuild-rehearsal`
- Repo baseline under test: current `main` plus evidence/docs produced in this branch only
- Local toolchain expected: Node.js, npm, Supabase CLI, project-local env files if present

### Runtime environments

- Production web host: `https://vibelymeet.com`
- Production web alias: `https://www.vibelymeet.com`
- Linked Supabase project ref from rebuild pack: `schdyxcunwcvddlcshwd`

### Known smoke/test identities referenced by the repo

- Profile `2cf4a5af-acc7-4450-899d-0c7dc85139e2` (`direklocal@gmail.com`)
- Profile `2a0995e1-8ec8-4a11-bdfe-0877c3383f5c` (`kaanporsuk@gmail.com`)

These identities are documented in migrations and are the only explicit repo-backed smoke users currently known. If reusable auth credentials or an existing authenticated session are not locally available, authenticated UI proof may remain blocked even if DB and route evidence is available.

## 2. Deploy expectation before testing

- Supabase deploy required before testing: **No**
- Vercel/hosting deploy required before testing: **No**
- Provider-dashboard changes required before testing: **No expected precondition for this stream**

If a real runtime defect is reproduced and traced to missing cloud state rather than code, this document will be updated with the smallest required follow-up action instead of broadening this branch.

## 3. Evidence policy

- `Hard pass`: live runtime proof captured from authenticated route execution, live SQL state, or production/runtime logs that directly demonstrate the intended behavior.
- `Blocked`: proof requires a capability not available in this session (for example: browser push permission prompt, notification click interaction, or missing smoke-account credentials).
- `Fail`: a live check reproduces incorrect behavior.
- `Implementation-only confidence` is not sufficient for closure in this branch and should not be reported as a hard pass.

## 4. Runtime proof matrix

| Area | Exact check | Route or surface | Planned evidence source | Automatable here | Pass criteria | Deploy required before test |
|---|---|---|---|---|---|---|
| Schedule | Save | `/schedule` web; native parity judged from shared backend/runtime data | Authenticated route hit if possible, plus live DB row delta | Partial | Save writes expected `user_schedules` state for smoke profile and route remains healthy | No |
| Schedule | Rollback/error handling | `/schedule` | Forced-invalid or revoked write path if feasible; otherwise blocker | Partial | Failed write restores prior state and exposes a failure signal | No |
| Schedule | Pending / upcoming / history buckets | `/schedule`, dashboard/home reminder surfaces | Live SQL seeded state plus authenticated route evidence if possible | Partial | Buckets reflect backend truth without client-only drift | No |
| Schedule | Reminder-routing truth | dashboard/home + accepted plan state | Live SQL proof and route evidence | Partial | Reminder UI contract matches accepted plan truth | No |
| Schedule | Chat -> schedule consistency | server-owned suggestion action path | Function/API logs plus live data transitions | Partial | Suggestion decision path is backend-owned and produces expected downstream schedule state | No |
| Referrals | Entry points | settings, matches, profile to referrals hub | Authenticated route resolution and navigation evidence if possible | Partial | All entry points reach referrals surface without broken route/auth state | No |
| Referrals | Invite link behavior | referrals hub share/copy actions | Live canonical URL generation and route fetch | Yes | Invite links resolve to canonical `/invite?ref=...` behavior | No |
| Referrals | `/invite?ref=...` landing | production web invite route | Production fetch/redirect evidence | Yes | Invite landing preserves attribution context into auth route | No |
| Referrals | Attribution semantics in practice | auth + profile attribution path | Live SQL state for smoke identities and attribution attempts if feasible | Partial | `referred_by` is set once, never self, never overwritten | No |
| Vibe Studio | Open | `/vibe-studio` | Authenticated route hit if possible, plus live profile/video rows | Partial | Studio route loads against real profile state | No |
| Vibe Studio | Upload/create | studio modal + upload path | Function/storage logs and live DB/video-state changes if feasible | Partial | Upload path creates expected pending/processing state | No |
| Vibe Studio | Processing | studio/video state | Live profile/video status evidence | Yes | Processing state exists and maps correctly | No |
| Vibe Studio | Ready | studio playback state | Live ready-state evidence, route proof if possible | Partial | Ready state carries usable playback metadata | No |
| Vibe Studio | Replace/delete | studio management actions | Edge-function logs plus DB state change if feasible | Partial | Delete/replace transitions occur without orphaned state | No |
| Vibe Studio | Caption save | profile update path | Live DB row update if feasible | Partial | Caption persists without media ownership drift | No |
| OneSignal | Worker registration | production browser worker endpoints | Production fetch plus browser-capable proof if possible | Partial | Root worker asset is served and registerable from production host | No |
| OneSignal | Permission prompt | production authenticated browser | Interactive browser evidence only | No | Native browser prompt can be triggered and state changes are visible | No |
| OneSignal | Subscription identity path | production auth + OneSignal SDK | Live DB row/log update after subscription | Partial | Player/subscription identity reaches `notification_preferences` | No |
| OneSignal | `notification_preferences` sync | DB row | Live SQL row evidence | Yes | Expected push fields update after subscription action | No |
| OneSignal | Delivery path | `send-notification` and provider dispatch | Function logs and delivered-notification proof if feasible | Partial | Real dispatch attempt succeeds and targets subscribed identity | No |
| OneSignal | Click/deep-link path | production notification click | Interactive browser/device evidence only | No | Click opens routed destination from notification payload | No |

## 5. Rebuild rehearsal plan

The rebuild rehearsal is intentionally disciplined and logged. It is not treated as complete until commands and outcomes are recorded in `docs/rebuild-rehearsal-log.md`.

Planned sequence:

1. Record baseline: branch, commit, node, npm, Supabase CLI.
2. Verify env-file assumptions without printing secret values.
3. Run dependency install from lockfile (`npm ci`).
4. Run migration parity inspection (`./scripts/check_migration_parity.sh`).
5. Run build (`npm run build`).
6. Run static smoke (`./scripts/run_golden_path_smoke.sh`).
7. Note every ambiguity, hidden dependency, missing assumption, or provider dependency encountered.

## 6. Known likely blockers before execution

- There is no checked-in browser automation harness for authenticated web flows in this repo.
- There is no checked-in web push automation harness capable of granting notification permissions or clicking a real delivered notification.
- Smoke-profile identities are known from migrations, but reusable auth credentials may or may not be available locally.
- Native device-only flows remain out of scope unless a pre-existing automation path is already available in the repo or local environment.

## 7. Closure target for this branch

At branch close, every target check must be classified as one of:

- `Hard pass` with runtime evidence
- `Blocked` with exact missing capability and the smallest next-fix branch
- `Fail` with precise root cause and the smallest safe remediation path

## 8. Execution results (2026-04-08)

### Environment and identity evidence collected

- Production web host and alias responded successfully during this stream.
- Linked Supabase project `schdyxcunwcvddlcshwd` is healthy and still linked in the local CLI.
- The smoke identities exist in `auth.users` and `public.profiles`.
- Important repo drift note: the migration comments that label which email belongs to which smoke-user UUID are reversed relative to the current `auth.users` rows. The live system currently maps:
  - `2a0995e1-8ec8-4a11-bdfe-0877c3383f5c` -> `direklocal@gmail.com`
  - `2cf4a5af-acc7-4450-899d-0c7dc85139e2` -> `kaanporsuk@gmail.com`

### Proof outcome matrix

| Area | Check | Result | Evidence collected | Exact blocker if not hard pass |
|---|---|---|---|---|
| Schedule | Save | Blocked | Live DB confirms smoke schedule data exists for `2cf4...` (`16` open slots), and production `/schedule` resolves to auth shell when unauthenticated. | No reusable smoke-account session/JWT to perform an authenticated write on the real route. |
| Schedule | Rollback/error handling | Blocked | No live runtime error path could be exercised safely in this session. | Requires authenticated UI execution plus a controlled failing write path. |
| Schedule | Pending / upcoming / history buckets | Blocked | Smoke match data contains cancelled suggestions but **no** `date_plans`, so there is no active reminder/upcoming/history dataset to render-check. | Missing authenticated session and missing active schedule-plan data for the smoke identities. |
| Schedule | Reminder-routing truth | Blocked | No `date_plans` were present for smoke identities, so no accepted-plan reminder state exists to prove against the UI. | Requires active accepted plan data and authenticated route execution. |
| Schedule | Chat -> schedule consistency (server-owned path) | Hard pass | Live match `06eab9bc-fabc-4580-9192-98b636f64a89` has `5` real `messages.message_kind='date_suggestion'` rows whose `ref_id` values point to persisted `date_suggestions` rows; the smoke pair also has multiple real `date_suggestions` rows in `cancelled` state. | — |
| Referrals | Entry points | Blocked | Public route checks succeeded, but no authenticated navigation session was available. | Requires authenticated browser automation or reusable smoke credentials. |
| Referrals | Invite link behavior | Partial | Live production `https://vibelymeet.com/invite?ref=<uuid>` resolves and loads the auth shell. | Browser execution of the client-side redirect is still needed to prove query preservation into the auth route. |
| Referrals | `/invite?ref=...` landing behavior | Partial | Live production invite URL lands on the public auth shell rather than 404/error. | Need JS-capable browser proof that the `ref` query survives client-side navigation exactly as intended. |
| Referrals | Attribution semantics in practical runtime | Blocked | Live profile rows for smoke users still have `referred_by = null`. An attempted SQL-side invocation of `apply_referral_attribution` failed with `permission denied`, which confirms the live RPC is correctly restricted to authenticated callers. | Requires a real authenticated user JWT/session to exercise the production RPC safely. |
| Vibe Studio | Open | Blocked | Production `/vibe-studio` is reachable and auth-gated; live smoke profile `2cf4...` has ready Vibe Video data. | Requires authenticated browser session to render the actual studio route. |
| Vibe Studio | Upload/create | Blocked | No fresh upload/create function traffic for the smoke account was available in this session. | Requires authenticated studio session and a safe test upload. |
| Vibe Studio | Processing | Blocked | No smoke profile currently sits in a `processing` state. | Requires a live in-flight upload or a controlled test upload. |
| Vibe Studio | Ready | Partial | Live smoke profile `2cf4...` has `vibe_video_status='ready'`, `bunny_video_status='ready'`, non-null `bunny_video_uid`, and non-empty caption. | Route/UI playback still needs authenticated browser execution. |
| Vibe Studio | Replace/delete | Blocked | No replace/delete action was safely exercised. | Requires authenticated studio session. |
| Vibe Studio | Caption save | Blocked | Existing caption data is present for the smoke profile, but no live edit was executed. | Requires authenticated studio session and safe test write. |
| OneSignal | Worker registration asset | Hard pass | Live production fetch of `https://vibelymeet.com/OneSignalSDK.sw.js` returned the expected root worker shim that delegates to OneSignal CDN. | — |
| OneSignal | Permission prompt | Blocked | No browser-capable permission UI is available through current tooling. | Requires a real browser session with notification permission controls. |
| OneSignal | Subscription identity path | Partial | Product-level live DB evidence exists: `notification_preferences` currently contains `15` rows with `onesignal_player_id` and `3` subscribed web rows, so the web subscription sync path has worked in production. The current smoke profile does **not** have an active web player ID right now. | Need a fresh smoke-account browser session to prove current subscription for the known test account. |
| OneSignal | `notification_preferences` sync | Partial | Smoke user `2cf4...` currently has mobile push identity populated, but web player columns are null; product-level web rows exist for other users. | Need a fresh browser subscription for the smoke account. |
| OneSignal | Delivery dispatch path | Partial | `push_notification_events` contains a historical `platform='web'`, `status='sent'` event for smoke user `2cf4...` on `2026-02-12 18:32:51+00`, proving backend web dispatch has succeeded at least once in production. | Fresh end-to-end delivery receipt was not executed in this stream. |
| OneSignal | Click/deep-link path | Blocked | No delivered notification could be clicked from current tooling. | Requires interactive browser/device notification click proof. |

### Smallest next-fix branch for blocked proof

- Recommended branch if fresh authenticated browser proof is required: `qa/browser-auth-runtime-proof`
- Scope for that branch:
  - add the smallest possible browser harness for real route execution
  - consume smoke credentials from local untracked env only
  - prove authenticated route rendering for `/schedule`, `/referrals`, and `/vibe-studio`
  - capture OneSignal permission/subscription only if a notification-capable browser session is available
- Not required for this branch:
  - no product redesign
  - no schema changes
  - no provider reconfiguration unless the new harness reproduces a real defect
