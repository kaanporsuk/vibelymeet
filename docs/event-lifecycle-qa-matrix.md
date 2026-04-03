# Event Lifecycle QA Matrix

## Scope
Operational QA hardening for event lifecycle behavior across confirmed, waitlisted, promoted, cancelled, and ended states.

## Status Legend
- `Confirmed`: user has a confirmed seat
- `Waitlisted`: user is on waitlist, not lobby-eligible
- `Promoted`: user moved from waitlist to confirmed
- `Cancelled`: event has been cancelled
- `Ended`: event/session has ended

## Lifecycle Matrix

| Flow | Confirmed | Waitlisted | Promoted | Cancelled | Ended | Primary Operational Signals |
| --- | --- | --- | --- | --- | --- | --- |
| Registration / settlement | Ticket settle should create/keep confirmed admission | Settle can place user into waitlist when full | Promotion path should transition to confirmed | New registrations blocked or explicitly rejected | Registration closed / no new admission | `stripe_event_ticket_settlements`, `event_registrations`, structured `stripe-webhook` logs |
| Waitlist placement | Not applicable once confirmed | Placement occurs when capacity reached | N/A until promoted | No new waitlist entries after cancellation | N/A | `event_registrations.admission_status`, settlement outcomes |
| Waitlist promotion notify | No promotion notice | Pending until seat opens | Promotion enqueue + notify should complete | No promotion fanout after cancellation | N/A | `waitlist_promotion_notify_queue`, `notification_log`, structured promotion processor logs |
| Event reminder delivery | Reminder should target lobby/event truthfully and deliver or suppress with reason | Reminder should avoid lobby implication and stay status-safe | Follows confirmed reminder behavior after promotion | Cancellation notice should supersede reminders | No further reminders expected | `event_reminder_queue`, `notification_log`, structured reminder + send-notification logs |
| Cancellation notify | Receives cancellation message | Receives cancellation message | Receives cancellation message if still registered | Core lifecycle state | N/A | `notification_log` category `event_cancelled`, admin action logs |
| Lobby entry | Eligible before start/live | Not lobby-eligible unless promoted/confirmed | Becomes lobby-eligible once promoted | Lobby should not proceed for cancelled event | Lobby should transition to ended state | Lobby UI state + lifecycle feed (`video_sessions`, reminder/live notifications) |
| Swipe outcome | Swipe records, possible session-stage match path | Same mechanics once in lobby/date stage | Same as confirmed once promoted | No new swipes after cancellation expected | No new swipes after end expected | `event_swipes`, `video_sessions`, structured `swipe-actions` logs |
| Ready gate | Can enter and progress to date | Not available until confirmed/promotion | Available post-promotion | Should terminate/avoid new ready-gate transitions | Should not enter ready gate post-end | `video_sessions.state`, ready-gate notifications, reconnect metrics |
| Reconnect grace expiry/resume | Grace start/return/expire tracked during active date | Not applicable when user never in date | Same as confirmed during active date | Active sessions should terminate gracefully | Session remains ended | client analytics in `useReconnection`, `video_sessions.ended_reason` |
| Date start/end | Date should start from ready gate and end with reason | N/A until session participation | Same as confirmed during active date | Session end reason should reflect cancellation/system path | End state should remain stable | `video_sessions`, `post-date-verdict`, structured verdict/swipe logs |
| Unregister / booking cancellation | Removes future participation, no stale lobby implications | Removes waitlist entry | If promoted then unregister should clear confirmed seat | Cancellation modal and backend cleanup consistent | No-op or blocked after end depending on timing | registration analytics + admin lifecycle feed (`event_registrations`, queues/logs) |

## High-Risk Regression Checks
1. Confirmed and waitlisted users receive truthful, status-safe reminders and deep links.
2. Waitlist promotions produce exactly one notify queue record per promotion and a corresponding send outcome.
3. Stripe ticket settlement outcomes are visible and correlate with resulting admission states.
4. Reconnect grace start/return/expire transitions are observable and align with session end reason.
5. Admin event lifecycle feed surfaces both successful operations and source unavailability without hiding gaps.

## Minimum Evidence to Capture Per QA Run
1. Selected `event_id` and target user IDs for each status bucket.
2. At least one lifecycle record for reminder queue activity and reminder send result.
3. At least one waitlist promotion queue/result record (or explicit absence reason).
4. At least one settlement outcome row for the selected event.
5. At least one swipe/session lifecycle row and one admin action row for the selected event.
