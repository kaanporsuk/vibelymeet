# Event Lobby Investigation Batch 2 - Gating And Queue Lifecycle

Date: 2026-05-01
Branch: `audit/event-lobby-investigation-gating-queue-lifecycle`
Supabase project ref: `schdyxcunwcvddlcshwd / MVP_Vibe`

## Executive Verdict

PASS.

Streams 3, 3b, and 4 remain landed as intended across web, native, backend SQL, local regression tests, and deployed Supabase catalog markers. No product/code fix was made in this branch. No material contract drift was found. No follow-up bugfix prompt is required from this batch.

The only caveats are already documented launch posture items:

- Native and web do not share the exact same gate helper implementation; native mirrors the gate through local booleans and backend-startable recovery checks.
- Native keeps participant-scoped realtime listeners alive with route/user identity for backend-truth recovery. Side-effecting deck/status/foreground/queue/Mystery Match work remains gated behind local live/confirmed/not-paused truth.
- The surface inventory still reports 41 candidate orphan components, but the audit method remains triage-only and not a deletion manifest.
- `npm run lint` exits 0 with the existing 208-warning backlog.
- `npm run build` exits 0 with existing Vite chunk/dynamic import warnings.

## Scope And Files Inspected

Read first / evidence files:

- `docs/audits/event-lobby-closure-report.md`
- `docs/audits/event-lobby-web-gating-verification.md`
- `docs/audits/recent-hardening-deep-audit-2026-05-01.md`
- `docs/audits/event-lobby-ready-queue-contract-verification.md`
- `docs/contracts/event-lobby-ready-queue-contract.md`
- `docs/audits/surface-inventory-candidates-2026-04-14.md`
- `src/lib/eventLobbyGating.ts`
- `src/pages/EventLobby.tsx`
- `src/hooks/useEventDeck.ts`
- `src/hooks/useEventStatus.ts`
- `src/hooks/useMatchQueue.ts`
- `src/hooks/useReadyGate.ts`
- `apps/mobile/app/event/[eventId]/lobby.tsx`
- `apps/mobile/lib/eventsApi.ts`
- `apps/mobile/lib/eventStatus.ts`
- `apps/mobile/lib/readyGateApi.ts`
- `supabase/migrations/20260501200000_ready_gate_event_ended_terminalization.sql`
- `supabase/migrations/20260501223000_event_lobby_canonical_active_state.sql`
- `supabase/migrations/20260501225000_event_lobby_ready_queue_contract.sql`
- `shared/matching/webEventLobbyGating.test.ts`
- `shared/matching/eventLobbyReadyQueueContract.test.ts`

Startup evidence:

- Branch created from latest `main` at `0e8359f4d chore: audit and tidy current work map (#666)`.
- Worktree was clean before the audit branch.
- `supabase/.temp/project-ref` and `supabase projects list` confirmed the linked project as `schdyxcunwcvddlcshwd / MVP_Vibe`.
- `supabase migration list --linked` showed local/remote parity, including `20260501225000`.
- `supabase db push --linked --dry-run` returned `Remote database is up to date.`

## Web Gate Matrix

`src/lib/eventLobbyGating.ts` centralizes web gating. `src/pages/EventLobby.tsx` derives:

- `deckEnabled = lobbyGate.canFetchDeck`
- `lobbySideEffectsEnabled = lobbyGate.canUseLobbySideEffects`
- `lobbyActionsEnabled = lobbyGate.canUseLobbyActions && !showEventEndedModal`

| State | Gate result | Deck | Swipe/actions | Heartbeat/status | Queue/realtime side effects | Ready Gate stale open | UI |
|---|---|---:|---:|---:|---:|---:|---|
| Missing event id | `missing_event_id` | Off | Off | Off | Off | Suppressed by non-live gate | Browse-events unavailable state |
| Missing event row / stale link | `not_found` | Off | Off | Off | Off | Suppressed by non-live gate | Event-not-found unavailable state |
| Signed out | `sign_in_required` | Off | Off | Off | Off | Suppressed by non-live gate | Sign-in unavailable state |
| Not registered | `not_registered` | Off | Off | Off | Off | Suppressed by non-live gate | Register-first unavailable state |
| Waitlisted / not confirmed | `waitlisted` | Off | Off | Off | Off | Suppressed by non-live gate | Waitlist unavailable state |
| Scheduled / not started | `not_started` | Off | Off | Off | Off | Suppressed by non-live gate | Not-live-yet state |
| Live confirmed unpaused | `live` | On | On | On | On | Allowed only while live or scoped backend session matches | Lobby |
| Ended by status | `ended` | Off | Off | Off | Off | Non-scoped stale session cleared | Ended modal/unavailable state |
| Ended by scheduled end time | `ended` | Off | Off | Off | Off | Non-scoped stale session cleared | Ended modal/unavailable state |
| Ended by `ended_at` | `ended` | Off | Off | Off | Off | Non-scoped stale session cleared | Ended modal/unavailable state |
| Cancelled | `cancelled` | Off | Off | Off | Off | Non-scoped stale session cleared | Cancelled unavailable state |
| Archived | `archived` | Off | Off | Off | Off | Non-scoped stale session cleared | Archived unavailable state |
| `archived_at` timestamp | `archived` | Off | Off | Off | Off | Non-scoped stale session cleared | Archived unavailable state |
| Draft | `draft` | Off | Off | Off | Off | Non-scoped stale session cleared | Draft unavailable state |
| Paused account | `paused` | Off | Off | Off | Off | Actions disabled | Paused lobby shell |

Evidence:

- `getWebEventLobbyGateState` handles missing ids, auth, missing rows, cancelled, archived, draft, ended/completed, `endedAt`, `archivedAt`, scheduled live window, non-live status, registration, waitlist, and paused account.
- `useEventDeck({ enabled: deckEnabled })` prevents stale deck polling.
- `useEventStatus({ eventId, enabled: lobbySideEffectsEnabled })` prevents local status writes and heartbeat while disabled.
- `useMatchQueue({ enabled: lobbySideEffectsEnabled })` prevents queue drain/realtime queue work while disabled.
- `openReadyGateSession` suppresses non-backend-hydrated Ready Gate opens while `lobbyActionsEnabled` is false.
- `readyGateOverlayAllowed` requires the live gate or an already scoped backend session.
- `LobbyUnavailableState` and `EventEndedModal` render terminal/unavailable states before the lobby action surface.

## Native Gate Matrix

Native implements equivalent local truth in `apps/mobile/app/event/[eventId]/lobby.tsx`:

- `isEventArchived = Boolean(archived_at) || status === 'archived'`
- `isEventEndedByTruth = Boolean(ended_at) || status in ('ended', 'completed') || local end time elapsed`
- 2026-06-06 clarification: current native `isLiveWindow` uses `resolveEventLifecycle`, so raw `upcoming` and compatibility `scheduled` rows are live when inside the scheduled event window; cancelled, archived, draft, ended, and server-inactive rows still block lobby side effects. Native event-detail and home CTAs use the same phase helper, with archive markers forcing the phase closed before an Enter Lobby action can render.
- `lobbySideEffectsEnabled` requires route id, user id, event row, event and registration loaded, confirmed registration, not paused, and live window.
- `deckQueryEnabled = lobbySideEffectsEnabled`.

| State | Native behavior |
|---|---|
| Missing event | Renders Event-not-found error before lobby content |
| Scheduled/not started | `isLiveWindow` false; deck/status/foreground/queue/Mystery Match disabled |
| Ended by status/completed | `isEventEndedByTruth` true; ended UI rendered; side effects disabled |
| Ended by scheduled end | `isEventEndedByTruth` true; ended UI rendered; side effects disabled |
| `ended_at` | `isEventEndedByTruth` true; ended UI rendered; side effects disabled |
| Cancelled | Error state and route back to event; side effects disabled |
| Archived / `archived_at` | Error state and route back to event; side effects disabled |
| Draft | Error state and route back to event; side effects disabled |
| Not confirmed / waitlisted | Register/waitlist error state; side effects disabled |
| Paused account | `lobbySideEffectsEnabled` false; swipe/deck side effects disabled |
| Live confirmed unpaused | Deck, foreground stamp, queue drain, status hook, and Mystery Match can run |
| Backend `event_not_active` swipe/deck response | Native sets `serverInactiveEventReason`, cancels Mystery Match, invalidates event details, and disables live window truth |

Evidence:

- `useEventStatus(id, user?.id ?? undefined, lobbySideEffectsEnabled)` is no-op while disabled.
- Deck fetch uses `useEventDeck(id, user?.id ?? null, deckQueryEnabled)`.
- Foreground stamp requires `lobbySideEffectsEnabled`, focused lobby, and active AppState.
- Queue refresh/drain requires `lobbySideEffectsEnabled`.
- Mystery Match receives `enabled: mysteryMatchEnabled`, where `mysteryMatchEnabled = lobbySideEffectsEnabled`.
- Swipe handler exits unless `current`, not processing, and `lobbySideEffectsEnabled`.
- Date navigation uses `ensureVideoDateStartableBeforeNavigation`; no native date navigation is based solely on local Ready Gate optimism.

## Web/Native Drift Table

| Area | Classification | Evidence / note |
|---|---|---|
| Gate implementation | Acceptable implementation difference | Web uses `getWebEventLobbyGateState`; native mirrors the same state taxonomy through local booleans and UI branches. |
| Missing event / stale link | Consistent | Both render not-found/unavailable and keep deck off. |
| Scheduled/not-started | Consistent | Both require current time inside event window before deck/side effects. |
| Ended while mounted | Consistent | Both subscribe to event lifecycle, show ended UI, and invalidate/stop action paths. |
| Cancelled/archived/draft | Consistent | Both render unavailable and suppress action side effects. |
| Paused account | Consistent with UX difference | Web exposes a paused unavailable/lobby state; native disables live side effects and shows paused break controls. Both prevent deck/actions. |
| Not confirmed / waitlisted | Consistent | Both block deck/actions and render explicit registration/waitlist states. |
| Backend `event_not_active` | Consistent | Web/native treat it as terminal stale truth and stop action advancement. |
| Queue drain eligibility | Consistent | Both gate drain behind live/eligible lobby truth and backend drain remains authoritative. |
| Ready Gate stale open prevention | Consistent enough, with native recovery nuance | Web directly suppresses stale local opens via `lobbyActionsEnabled`. Native can keep participant-scoped recovery listeners alive, but invalid-event render paths return before the Ready Gate overlay and date routing remains backend-startable gated. |

No contract drift requiring a bugfix was found.

## Busy-User Policy Verification

Backend safe launch policy is documented in `docs/contracts/event-lobby-ready-queue-contract.md` and enforced by `20260501225000_event_lobby_ready_queue_contract.sql`.

Deck policy:

- `get_event_deck` preserves auth and active-event rejection.
- It delegates to the prior active-event base and then filters returned candidates to `queue_status` `browsing` or `idle`.
- It excludes unended `video_sessions` where a candidate is in Ready Gate, handshake, or date truth through `ready_gate_status`, `state`, `phase`, `handshake_started_at`, or `date_started_at`.
- Offline, in-survey, unknown, and other non-lobby statuses are hidden by the safe launch default because only `browsing` and `idle` are normal deck states.

Client policy:

- Web and native still render busy/in-session badges defensively for stale cached cards.
- Those badges are informational; canonical swipe eligibility is backend-owned.
- Web and native tests confirm no direct client creation of video sessions or backend-owned Ready Gate lifecycle writes.

## Ready Gate / Queue Contract Verification

`handle_swipe(uuid, uuid, uuid, text)`:

- Preserves public signature, `SECURITY DEFINER`, and `SET search_path TO 'public'`.
- Authenticates `auth.uid() = p_actor_id`.
- Checks actor/target confirmed registration and active event before mutation.
- Holds the event row stable and rechecks active-event truth.
- Acquires ordered participant advisory locks using `event_lobby_participant_session:<event>:<participant>`.
- Checks for another unended active session involving either participant before existing swipe lookup, `event_swipes` insert, delegated session creation, or registration mutation.
- Returns `participant_has_active_session_conflict` with `notification_suppressed: true` and `dedupe_reason: active_session_conflict`.
- Preserves duplicate/idempotency outcomes: `already_swiped`, `already_matched`, `swipe_already_recorded`, and `event_not_active`.

`promote_ready_gate_if_eligible(uuid, uuid)`:

- Preserves public signature, auth/service-role split, `SECURITY DEFINER`, and `search_path`.
- Requires actor registration and confirmed admission.
- Checks active event, locks event row, and rechecks active event before promotion.
- Selects queued pair, acquires ordered participant advisory locks, and blocks if either participant has another unended session.
- Returns `participant_has_active_session_conflict` before promotion delegation.

`drain_match_queue(uuid)`:

- Remains backend-owned.
- Active-event guard lives in the canonical wrapper.
- Delegates through public `promote_ready_gate_if_eligible`, so promotion uses participant locks and conflict guards.

`ready_gate_transition(uuid, text, text)`:

- Retains Stream 2 rowcount/expiry behavior by delegating to the event-inactive base for non-sync/ready/snooze or active-event paths.
- For sync/mark_ready/snooze, locks the session row and detects event inactivity under lock.
- Terminalizes pre-date Ready Gate states for inactive events.
- Allows date-capable/provider-prepared sessions to remain recoverable without reopening stale Ready Gate state.
- Returns `EVENT_NOT_ACTIVE` / `event_not_active` stale truth for inactive non-date-capable Ready Gate transitions.

The one-active-session invariant is not client-only; it is enforced by deck filtering, direct swipe pre-mutation conflict checks, ordered participant locks, queue promotion conflict checks, and server-owned Ready Gate/date transitions.

## Surface Inventory Safety Note

`npm run audit:surfaces` completed and rewrote `docs/audits/surface-inventory-candidates-2026-04-14.md` with no git diff.

Current inventory:

- Orphan pages: 0
- Orphan hooks: 0
- Orphan components: 41
- Reachable modules: 500

The current 41 component candidates remain mostly shadcn UI, wizard, safety, and marketing-style surfaces. The report explicitly says to treat this as a triage queue, not a deletion manifest. No Event Lobby or Ready Gate page/hook was orphaned or removed by this audit.

## Validation Results

Passed:

- `npx tsx shared/matching/webEventLobbyGating.test.ts`
- `npx tsx shared/matching/eventLobbyReadyQueueContract.test.ts`
- `npm run test:hardening-contracts`
- `npm run test:event-lobby-regression`
- `npm run audit:surfaces`
- `npm run typecheck`
- `npm run lint` (exit 0; existing 208 warnings)
- `npm run build` (exit 0; existing Vite chunk/import warnings)
- `supabase db push --linked --dry-run` (remote database up to date)
- `git diff --check`

No production smoke, production DML, local Supabase, Docker, deploy, or broad code fix was run.

## Deployed Remote Marker Checks

Read-only Supabase catalog checks were run against `schdyxcunwcvddlcshwd`.

Migration parity:

- `supabase migration list --linked` showed `20260501225000` present locally and remotely.
- `supabase db push --linked --dry-run` returned `Remote database is up to date.`

Function marker query:

| Function | Remote md5 | Active helper | Busy/session markers | Conflict markers | Grants |
|---|---|---:|---:|---:|---|
| `get_event_deck` | `17c5385df896d6c4b0947a50c7d04eb0` | Yes | Broad markers present: `queue_status`, `browsing`, `idle`, `video_sessions`, `ready_gate_status`, `handshake_started_at`, `date_started_at` | N/A | authenticated/service role yes; anon no |
| `handle_swipe` | `b39403eafedf23104920c56b0a58c55c` | Yes | Participant lock marker present | `pre_swipe_active_session_guard`, `participant_has_active_session_conflict` present | authenticated/service role yes; anon no |
| `promote_ready_gate_if_eligible` | `f2ece9fa3ca9285320c68ee332fcfa51` | Yes | Participant lock marker present | `pre_promotion_active_session_guard`, `participant_has_active_session_conflict` present | authenticated/service role yes; anon no |
| `drain_match_queue` | `3085db275ba3c5eb9c9d439e7f81cc1a` | Yes | Delegates queue promotion route | No direct marker expected | authenticated/service role yes; anon no |
| `ready_gate_transition` | `edc877ec0657cf772259dd5ac4b89483` | No direct active helper marker expected in top wrapper | Event-inactive wrapper present | No direct queue conflict marker expected | anon/authenticated/service role yes, preserving public RPC posture |

The exact text check for the deck busy filter did not match `pg_get_functiondef` formatting, so the audit used broader marker checks for the deployed function body. Those markers confirmed the deployed deck includes queue-status and active-session filtering ingredients.

## Findings And Follow-Up Prompts

### Finding B2-001 - PASS - Web EventLobby gate remains complete

Evidence: shared gate helper, EventLobby wiring, unavailable UI, and `webEventLobbyGating.test.ts` cover missing event, stale links, registration, waitlist, not-started, ended, cancelled, archived, draft, and paused account paths.

Follow-up bugfix prompt: none.

### Finding B2-002 - PASS - Native EventLobby mirrors contract with acceptable implementation differences

Evidence: native maps `archived_at` / `ended_at`, blocks terminal statuses and local ended window, gates deck/status/foreground/queue/Mystery Match behind `lobbySideEffectsEnabled`, and uses backend-startable date navigation.

Follow-up bugfix prompt: none.

### Finding B2-003 - PASS - Backend busy-user and one-active-session invariant is server-owned

Evidence: deployed/local `get_event_deck`, `handle_swipe`, `promote_ready_gate_if_eligible`, `drain_match_queue`, and `ready_gate_transition` markers and tests confirm deck filtering, participant locks, pre-mutation conflicts, guarded promotion, and inactive-event Ready Gate behavior.

Follow-up bugfix prompt: none.

### Finding B2-004 - WARN - Surface inventory remains triage-only

Evidence: inventory reports 0 orphan pages, 0 orphan hooks, and 41 orphan component candidates. Existing caveats say dynamic import/runtime loaders are not analyzed.

Follow-up bugfix prompt: none. Do not delete candidates without product/route proof.

### Finding B2-005 - WARN - Existing lint/build warning backlog remains

Evidence: `npm run lint` exits 0 with 208 warnings; `npm run build` exits 0 with Vite chunk/import warnings.

Follow-up bugfix prompt: none for this investigation. A separate lint debt stream could be planned if desired.

## No-Production-Mutation Statement

This branch performed only read-only Supabase catalog/migration checks and local static/build validations. It did not mutate production data, run production smoke actions, deploy Supabase artifacts, run local Supabase, use Docker, broaden grants, edit historical migrations, or delete surface inventory candidates.
