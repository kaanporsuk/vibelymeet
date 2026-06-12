# Flatten Video Date Transition RPC Family

Date: 2026-06-11  
Branch: `codex/flatten-video-date-transition-rpc-family`

## Scope

This pass flattens the public/PostgREST `video_date_transition` RPC family only. It does not flatten `ready_gate_transition_*`, `video_session_mark_ready_v2_*`, or `handle_swipe_*`.

Golden flow preserved:

`mutual swipe -> Ready Gate -> both ready -> prepare_date_entry -> /date/native date -> Daily media -> post-date survey -> date_feedback`

## Implementation

- Added migration `20260611130225_flatten_video_date_transition_rpc_family.sql`.
- Preserved the public signature `public.video_date_transition(uuid, text, text)` with `SECURITY DEFINER`, `SET search_path TO 'public', 'pg_catalog'`, and `authenticated` / `service_role` execute grants.
- Kept current action compatibility:
  - `complete_entry` delegates to the existing `complete_handshake` internals.
  - `continue_entry` delegates to the existing `continue_handshake` internals.
  - `enter_handshake` remains rejected with `ENTER_HANDSHAKE_REMOVED`.
- Copied the deployed transition implementation into the private `private_video_date` compatibility schema with non-public helper names, then drops the timestamped public helper RPCs.
- The active public RPC calls only the private `vdt_current_base` compatibility implementation and returns the existing fail-soft markers, including `active_entry_failsoft_shell`, `hot_path_no_throw_shell`, and `standalone_enter_handshake_removed_shell`.

## Test Coverage

- Added `shared/matching/videoDateTransitionRpcFlatteningContracts.test.ts`.
- Wired it into `npm run test:video-date:red-flags`.
- The test enforces:
  - active web/native/Edge sources call only `video_date_transition`, not the helper RPCs;
  - the public signature/grants/search path remain stable;
  - timestamped transition helper RPCs are dropped from `public`;
  - this branch does not flatten `ready_gate_transition_*`, `video_session_mark_ready_v2_*`, or `handle_swipe_*`.

## Follow-Ups

- `ready_gate_transition_*`
- `video_session_mark_ready_v2_*`
- `handle_swipe_*`

## Proof Boundary

This is a behavior-preserving backend/catalog simplification. It is not Video Date product acceptance. Final acceptance still requires a fresh two-user production-like run through persisted `date_feedback`.
