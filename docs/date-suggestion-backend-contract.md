# Date Suggestion — backend contract (implemented)

## Tables

- `date_suggestions` — root entity; partial unique index on `match_id` where `status IN ('draft','proposed','viewed','countered')`.
- `date_suggestion_revisions` — append-only; `agreed_field_flags` jsonb on counters.
- `schedule_share_grants` — `(match_id, viewer_user_id, subject_user_id)` unique; 48h `expires_at`.
- `date_plans` + `date_plan_participants` — confirmed plan; per-user `calendar_title` = `Date with {partner first name}`.
- `date_suggestion_transition_log` — observability (no PII in `payload`).
- `messages` — `message_kind`, `ref_id` → `date_suggestions`, `structured_payload` jsonb.

## RPC (authenticated)

`date_suggestion_apply(p_action text, p_payload jsonb) returns jsonb`

| Action | Payload | Notes |
|--------|---------|-------|
| `create_draft` | `{ match_id }` | Optional `draft` in payload for initial JSON. |
| `update_draft` | `{ suggestion_id, draft }` | Proposer only, `status = draft`. |
| `send_proposal` | `{ suggestion_id }` **or** `{ match_id, draft? }` + `revision: { date_type_key, time_choice_key, place_mode_key, venue_text?, optional_message?, schedule_share_enabled, starts_at?, ends_at?, time_block? }` | Sets `expires_at = now()+7d`; share grant if `schedule_share_enabled`; inserts `messages` row (`message_kind = date_suggestion`). Returns `notify` for Edge. |
| `mark_viewed` | `{ suggestion_id }` | Non-author of current revision only. |
| `counter` | `{ suggestion_id, revision: { ... } }` | Computes `agreed_field_flags`. |
| `accept` | `{ suggestion_id }` | Non-author only; creates `date_plans` + participants; `messages` `date_suggestion_event`. |
| `decline` | `{ suggestion_id }` | Recipient only (original `recipient_id`). |
| `not_now` | `{ suggestion_id }` | Either participant. No push from Edge (not in launch list). |
| `cancel` | `{ suggestion_id }` | Original proposer only. |
| `plan_mark_complete` | `{ plan_id }` | Two-step completion → `date_suggestions.status = completed`. |

`get_shared_schedule_for_date_planning(p_match_id, p_subject_user_id) returns jsonb` — slots for next 14 days from `user_schedules` if valid grant.

## Edge

- **`date-suggestion-actions`** — JWT required; invokes `date_suggestion_apply`, then `send-notification` when `result.notify` is set.
- **`date-suggestion-expiry`** — `Authorization: Bearer ${CRON_SECRET}`; expiring-soon (24h window, once via `expiring_soon_sent_at`); hard `expired` transition; transition log rows.

## Schedule privacy

- RLS on `user_schedules`: partner read **only** with active `schedule_share_grants` row (replaces always-on match read).

## Notifications (`send-notification` categories)

- `date_suggestion_proposed`, `date_suggestion_countered`, `date_suggestion_accepted`, `date_suggestion_declined`, `date_suggestion_cancelled`, `date_suggestion_expiring_soon` — `pref_messages`; deep link like messages (`/chat/:sender_id`).

## Remaining client work

- Invoke `date-suggestion-actions` or `rpc('date_suggestion_apply')` from web/native; render `message_kind` / `ref_id` cards; read `date_plans` for calendar UI; remove legacy plain-text proposal line when cut over.
