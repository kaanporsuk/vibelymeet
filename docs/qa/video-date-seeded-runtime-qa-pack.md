# Video Date Seeded Runtime QA Pack

## Purpose

Use this pack to run repeatable staging or production smoke checks for the live video-date loop with real accounts/devices. It fills the manual gap left by CI: seeded two-user timing, Daily media join, native device behavior, admin Video Date Ops, and non-admin access checks.

Reference baselines:

- `docs/video-date-hardening-closure-handoff.md`
- `docs/golden-path-regression-runbook.md`
- `docs/observability/video-date-operator-metrics.md`

## Existing Assets Audited

- `docs/qa/chat-call-launch-smoke-matrix.md` and `docs/qa/chat-call-wave4-validation.md` are the closest existing manual QA pack pattern.
- `scripts/run_golden_path_smoke.sh` is the CI/local scripted harness; it does not create users or events.
- `scripts/fresh-smoke-proof-bootstrap.mjs` can authenticate and seed proof data against the linked project. It is not used by this pack because this workstream must avoid committing credentials or adding production-mutating automation.
- `supabase/validation/video_date_end_to_end_hardening.sql` is a read-only SQL validation pack for migration-era checks, not a seeded two-user runtime playbook.

## Safety Rules

- Do not commit credentials, passwords, JWTs, refresh tokens, or personal account details.
- Prefer staging or a dedicated test event. Production checks must use approved smoke users and a clearly labeled test event.
- SQL in this doc is read-only unless explicitly labeled `cleanup/manual-review-required`.
- Do not run destructive production cleanup from this document. Use the cleanup section to identify candidates, then make a reviewed decision.
- Do not bypass normal app actions by writing lifecycle state directly. Ready Gate, date, survey, queue, and swipe behavior must remain backend-owned.

## Required Test Actors

| Actor | Required role | Purpose |
| --- | --- | --- |
| Admin operator | Admin | Open `/kaan/dashboard`, inspect Video Date Ops, cross-check aggregate health. |
| User A | Non-admin | Event registration, swipe, Ready Gate, date, survey, chat/match path. |
| User B | Non-admin | Partner path for User A. Must be eligible for the same event/deck. |

Record the run privately outside Git:

```text
Environment:
Date/time:
Operator:
Admin account:
User A id:
User B id:
Event id:
Web build / native build:
Notes:
```

## Profile Eligibility Checklist

Before the run:

- [ ] User A and User B can sign in on separate browsers/devices.
- [ ] Both users are non-admin.
- [ ] Both profiles are complete enough to appear in event deck discovery.
- [ ] Neither user is paused, suspended, blocked, reported, or safety-restricted against the other.
- [ ] Both users have event access/admission for the target event.
- [ ] Both users can foreground the lobby at the same time.
- [ ] Native smoke, if included, uses a build pointed at the same Supabase environment.

Read-only SQL:

```sql
-- read-only: confirm the two users have event registrations and no active room pointer before starting
select
  er.event_id,
  er.profile_id,
  er.admission_status,
  er.queue_status,
  er.current_room_id,
  er.last_lobby_foregrounded_at
from public.event_registrations er
where er.event_id = '<event_id>'::uuid
  and er.profile_id in ('<user_a_id>'::uuid, '<user_b_id>'::uuid)
order by er.profile_id;
```

```sql
-- read-only: confirm there is no currently active same-pair session before the simultaneous-swipe run
select
  vs.id,
  vs.event_id,
  vs.participant_1_id,
  vs.participant_2_id,
  vs.state,
  vs.phase,
  vs.ready_gate_status,
  vs.ready_gate_expires_at,
  vs.ended_at
from public.video_sessions vs
where vs.event_id = '<event_id>'::uuid
  and vs.ended_at is null
  and (
    (vs.participant_1_id = '<user_a_id>'::uuid and vs.participant_2_id = '<user_b_id>'::uuid)
    or
    (vs.participant_1_id = '<user_b_id>'::uuid and vs.participant_2_id = '<user_a_id>'::uuid)
  )
order by vs.created_at desc;
```

## Event Setup Checklist

- [ ] Use a live or near-live event where both smoke users are admitted.
- [ ] Event has enough eligible profiles that User A and User B can see each other, or a controlled deck state where the pair is intentionally exposed.
- [ ] Event is not close enough to ending that the event-ended path masks the normal Ready Gate path, unless testing the event-ended branch.
- [ ] Daily configuration is valid for the environment.
- [ ] `admin-video-date-ops` is deployed when validating admin metrics.

Read-only SQL:

```sql
-- read-only: event timing and status sanity
select
  e.id,
  e.title,
  e.status,
  e.starts_at,
  e.ends_at
from public.events e
where e.id = '<event_id>'::uuid;
```

## Two-User Simultaneous Swipe Checklist

1. Open User A and User B in separate browsers/devices.
2. Enter the same event lobby with both users.
3. Confirm both users are foregrounded and see each other or the intended target card.
4. Count down verbally and swipe mutual as close together as possible.
5. Record client-visible outcomes:
   - User A result/route:
   - User B result/route:
   - Any console/app errors:
6. Confirm both users route to the same Ready Gate if a session is returned.

Read-only SQL:

```sql
-- read-only: exactly one active session should exist for the pair after mutual swipe
select
  vs.id,
  vs.event_id,
  vs.participant_1_id,
  vs.participant_2_id,
  vs.state,
  vs.phase,
  vs.ready_gate_status,
  vs.ready_gate_expires_at,
  vs.ended_at,
  vs.created_at
from public.video_sessions vs
where vs.event_id = '<event_id>'::uuid
  and (
    (vs.participant_1_id = '<user_a_id>'::uuid and vs.participant_2_id = '<user_b_id>'::uuid)
    or
    (vs.participant_1_id = '<user_b_id>'::uuid and vs.participant_2_id = '<user_a_id>'::uuid)
  )
order by vs.created_at desc
limit 10;
```

```sql
-- read-only: both registrations should point to the same active/current session when in Ready Gate/date
select
  er.profile_id,
  er.queue_status,
  er.current_room_id,
  vs.state,
  vs.phase,
  vs.ready_gate_status,
  vs.ready_gate_expires_at,
  vs.ended_at
from public.event_registrations er
left join public.video_sessions vs on vs.id = er.current_room_id
where er.event_id = '<event_id>'::uuid
  and er.profile_id in ('<user_a_id>'::uuid, '<user_b_id>'::uuid)
order by er.profile_id;
```

Pass criteria:

- [ ] One active same-pair `video_sessions` row at most.
- [ ] Both users receive a routable session.
- [ ] Both users arrive at the same Ready Gate.
- [ ] No user falls into a dead queue/collision state.

## Ready Gate, Date, And Survey Continuity Checklist

Ready Gate:

- [ ] Countdown is consistent between users.
- [ ] Refresh/reconnect preserves countdown from server `ready_gate_expires_at`.
- [ ] Ready/skip/snooze actions use existing backend transitions.
- [ ] Ready Gate expiration shows the expected expired/disabled behavior.

Daily/date:

- [ ] Both users can join the Daily room.
- [ ] Camera/mic permission prompts are understandable.
- [ ] Refresh/rejoin restores server-owned date phase/timer.
- [ ] Timer correction does not flicker or repeatedly fire analytics.
- [ ] Ending the date moves both users into the expected post-date path.

Post-date survey:

- [ ] Survey submit has a busy state and cannot be double-submitted.
- [ ] Queued or activated next session routes into Ready Gate.
- [ ] Fresh deck candidate returns to lobby with a real card/state.
- [ ] No candidate shows calm empty state.
- [ ] Event-ended path still wins when the event has ended.

Read-only SQL:

```sql
-- read-only: inspect the tested session after Ready Gate/date/survey
select
  vs.id,
  vs.event_id,
  vs.state,
  vs.phase,
  vs.ready_gate_status,
  vs.ready_gate_expires_at,
  vs.handshake_started_at,
  vs.date_started_at,
  vs.ended_at,
  vs.ended_reason,
  vs.participant_1_joined_at,
  vs.participant_2_joined_at
from public.video_sessions vs
where vs.id = '<video_session_id>'::uuid;
```

## Admin Video Date Ops Cross-Check

Admin UI:

- [ ] Log in as admin.
- [ ] Open `/kaan/dashboard`.
- [ ] Go to Event Analytics.
- [ ] Select the test event.
- [ ] Confirm Video Date Ops renders 24h and 7d windows.
- [ ] Confirm metrics are aggregate-only and do not expose user PII.

Non-admin 403:

- [ ] Sign in as User A or User B.
- [ ] Attempt to call `admin-video-date-ops` with that user's bearer token.
- [ ] Confirm response is 403.

Example request shape; do not store bearer tokens:

```bash
# manual check: expects 403 for non-admin bearer token
curl -i \
  -X POST "https://<project-ref>.supabase.co/functions/v1/admin-video-date-ops" \
  -H "Authorization: Bearer <non_admin_access_token>" \
  -H "Content-Type: application/json" \
  --data '{"eventId":"<event_id>"}'
```

Cross-check read-only SQL:

```sql
-- read-only: Ready Gate to join latency sample for the selected event
select
  vs.id,
  vs.ready_gate_expires_at,
  vs.participant_1_joined_at,
  vs.participant_2_joined_at,
  least(vs.participant_1_joined_at, vs.participant_2_joined_at) as first_joined_at,
  greatest(vs.participant_1_joined_at, vs.participant_2_joined_at) as both_joined_at
from public.video_sessions vs
where vs.event_id = '<event_id>'::uuid
  and vs.created_at >= now() - interval '24 hours'
order by vs.created_at desc
limit 25;
```

```sql
-- read-only: recent event-loop observability for the test event, if the operator has access
select
  created_at,
  event_name,
  reason,
  metadata
from public.event_loop_observability_events
where event_id = '<event_id>'::uuid
  and created_at >= now() - interval '24 hours'
order by created_at desc
limit 50;
```

If the second query is blocked by permissions, use the admin panel, Supabase dashboard, or the documented service-role operator process. Do not weaken RLS for QA.

## Native Device Smoke Checklist

- [ ] Install/open the current native preview or production candidate build.
- [ ] Confirm the build points at the same environment as the web/admin check.
- [ ] Sign in as User A or User B.
- [ ] Enter the seeded event lobby.
- [ ] Confirm Ready Gate routing and countdown match web behavior.
- [ ] Join Daily room and verify camera/mic behavior.
- [ ] Complete date end and survey continuity.
- [ ] Background/foreground during lobby or Ready Gate and confirm state recovers.

Optional existing command:

```bash
cd apps/mobile
MAESTRO_RUN=1 npm run rc-smoke
```

This only proves the existing native smoke path. It does not replace the two-user video-date flow.

## Cleanup Guidance

Use cleanup only after recording QA results.

Read-only stale-session candidate query:

```sql
-- read-only: stale active sessions for the test event that may need reviewed cleanup
select
  vs.id,
  vs.event_id,
  vs.participant_1_id,
  vs.participant_2_id,
  vs.state,
  vs.phase,
  vs.ready_gate_status,
  vs.ready_gate_expires_at,
  vs.date_started_at,
  vs.ended_at,
  vs.created_at
from public.video_sessions vs
where vs.event_id = '<event_id>'::uuid
  and vs.ended_at is null
  and vs.created_at < now() - interval '30 minutes'
order by vs.created_at asc;
```

Read-only registration pointer query:

```sql
-- read-only: registrations still pointing at ended or stale sessions
select
  er.event_id,
  er.profile_id,
  er.queue_status,
  er.current_room_id,
  vs.state,
  vs.phase,
  vs.ended_at,
  vs.ended_reason
from public.event_registrations er
left join public.video_sessions vs on vs.id = er.current_room_id
where er.event_id = '<event_id>'::uuid
  and er.profile_id in ('<user_a_id>'::uuid, '<user_b_id>'::uuid)
order by er.profile_id;
```

Cleanup/manual-review-required:

- [ ] Prefer existing backend expiry/cleanup paths over direct SQL.
- [ ] If direct cleanup is required in production, create a reviewed SQL note with exact row IDs and expected state transitions.
- [ ] Do not clear `current_room_id`, end sessions, or modify event status casually.
- [ ] Do not delete smoke users or shared smoke accounts unless the owner explicitly approves.
- [ ] After cleanup, rerun the read-only registration and session queries.

## Sign-Off Template

```text
Environment:
Date/time:
Operator:
Admin Video Date Ops: PASS / FAIL / SKIP
Non-admin 403: PASS / FAIL / SKIP
Two-user simultaneous swipe: PASS / FAIL / SKIP
Ready Gate countdown/reconnect: PASS / FAIL / SKIP
Daily media join: PASS / FAIL / SKIP
Post-date survey continuity: PASS / FAIL / SKIP
Native device path: PASS / FAIL / SKIP
Cleanup needed: NO / YES
Follow-up issue/PR:
Notes:
```

## What Remains Manual

- Account credentials and bearer token collection.
- Creating or selecting the seeded event.
- Timing the simultaneous swipe.
- Daily media/device permission behavior.
- Native device installation and foreground/background checks.
- Admin metric interpretation and PostHog/Supabase cross-checks.
