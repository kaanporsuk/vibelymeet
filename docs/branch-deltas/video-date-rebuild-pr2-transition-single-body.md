# Video Date Rebuild PR 2 — `video_date_transition` Single Body

Date: 2026-06-11
Branch: `claude/vd-rebuild-02-transition-single-body`
Sequence: PR 2 of the 10-PR Video Date re-foundation (PR 1: backend truth pin, #1301)

## Scope

One migration, `supabase/migrations/20260611175511_video_date_transition_single_body.sql` (applied to linked project `schdyxcunwcvddlcshwd`):

1. `CREATE OR REPLACE public.video_date_transition(uuid, text, text)` as a single
   self-contained PL/pgSQL body implementing the effective composition of the
   former 25-generation `private_video_date.vdt_*` delegation chain
   (`vdt_core_legacy_01` .. `vdt_current_base`), reconstructed bottom-up from
   the PR-1 fixtures in `supabase/contract-fixtures/2026-06/`.
2. `DROP FUNCTION` for all 25 `private_video_date.vdt_*` functions, then
   `DROP SCHEMA private_video_date` (no CASCADE — fails loudly if non-empty).
   The only live reference to the schema was the previous public shell body
   (verified via live `pg_proc.prosrc` scan and repo-wide grep).

No client, Edge Function, or other RPC changes. Shared public helpers
(`video_date_lifecycle_*`, `video_date_ready_gate_actionability_v1`,
`video_date_protect_both_ready_entry_v1`, `finalize_video_date_handshake_deadline`,
`end_unconfirmed_video_date_start`, observability, survey-eligibility v2, etc.)
are still called by name in the chain's exact order — they remain the payload,
sanitization, and observability owners used by the other RPC families.

## Preserved contract (effective composition)

- Entry aliases `complete_entry` → `complete_handshake`, `continue_entry` →
  `continue_handshake` (vocabulary flips physically in PR 5).
- Pinned `ENTER_HANDSHAKE_REMOVED` rejection payload, returned directly from
  the shell with no enrichment (as before).
- `prepare_entry` stays preflight-only: actionability precheck
  (`video_date_ready_gate_actionability_v1(..., false, true, true, true)`) →
  prepare-lease protection (`video_date_protect_both_ready_entry_v1`, hard-fail
  codes returned as-is) → 90s lease grant/refresh on a virgin `both_ready`
  gate → event-inactive block (`get_event_lobby_inactive_reason` +
  `terminalize_event_ready_gates`) → preflight checks (`SESSION_ENDED`,
  `BLOCKED_PAIR`, `RECONNECT_SYNC_REQUIRED`, `READY_GATE_NOT_READY`,
  `preflight_only: true` success). Room/token minting stays exclusively in the
  daily-room Edge Function (actionability precheck → prepare lease →
  deterministic room → `confirm_video_date_entry_prepared` → token).
- `complete_handshake` delegates to `finalize_video_date_handshake_deadline`
  (`rpc_complete_handshake`); vibe/pass 60s after `handshake_started_at` go to
  the finalizer with `late_<action>_after_handshake_deadline`.
- Self-away suppression (5 web/app lifecycle reasons; presence + remote-seen +
  surface-claim evidence; clears away/grace + `bump_video_session_seq`) and
  partner-away suppression (20s warmup evidence window, bypassed only by
  `daily_transport_grace_expired`). Suppression results bypass the inner post
  tier exactly as in the chain.
- Core machine: `sync_reconnect`, `mark_reconnect_partner_away`,
  `mark_reconnect_return` (+ unconditional grace-clear post-step),
  vibe/pass (grace coercion, idempotent decision persistence, mutual → date,
  both-decided-non-mutual → ended), `end` (partial-join peer timeout via the
  `partial_join_peer_timeout`/`peer_missing_timeout` reasons; pre-date-aware
  cleanup with reason canonicalization to `pre_date_manual_end`; date-phase
  `in_survey` continuity; reconnect-grace auto-end precheck), unknown →
  `UNKNOWN_ACTION`.
- Inner posts: `prepare_entry` session-snapshot merge; unconfirmed-date guard
  (`video_date_session_has_confirmed_encounter` else
  `end_unconfirmed_video_date_start`); terminal v2 survey continuity
  (`video_date_session_is_post_date_survey_eligible_v2` drives
  `survey_required` + `event_registrations` `in_survey`/`browsing`/`idle`).
- Outer pipeline (chain order): `video_date_enrich_lifecycle_payload_v1` ×2 →
  `video_date_lifecycle_sanitize_client_failsoft_payload_v1` →
  `video_date_lifecycle_enrich_and_sanitize_payload_v2` →
  `ready_gate_actionability_checked` merge →
  `video_date_both_ready_route_payload_v1` (source
  `video_date_transition.both_ready_owner`) → shell markers
  (`active_entry_failsoft_shell`, `hot_path_no_throw_shell`,
  `standalone_enter_handshake_removed_shell`, `flattened_public_shell`) plus a
  new additive `single_body_rpc: true` live marker.
- Grants: authenticated + service_role only (verified in live `proacl`).

## Intentional deltas vs. the literal chain

1. **No raw SQL diagnostics in client payloads** (explicit PR-2 task): the
   former `vdt_routeable_entry` catch leaked `sqlstate`/`message`/`detail`/
   `hint` (sqlstate survived both sanitizers); the former shell last-resort
   payloads carried `sqlstate`/`sql_message`. All failure payloads now stay
   sanitized retryable JSON; diagnostics route into
   `video_date_lifecycle_observe_exception_v2`. `retryable` keeps the
   `SQLSTATE IS DISTINCT FROM '42501'` semantics and `retry_after_ms`/`retry_after_seconds`.
2. **v1 survey-continuity pass dropped** (`vdt_prepare_lease` post-step): the
   outer v2 pass already finally determined `survey_required` and registration
   state for every terminal result; the v1 pass's only residues were a
   duplicate observability row and an unguarded `event_registrations`
   update that could stomp `current_room_id` for a user already re-matched
   into a newer session (v1-eligible / v2-ineligible edge). v2-only is kept.
3. **Shadowed code not carried over:** `vdt_lifecycle_presence`'s self-away
   suppression (strict subset of `vdt_single_owner`'s reasons and evidence);
   core `enter_handshake` (shell-rejected), core `complete_handshake`
   (replaced by the finalizer generation), core `end` (replaced by the
   pre-date cleanup generation), and the mutating `prepare_entry` handlers in
   `vdt_prepare_entry_prewarm`/`vdt_provider_atomic_entry` (shadowed by the
   `vdt_peer_missing_end` preflight generation); `vdt_warmup_stability`
   (transparent pass-through).
4. Exception-context strings consolidated to `video_date_transition.single_body`
   / `video_date_transition.single_body_core` (server-side observability only;
   client payload shapes unchanged).

## Removals (cloud)

- Functions dropped: `private_video_date.vdt_active_entry_failsoft`,
  `vdt_both_ready_owner`, `vdt_core_legacy_01`, `vdt_current_base`,
  `vdt_deadline`, `vdt_definitive_owner`, `vdt_event_inactive`,
  `vdt_failsoft_base`, `vdt_hot_path_no_throw`, `vdt_last_resort`,
  `vdt_latest_presence`, `vdt_lifecycle_presence`, `vdt_partial_ready_gate`,
  `vdt_peer_missing_end`, `vdt_pre_date_end_cleanup`,
  `vdt_prepare_entry_prewarm`, `vdt_prepare_lease`, `vdt_prepare_payload`,
  `vdt_provider_atomic_entry`, `vdt_remote_seen`, `vdt_routeable_entry`,
  `vdt_single_owner`, `vdt_survey_continuity`, `vdt_terminal_lifecycle`,
  `vdt_warmup_stability` (all `(uuid, text, text)`).
- Schema dropped: `private_video_date`.
- No tables, views, columns, buckets, cron jobs, flags, or env vars touched.

## Tests / fixtures

- New `shared/matching/videoDateTransitionSingleBodyContracts.test.ts`
  (12 pins), wired into `test:video-date-v4` and `test:video-date:red-flags`.
- `shared/matching/videoDateBackendTruthPinContracts.test.ts` head pins
  updated: no `private_video_date` reference + `single_body_rpc` marker.
- `supabase/contract-fixtures/2026-06/functions/public-heads/video_date_transition.sql`
  re-dumped from live post-apply; fixtures README records the re-dump. The 25
  private-chain fixtures remain as dropped-chain history.

## Verification evidence

- Transactional dry-run: full migration executed against the remote with
  `COMMIT` → `ROLLBACK` before the real apply (clean; state verified
  untouched afterwards).
- Applied via `npx supabase db push`; migration list aligned; post-apply
  `db push --linked --dry-run` reports "Remote database is up to date".
- Live markers: `private_video_date` function count 0, schema absent, head
  def free of chain references, `single_body_rpc` marker present, ACL
  `authenticated`/`service_role` only.
- Live probes (admin SQL, no auth context, nonexistent session): pinned
  `enter_handshake` rejection payload byte-for-byte; `sync_reconnect` returns
  `UNAUTHORIZED` through the full enrichment/route pipeline with all markers
  and no raw diagnostics.
- `npm run typecheck`, `npm run lint`, `test:video-date-v4` (incl. truth-pin
  17/17 and single-body 12/12), `test:video-date:red-flags`,
  `test:event-lobby-regression`, `test:daily-room-contract` 13/13 all green;
  `db lint --linked` 0 errors and no findings on the new body.
- Staging two-user e2e: run via the Phase 8 certification workflow
  (`mode: two-user-web`) — result recorded in the PR.

Static tests are not product acceptance; the program bar remains a fresh
two-user run through persisted `date_feedback`.
