# Media Lifecycle Operations Runbook

Updated: 2026-04-13

This runbook is the Sprint 4 operator guide for Vibely's live media lifecycle system.

It covers:
- live readiness posture before cron activation
- the admin controls added in Sprint 4
- the difference between worker dry-run and operator preview
- the guarded cron enablement recommendation

## Current live readiness snapshot

Linked project: `schdyxcunwcvddlcshwd`

Readiness audit summary from the linked project:
- `media_delete_jobs`: no pending, claimed, failed, or abandoned jobs
- `media_assets`: no orphan-like active assets and no failed purge assets were found in the live audit
- `soft_deleted` assets already past `purge_after`: 6 total
  - `chat_image`: 3
  - `chat_video`: 1
  - `chat_video_thumbnail`: 1
  - `voice_message`: 1
- owned media (`vibe_video`, `profile_photo`) currently has soft-deleted rows, but none were already overdue in this audit
- `verification_selfie` remains seeded but `worker_enabled = false`

Operational interpretation:
- the queue is healthy
- the main activation risk is not job failure; it is accidentally enabling automated deletion without one final monitored real run
- current overdue backlog is limited and concentrated in chat media, which makes a small-batch first run feasible once approved

## Admin controls added in Sprint 4

Sprint 4 adds:
- Edge Function `admin-media-lifecycle-controls`
- Web admin panel `AdminMediaLifecyclePanel`

The admin controls intentionally expose only policy/timing knobs:
- `vibe_video.retention_days`
- `profile_photo.retention_days`
- `event_cover.retention_days`
- `worker_enabled` for operator-controlled families
- one shared chat policy across `chat_image`, `chat_video`, `chat_video_thumbnail`, and `voice_message`
  - `retention_mode`
  - `eligible_days`
  - `worker_enabled`

The admin controls do **not** change the code-owned release semantics:
- chat media is still retained while at least one participant still retains the conversation
- pending account deletion is still only a reversible grace-window hold
- `verification_selfie` remains worker-disabled

## Read-only preview semantics

There are now two different operator previews:

1. `process-media-delete-jobs` dry-run
- auth: `CRON_SECRET`
- behavior: previews only already-queued `pending` / `failed` jobs
- does **not** simulate `promote_purgeable_assets`
- does **not** mutate queue or asset state

2. `admin-media-lifecycle-controls` readiness preview
- auth: admin JWT
- behavior: read-only operator snapshot that combines:
  - already-queued jobs that are ready now
  - soft-deleted assets that a real worker run would promote first
- does **not** mutate queue or asset state

Use the admin preview for activation planning.
Use the worker dry-run for exact queue-preview behavior with the live worker.

## Recommended initial worker settings

Current recommendation: **do not enable cron yet.**

Before the first scheduled run:
1. Run one manual monitored live execution of `process-media-delete-jobs`
2. Observe:
   - provider delete success rate
   - `media_delete_jobs` completion/failure behavior
   - `media_assets` transitions to `purged`
   - Bunny/Supabase provider-side confirmation for a small sample
3. Only then consider scheduling cron

If/when cron is enabled, start with:
- cadence: every 15 minutes
- batch size: 10
- family filter: none
- retry behavior: existing DB-owned exponential backoff (`1m`, `5m`, `25m`, `2h`, `10h`) with per-family `max_attempts` defaults

Rationale:
- low backlog
- no failed jobs
- no orphan-like active assets found in the live audit
- but no post-Sprint-3 production delete run has yet been blessed as the final operator proof

## Rollback procedure

If the first live execution or early cron runs show unexpected behavior:
1. disable the scheduler / remove the cron job
2. set `worker_enabled = false` for the affected families in the admin panel
3. inspect `media_delete_jobs` and `media_assets.last_error`
4. verify provider-side object state before resuming

## Deploy notes

Sprint 4 adds one new admin-only Edge Function:

```bash
supabase functions deploy admin-media-lifecycle-controls --project-ref schdyxcunwcvddlcshwd
```

Cron remains intentionally disabled after Sprint 4.
