# Remove Daily-room Legacy Date Actions

Date: 2026-06-09  
Branch: `codex/remove-daily-room-legacy-actions`

## Scope

Remove the legacy public/client-facing `daily-room` Edge Function actions:

- `create_date_room`
- `join_date_room`

This is a path-to-leaner cleanup. It removes the old public action contract and dead dispatch branches only. It does not remove provider-side Daily room creation/reuse/verification, which remains owned by `prepare_date_entry` and `ensure_date_room`.

## Preserved

- `prepare_date_entry` remains the web/native Video Date room/token entry path.
- `video_date_transition('enter_handshake')` remains intentionally available.
- `ensure_date_room`, `prepare_diagnostic_entry`, `prepare_solo_entry`, `video_date_leave`, `delete_room`, and match-call actions remain intact.
- Existing `create_date_room_*` provider observability operation labels remain intact because they are shared Daily provider lifecycle labels used by `prepare_date_entry`.

## Validation

- `shared/matching/dailyRoomLegacyActionRemovalContracts.test.ts` asserts that `create_date_room` and `join_date_room` are absent from the active Daily-room action contract and dispatch, current web/native entry still uses `prepare_date_entry`, and `enter_handshake` is preserved.
- `npm run test:event-lobby-regression` now includes the new removal contract.
- Supabase Edge Function deployment succeeded with `supabase functions deploy daily-room --project-ref schdyxcunwcvddlcshwd --use-api`.
- Remote verification showed `daily-room` ACTIVE version 863 updated at `2026-06-09 18:19:07 UTC`.

## Proof Boundary

This is source and Edge Function cleanup evidence only. It is not Video Date product acceptance. Video Date remains unaccepted until a fresh disposable two-user production run proves match -> Ready Gate -> same Daily room -> stable bilateral provider-backed media/date -> date end -> both users persist `date_feedback`, including leave/rejoin and prolonged absence checks.
