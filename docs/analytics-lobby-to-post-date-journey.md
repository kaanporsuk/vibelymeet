# Analytics: Lobby → Ready Gate → Video Date → Post-date survey

Canonical PostHog event names live in `shared/analytics/lobbyToPostDateJourney.ts` (`LobbyPostDateEvents`). Web and native use the same string values.

## Rules

- **No PII**: no freeform text, messages, partner identifiers, or raw profile fields in analytics props.
- **Dedupe**: impressions fire once per meaningful UI entry (mount/state) using refs; taps fire once per press; terminal outcomes once per resolved outcome.
- **Legacy journey events**: `video_date_journey_*` names remain for routing/diagnostics where still emitted; Ready Gate UI no longer double-emits those — it uses `LobbyPostDateEvents` only.

## Event map

### A. Lobby / empty deck / convergence

| Event | When | Props (required / optional) |
|-------|------|-------------------------------|
| `lobby_empty_state_impression` | User sees persistent empty deck UI (deck clear / exhausted path). | `platform`, `event_id` |
| `lobby_empty_state_refresh_tap` | User taps refresh on empty deck. | `platform`, `event_id` |
| `lobby_convergence_impression` | Lobby yields UI to “Opening Ready Gate…” / “Joining your date…” while session converges. | `platform`, `event_id`, optional `source_surface`: `ready_gate` \| `video_date` |
| `mystery_match_cta_impression` | Mystery Match CTA visible (native empty deck). | `platform`, `event_id` |
| `mystery_match_cta_tap` | User starts Mystery Match search. | `platform`, `event_id` |
| `mystery_match_outcome` | RPC/search produced a session or entered waiting loop. | `platform`, `event_id`, `outcome`: `matched` \| `waiting` \| `error` |
| `mystery_match_cancel` | User cancels Mystery search / waiting. | `platform`, `event_id` |

### B. Ready Gate

| Event | When | Props |
|-------|------|-------|
| `ready_gate_impression` | Ready Gate card shown for a session. | `platform`, `session_id`, `event_id` |
| `ready_gate_opening_wait_impression` | Native: permission / “Opening…” gate before main card. Web: optional loading parity. | `platform`, `session_id`, `event_id` |
| `ready_gate_permission_blocked` | Camera/mic not granted (native blocking UI). | `platform`, `session_id`, `event_id` |
| `ready_gate_ready_tap` | User taps I’m Ready. | `platform`, `session_id`, `event_id` |
| `ready_gate_snooze_tap` | User taps Snooze. | `platform`, `session_id`, `event_id` |
| `ready_gate_not_now_tap` | User steps away / dismisses without waiting for timeout. | `platform`, `session_id`, `event_id`, `dismiss_variant`: `skip_this_one` \| `cancel_go_back` |
| `ready_gate_timeout` | Gate closes due to countdown or server forfeited/expired while overlay still eligible. | `platform`, `session_id`, `event_id` |
| `ready_gate_stale_close` | Overlay closes because session/registration invalid or room mismatch. | `platform`, `session_id`, `event_id`, `reason` (machine-readable enum / code, no user text) |
| `ready_gate_both_ready` | Handoff to video date navigation begins. | `platform`, `session_id`, `event_id`, optional `source` |

### C. Video date join / peer-missing

| Event | When | Props |
|-------|------|-------|
| `video_date_join_attempt` | Client begins joining Daily / prejoin pipeline for the session. | `platform`, `session_id`, `event_id`, optional `is_retry` |
| `video_date_join_success` | Join pipeline reached “in room” success for this attempt. | `platform`, `session_id`, `event_id`, optional `has_remote_participant` |
| `video_date_join_failure` | Terminal failure before successful join for this attempt. | `platform`, `session_id`, `event_id`, `reason` |
| `video_date_peer_missing_terminal_impression` | Peer-missing terminal card shown (native). | `platform`, `session_id`, `event_id` |
| `video_date_peer_missing_retry_tap` | Retry from peer-missing terminal. | `platform`, `session_id`, `event_id` |
| `video_date_peer_missing_keep_waiting_tap` | Keep waiting. | `platform`, `session_id`, `event_id` |
| `video_date_peer_missing_back_to_lobby_tap` | Back to lobby / abort from terminal. | `platform`, `session_id`, `event_id` |

### D. In-date extension (KeepTheVibe row)

| Event | When | Props |
|-------|------|-------|
| `extend_date_cta_impression` | Extend row visible with credits (date phase). | `platform`, `session_id`, `event_id`, `credits_state` (bucketed) |
| `extend_date_no_credits_impression` | No credits — upsell / Get Credits shown. | `platform`, `session_id`, `event_id`, `credits_state` |
| `extend_date_cta_tap` | Tap +2 min, +5 min, or Get Credits. | `platform`, `session_id`, `event_id`, `cta_name`: `extra_time` \| `extended_vibe` \| `get_credits` |
| `extend_date_success` | Credit spend RPC succeeded. | `platform`, `session_id`, `event_id`, `credit_type`, `minutes_added`, `credits_state` |
| `extend_date_failure` | Spend failed or insufficient. | `platform`, `session_id`, `event_id`, `reason` |
| `extend_date_get_credits_tap` | Optional alias: same as `extend_date_cta_tap` with `cta_name: get_credits` (native/web may emit either pattern). |

### E. Post-date verdict & survey shell

| Event | When | Props |
|-------|------|-------|
| `post_date_survey_impression` | Survey modal opens. | `platform`, `session_id`, `event_id` |
| `keep_the_vibe_impression` | Verdict step (yes/no vibe) first shown. | `platform`, `session_id`, `event_id` |
| `keep_the_vibe_yes_tap` | User taps Vibe on verdict. | `platform`, `session_id`, `event_id` |
| `keep_the_vibe_no_tap` | User taps Pass on verdict. | `platform`, `session_id`, `event_id` |
| `post_date_survey_submit` | Verdict successfully recorded (server ok). | `platform`, `session_id`, `event_id`, `verdict`: `vibe` \| `pass` |
| `mutual_vibe_outcome` | Server returned mutual boolean after verdict. | `platform`, `session_id`, `event_id`, `outcome`: `mutual` \| `not_mutual` |
| `post_date_survey_skip` | User skips optional highlights or safety step. | `platform`, `session_id`, `event_id`, `step`: `highlights` \| `safety` |
| `post_date_survey_complete_return` | User completes flow and returns to lobby/home (survey finished). | `platform`, `session_id`, `event_id`, optional `destination`: `lobby` \| `home` \| `offline` |

Deprecated for new dashboards (replaced by row above where noted): legacy `post_date_survey_completed` on verdict — prefer `post_date_survey_submit`.
