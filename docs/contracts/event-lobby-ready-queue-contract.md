# Event Lobby Ready Gate Contract

Date: 2026-06-09
Scope: Event Lobby deck, swipe, direct mutual match, and Ready Gate entry after queued auto-promotion removal.

## Canonical Policy

The backend owns swipe eligibility and session creation. Web and native may show local loading, ended, or busy affordances, but they must not be treated as the source of truth for whether a match/session can be created.

| Registration / session state | Normal deck behavior | Swipe behavior |
|---|---|---|
| `browsing` | Swipeable when all other backend filters pass | Allowed |
| `idle` | Swipeable when all other backend filters pass | Allowed |
| `in_ready_gate` | Hide from backend deck | Direct swipe returns active-session conflict before mutation |
| `in_handshake` | Hide from backend deck | Direct swipe returns active-session conflict before mutation |
| `in_date` | Hide from backend deck | Direct swipe returns active-session conflict before mutation |
| `in_survey` | Hide from backend deck | Hidden until survey/date-feedback routing returns the user to lobby/chat/wrap-up |
| `offline` | Hide from backend deck | No queued promotion fallback |
| Other / unknown | Hide from backend deck | Backend decides through active-event, safety, idempotency, and conflict guards |

Clients may keep informational busy badges for stale cached cards, but active in-session users are not normal swipe targets once the backend deck refreshes.

## Match Outcomes

`immediate match`: mutual vibe/super-vibe when both users are promotable. Backend creates or reuses one `video_sessions` row and moves both registrations to `in_ready_gate`.

`already matched`: duplicate/retry path for an existing same-pair active session. Clients should recover the returned `video_session_id`.

`active-session conflict`: either participant already has another unended active session. `handle_swipe` returns `participant_has_active_session_conflict` before inserting `event_swipes`, creating `video_sessions`, or updating registration room pointers.

`partner unavailable`: safety, visibility, blocked/reported, paused, not-registered, inactive-event, or not-currently-promotable paths remain non-mutating and notification-suppressed where applicable.

`match_queued`: removed from the active client contract. Migration `20260610000100_remove_post_date_instant_next.sql` expires pre-existing queued sessions and removes queue-drain/promotion RPCs. Follow-up migration `20260610022531_review_comments_1262_1280_followups.sql` wraps the active swipe base so any delegated `match_queued` fallback is promoted into the same session as a normal Ready Gate `match` instead of burning reciprocal swipes.

## Ready Gate State Machine

Ready Gate ready: direct mutual match sets `ready_gate_status = ready`, `ready_gate_expires_at`, `event_registrations.queue_status = in_ready_gate`, `current_room_id`, and `current_partner_id`.

Skip: `ready_gate_transition` handles skip/forfeit semantics without client-created sessions.

Snooze: snooze status keeps the session in a Ready Gate-owned state; the user must not be returned as a normal deck card.

Expire: expiry terminalizes the Ready Gate session and clears/normalizes registration pointers through the existing Ready Gate cleanup contracts.

Both-ready: both participants ready moves the session toward date entry. Clients may navigate only after backend truth says the session is both-ready or date-entry eligible.

Return-from-date: returning users must be reconciled through backend session truth and registration state. They should not be reintroduced as swipeable cards while the prior session remains active or survey-required.

## Removed Queue Drain

`drain_match_queue`, `drain_match_queue_v2`, queue hints, queued promotion via `promote_ready_gate_if_eligible`, post-date instant-next routing, and pending-feedback queue-drain blockers are removed from the active contract. Clients must not poll queued counts, drain queued sessions, rescue queued sessions from notifications, or auto-route from survey completion into another Ready Gate/Video Date.

Post-date routing is authoritative through `resolve_post_date_next_surface`, but the allowed next actions are survey, lobby, chat, wrap-up, or home. It must not return another Ready Gate or Video Date action.

## One-Active-Session Invariant

One active session per user is enforced by:

- deck filtering that hides active Ready Gate, entry, and date candidates;
- direct swipe pre-mutation conflict checks;
- pair-level swipe serialization in the canonical mutation base;
- Ready Gate/date lifecycle cleanup before users can return to normal deck participation.

The invariant is backend-owned. Clients should handle `participant_has_active_session_conflict`, `already_matched`, and `event_not_active` as terminal/recovery outcomes, not retry loops.

## Web/Native UI Expectations

Web and native should fetch/use deck cards only when the active-event and registration gates permit it. Busy labels may remain as defensive stale-card UI, but cards returned by the canonical backend deck should be normal lobby candidates only.

Clients must not create video sessions. They must route to Ready Gate/date only from backend session truth (`video_session_id`, `ready_gate_status`, date-entry truth, and active session hooks).
