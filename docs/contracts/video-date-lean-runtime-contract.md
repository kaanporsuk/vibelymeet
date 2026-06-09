# Video Date Lean Runtime Contract

Date opened: 2026-06-09

Purpose: define the small product/backend contract that should replace scattered Video Date route and state inference over time. This is a contract layer around the current implementation, not a rewrite instruction and not product acceptance proof.

## Goal

Video Date should be understandable as one server-owned flow:

1. Lobby admits the user and returns eligible deck cards.
2. Swipe records pass, vibe, or super-vibe.
3. Mutual match creates or resumes one video session.
4. Ready Gate collects both users' ready decisions.
5. Date route owns the handoff while Daily room preparation and join happen.
6. Server certifies stable bilateral media before a real date is counted.
7. Terminal survey opens only for survey-eligible ended encounters.
8. Feedback persistence, not client UI success alone, completes the date.

## Current Read Sources

Do not introduce another competing route owner. The lean contract wraps the current read surfaces:

| Surface | Current owner | Current role |
|---|---|---|
| `public.get_event_deck_v3(uuid, uuid, integer)` | Server | Lobby deck admission and card eligibility. |
| `swipe-actions` -> `public.handle_swipe_v2(...)` | Mixed | Client invokes Edge Function; server records swipe and returns match/queue/Ready Gate result. |
| `public.get_video_date_start_snapshot_v1(uuid)` | Server | Ready Gate/startup session truth and both-ready routeability. |
| `public.video_session_mark_ready_v2(uuid, text, text)` | Server | Decisive Ready Gate ready action. |
| `public.video_date_transition(uuid, text, text)` | Server | Date lifecycle command wrapper for prepare, start, end, and terminal recovery paths. |
| `daily-room` | Mixed | Client invokes Edge Function; server prepares/verifies Daily room and token work. |
| `video-date-snapshot` -> `public.get_video_date_snapshot_core(uuid)` | Mixed | Client invokes Edge Function; server returns date snapshot and optional Daily token. |
| `public.claim_video_date_surface(...)` | Server | Active `/date` surface ownership and duplicate-tab protection. |
| `public.mark_video_date_daily_joined(...)` / `public.record_heartbeat_v2(...)` | Mixed | Client reports provider-backed presence; server decides lifecycle truth. |
| `post-date-verdict` -> `public.submit_post_date_verdict_v3(...)` | Mixed | Client invokes Edge Function; server persists mandatory verdict feedback. |
| `public.update_post_date_feedback_details(...)` | Server | Optional post-date detail persistence. |

## Lean Screens

The client should render or navigate from one normalized screen value:

| Lean screen | Current route | Meaning |
|---|---|---|
| `lobby` | `/event/:eventId/lobby` or native event lobby | User is browsing deck, waiting, or safely returned to event context. |
| `ready_gate` | `/ready/:sessionId` or native Ready Gate | A live Ready Gate is actionable for this user. |
| `date` | `/date/:sessionId` or native date route | The date route owns the session, including both-ready provider preparation and active Daily join. |
| `survey` | `/date/:sessionId` with survey UI or native survey shell | Session ended with survey-eligible encounter truth and this actor still needs feedback. |
| `done` | Lobby/home/chat depending next surface | The Video Date unit is complete or terminal without survey. |
| `blocked` | Current surface with retry/error state | Backend cannot return routeable truth yet; retry or support diagnostics are required. |

## Lean Commands

All future client commands should normalize to this set before touching raw RPC/Edge responses:

| Command | Owner | Current implementation target |
|---|---|---|
| `enter_lobby` | Server | Auth/session + registration/event-live checks before deck read. |
| `get_deck` | Server | `get_event_deck_v3`. |
| `swipe` | Server | `swipe-actions` / `handle_swipe_v2`. |
| `mark_ready` | Server | `video_session_mark_ready_v2` or Ready Gate transition compatibility path. |
| `forfeit_ready_gate` | Server | `ready_gate_transition(..., 'forfeit', ...)`. |
| `prepare_date` | Mixed | `daily-room` and `video_date_transition(..., 'prepare_entry', ...)`. |
| `join_date` | Mixed | `video-date-snapshot`, Daily client join, `mark_video_date_daily_joined`, heartbeat. |
| `end_date` | Mixed | Client action plus `video_date_transition(..., 'end', ...)`. |
| `submit_survey` | Server | `post-date-verdict`, `submit_post_date_verdict_v3`, `date_feedback` row confirmation. |
| `return_to_lobby` | Client | Route/navigation after server next-surface truth. |
| `retry` | Client | Retry same normalized command after retryable server response. |

## State Authority

The long-term simplification target is:

- `video_sessions.state` is the authoritative session state.
- `video_sessions.ready_gate_status` is Ready Gate substate only.
- `event_registrations.queue_status` is a participant display/read model, not the route owner.
- Daily provider fields and `video_date_surface_claims` are evidence for lifecycle promotion, not independent screens.
- `date_feedback` is the completion proof for survey, not the survey UI state.

Current code still has legacy overlap. Until migration is complete, the shared decision layer must normalize current overlap into the lean screen contract.

## Acceptance Rules

These rules must stay true while simplifying:

- `both_ready` is date-route ownership, not proof of a real date.
- Daily room creation is not proof of a real date.
- Brief local/remote media is not proof of a successful date without stable bilateral provider-backed certification.
- `pre_stable_media_failed` is survey-ineligible.
- Survey completion requires the actor's `date_feedback` row.
- Web and native must resolve the same lean screen for the same backend truth.
- Lobby and Ready Gate must yield to active date/survey ownership.

## Migration Strategy

1. Keep current RPCs and Edge Functions working.
2. Route all new UI decisions through `shared/matching/videoDateLeanRuntimeContract.ts`.
3. Convert web surfaces first where the route decision is already centralized.
4. Convert native surfaces through the same shared module.
5. Only then reduce direct raw reads and duplicated branch logic.
6. Add a backend RPC only if the existing `get_video_date_start_snapshot_v1` plus `video-date-snapshot` cannot express a required screen cleanly.

## Proof Boundary

This contract makes the flow easier to reason about, but it does not prove product health. Product acceptance still requires a fresh two-user production run through lobby, mutual match, Ready Gate, same Daily room, stable bilateral provider-backed media/date, date end, and both users persisting `date_feedback`.
