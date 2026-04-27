# Video Date Hardening Closure Report

Date: 2026-04-27

## Executive verdict

Video Date hardening Sprints A-F are complete, merged to `main`, and deployed for the web/backend production path.

Final recommendation: production-ready for the web/backend Video Date flow, with native binary distribution still requiring the normal external release confirmation if a fresh iOS/Android build has not already been cut and installed by testers.

Evidence from the closure pass:

- Local `main`: `bae2ba050 fix(video-date): automate pending verdict reminders`
- Remote DB dry-run: `Remote database is up to date.`
- Vercel status for Sprint F merge commit: success
- Pending-verdict cron: active pg_cron job with recent pg_net `200` responses
- Relevant Edge Functions: deployed and active

## Sprints A-F summary

| Sprint | PR | Merge commit | Scope |
| --- | --- | --- | --- |
| A | #544 | `69c29c3fba79dbcec808b66770a63e3c5c384a2e` | Provider-atomic Daily entry, route gating, Daily error classification, active-session indexing, safe room cleanup |
| B | #545 | `88ef7ca0c42053f61c58013ea80009d4e5040a31` | Backend session-state ownership, `video_sessions` write lockdown, `update_participant_status` narrowing |
| C | #546 | `510a89b3e2e2646a81202376c6b7383e88355c6b` | Reconnect UX, survey retry/failure UX, authenticated unload leave signaling |
| D | #547 | `20a5d9f174aba539627a4d21a06337aceea7f04c` | Native AppState background policy, half-verdict pending state, notification deep-link fail-closed routing |
| E | #548 | `1c3e282ec086a359b575e75fa9baffd2901b8796` | Camera/mic denial UX, playback blocked CTA, no-remote UX, observability |
| F | #549 | `bae2ba050ea25e630b461bb675dfe083d43ee225` | Pending-verdict reminder automation, stale pending verdict marking, notification safety |

## Exact landed scope

- Provider-atomic Daily entry.
- Route gating on provider-prepared truth.
- Daily 401/403, 429, 4xx, and 5xx error classification.
- Active-session lookup indexes for `video_sessions`.
- Safe video-date room cleanup that defers when Daily active-participant checks are active or inconclusive.
- Direct client write lockdown for `video_sessions`.
- `update_participant_status` narrowed so clients cannot set `in_handshake` or `in_date`.
- Web reconnect grace UX for remote disconnects.
- Web/native Post-Date Survey retry and visible failure handling.
- Web unload/pagehide leave signaling without client-side Daily room deletion.
- Native AppState background grace, recovery, and expiry policy.
- Half-verdict pending state and honest saved/waiting UX.
- Notification deep-link routing that fails closed through provider-prepared route truth.
- Web camera/mic denial UX with retry.
- Playback/autoplay blocked recovery CTA.
- Waiting-peer/no-remote UX clarity and observability.
- Pending-partner verdict reminder automation.
- Stale pending verdict marking after the configured stale window.
- Reported/blocked pair suppression for reminders and mutual match creation.

## Migrations applied

The closure pass confirmed these migration versions exist in the remote Supabase migration table:

- `20260501102000_video_sessions_active_lookup_indexes`
- `20260501110000_video_date_provider_atomic_entry`
- `20260501112000_video_sessions_rls_write_lockdown`
- `20260501113000_post_date_pending_verdict_observability`
- `20260501114000_post_date_pending_verdict_reminders`

Final DB check:

```bash
supabase db push --linked --dry-run
```

Result:

```text
Remote database is up to date.
```

## Edge Functions deployed

Relevant Video Date functions are deployed and active on project `schdyxcunwcvddlcshwd`:

| Function | Version | Updated at |
| --- | ---: | --- |
| `daily-room` | 520 | 2026-04-27 16:56:51 |
| `video-date-room-cleanup` | 124 | 2026-04-27 16:56:58 |
| `send-notification` | 481 | 2026-04-27 19:36:53 |
| `post-date-verdict-reminders` | 1 | 2026-04-27 19:37:02 |

## Web deploy status

Vercel reported success for Sprint F merge commit `bae2ba050ea25e630b461bb675dfe083d43ee225`.

Status evidence:

- Context: `Vercel`
- State: `success`
- Description: `Deployment has completed`
- Deployment URL: `https://vercel.com/okp805/vibelymeet/GHGxNTiP32R6GNjjgHRwXg1RURrX`

## Native release status

Native source changes are merged to `main`.

This closure pass did not verify App Store, TestFlight, Play Store, EAS, or physical-device binary distribution. If a fresh native build containing Sprints C/D has not already been released to testers, mixed web/native QA and production native usage should use a newly cut build.

Native items requiring fresh binary distribution if not already released:

- Native Post-Date Survey retry and visible failure CTA.
- Native AppState background grace/recovery/expiry policy.
- Native pending-verdict UX and notification deep-link fail-closed behavior.

## QA status

User context for this closure sprint states that Sprints A-F are complete and QA accepted.

This document records release-state and deployment evidence. It does not replace physical-device QA evidence for native binaries or browser-specific media/autoplay behavior.

## Final known open risks

- Native binary release status was not independently verified in this closure pass.
- Browser permission and autoplay behavior remain browser-specific and should stay in manual regression QA.
- Analytics dashboards may need wiring or saved views for the new Video Date event names.
- Reminder copy and timing may need future product tuning after observing real-world response rates.
- Long-term native audio-session work remains deferred. Do not introduce `expo-av` as part of that future work unless the native media architecture is deliberately revisited.
- Manual QA caveats remain for rare network, backgrounding, and permission-denial combinations on physical iOS/Android devices.

## Deferred future polish

- Dashboard views for pending-verdict reminder outcomes, stale pending verdicts, provider failures, and no-remote recovery.
- Product tuning for reminder cadence and notification copy.
- Longer-term native media/audio-session policy work.
- Browser-specific help text refinements for camera/mic permission recovery.
- Additional end-to-end automated browser/device tests for Daily join and media playback.

## Rollback notes

Prefer forward migrations and targeted function/web rollbacks. Do not edit old migrations in place.

High-level rollback map:

- Provider entry regressions: roll forward around `daily-room`, `confirm_video_date_entry_prepared`, and provider-prepared route truth. Avoid restoring client-owned routeability.
- RLS/session ownership regressions: roll forward with explicit grants/policies. Do not reintroduce broad authenticated DML on `video_sessions`.
- Survey/outcome regressions: keep `date_feedback` as canonical verdict truth; repair pending rows rather than deleting verdict data.
- Reminder automation regressions: disable the pg_cron job first, then adjust `post-date-verdict-reminders` or `send-notification`.

Disable pending-verdict reminder cron if needed:

```sql
select cron.unschedule(jobid)
from cron.job
where jobname = 'post-date-verdict-reminders';
```

## Operator runbook: pending-verdict reminder cron

Purpose: send one neutral reminder to the missing partner when exactly one post-date verdict is pending, and mark long-pending rows stale.

Runtime pieces:

- Table: `public.post_date_pending_verdicts`
- Function: `post-date-verdict-reminders`
- Notification function: `send-notification`
- Schedule: `post-date-verdict-reminders`, `*/5 * * * *`
- Auth: Edge Function has `verify_jwt=false` and is internally protected by `CRON_SECRET`
- DB scheduler secret source: Vault secret named `cron_secret`

Verify cron exists:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'post-date-verdict-reminders';
```

Verify recent scheduler runs:

```sql
select runid, status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (
  select jobid
  from cron.job
  where jobname = 'post-date-verdict-reminders'
)
order by start_time desc
limit 5;
```

Verify recent HTTP delivery from pg_net:

```sql
select id, status_code, timed_out, nullif(error_msg, '') is not null as has_error, created
from net._http_response
order by created desc
limit 10;
```

Expected healthy state:

- `cron.job.active = true`
- Recent `cron.job_run_details.status = succeeded`
- Recent `net._http_response.status_code = 200`
- `timed_out = false`
- `has_error = false`

If scheduler HTTP responses are `401`:

1. Confirm the Edge Function secret `CRON_SECRET` exists.
2. Confirm Vault secret `cron_secret` exists and has a value.
3. Align Vault `cron_secret` to the same value expected by the Edge Function.
4. Wait for the next five-minute scheduler tick.
5. Re-check `cron.job_run_details` and `net._http_response`.

Do not print secret values in logs, tickets, docs, or chat.

## Manual verification commands

Release state:

```bash
git checkout main
git pull --ff-only origin main
git status --short
git log -1 --oneline
supabase db push --linked --dry-run
```

Project and migrations:

```bash
grep -n "project_id" supabase/config.toml
supabase migration list --linked
supabase db query --linked --output table \
  "select version from supabase_migrations.schema_migrations
   where version in ('20260501102000','20260501110000','20260501112000','20260501113000','20260501114000')
   order by version;"
```

Functions:

```bash
supabase functions list --project-ref schdyxcunwcvddlcshwd \
  | rg 'daily-room|video-date-room-cleanup|send-notification|post-date-verdict-reminders'
```

Vercel merge commit status:

```bash
gh api repos/kaanporsuk/vibelymeet/commits/bae2ba050ea25e630b461bb675dfe083d43ee225/status \
  --jq '{state: .state, statuses: [.statuses[] | {context, state, description, target_url, updated_at}]}'
```

Cron and pg_net:

```bash
supabase db query --linked --output table \
  "select jobid, jobname, schedule, active
   from cron.job
   where jobname = 'post-date-verdict-reminders';"

supabase db query --linked --output table \
  "select runid, status, return_message, start_time, end_time
   from cron.job_run_details
   where jobid = (select jobid from cron.job where jobname = 'post-date-verdict-reminders')
   order by start_time desc
   limit 5;"

supabase db query --linked --output table \
  "select id, status_code, timed_out, nullif(error_msg, '') is not null as has_error, created
   from net._http_response
   order by created desc
   limit 10;"
```

No command in this report requires `db reset`, non-dry-run `db push`, or function deployment.
