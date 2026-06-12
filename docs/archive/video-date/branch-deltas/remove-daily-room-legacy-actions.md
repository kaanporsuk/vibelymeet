# Remove Daily-room Legacy Date Actions

Date: 2026-06-09  
Branch: `codex/remove-daily-room-legacy-actions`

Supersession note, 2026-06-09: `docs/branch-deltas/remove-daily-room-non-golden-actions.md` expands this cleanup and removes the additional non-golden Video Date actions `ensure_date_room`, `prepare_diagnostic_entry`, and `prepare_solo_entry` from active source.

## Scope

Remove the legacy public/client-facing `daily-room` Edge Function actions:

- `create_date_room`
- `join_date_room`

This was a path-to-leaner cleanup. It removed the old public action contract and dead dispatch branches only. The superseding non-golden cleanup keeps provider-side Daily room creation/reuse/verification owned by `prepare_date_entry` and removes the separate `ensure_date_room` warmup action.

## Preserved

- `prepare_date_entry` remains the web/native Video Date room/token entry path.
- Superseded follow-up: `docs/branch-deltas/remove-standalone-enter-handshake.md` removes standalone/client-visible `video_date_transition('enter_handshake')`; current clients must use `prepare_date_entry` / `prepare_entry`.
- In this earlier branch, `ensure_date_room`, `prepare_diagnostic_entry`, and `prepare_solo_entry` remained intact. The superseding non-golden cleanup removes them from active source.
- `video_date_leave`, `delete_room`, and match-call actions remain intact.
- Existing `create_date_room_*` provider observability operation labels remain intact because they are shared Daily provider lifecycle labels used by `prepare_date_entry`.

## Validation

- Superseded follow-up: `shared/matching/dailyRoomLegacyActionRemovalContracts.test.ts` now also asserts that standalone `enter_handshake` is absent/rejected and current web/native entry still uses `prepare_date_entry`.
- `npm run test:event-lobby-regression` now includes the new removal contract.
- Supabase Edge Function deployment succeeded with `supabase functions deploy daily-room --project-ref schdyxcunwcvddlcshwd --use-api`.
- Remote verification showed `daily-room` ACTIVE version 863 updated at `2026-06-09 18:19:07 UTC`.

## Proof Boundary

This is source and Edge Function cleanup evidence only. It is not Video Date product acceptance. Video Date remains unaccepted until a fresh disposable two-user production run proves match -> Ready Gate -> same Daily room -> stable bilateral provider-backed media/date -> date end -> both users persist `date_feedback`, including leave/rejoin and prolonged absence checks.
