# Video Date Golden Flow Certification

Date: 2026-06-08

This is the current certification checklist for the Vibely Video Date golden flow:

`live event match -> Ready Gate -> both ready -> canonical Daily room -> /date/:sessionId ownership -> same Daily room -> active co-presence -> remote media -> date promotion -> terminal survey -> date_feedback -> expected next surface`.

This document is not proof by itself. Video Date is certified only after a fresh disposable two-user run completes through both users saving `date_feedback`.

## Automated Gates

Run these from the repo root before any live certification attempt:

```bash
npm run test:video-date:red-flags
npm run test:video-date-v4
npm run verify:video-date:functions -- --skip-remote
```

`npm run test:video-date-v4` includes the PostgREST lifecycle RPC runtime probe. Without seeded `VIDEO_DATE_PUBLIC_API_RLS_*` credentials it skips safely; before a production certification attempt, seed a disposable participant JWT/session and verify duplicate, invalid, and terminal-style requests return structured JSON and no raw 5xx.

Run the invariant pack before, during, and after the live attempt. In a linked Supabase checkout, the command can use `supabase db query --linked`; with an explicit Postgres URL it uses `psql`:

```bash
npm run check:video-date:invariants
```

For certification and release decisions, make warnings fail. This is required
because stale survey-required sessions with missing `date_feedback` are not
database corruption, but they are proof that the Video Date run has not reached
the finish line:

```bash
npm run check:video-date:invariants -- --warn-as-error
```

For a single bundled local gate:

```bash
npm run certify:video-date:golden-flow -- --skip-live
```

For release verification with remote checks and invariant enforcement:

```bash
npm run certify:video-date:golden-flow -- --require-live
```

The bundled command still reports `certified: false` until a real two-user runtime run has been recorded.

## Runtime Acceptance

Use a disposable event with two eligible users. Record the following evidence in the command center or the release ticket:

- `event_id`, `video_session_id`, client platforms, commit SHA, deployment target, and operator.
- Both participants entered Ready Gate, with `video_date_ready_gate_entries` or RPC payload evidence.
- First ready tap moved to `ready_a` or `ready_b`; second ready tap moved to `both_ready`.
- `both_ready` returned canonical `daily_room_name` and `daily_room_url`; Daily provider failure did not poison the ready commit.
- `/date/:sessionId` became the owner; lobby and Ready Gate did not reclaim navigation.
- While `/date/:sessionId` owned the session, lobby/deck queue hints, drain calls, readiness polling, and foreground status loops did not compete with it.
- Both clients joined the same Daily room and called joined/owner heartbeat paths.
- Daily webhook/provider evidence showed current participant overlap without a newer leave/away marker.
- Any delayed Daily webhook truth was preserved by provider `occurred_at`, including participant provider join/left proof, without reviving terminal state.
- Both clients recorded canonical remote-seen evidence.
- Server promoted the session to `date` and set `date_started_at`.
- Date ended into survey-required truth, terminal audit fields reconstructed one chronological story, and `/date/:sessionId` opened `PostDateSurvey`.
- After terminal survey truth, Daily/date/queue loops stopped until feedback persisted.
- Both users persisted `date_feedback`.
- `resolve_post_date_next_surface` or equivalent client/server truth returned the expected next lobby/deck/Ready Gate state.

## Failure Handling

If any step fails, keep the session intact for inspection and capture:

- Ready Gate and mark-ready RPC payloads.
- `video_session_commands`, `video_date_daily_webhook_events`, `video_date_surface_claims`, and client stuck/RC diagnostics.
- Daily room name, provider participant ids, join/leave order, `participant_*_away_at`, `participant_*_joined_at`, and `participant_*_remote_seen_at`.
- `participant_*_provider_joined_at`, `participant_*_provider_left_at`, `terminal_generation`, `terminal_audit_*`, and surface-claim terminal tuple fields.
- `ended_reason`, `survey_required`, registration `queue_status`, and `date_feedback` rows.
- All retryable/error fields from lifecycle RPC payloads, including `code`, `retryable`, `terminal`, `sqlstate`, and route-owner fields.

Do not classify the flow as fixed from static tests, route entry, `both_ready`, Daily room creation, brief media visibility, or a survey-required terminal row alone.
