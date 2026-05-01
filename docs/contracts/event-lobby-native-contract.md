# Event Lobby Native Contract

Date: 2026-05-01
Scope: Event Lobby backend, web, and native contract for entry eligibility, deck, swipes, Super Vibes, Ready Gate, queueing, media, realtime, observability, and privacy.

## Purpose And Ownership

This is the canonical Event Lobby contract for native implementation. Native should use this document instead of reverse-engineering web behavior.

The backend owns:

- event and registration eligibility
- deck membership and safety filters
- swipe persistence and idempotency
- Super Vibe limit enforcement
- match/session creation
- queue promotion
- Ready Gate transitions
- video-date entry eligibility
- one-active-session-per-user protection

Clients own:

- rendering the current backend state
- disabling stale or locally invalid actions before a request is made
- requesting backend actions through the canonical RPC or Edge Function
- polling/realtime recovery when subscriptions lag
- displaying sanitized user-facing copy
- emitting the approved observability taxonomy

Clients must not create `video_sessions`, infer match/session eligibility as final truth, expose private safety details, or fetch arbitrary profile fields for lobby cards.

## Entry Eligibility

An Event Lobby entry is valid only when all of these are true:

- the user is authenticated
- the route has an `eventId`
- the event exists
- the event is active under `get_event_lobby_active_state`
- the user has a confirmed event registration
- the user's account is not locally known to be paused
- the user is not backend-excluded by suspension/deletion/safety checks

The active-event invariant is backend-owned and includes:

- event row exists
- status is `live`
- status is not `draft`, `cancelled`, or archived-like
- `archived_at` is null
- `ended_at` is null
- server time is not before the scheduled start
- server time is before the scheduled end when the event has an end or duration field

The canonical inactive reasons are:

- `event_not_found`
- `event_not_live`
- `event_draft`
- `event_cancelled`
- `event_archived`
- `event_ended`
- `event_not_started`
- `event_outside_live_window`

Client behavior:

- Missing event: render a not-found state or redirect to a safe event surface.
- Not registered or not confirmed: do not fetch the deck; route/show the existing product-safe state.
- Scheduled or not started: do not fetch the deck; show not-live/scheduled copy.
- Cancelled, archived, draft, ended: stop deck polling, disable swipes, close transient interactions, and route/show a terminal event state.
- Paused account: preserve pause semantics and do not fetch the deck.

Backend behavior remains final. A stale client may still call an RPC or Edge Function, and the backend must reject unsafe requests without mutation.

## Deck RPC

Canonical RPC:

```sql
get_event_deck(p_event_id uuid, p_user_id uuid, p_limit integer)
```

Clients pass:

- `p_event_id`: current event id
- `p_user_id`: authenticated viewer profile/user id
- `p_limit`: client deck limit, currently `50`

Backend guarantees:

- `auth.uid() = p_user_id` is preserved
- inactive events raise `event_not_active`; they are not represented as a normal empty deck
- confirmed registration, safety, block/report, discoverability, and paused/deleted/suspended filters remain server-owned
- busy users in active Ready Gate, handshake, date, survey, offline, or unknown states are not returned as normal swipeable cards
- returned payload is viewer-safe only

Safe deck payload fields:

- `profile_id`
- `name`
- `age`
- `gender`
- `avatar_url`
- `photos`
- `primary_photo_path`
- `about_me`
- `job`
- `location`
- `height_cm`
- `tagline`
- `looking_for`
- `queue_status`
- `availability_state`
- `photo_verified`
- `premium_badge`
- `has_met_before`
- `is_already_connected`
- `has_super_vibed`
- `shared_vibe_count`

`availability_state` is currently `available` for returned cards because active in-session candidates are hidden by the backend deck. If a future backend contract intentionally returns unavailable cards, it must add an explicit viewer-safe state and clients must render them as disabled, not normally swipeable.

Deck empty and error behavior:

- valid live lobby with no returned cards: render an empty lobby state and emit `lobby_deck_empty`
- inactive event RPC error: map to `event_not_active`, stop deck polling, and route/show a terminal event state
- network/RPC failure: keep stale UI safe, disable risky actions when needed, and emit `lobby_deck_error`
- do not expose exact block/report/moderation/suspension reasons to users

Native polling guidance:

- Enable deck fetch only after auth, event, registration, active/live, and pause gates pass.
- The current native cadence is `refetchInterval: 15000` and `staleTime: 10000`.
- Pause deck fetches when the app is backgrounded, the route is unfocused, or the event becomes inactive.

Relevant native files:

- `apps/mobile/lib/eventsApi.ts`
- `apps/mobile/app/event/[eventId]/lobby.tsx`
- `supabase/functions/_shared/eventProfileAdapters.ts`

## Swipe API

Canonical Edge Function:

```text
swipe-actions
```

Request body:

```json
{
  "event_id": "uuid",
  "target_id": "uuid",
  "swipe_type": "pass | vibe | super_vibe"
}
```

Response shape is JSON from `handle_swipe` plus Edge Function compatibility fields. Clients must read `outcome` when present and fall back to `result` for older compatible paths.

Common outcome taxonomy:

- `pass_recorded`
- `vibe_recorded`
- `super_vibe_sent`
- `match`
- `match_queued`
- `already_matched`
- `already_swiped`
- `swipe_already_recorded`
- `limit_reached`
- `already_super_vibed_recently`
- `participant_has_active_session_conflict`
- `event_not_active`
- `blocked`
- `reported`
- `account_paused`
- `target_unavailable`
- `target_not_found`
- `not_registered`

Duplicate and idempotency semantics:

- same swipe key and same swipe type returns `already_swiped` when no existing mutual active session should be opened
- duplicate after an existing mutual session returns `already_matched` with the existing `video_session_id` when recoverable
- same swipe key with a different type returns `swipe_already_recorded`
- duplicate after the event becomes inactive returns `event_not_active`
- duplicate/no-op responses include additive markers such as `duplicate`, `idempotent`, `replay`, `notification_suppressed`, and `dedupe_reason` where available

Notification side-effect rules:

- notifications are allowed only for first-time side-effect-worthy outcomes
- duplicate/no-op retries must not trigger a second notification
- inactive-event, blocked, reported, paused, unavailable, conflict, and already-swiped outcomes are notification-suppressed
- clients should not attempt their own push side effects for lobby swipes

Ready Gate routing from swipe:

- `match` with a `video_session_id` and `immediate !== false` may open Ready Gate
- `already_matched` with a recoverable `video_session_id` may recover Ready Gate/date state
- `match_queued` should be tracked as queued and recovered through queue drain or realtime
- `already_swiped`, `event_not_active`, `participant_has_active_session_conflict`, and other terminal/no-advance outcomes must not burn the card as a fresh success

Relevant shared helpers:

- `supabase/functions/_shared/matching/videoSessionFlow.ts`
- `apps/mobile/lib/eventsApi.ts`
- `apps/mobile/app/event/[eventId]/lobby.tsx`

## Super Vibe

Current policy:

- 3 Super Vibes per user per event
- current native remaining-count helper derives remaining uses from `event_swipes`
- backend `handle_swipe` remains final authority for limit, retry, and conflict outcomes

Expected outcomes:

- first-time valid Super Vibe: `super_vibe_sent`, `match`, or `match_queued`
- limit reached: `limit_reached`
- same-action retry: `already_swiped` or an existing compatible idempotency outcome
- retry after existing session: `already_matched` when recoverable
- inactive event: `event_not_active`

Premium, credits, and monetization caveats:

- the client may render remaining counts and premium affordances, but must not treat local state as billing or entitlement authority
- future monetization changes must preserve backend-owned swipe mutation and notification suppression semantics
- no native client should decrement credits or Super Vibe allowance locally before backend confirmation

## Ready Gate

Canonical RPC:

```sql
ready_gate_transition(p_session_id uuid, p_action text, p_reason text default null)
```

Canonical actions:

- `mark_ready`
- `snooze`
- `forfeit`
- `sync`

Relevant Ready Gate/session states include:

- `ready`
- `ready_a`
- `ready_b`
- `both_ready`
- `snoozed`
- `queued`
- `forfeited`
- `expired`

Immediate match:

- swipe returns/reuses a `video_sessions.id`
- backend moves eligible participants into Ready Gate state
- clients open the in-lobby overlay or `/ready/[id]` from backend session truth only

Queued match promotion:

- queued sessions are backend-owned
- `drain_match_queue` and realtime/polling may promote a queued session into Ready Gate
- clients dedupe Ready Gate opening by `video_session_id`

Skip, snooze, expire, and both-ready:

- skip/forfeit is an RPC transition, not a client-side session deletion
- snoozed sessions must not reappear as normal swipeable cards
- expired sessions are terminalized by backend state and should route back to a safe event surface
- both-ready/date entry requires backend truth that the session is date-entry eligible

Route and deeplink expectations:

- in-lobby overlay is preferred when the user is already in the relevant event lobby
- `/ready/[id]` must validate session membership, event activity, and terminal state before showing controls
- stale or invalid Ready Gate links route back to events or the relevant event details/lobby safely
- `/date/[id]` may be entered only when Daily/video-date backend truth says the session is startable or rejoinable

Relevant native files:

- `apps/mobile/lib/readyGateApi.ts`
- `apps/mobile/components/lobby/ReadyGateOverlay.tsx`
- `apps/mobile/app/ready/[id].tsx`
- `apps/mobile/app/date/[id].tsx`

## Queueing

Canonical queue surfaces:

- `drain_match_queue(p_event_id uuid)`
- `promote_ready_gate_if_eligible(p_event_id uuid, p_uid uuid)` internally
- `video_sessions.ready_gate_status = 'queued'` for queued lobby sessions

Busy-user policy:

- `browsing` and `idle`: eligible for normal deck return when all other filters pass
- `in_ready_gate`: hidden from deck; direct swipe returns active-session conflict before mutation
- `in_handshake`: hidden from deck; direct swipe returns active-session conflict before mutation
- `in_date`: hidden from deck; direct swipe returns active-session conflict before mutation
- `in_survey`: hidden from deck; queue drain may proceed only if backend eligibility allows it
- `offline`: hidden from deck; queued promotion remains backend-owned
- unknown or unrecognized states: hidden from deck

One-active-session invariant:

- deck filtering hides active in-session users
- direct swipe conflict checks run before `event_swipes`, `video_sessions`, or registration pointer mutation
- queue promotion uses participant locks and conflict checks before promotion
- clients must treat `participant_has_active_session_conflict` as terminal/recovery state, not as a retry loop

Foreground and presence:

- native may call lobby foreground/presence helpers only while the event lobby is focused, app-active, confirmed, and event-active
- current native lobby foreground cadence is about 30 seconds while enabled
- stale foreground or offline state is not permission to create a session client-side

## Media

Card media fallback order:

1. first valid `photos[]` entry
2. `avatar_url`
3. placeholder or initials fallback

Safe media fields:

- `photos`
- `primary_photo_path`
- `avatar_url`

Path handling:

- deck media paths are public rendering references, not proof-selfie or private verification artifacts
- clients should pass paths through the app image helpers instead of building provider URLs ad hoc
- native full-card lobby images use `deckCardUrl`
- avatar-sized surfaces use `avatarUrl`
- web full-card lobby imagery uses the deck-card preset, not a thumbnail preset

Missing media must not crash the card, block swiping by itself, or trigger per-card profile fetches.

## Realtime And Polling

Expected realtime subscriptions:

- own `event_registrations` changes for the current event/profile
- participant-scoped `video_sessions` inserts/updates for the current user
- current `events` row lifecycle changes
- Ready Gate session row while a Ready Gate is open

Expected polling/recovery:

- deck refetch while lobby is valid and foregrounded
- queue drain retry/backoff while queued and event-active
- active session polling for cold-start/deeplink recovery
- Ready Gate polling fallback while realtime is degraded

Dedupe rules:

- dedupe Ready Gate overlay and navigation by `video_session_id`
- do not open multiple Ready Gate overlays for the same session
- do not navigate to date more than once for the same session transition
- treat realtime as a hint; refetch session/registration truth before irreversible route changes

Degraded realtime behavior:

- continue safe polling where enabled
- avoid stale swipes when the event becomes inactive
- recover queued/immediate sessions from backend session truth
- emit observability for failures without leaking private fields

## Observability

Use the shared Event Lobby observability taxonomy.

Client event names:

- `lobby_entered`
- `lobby_deck_loaded`
- `lobby_deck_empty`
- `lobby_deck_error`
- `lobby_swipe_submitted`
- `lobby_swipe_result`
- `lobby_swipe_duplicate_suppressed`
- `ready_gate_shown`
- `ready_gate_transition`
- `queue_drain_attempted`
- `queue_drain_result`
- `date_entered_from_lobby`

Backend/Edge structured log names:

- `lobby_swipe_result`
- `lobby_swipe_duplicate_suppressed`
- `notification_suppressed`
- `notification_sent`

Deck empty reasons:

- `event_not_active`
- `user_not_eligible`
- `no_confirmed_candidates`
- `all_candidates_filtered`
- `all_candidates_seen_locally`
- `all_candidates_busy_or_unavailable`
- `rpc_error`
- `network_error`
- `unknown`

Swipe result properties:

- `event_id`
- `platform`
- `swipe_type`
- `outcome`
- `reason`
- `session_id_present`
- `notification_attempted`
- `notification_suppressed_reason`
- `duplicate`

Do not emit raw target ids, actor ids, report/block internals, moderation details, emails, phone numbers, or proof-media paths in analytics payloads.

## Security And Privacy

Forbidden deck and observability fields:

- proof selfie URLs or storage paths
- private verification artifacts
- moderation fields
- suspension reasons
- report/block internals
- phone or email PII
- private contact info
- `photo_verified_at`
- `premium_until`
- admin grant metadata

Direct abuse protections:

- public RPCs and Edge Functions must preserve auth checks
- `SECURITY DEFINER` functions must pin `search_path`
- clients must invoke `swipe-actions` for swipe mutations and must not write `event_swipes` or `video_sessions` directly
- inactive-event, registration, safety, duplicate, and active-session conflict paths must be non-mutating where the backend contract says so
- notification side effects stay backend/Edge-owned

## Native Implementation Checklist

Prompt 9 native implementation should audit these files first:

- `apps/mobile/app/event/[eventId]/lobby.tsx`
- `apps/mobile/lib/eventsApi.ts`
- `apps/mobile/lib/eventStatus.ts`
- `apps/mobile/lib/readyGateApi.ts`
- `apps/mobile/components/lobby/ReadyGateOverlay.tsx`
- `apps/mobile/app/ready/[id].tsx`
- `apps/mobile/app/date/[id].tsx`
- `apps/mobile/lib/useActiveSession.ts`
- `apps/mobile/lib/useMysteryMatch.ts`
- `apps/mobile/lib/imageUrl.ts`
- `supabase/functions/_shared/eventProfileAdapters.ts`
- `supabase/functions/_shared/matching/videoSessionFlow.ts`
- `shared/observability/eventLobbyObservability.ts`

Implementation deltas to verify in Prompt 9:

- Native unavailable, terminal, and empty states map to the exact deck empty taxonomy without leaking sensitive reasons.
- Native swipe/toast handling covers `already_swiped`, `swipe_already_recorded`, `event_not_active`, `participant_has_active_session_conflict`, `account_paused`, `target_unavailable`, `blocked`, and `reported`.
- Super Vibe remaining UI treats backend outcomes as final truth and does not locally spend allowance before confirmation.
- Ready Gate overlay and `/ready/[id]` dedupe by `video_session_id` across realtime, polling, deep links, and queued promotion.
- Event ending while in the lobby stops deck polling, disables swipes, closes transient swipe actions, and routes/shows a terminal state.
- Queue drain and mystery match calls remain gated by active event, confirmed registration, foreground/focus, and pause state.
- Media fallback remains photo, then avatar, then placeholder, with full-card deck image sizing.
- Native observability uses the shared event names and sanitized properties.

Tests and smoke required for Prompt 9:

- `npm run test:event-lobby-regression`
- `npm run test:hardening-contracts`
- native typecheck/build command available to the mobile workspace
- focused native tests for deck payload parsing, swipe outcome parsing, inactive event handling, media fallback, and Ready Gate open dedupe
- staging smoke from `docs/golden-path-event-lobby-regression-runbook.md`

Rollout notes:

- do not mutate production data without safe fixtures
- use staging users/events for two-user and three-user proof
- do not change backend semantics from native unless a separate backend stream is opened
- do not redesign Event Lobby or Ready Gate UI in the contract-following implementation

## Prompt 9 Implementation Status

Branch `fix/native-event-lobby-parity` implements the native contract-following pass.

- Native gates deck fetches behind event/user/registration/pause/live checks and now treats backend `event_not_active` deck or swipe responses as a terminal lobby-closed state.
- Native swipe handling normalizes `outcome`, `result`, and `error` before telemetry, duplicate suppression, Ready Gate routing, toast handling, and deck advancement.
- Native covers duplicate/idempotent, unavailable, paused, registration, active-session conflict, Super Vibe limit/retry, and inactive-event outcomes without client-owned notification side effects.
- Native consumes safe deck payload fields for media, premium/photo verification, and availability display; non-`available` candidates are not presented as normal swipe targets.
- Ready Gate opening remains deduped by `video_session_id` and routed through backend session truth.
- Regression coverage lives in `shared/matching/nativeEventLobbyContractParity.test.ts` and the Event Lobby harness.
- No schema, RPC, Edge Function, provider, or environment changes were made by the native implementation stream.

## Rebuild Delta

Prompt 8 was documentation-only; Prompt 9 adds native/shared client implementation coverage.

- New canonical contract: `docs/contracts/event-lobby-native-contract.md`
- Native implementation audit: `docs/audits/native-event-lobby-parity-implementation.md`
- Native branch delta: `docs/branch-deltas/fix-native-event-lobby-parity.md`
- No schema changes
- No RPC return-shape changes
- No Edge Function changes
- No provider or environment variable changes
- No Supabase deploy required
- Prompt 9 native implementation tasks are enumerated above
