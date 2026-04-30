# Event Lobby Active Event Contract

Branch: `fix/event-lobby-active-event-contract`

## Problem

Production verification showed that Event Lobby backend entrypoints could still be called outside the true live event window. Stale links, direct RPC calls, native retries, or queue drains could reach deck, swipe, mystery match, or queued Ready Gate promotion logic after an event was not live anymore.

## Approach

This branch adds a shared SQL active-event guard and wraps the existing mature RPC bodies without changing their success-path behavior. The public RPC signatures stay the same; inactive events are rejected before profile disclosure, swipe inserts, super-vibe accounting, `video_sessions` creation/reuse, mystery-match creation, or queued Ready Gate promotion.

## Files Changed

- `supabase/migrations/20260501180000_event_lobby_active_event_contract.sql`
- `supabase/validation/event_lobby_active_event_contract.sql`
- `shared/matching/eventLobbyActiveEventContract.test.ts`
- `docs/branch-deltas/fix-event-lobby-active-event-contract.md`

## SQL Functions Changed

- Added `public.get_event_lobby_inactive_reason(uuid)`
- Added `public.is_event_lobby_active(uuid)`
- Wrapped `public.get_event_deck(uuid, uuid, integer)`
- Wrapped `public.handle_swipe(uuid, uuid, uuid, text)`
- Wrapped `public.find_mystery_match(uuid, uuid)`
- Wrapped `public.promote_ready_gate_if_eligible(uuid, uuid)`
- Wrapped `public.drain_match_queue(uuid)`

The previous implementations are retained as timestamped internal base functions and execution is revoked from `PUBLIC`, `anon`, and `authenticated`.

## Public-Schema Helper Surface

`get_event_lobby_inactive_reason(uuid)` and `is_event_lobby_active(uuid)` live in the `public` schema so `SECURITY DEFINER` lobby RPC wrappers can call one shared contract. They are internal-only API surfaces:

- `EXECUTE` is revoked from `PUBLIC`, `anon`, and `authenticated`.
- `EXECUTE` is granted to `service_role` for operator diagnostics and trusted backend use.
- They return only a boolean or lifecycle reason code, never profile, registration, swipe, match, or media payload data.
- Public wrappers only return detailed inactive reason codes after the caller is authenticated and, where applicable, established as a registered/confirmed event participant. Nonparticipants receive authorization or registration/admission outcomes instead of lifecycle details.

No web or native client should call these helpers directly. Clients should keep using `get_event_deck`, `swipe-actions`/`handle_swipe`, `find_mystery_match`, and `drain_match_queue`.

## Security Definer Hygiene

Every helper and wrapper added by this migration is `SECURITY DEFINER` with fixed `SET search_path TO 'public'`. The functions do not need extension lookup, and auth helpers are schema-qualified as `auth.uid()` / `auth.role()`.

## Active Event Rule

An Event Lobby backend action is allowed only when:

- the event exists
- `events.status = 'live'`
- `events.ended_at IS NULL`
- `events.archived_at IS NULL`
- current database time is within `event_date + COALESCE(duration_minutes, 60)`
- the existing RPC auth and participant checks pass

Inactive reason codes are normalized as:

- `event_not_found`
- `event_archived`
- `event_cancelled`
- `event_ended`
- `event_not_live`
- `event_outside_live_window`

This matches the strict lobby window used by web `EventLobby`, web event utilities, native lobby, native event phase derivation, and existing `get_visible_events` live classification: start at `event_date`, end at `event_date + duration_minutes`, with null duration defaulting to 60 minutes. Discover/home grace-window visibility remains separate and is not used for lobby backend actions.

## Return Shape Changes

Successful outcomes are delegated to the existing implementations unchanged.

Inactive outcomes:

- `get_event_deck`: returns zero rows.
- `handle_swipe`: returns `success: false`, `result: "event_not_active"`, `error: "event_not_active"`, and `reason`.
- `find_mystery_match`: returns `success: false`, `error: "event_not_active"`, `reason`, and `terminal: true`.
- `promote_ready_gate_if_eligible`: unauthenticated/spoofed direct client calls return `promoted: false`, `reason: "unauthorized"`; nonregistered or unconfirmed actors return `registration_missing` / `admission_not_confirmed`; inactive events return `promoted: false`, `reason: "event_not_valid"`, and `inactive_reason`. `service_role` remains allowed for trusted backend/operator calls.
- `drain_match_queue`: nonregistered or unconfirmed actors return `registration_missing` / `admission_not_confirmed`; inactive events return `found: false`, `reason: "event_not_valid"`, and `inactive_reason`.

## Supabase Deploy Requirement

Required: yes, after review and merge.

Expected linked project remains `schdyxcunwcvddlcshwd`.

Do not create any later migration with a version that sorts before `20260501180000`.

Deployment workflow for this stream is PR-first, then live Supabase cloud deploy to the canonical project after merge. Before applying the migration, run `supabase db push --linked --dry-run` and continue only if the dry-run shows exactly `20260501180000_event_lobby_active_event_contract.sql` with no unexpected migrations or drift.

## Edge Function Deploy Requirement

Not required. `swipe-actions` continues to call `handle_swipe` and only emits notifications for match, queued match, super-vibe, and vibe outcomes. Inactive `event_not_active` outcomes do not trigger notification side effects.

## Env Vars

No new environment variables.

## Validation

Run before merge:

- `npx tsx shared/matching/eventLobbyActiveEventContract.test.ts`
- `npx tsx supabase/functions/_shared/matching/videoSessionFlow.test.ts`
- `npm run build`
- `git diff --check`
- After the approved Supabase deploy, run `supabase/validation/event_lobby_active_event_contract.sql` as read-only production post-deploy verification.

## Remaining Risks

- This stream does not address swipe retry idempotency or duplicate notification suppression.
- This stream does not add ended-lobby UI polish, empty-state copy, media payload changes, busy-candidate policy, or native contract documentation.
- SQL regression here is static migration-contract coverage plus post-deploy read-only catalog verification. The production deploy must be preceded by a linked-project check and a dry-run showing only this migration.
