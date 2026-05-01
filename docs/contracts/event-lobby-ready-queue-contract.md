# Event Lobby Ready Gate And Queue Contract

Date: 2026-05-01
Scope: Event Lobby deck, swipe, Ready Gate promotion, and queue drain.

## Canonical Policy

The backend owns swipe eligibility and session creation. Web and native may show local loading, ended, or busy affordances, but they must not be treated as the source of truth for whether a match/session can be created.

| Registration / session state | Normal deck behavior | Swipe behavior |
|---|---|---|
| `browsing` | Swipeable when all other backend filters pass | Allowed |
| `idle` | Swipeable when all other backend filters pass | Allowed |
| `in_ready_gate` | Hide from backend deck | Direct swipe returns active-session conflict before mutation |
| `in_handshake` | Hide from backend deck | Direct swipe returns active-session conflict before mutation |
| `in_date` | Hide from backend deck | Direct swipe returns active-session conflict before mutation |
| `in_survey` | Hide from backend deck | Queue drain may only proceed if backend promotion eligibility allows it |
| `offline` | Hide from backend deck | Queued promotion remains backend-owned |
| Other / unknown | Hide from backend deck | Backend decides through active-event, safety, idempotency, and conflict guards |

Clients may keep informational busy badges for stale cached cards, but active in-session users are not normal swipe targets once the backend deck refreshes.

## Match Outcomes

`immediate match`: mutual vibe/super-vibe when both users are lobby-present and idle/browsing. Backend creates or reuses one `video_sessions` row and moves both registrations to `in_ready_gate`.

`queued match`: mutual vibe/super-vibe when one or both participants are not promotable right now. Backend creates/reuses a queued `video_sessions` row and keeps registrations in lobby-compatible status so queue drain can promote later.

`already matched`: duplicate/retry path for an existing same-pair active session. Clients should recover the returned `video_session_id`.

`active-session conflict`: either participant already has another unended active session/queued session. `handle_swipe` now returns `participant_has_active_session_conflict` before inserting `event_swipes`, creating `video_sessions`, or updating registration room pointers.

`partner unavailable`: safety, visibility, blocked/reported, paused, not-registered, and inactive-event paths remain non-mutating and notification-suppressed where applicable.

## Ready Gate State Machine

Ready Gate ready: promotion sets `ready_gate_status = ready`, `ready_gate_expires_at`, `event_registrations.queue_status = in_ready_gate`, `current_room_id`, and `current_partner_id`.

Skip: `ready_gate_transition` handles skip/forfeit semantics without client-created sessions.

Snooze: snooze status keeps the session in a Ready Gate-owned state; the user must not be returned as a normal deck card.

Expire: expiry terminalizes the Ready Gate session and clears/normalizes registration pointers through the existing Ready Gate cleanup contracts.

Both-ready: both participants ready moves the session toward date entry. Clients may navigate only after backend truth says the session is both-ready or date-entry eligible.

Return-from-date: returning users must be reconciled through backend session truth and registration state. They should not be reintroduced as swipeable cards while the prior session remains active.

## Queue Drain

`drain_match_queue` remains a backend-owned promotion attempt. It requires the canonical active-event state and delegates promotion through `promote_ready_gate_if_eligible`.

`promote_ready_gate_if_eligible` now acquires ordered participant advisory locks for the queued pair, checks for another unended session involving either participant, and returns `participant_has_active_session_conflict` before promotion if a conflict exists.

## One-Active-Session Invariant

One active session per user is enforced by:

- deck filtering that hides active Ready Gate, handshake, and date candidates;
- direct swipe pre-mutation conflict checks;
- ordered participant advisory locks shared by swipe and queue promotion;
- pair-level swipe serialization in the canonical mutation base;
- promotion conflict checks before queued sessions move into Ready Gate.

The invariant is intentionally backend-owned. Clients should handle `participant_has_active_session_conflict`, `already_matched`, and `event_not_active` as terminal/recovery outcomes, not retry loops.

## Web/Native UI Expectations

Web and native should fetch/use deck cards only when the active-event and registration gates permit it. Busy labels may remain as defensive stale-card UI, but cards returned by the canonical backend deck should be normal lobby candidates only.

Clients must not create video sessions. They must route to Ready Gate/date only from backend session truth (`video_session_id`, `ready_gate_status`, date-entry truth, and active session hooks).
