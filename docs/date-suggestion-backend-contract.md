# Date Suggestion Backend Contract

This is the current Schedule / physical-date lifecycle contract. Clients should not call date-suggestion SQL RPCs directly for writes; the supported write surface is the `date-suggestion-actions` Edge Function.

## Write Surface

- Web and native clients call `date-suggestion-actions` with `{ action, payload }`.
- `date-suggestion-actions` invokes `date_suggestion_apply_v2` for most proposal, counter, accept, decline, cancel, and schedule-share actions.
- `plan_mark_complete` is special: the Edge Function routes it directly to `date_plan_mark_complete_v2`.
- Legacy `date_suggestion_apply` / `date_suggestion_apply_v2` entrypoints must also route `plan_mark_complete` to `date_plan_mark_complete_v2` so callers cannot use the old completion model by accident.
- `date-suggestion-expiry` remains the cron-owned expiry surface (`Authorization: Bearer ${CRON_SECRET}`).

## Core Tables

- `date_suggestions` — root entity; partial unique index on `match_id` where `status IN ('draft','proposed','viewed','countered')`.
- `date_suggestion_revisions` — append-only proposal/counter revisions; includes schedule-share flags and agreed field flags.
- `schedule_share_grants` and `schedule_share_grant_slots` — 48-hour selective schedule visibility for date planning.
- `date_plans` and `date_plan_participants` — accepted plan records and per-user calendar metadata.
- `date_plan_completion_confirmations` — one row per user per accepted physical date plan when that user marks complete.
- `date_plan_feedback` — optional private physical/scheduled-date feedback for trust and safety review.
- `date_suggestion_transition_log` — observability; avoid PII in `payload`.
- `messages` — `message_kind`, `ref_id`, and `structured_payload` rows for date suggestion cards and lifecycle events.

## Action Routing

| Action family | Entry point | Notes |
|---------------|-------------|-------|
| Draft/proposal/counter/view/accept/decline/not-now/cancel | `date-suggestion-actions` → `date_suggestion_apply_v2` | `date_suggestion_apply_v2` owns current validation and delegates preserved legacy behavior where needed. |
| Schedule-share accept/edit | `date-suggestion-actions` → `date_suggestion_apply_v2` | Accepting a schedule-share offer is start-time-only; `date_plans.ends_at` remains `NULL` for that path. |
| Mark complete | `date-suggestion-actions` → `date_plan_mark_complete_v2` | Uses per-user completion confirmations and returns structured completion state. |
| Physical-date feedback | `submit_date_plan_feedback` / `get_my_date_plan_feedback_status` | Feedback is private to the reviewer plus admin/moderator safety review. |

## Completion Model

- Mark Complete is gated by `date_plan.starts_at`; calls before `starts_at` return `date_not_started`.
- One user marking complete creates or reuses a row in `date_plan_completion_confirmations` and returns `completion_state = 'self_marked'` with `waiting_for_user_id`.
- Both expected participants marking complete updates the `date_plans` and `date_suggestions` rows to `completed` and returns `completion_state = 'mutually_completed'`.
- A backend trigger on `date_plans` blocks direct early completion writes to completion columns or `status = 'completed'`.
- Cancelled dates stay terminal/history; completion logic must not reclassify cancellation semantics.

## Feedback Separation

- `date_plan_feedback` stores optional post-physical-date feedback. The reviewer can read their own row; the subject cannot read feedback written about them; admins/moderators can read rows for safety review.
- `public.date_feedback`, `PostDateSurvey`, `video_sessions`, and the Vibely Video post-date survey flow are separate systems and must not be coupled to scheduled/physical-date feedback.
- No public trust score or user-visible rating is produced by `date_plan_feedback`.

## Schedule Privacy

- `user_schedules` partner reads require an active `schedule_share_grants` row and scoped grant slots.
- Accepted cards render confirmed `date_plan` state. They must not show “Share your Vibely Schedule”, “48h live windows”, or other schedule-share planning mechanics after acceptance/completion.
- Share the Date text is editable before sharing/copying and uses confirmed plan state, not schedule-share mechanics.

## Notifications

- `date_suggestion_proposed`, `date_suggestion_countered`, `date_suggestion_accepted`, `date_suggestion_declined`, `date_suggestion_cancelled`, `date_suggestion_schedule_share_updated`, and `date_suggestion_expiring_soon` are the current date suggestion notification categories.
- `cancel_plan` emits `plan_cancelled` internally and maps to the existing cancellation notification category.
