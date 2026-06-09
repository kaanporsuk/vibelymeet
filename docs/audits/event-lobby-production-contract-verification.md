# Event Lobby Production Contract Verification

Date: 2026-04-30
Branch: `audit/event-lobby-production-contract-verification`
Mode: read-only production verification. No code fixes, deploys, pushes, migration edits, or Supabase cloud mutations were performed.

> Current status note, 2026-05-01: this document is a historical pre-hardening production snapshot. The blockers identified here were intentionally closed by Streams 1-11, especially PRs #613-#624. Do not use the historical readiness verdict below as current production posture; use the stream branch deltas, validation SQL, and hardening contract tests for current state.
>
> Current Event Lobby note, 2026-06-09: Mystery Match was removed from the active product/backend path by `supabase/migrations/20260609152000_remove_mystery_match.sql`. Rows below mentioning `find_mystery_match` are historical production evidence, not current schema.

## Executive Summary

Production Supabase is linked to the same project ref declared in `supabase/config.toml`: `schdyxcunwcvddlcshwd` (`MVP_Vibe`, West EU / Ireland).

At the time of this audit, the remote migration history matched local migration history exactly for the audited repo: 338 local versions, 338 remote versions, 0 version mismatches. The then-latest hardening migrations inspected by the scratch deep-dive were present remotely, including the future-dated `202605...` migration series.

The deployed Edge Functions needed for the Event Lobby Deck contract are active. `swipe-actions`, `daily-room`, `send-notification`, and `admin-video-date-ops` were downloaded from the linked project into `/tmp` with `supabase functions download --use-api`; their downloaded source matches local source by SHA-256.

Historical production readiness verdict: production had the same backend contract shape that the audit inspected, including the blockers listed below. Those blockers are no longer current findings after the merged hardening streams; they are retained here only as the rationale for Streams 1-11.

## Verification Commands

- `supabase projects list`
- `supabase migration list --linked`
- `supabase functions list --project-ref schdyxcunwcvddlcshwd`
- `supabase db query --linked ...`
- `supabase functions download <function> --project-ref schdyxcunwcvddlcshwd --use-api`

Attempted but blocked:

- `supabase db dump --linked --schema public --file /tmp/vibely_remote_public_schema.sql`
- Blocker: Docker daemon unavailable. The CLI requires Docker for `db dump`. This was mitigated by direct read-only `supabase db query --linked` checks against `pg_get_functiondef`, `information_schema.columns`, and `pg_indexes`.

## Linked Project Ref

Local config:

- `supabase/config.toml`: `project_id = "schdyxcunwcvddlcshwd"`

Linked CLI metadata:

- `supabase/.temp/project-ref`: `schdyxcunwcvddlcshwd`
- `supabase/.temp/linked-project.json`: ref `schdyxcunwcvddlcshwd`, name `MVP_Vibe`

CLI project list:

- Linked project: `schdyxcunwcvddlcshwd`
- Name: `MVP_Vibe`
- Region: `West EU (Ireland)`
- Created: `2025-12-17 20:55:23 UTC`

Verdict: linked project matches local config.

## Remote Migration Status

`supabase migration list --linked` completed against the remote database.

Summary:

- Local migration versions: 338
- Remote migration versions: 338
- Version mismatches: 0

The remote history includes the Event Lobby / Ready Gate / Video Date hardening tail:

- `20260430190000`
- `20260501090000`
- `20260501092000`
- `20260501103000`
- `20260501110000`
- `20260501112000`
- `20260501135000`
- `20260501142000`
- `20260501145000`
- `20260501170000`

Verdict: local and remote migration histories match.

## Local vs Remote Mismatch

No migration-history mismatch was found.

Remote current function definitions were queried with `pg_get_functiondef` and checked for contract markers. The query returned these remote definition hashes:

| Function | Args | Remote definition MD5 | Contract markers observed |
|---|---|---:|---|
| `get_event_deck` | `p_event_id uuid, p_user_id uuid, p_limit integer` | `3278f6033a3c9d44248bb5034dc7c369` | `is_profile_discoverable`; no live/unended marker |
| `handle_swipe` | `p_event_id uuid, p_actor_id uuid, p_target_id uuid, p_swipe_type text` | `9c9e811826f9d698ad78eab7ab8cc7c7` | pair advisory lock marker, cancelled/archived marker, discoverability marker |
| `find_mystery_match` | `p_event_id uuid, p_user_id uuid` | historical 2026-04-30 marker | discoverability marker; no live/unended marker; removed from current schema on 2026-06-09 |
| `drain_match_queue` | `p_event_id uuid` | `c2328b0d89e89425fa2cb1402569cc31` | `expire_stale_video_sessions`, `promote_ready_gate_if_eligible` |
| `promote_ready_gate_if_eligible` | `p_event_id uuid, p_uid uuid` | `e938ce5ea36109781564ed12b4437155` | promotion helper; regex check confirms live status and ended-null markers |
| `ready_gate_transition` | `p_session_id uuid, p_action text, p_reason text` | `b01fbd799302e91d5cc4cb906e6d7f0d` | `20260501170000` wrapper and both-ready provider grace marker |
| `update_participant_status` | `p_event_id uuid, p_status text` | `d12dacf873763b5db3ddcdbfbaa14da5` | current participant status RPC present |

Remote table/index checks confirmed the expected contract fields and constraints for:

- `event_registrations`: `queue_status`, `current_room_id`, `current_partner_id`, `last_active_at`, `last_lobby_foregrounded_at`, `last_matched_at`, `joined_queue_at`
- `event_swipes`: `event_id`, `actor_id`, `target_id`, `swipe_type`, unique actor-target indexes
- `video_sessions`: participants, Ready Gate fields, queued expiry, Daily room fields, lifecycle state/phase/end fields

Important caveat: a full remote schema dump was not possible because Docker was unavailable. For the Event Lobby Deck contract, direct remote SQL queries verified the specific production objects and markers that matter for this stream.

## Local Migration Surfaces Inspected

Key local migration definitions participating in the contract:

| Surface | Latest / relevant local migration evidence |
|---|---|
| `get_event_deck` | Latest inspected definition in `20260430190000_enforce_discovery_audience_in_discovery_surfaces.sql` |
| `handle_swipe` | Latest inspected definition in `20260501092000_handle_swipe_presence_and_already_matched_session.sql` |
| `swipe-actions` | Edge Function source at `supabase/functions/swipe-actions/index.ts` |
| `ready_gate_transition` | Base hardening in `20260501090000...`, observability wrapper in `20260501135000...`, latest both-ready grace wrapper in `20260501170000...` |
| `drain_match_queue` | Current one-arg RPC lineage through `20260420120000`, `20260421120000`, `20260423120000` |
| `find_mystery_match` | Historical definition in `20260430190000_enforce_discovery_audience_in_discovery_surfaces.sql`; removed from current schema by `20260609152000_remove_mystery_match.sql` |
| `event_registrations` | Base table plus queue/status/presence hardening, including `20260501142000_ready_gate_client_lifecycle_overwrite_guard.sql` |
| `event_swipes` | Base table and uniqueness/indexes from `20260212180837...` and later hardening |
| `video_sessions` | Base table, unique pair/session constraints, active lookup indexes, RLS lockdown, Ready Gate/date lifecycle fields |

## Deployed Edge Function Status

Remote function registry status:

| Function | Status | Version | Updated at UTC | Local config `verify_jwt` | Source parity |
|---|---:|---:|---|---:|---|
| `swipe-actions` | ACTIVE | 461 | 2026-04-30 12:52:00 | true | Matches local SHA-256 |
| `daily-room` | ACTIVE | 561 | 2026-04-30 17:31:04 | true | Matches local SHA-256 |
| `send-notification` | ACTIVE | 518 | 2026-04-30 12:52:00 | true | Matches local SHA-256 |
| `admin-video-date-ops` | ACTIVE | 57 | 2026-04-30 12:52:00 | true | Matches local SHA-256 |
| `event-notifications` | ACTIVE | 550 | 2026-04-30 12:52:00 | true | Status verified |
| `event-reminders` | ACTIVE | 440 | 2026-04-30 12:52:00 | false | Status verified |
| `video-date-room-cleanup` | ACTIVE | 161 | 2026-04-30 12:52:00 | false | Status verified |
| `post-date-verdict` | ACTIVE | 326 | 2026-04-30 12:52:00 | true | Status verified |
| `post-date-verdict-reminders` | ACTIVE | 35 | 2026-04-30 12:52:00 | false | Status verified |

Downloaded-source SHA-256 checks:

- `swipe-actions/index.ts`: `3777ecfe408c91c9d4947c3869ebc7d7721406a5fac56d4962470b6c8bd0258d`
- `daily-room/index.ts`: `eeee2666be25df257d69506fa4d9e7ebf6ab63fb839447fa17465103d91b67e3`
- `daily-room/dailyRoomContracts.ts`: `45fb3e95eac7a5b8ac08a9a2f6504f6f5dc3ade5a1c548663e2340f20ac019e2`
- `send-notification/index.ts`: `4ba20e44d3c3ff0ff145353868a234bada72a6106bd583dae033da2e2f1e4a3e`
- `admin-video-date-ops/index.ts`: `6db89ad332686fc33283c2bd62504e87d8fd41ef8ef8758d2fdfb7afa765244d`
- `_shared/admin-video-date-ops.ts`: `c468abe6cd3e27d427a3a46f4a58182d1cc50d19441c2ae97eba1ea8c985cfeb`

## `swipe-actions` Client Usage

Code search found no direct app calls to `supabase.rpc('handle_swipe')` in `src` or `apps/mobile`.

Verified app call paths:

- Web: `src/hooks/useSwipeAction.ts` posts to `swipe-actions` with explicit user `Authorization` and `apikey` headers.
- Native: `apps/mobile/lib/eventsApi.ts` posts to `swipe-actions` with explicit user `Authorization` and `apikey` headers.
- Edge: `supabase/functions/swipe-actions/index.ts` invokes `userClient.rpc("handle_swipe", ...)`

Verdict: web and native use `swipe-actions`; `handle_swipe` remains the backend RPC called by the Edge Function.

## Historical Production Readiness Verdict

Production/cloud truth verified for this historical audit:

- The linked Supabase project matches local config.
- Remote migration history matches local history.
- The Event Lobby Deck hardening migrations referenced by the audit are applied remotely.
- `swipe-actions` is deployed and active.
- `swipe-actions`, `daily-room`, `send-notification`, and `admin-video-date-ops` source-match local deployed source.
- Web and native call `swipe-actions`, not direct `handle_swipe`.

Historical readiness verdict: production was aligned with the audited local backend contract, but the audited contract was not yet production-safe for Event Lobby Deck fixes. This was the input to the subsequent hardening streams, not the current state of `main`.

## Historical Blockers Before Code Fixes

The following blockers were real at audit time and are retained as historical context. They were addressed by Streams 1-11 and should not be cited as current production defects without rerunning current validation.

1. Active-event enforcement gap was real in production.
   - Remote `get_event_deck` has no live/unended marker.
   - Remote `find_mystery_match` has no live/unended marker.
   - Remote `handle_swipe` has cancelled/archived and session-ended markers, but no clear event-live marker.
   - `promote_ready_gate_if_eligible` does have live and ended-null markers, so queue promotion is stricter than deck/swipe/mystery entry.

2. `swipe-actions` production source matched local source, so any swipe retry/idempotency or notification coupling risks from the audit were production-real, not local-only.

3. A full remote schema dump could not be produced in this environment because Docker is unavailable.
   - This is not blocking the contract conclusion above because targeted remote SQL verified the required functions/tables/indexes.
   - If a full byte-for-byte schema artifact is required before release, run the manual command below on a machine with Docker running.

4. The scratch deep-dive audit source was intentionally left untracked during the audit and has since been removed from the working tree to avoid preserving stale pre-hardening claims as current documentation.

## Manual Verification Commands If Needed

Run these only for additional evidence; do not deploy or push:

```bash
supabase projects list
supabase migration list --linked
supabase functions list --project-ref schdyxcunwcvddlcshwd
supabase db dump --linked --schema public --file /tmp/vibely_remote_public_schema.sql
supabase functions download swipe-actions --project-ref schdyxcunwcvddlcshwd --use-api
supabase functions download daily-room --project-ref schdyxcunwcvddlcshwd --use-api
supabase functions download send-notification --project-ref schdyxcunwcvddlcshwd --use-api
```

Optional SQL marker query:

```bash
supabase db query --linked -o json "
with target(proname) as (
  values
    ('get_event_deck'),
    ('handle_swipe'),
    ('ready_gate_transition'),
    ('drain_match_queue'),
    ('find_mystery_match'),
    ('promote_ready_gate_if_eligible')
),
f as (
  select p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join target t on t.proname = p.proname
  where n.nspname = 'public'
)
select proname, args, md5(def) as definition_md5
from f
order by proname, args;
"
```
