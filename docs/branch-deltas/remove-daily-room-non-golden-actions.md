# Remove Daily-room Non-Golden Video Date Actions

Date: 2026-06-09
Branch: `codex/daily-room-golden-flow-only`

## Scope

Make `prepare_date_entry` the only public/client Video Date Daily entry command.

Removed active `daily-room` Video Date entry actions:

- `create_date_room`
- `join_date_room`
- `ensure_date_room`
- `prepare_diagnostic_entry`
- `prepare_solo_entry`

No database migration is required for this pass because the cleanup is Edge Function, client wrapper, observability, docs, and test source only.

## Preserved

- `prepare_date_entry` remains the web/native Video Date room and token entry path.
- `video_date_leave` and `delete_room` remain supported cleanup/end actions.
- `video_date_transition('enter_handshake')` remains intentionally available; current web/native date-entry state still references handshake/timer transition ownership, so removing it is a separate audit/removal target.
- Match-call actions `create_match_call`, `answer_match_call`, and `join_match_call` remain active for the separate Chat call product and should be extracted or removed in a separate product-scoped PR.
- Existing `create_date_room_*` provider observability operation labels remain because they are shared provider-room lifecycle labels used internally by `prepare_date_entry`, not public action names.

## Validation

- `shared/matching/dailyRoomLegacyActionRemovalContracts.test.ts` now asserts all removed public Video Date entry actions are absent from active contracts, Daily config-required actions, dispatch branches, and active web/native Video Date entry clients.
- `shared/matching/readyGatePartialReadyDefinitiveClosure.test.ts` proves provider/token work is actionability-gated through `prepare_date_entry` and that solo prejoin is removed, not disabled.
- `shared/matching/nativeReadyGateParityContract.test.ts` and related warmup contracts now assert standalone/native Ready Gate surfaces do not call the removed room-warmup path.
- Active readiness checks no longer create Daily diagnostic rooms; they record local camera/mic capability only.
- Supabase Edge Function deployment succeeded from merged `main` with `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase functions deploy daily-room --project-ref schdyxcunwcvddlcshwd --use-api` and `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase functions deploy admin-video-date-ops --project-ref schdyxcunwcvddlcshwd --use-api`.
- Remote verification showed `daily-room` ACTIVE version 865 updated at `2026-06-09 19:17:45 UTC` and `admin-video-date-ops` ACTIVE version 349 updated at `2026-06-09 19:17:54 UTC`.

## Proof Boundary

This is source and Edge Function cleanup evidence only. It is not Video Date product acceptance. Video Date remains unaccepted until a fresh disposable two-user production run proves match -> Ready Gate -> same Daily room -> stable bilateral provider-backed media/date -> date end -> both users persist `date_feedback`, including leave/rejoin and prolonged absence checks.
