# Ready Gate Server-Owned Registration Status Final Audit

## Branch And Base

- Branch: `audit/ready-gate-registration-status-final-hardening`
- Base commit: `6e3b8984a91a53ab6498a2f3be047c803ffceb92`
- Scope: repo-level correctness only. Native builds, EAS builds/submits, OTA setup, store submission, and manual device QA were intentionally out of scope.

## Audit Scope

Audited the Ready Gate -> provider prepare -> date-entry lifecycle across:

- SQL/RPCs: `ready_gate_transition`, `video_date_transition`, `confirm_video_date_entry_prepared`, `update_participant_status`, promotion helpers, cleanup helpers, and direct `event_registrations` write policy surface.
- Web runtime: Ready Gate overlay, event lobby owner, status hook, active-session recovery, route hydration, date route, and date-entry prepare helpers.
- Native runtime: Ready Gate overlay, event lobby, standalone ready route, date route, active-session recovery, route hydration, notification deep links, status helpers, and date-entry guards.
- Shared tests/helpers: active-session truth routing, provider-room/date-startability helpers, and static hardening tests.

## Issues Found

1. `update_participant_status` no longer allowed clients to create `in_ready_gate`, `in_handshake`, or `in_date`, but it still allowed a client lifecycle write such as `offline`, `idle`, `browsing`, or `in_survey` to overwrite a row that was already attached to server-owned Ready Gate/date state through `current_room_id`.
2. The legacy RLS policy still allowed authenticated users to update their own `event_registrations` rows directly. Current clients do not directly mutate Ready Gate/date registration columns, but old or alternate clients could have attempted to create/clear `queue_status`, `current_room_id`, or `current_partner_id` outside the RPC.
3. Web `EventLobby` still called `setStatus("browsing")` immediately after Ready Gate overlay close, including terminal close paths. Server cleanup should own that transition.
4. Native home active-session termination still called `updateParticipantStatus(..., "browsing")` immediately after `ready_gate_transition('forfeit')` / `endVideoDate`. Server terminal/date lifecycle cleanup should own that transition.

## Fixes Made

- Added `supabase/migrations/20260501142000_ready_gate_client_lifecycle_overwrite_guard.sql`.
- Redefined `update_participant_status` so client-authored statuses remain limited to `browsing`, `idle`, `in_survey`, and `offline`, and are ignored while the row has `current_room_id` plus `queue_status` in `in_ready_gate`, `in_handshake`, or `in_date`.
- Added `prevent_client_session_registration_state_overwrite()` trigger for direct anon/authenticated table updates of `queue_status`, `current_room_id`, and `current_partner_id`.
- Removed the web Ready Gate close-time `setStatus("browsing")` from `src/pages/EventLobby.tsx`.
- Removed native home active-session post-terminal `updateParticipantStatus(..., "browsing")` from `apps/mobile/app/(tabs)/index.tsx`.
- Strengthened `shared/matching/videoDateEndToEndHardening.test.ts` to lock the new RPC guard, direct-update trigger, type-level exclusions, and removed terminal browsing writes.

## Final Ownership Model

- `video_sessions` remains the canonical source of Ready Gate/date state.
- Server-owned SQL/RPC/Edge/service-role flows own:
  - `event_registrations.queue_status = 'in_ready_gate'`
  - `event_registrations.queue_status = 'in_handshake'`
  - `event_registrations.queue_status = 'in_date'`
  - `current_room_id`
  - `current_partner_id`
- Authenticated client status helpers may request only non-session statuses:
  - `browsing`
  - `idle`
  - `offline`
  - `in_survey`
- Client status writes cannot overwrite a row currently attached to server-owned Ready Gate/date state.
- Date route entry still requires provider-confirmed session truth; `both_ready` alone remains prepare-eligible, not routeable date truth.

## Invariant Checklist

- No web client path writes `in_ready_gate`, `in_handshake`, or `in_date`.
- No native client path writes `in_ready_gate`, `in_handshake`, or `in_date`.
- Web and native client-writable status types exclude all session-authoritative statuses.
- Old/alternate direct client table updates cannot create, clear, or rehome Ready Gate/date registration state.
- Ready Gate terminal close paths no longer immediately write `browsing`.
- `ready_gate_transition` remains row-locked and terminal-safe.
- `prepare_entry` remains preflight-only.
- `confirm_video_date_entry_prepared` remains the routeable server transition after Daily proof.
- Route hydration and active-session recovery continue to prefer provider-confirmed `video_sessions` truth over stale registration rows.

## Validation

- `npm run test:vibe-video-contract`: pass, 23 Vibe Video tests + 5 onboarding type tests.
- `npx tsx shared/matching/videoDateEndToEndHardening.test.ts`: pass, 87 tests.
- `npx tsc --noEmit -p tsconfig.app.json`: pass.
- `npm run typecheck:core`: pass.
- `npm run lint`: pass with existing warnings only, 0 errors / 224 warnings.
- `npm run build`: pass.
- `cd apps/mobile && npm run typecheck`: pass.
- Supabase project ref confirmed in `supabase/config.toml`: `schdyxcunwcvddlcshwd`.
- `supabase db push --linked --dry-run`: pass; would push only `20260501142000_ready_gate_client_lifecycle_overwrite_guard.sql`.

## Deployment Impact

- New Supabase migration required: `20260501142000_ready_gate_client_lifecycle_overwrite_guard.sql`.
- No Supabase Edge Function changes.
- No native build, EAS build, EAS submit, OTA setup, store submission, or manual device QA was performed or required for this codebase-only audit.
- Cloud DB deployment was intentionally not performed in this pass because a new migration was added and this prompt requested stopping before cloud deploy.

## Remaining Risks

- Production is protected by the previously deployed migration against clients creating server-owned statuses through `update_participant_status`, but this final overwrite guard will not be live until the new migration is deployed.
- No unresolved repo-level correctness issues remain after the new migration is applied.
