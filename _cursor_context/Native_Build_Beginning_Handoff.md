Project: Vibely native app build kickoff
Repo: kaanporsuk/vibelymeet
Backend: Supabase project ref `schdyxcunwcvddlcshwd` (MVP_Vibe)
Goal: Start native iOS + Android implementation on top of the now-hardened web/backend baseline.

What matters most:
- The web/backend was deliberately hardened first so native can rely on backend-owned state, not fragile browser logic.
- The new chat should use Cursor as the primary implementer.
- Ask the user to do things only when Cursor truly cannot do them.
- When asking the user to do anything, give explicit step-by-step terminal/UI instructions.
- Keep one branch per stream, PR into protected main, and include rebuild delta/docs updates where relevant.

Current status / judgment:
- Web is now structurally strong enough to proceed toward native planning/building.
- The highest-risk shared flows are backend-owned:
  - pause/resume
  - Ready Gate transitions
  - video-date state machine
  - Daily Drop transitions
  - Daily Drop notification side-effects
  - chat send + chat notifications
  - swipe/match notifications
- Remaining web gaps are mostly:
  - regression automation / repeatable QA proof
  - premium/credits observability hardening
  - some lower-priority notification/admin/moderation coverage
- These do not block native planning/building, but should remain visible.

Completed / merged hardening streams:
1. Foundation consolidation
   - dead/mock route cleanup
   - central domain enums/transitions
   - TS strictness for core layers
   - auth decomposition / bootstrap ownership cleanup
2. Backend-authoritative pause/resume
   - `profiles.is_paused`, `paused_at`, `paused_until`, `pause_reason`
   - `account-pause`, `account-resume`
   - deck / drops / notifications respect pause
3. Pause/resume follow-up fixes
   - get_event_deck auth guard fixed via additive migration
   - safer pause semantics
4. Server-owned video-date state machine
   - `video_date_state`
   - `video_date_transition(...)`
   - client no longer owns critical lifecycle writes
5. Server-atomic Ready Gate transitions
   - `ready_gate_transition(...)`
   - row locking / terminal semantics
6. Server-owned Daily Drop transitions
   - `daily_drop_transition(...)`
   - backend-owned view/opener/reply/pass + match/message seeding
7. Daily Drop notification side-effects moved server-side
   - `daily-drop-actions`
8. Chat + swipe/match notifications moved server-side
   - `send-message`
   - `swipe-actions`

Important backend surfaces native should use:
- Auth/session: Supabase auth
- Pause/resume:
  - Edge Functions: `account-pause`, `account-resume`
- Ready Gate:
  - SQL/RPC: `ready_gate_transition`
- Video date:
  - SQL/RPC: `video_date_transition`
- Daily Drop:
  - SQL/RPC: `daily_drop_transition`
  - Edge Function wrapper: `daily-drop-actions`
- Chat:
  - Edge Function: `send-message`
- Swipe/match:
  - Edge Function: `swipe-actions`
  - SQL canonical engine behind it: `handle_swipe`
- Notifications:
  - canonical send surface: `send-notification`
  - native clients should prefer higher-level backend wrappers, not direct notification decisions
- Entitlements/billing:
  - `create-checkout-session`
  - `create-credits-checkout`
  - `create-event-checkout`
  - `create-portal-session`
  - `stripe-webhook`
  - canonical tables: `subscriptions`, `user_credits`
- Media / Bunny / uploads:
  - `create-video-upload`
  - `video-webhook`
  - `upload-image`
  - `upload-voice`
  - `upload-event-cover`
  - `upload-chat-video`
  - Bunny is the canonical media backend for current live flows

Native v1 scope already defined conceptually:
In scope for native v1:
- auth / sign in / sign up
- reset password
- onboarding
- dashboard / home
- events list
- event details
- event lobby
- matches list
- chat thread
- Ready Gate
- video date flow
- post-date survey
- profile
- settings
- verification flows as part of onboarding/profile

Deferred to v1.1+:
- match celebration
- public profile (`/user/:userId`)
- referrals / growth surfaces
- full premium upsell UX
- full credits UX
- vibe studio
- vibe feed
- schedule/calendar
- native delete-account UX, unless product decides it is v1-critical

Web-only for now:
- marketing/legal pages
- billing success/cancel result pages
- admin/internal dashboards/tools

What the next chat should assume about process:
- Cursor should do as much as possible.
- Only ask the user to do actions Cursor cannot do.
- Branch-per-stream.
- PR into main.
- Keep `_cursor_context` docs/inventory/manifests in sync when backend/public surfaces change.
- Include rebuild delta in each meaningful PR.
- Preserve the hardened backend ownership model; do not reintroduce client-owned business logic.

Important caveat:
- There is a thin regression harness branch/artifact:
  - `docs/golden-path-regression-runbook.md`
  - `scripts/run_golden_path_smoke.sh`
- If these are not yet on `main`, verify and merge/carry them forward before relying on them as the official QA artifact.

Recommended execution plan for native work:
Sprint 0 — Native architecture lock
- Choose exact stack and app structure
- Map web routes/flows to native screens
- Define backend contract usage per screen
- Define notifications/deep-linking/media/auth models
- Produce native build architecture doc and sprint board
- Output: implementation-ready architecture and backlog

Sprint 1 — App shell + auth + navigation
- project bootstrap
- environment/config
- Supabase session handling
- navigation structure
- sign in / sign up / reset password
- onboarding gate
- basic home/dashboard shell
- deep-link skeleton

Sprint 2 — Profile, onboarding, settings, pause/resume
- profile read/edit
- onboarding flow
- verification/profile dependencies
- settings
- pause/resume using backend-authoritative functions
- notification permission entry points

Sprint 3 — Events + matches + chat
- events list/details/lobby
- matches list
- chat thread using backend-owned `send-message`
- server-owned chat notifications
- basic push handling in native

Sprint 4 — Ready Gate + video date
- Ready Gate using `ready_gate_transition`
- video-date flow using `video_date_transition`
- reconnect / resume behavior
- post-date survey
- edge-case hardening around race/terminal flows

Sprint 5 — Daily Drop + swipe/match
- Daily Drop UI
- opener/reply/pass/view using backend-owned transitions
- swipe/match using `swipe-actions`
- native notification/deeplink handling for match/drop/chat flows

Sprint 6 — Entitlements + premium/credits + beta hardening
- premium state surfaces
- credits state surfaces
- purchase entrypoints if in scope
- analytics/observability hooks
- bug bash / beta hardening

Recommended immediate next task in the new chat:
- Start with a docs/planning stream first, not raw coding.
- Branch name suggestion:
  - `docs/native-build-architecture-plan`

What that first native-planning stream should deliver:
- recommended native stack / architecture
- exact native v1 scope
- screen map from web routes to native screens
- backend dependencies and contracts
- push notification architecture for native
- media upload/playback architecture for native
- auth/session/deep-link model
- environment/config checklist
- iOS + Android release prerequisites
- blockers/unknowns before implementation

Risks to keep visible during native work:
- Premium/credits still need stronger proof/observability
- Admin/moderation flows remain mostly web-admin surfaces
- Lower-priority reminder/reengagement notification flows are not all server-owned yet
- QA should continue to use the golden-path runbook as the web baseline reference

What I want you to do in this new chat:
1. Confirm the latest merged baseline on `main`
2. Verify whether the golden-path regression harness is already on `main`
3. Start `docs/native-build-architecture-plan`
4. Produce a definitive native architecture + sprint plan tied to the actual hardened backend surfaces
5. Then guide implementation sprint by sprint, using Cursor as implementer and asking the user to do only the actions Cursor cannot do

Closure addendum (2026-04-04):
- Auth/bootstrap ownership is now fully enforced with no latent fallback surfaces.
- `src/components/ProtectedRoute.tsx` blocks `profileStatus='unknown'` from protected shell rendering and shows recovery actions.
- Deprecated signup surfaces now hard-error:
  - `src/contexts/AuthContext.tsx` `signUp(...)`
  - `apps/mobile/context/AuthContext.tsx` `signUp(...)`
  - `apps/mobile/lib/authApi.ts` `signUpWithEmail(...)`
- Canonical signup/bootstrap owners remain:
  - Web: `src/pages/Auth.tsx`
  - Native: `apps/mobile/app/(auth)/sign-in.tsx`
- Canonical profile bootstrap helper remains `ensureProfileReady(...)`; legacy wrapper `ensureBootstrapProfileExists(...)` has been removed.

Registered-journey refinement addendum (2026-04-05):
- Reminder Join CTAs now prefer contextual active-session deep links when verifiable (`/date/:id`), with safe fallback preserved where no reliable session id exists.
- Native schedule reminder join now reuses its contextual handler (active session first, chat fallback) instead of bypassing it.
- Web `/vibe-studio` is now a dedicated Vibe Studio route; native mirrors this with `/vibe-studio` as the management hub and `vibe-video-record` as the authoring engine.