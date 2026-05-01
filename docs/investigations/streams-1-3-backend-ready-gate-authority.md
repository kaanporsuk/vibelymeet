# Streams 1-3 Backend Ready Gate Authority Investigation

Branch: `docs/investigate-streams-1-3-backend-ready-gate`
Base verified: latest `origin/main` as of 2026-05-01

## Executive verdict: PASS

Streams 1, 2, and 3 are present on `main`, and the current migration tail preserves their backend authority contracts. Later Event Lobby migrations rewrap some Stream 1 RPCs, but the final definitions still enforce canonical active-event state before deck, swipe, mystery, drain, or promotion side effects. Stream 3 does not erase Stream 2 expiry/rowcount hardening; it delegates active-event behavior to the Stream 2 base after its event-inactive gate.

No material code defect was found in this investigation-only pass.

## Artifacts inspected

- `supabase/migrations/20260501180000_event_lobby_active_event_contract.sql`
- `supabase/validation/event_lobby_active_event_contract.sql`
- `shared/matching/eventLobbyActiveEventContract.test.ts`
- `docs/branch-deltas/fix-event-lobby-active-event-contract.md`
- `supabase/migrations/20260501190000_ready_gate_transition_expiry_rowcount.sql`
- `supabase/validation/ready_gate_transition_expiry_rowcount.sql`
- `shared/matching/readyGateTransitionExpiryRowcount.test.ts`
- `docs/branch-deltas/fix-ready-gate-transition-expiry-rowcount.md`
- `supabase/migrations/20260501200000_ready_gate_event_ended_terminalization.sql`
- `supabase/validation/ready_gate_event_ended_terminalization.sql`
- `shared/matching/readyGateEventEndedTerminalization.test.ts`
- `docs/branch-deltas/fix-ready-gate-event-ended-terminalization.md`
- Later overwrite/regression migrations:
  - `20260501210000_swipe_retry_idempotency_notification_dedupe.sql`
  - `20260501223000_event_lobby_canonical_active_state.sql`
  - `20260501224000_event_lobby_swipe_already_swiped.sql`
  - `20260501225000_event_lobby_ready_queue_contract.sql`
  - `20260501230000_event_lobby_deck_payload_media.sql`
- Client/server call sites touching `video_sessions`, `ready_gate_transition`, `video_date_transition`, Event Lobby RPCs, and Ready Gate-owned fields.

Baseline evidence:

- `git checkout main`: already on `main`
- `git pull --ff-only origin main`: already up to date
- `git status --short --branch`: clean `main...origin/main`
- `git log --oneline -20`: latest head was `d3a97f0b1 docs: add final hardening release rehearsal (#648)`
- Stream artifact commits found:
  - Stream 1: `22d30191e Fix Event Lobby backend active-event contract`, `fdd7f0fe5 fix: enforce active event contract for lobby RPCs (#613)`
  - Stream 2: `c49adc74a fix: harden ready gate transition expiry and rowcount (#614)`
  - Stream 3: `ebf3b28b9 fix: terminalize ready gates when events end (#615)`

## Findings by stream

### Stream 1: Event Lobby active-event contract

PASS.

- Active-event helpers exist. The original stream adds `get_event_lobby_inactive_reason(uuid)` and `is_event_lobby_active(uuid)`. The later canonical-state migration adds `get_event_lobby_active_state(uuid, timestamptz)` and keeps the original helpers as compatibility wrappers.
- Internal-only/service-role helper access is preserved. Helper execution is revoked from `PUBLIC`, `anon`, and `authenticated`; `service_role` has execute.
- Wrappers exist for `get_event_deck`, `handle_swipe`, `find_mystery_match`, `promote_ready_gate_if_eligible`, and `drain_match_queue`.
- The active rule enforces live status, no ended/archived terminal fields, and DB time inside `event_date + COALESCE(duration_minutes, 60)`. The later canonical helper also distinguishes `event_draft`, `event_not_started`, and archived status.
- Nonparticipants do not receive detailed lifecycle leakage before auth/registration/admission checks. Auth/participant checks precede inactive reason returns in swipe, mystery, promotion, and drain paths; deck authenticates the requested viewer before active-state lookup.
- Service-role remains trusted where intended, especially promotion and internal helper paths.
- `SECURITY DEFINER` and `SET search_path TO 'public'` hygiene are present on added/replaced functions.
- Public signatures are preserved except for the intentional later `get_event_deck` payload extension in `20260501230000_event_lobby_deck_payload_media.sql`, which drops/recreates the RPC with extra return columns for viewer-safe media fields while retaining the active-event gate.
- Production validation SQL is catalog-only/read-only. It uses `select`, `pg_get_functiondef`, `to_regprocedure`, trigger/catalog inspection, and `has_function_privilege`; no DDL/DML commands were present.

### Stream 2: ready_gate_transition expiry/rowcount hardening

PASS.

- `ready_gate_transition(uuid, text, text)` public signature is preserved.
- The public RPC locks the target `video_sessions` row with `FOR UPDATE` before transition-sensitive logic.
- A server timestamp variable `v_now := now()` is used for transition decisions and writes.
- `mark_ready` and `snooze` re-check `ready_gate_expires_at <= v_now` under lock and terminalize elapsed pre-Daily/pre-date gates as expired.
- Expired gates reject late ready/snooze by returning `ready_gate_expired` truth with terminal shape.
- `GET DIAGNOSTICS v_row_count = ROW_COUNT` appears after guarded expiry, mark_ready, snooze, and forfeit updates.
- Zero-row guarded update paths re-read session truth and return session-not-found, terminal, stale, or conflict results instead of optimistic success.
- Terminal idempotency is preserved for `forfeited`, `expired`, and `both_ready`.
- `SECURITY DEFINER` and fixed `search_path` are preserved.
- The prior renamed base `ready_gate_transition_20260501190000_expiry_rowcount_prior` has execution revoked from `PUBLIC`, `anon`, and `authenticated`.

### Stream 3: event-ended Ready Gate terminalization and inactive prepare-entry guard

PASS.

- `terminalize_event_ready_gates(uuid, text)` exists and is service-role/internal-only.
- The event lifecycle trigger exists: `events_terminalize_ready_gates_on_inactive` fires after updates to `status`, `ended_at`, or `archived_at`.
- Cleanup targets only pre-date Ready Gate states: `queued`, `ready`, `ready_a`, `ready_b`, `snoozed`, and unprepared `both_ready`.
- Provider-prepared/date-capable sessions are excluded by state/phase plus Daily room, handshake/date, and participant join evidence.
- Linked registrations are normalized to `idle` with room/partner pointers cleared. The cleanup does not requeue users into browsing/searching for inactive events.
- `ready_gate_transition` handles event inactivity for `sync`, `mark_ready`, and `snooze`, terminalizes inactive pre-date rows, and blocks stale participant actions.
- `video_date_transition('prepare_entry')` blocks inactive event handoff before provider work for unprepared rows.
- `confirm_video_date_entry_prepared` blocks stale inactive-event confirmation before persisting provider-prepared state for unprepared rows.
- `READY_GATE_EVENT_ENDED` observability exists on cleanup and blocked Ready Gate action paths.
- Helper grants/revokes are safe: internal helpers are revoked from client roles; service-role execute is granted where needed.

## Cross-stream overwrite/regression findings

PASS.

- Stream 1 helper remains callable by Stream 3. Stream 3 calls `get_event_lobby_inactive_reason(uuid)`, and `20260501223000_event_lobby_canonical_active_state.sql` keeps that compatibility helper delegating to `get_event_lobby_active_state`.
- Stream 3 wrapping did not erase Stream 2 logic. `ready_gate_transition_20260501200000_event_inactive_base` is the Stream 2-hardened function, and Stream 3 delegates to it whenever the event-inactive precondition does not block.
- Later migrations did not overwrite `ready_gate_transition`, `video_date_transition`, or `confirm_video_date_entry_prepared` after Stream 3.
- Later Event Lobby migrations did overwrite/recreate `handle_swipe`, `get_event_deck`, and `promote_ready_gate_if_eligible`, but preserved active-event checks using `get_event_lobby_active_state`, event-row share locks before mutation/delegation, and safe grants.
- `find_mystery_match` and `drain_match_queue` final definitions remain from `20260501223000_event_lobby_canonical_active_state.sql` and retain Stream 1 active-event protection.
- No migration currently sorts before Streams 1-3 in a way that would undermine their order. The later tail sorts after `20260501200000`.
- No app/mobile direct client writes to Ready Gate-owned `video_sessions` fields were found. `20260501112000_video_sessions_rls_write_lockdown.sql` revokes `INSERT`, `UPDATE`, and `DELETE` on `video_sessions` from `anon` and `authenticated`. The only direct `video_sessions` updates found outside migrations were service/server function updates to Daily room metadata cleanup/provider fields.

## Validation commands and results

- `npx tsx shared/matching/eventLobbyActiveEventContract.test.ts`: PASS, 11 tests
- `npx tsx shared/matching/readyGateTransitionExpiryRowcount.test.ts`: PASS, 10 tests
- `npx tsx shared/matching/readyGateEventEndedTerminalization.test.ts`: PASS, 11 tests
- `npx tsx supabase/functions/_shared/matching/videoSessionFlow.test.ts`: PASS, 5 tests
- `npm run typecheck`: PASS
- `npm run build`: PASS. Vite emitted existing chunk/dynamic-import warnings for `src/lib/analytics.ts`, `src/services/eventCoverUploadService.ts`, and large production chunks.
- `git diff --check`: PASS

## Missing proof

- I did not execute the production validation SQL against Supabase cloud. This was intentional for the investigation-only scope and to avoid any cloud interaction beyond local Git/GitHub. The validation SQL files themselves were inspected and are catalog-only/read-only.
- I did not run Docker or local Supabase, per instruction.

## Repair streams recommended

None for Streams 1-3 based on this audit.

## Safety confirmation

- No Docker used.
- No local Supabase used.
- No Supabase cloud mutation performed.
- No deployment performed.
- Investigation generated only this report.
