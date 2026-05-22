# Supabase cloud — verify & deploy (MVP_Vibe / `schdyxcunwcvddlcshwd`)

This repo targets **one** production Supabase project. Always confirm before pushing.

## Expected project

| Field | Value |
|-------|--------|
| **Reference ID** | `schdyxcunwcvddlcshwd` |
| **Dashboard name** | MVP_Vibe |
| **URL** | `https://schdyxcunwcvddlcshwd.supabase.co` |

Source of truth in repo: `supabase/config.toml` → `project_id`.

## Prerequisites

1. [Supabase CLI](https://supabase.com/docs/guides/cli) installed (`supabase --version`).
2. Logged in: `supabase login` (opens browser).
3. This directory linked: from repo root, `supabase link --project-ref schdyxcunwcvddlcshwd` (if `supabase/config.toml` ever drifts).

## Verify connection (read-only)

```bash
cd /path/to/vibelymeet

# Must show ● on schdyxcunwcvddlcshwd
supabase projects list

# Local vs remote migrations (columns should match line-by-line)
supabase migration list --linked

# Remote DB already has all migrations?
supabase db push --linked
# → "Remote database is up to date." when nothing pending

# Deployed Edge Functions on cloud
supabase functions list --project-ref schdyxcunwcvddlcshwd
```

## Deploy database changes

After adding a file under `supabase/migrations/`:

```bash
supabase db push --linked
```

Review SQL in PRs first; this applies pending migrations to **linked** cloud only.

Phase 2 live-loop observability (`20260423120000_event_loop_observability.sql`) adds table `event_loop_observability_events` and replaces several RPC bodies — **no Edge deploy or new secrets**. Query telemetry with the **service role** in SQL editor or a backend job; the table has RLS with no `authenticated` policy.

Phase 3 (`20260424120000_event_loop_read_model_views.sql`) adds **views only** (`v_event_loop_*`) for hourly rollups and filtered rows — same service-role access pattern; **no** write-path or Edge changes.

Phase 3b (`20260430123100_event_loop_operator_normalized_read_models.sql`) adds **`v_event_loop_mark_lobby_promotion_normalized`**, **`v_event_loop_observability_metric_streams`**, and COMMENT clarifications on hourly rollups — **additive views/comments only**. See **`docs/observability/event-loop-dashboard-normalization.md`** before mixing promote + drain aggregates.

Phase 3c (`20260425120000_event_loop_observability_retention_prune.sql`) adds **`prune_event_loop_observability_events`** — batched `DELETE` for rows older than **30 days** (defaults; tunable). **No Edge deploy or new secrets.** Apply migration with `supabase db push --linked`.

**Scheduling (production):** enable **`pg_cron`** on the project and run `SELECT public.prune_event_loop_observability_events();` on a **daily** (or hourly if catching up) schedule, **or** invoke the same SQL from an external trusted runner. Repeat until `has_more_to_prune` is `false` after major backlog. See `_cursor_context/event_loop_observability_retention_policy.md` (Phase 3c section).

## Deploy Edge Functions

**One function** (typical after code change):

```bash
supabase functions deploy <function-name> --project-ref schdyxcunwcvddlcshwd
```

**All functions** (e.g. after shared `_shared` change or major release):

```bash
./scripts/deploy-supabase-cloud.sh --functions-only
# or full: DB push + all functions
./scripts/deploy-supabase-cloud.sh
```

Secrets (Stripe, Twilio, etc.) are **not** in git — set in Dashboard → Edge Functions → Secrets or `supabase secrets set --project-ref schdyxcunwcvddlcshwd KEY=value`.

### Daily video-date webhook secret

`video-date-daily-webhook` is a provider-public endpoint (`verify_jwt = false`) that verifies Daily's `X-Webhook-Signature` and `X-Webhook-Timestamp` inside the function. The required secret is:

- `DAILY_WEBHOOK_SECRET`: Daily webhook `hmac` exactly as returned by Daily; it is base64 encoded and the function decodes it before signing `timestamp + "." + rawBody`.

Safe set pattern that avoids shell history/log exposure:

```bash
read -rsp "Daily webhook hmac (base64): " DAILY_WEBHOOK_SECRET; printf "\n"
tmp="$(mktemp)"; chmod 600 "$tmp"
printf 'DAILY_WEBHOOK_SECRET=%s\n' "$DAILY_WEBHOOK_SECRET" > "$tmp"
supabase secrets set --env-file "$tmp" --project-ref schdyxcunwcvddlcshwd
rm -f "$tmp"; unset DAILY_WEBHOOK_SECRET
```

Daily provider registration must target `https://schdyxcunwcvddlcshwd.supabase.co/functions/v1/video-date-daily-webhook` and subscribe to `participant.joined` / `participant.left`. After the secret is set, unsigned probes should return `401 timestamp_missing` or `401 signature_invalid`, not `webhook_secret_missing`.

## Agent / MCP

If **user-supabase** MCP or any authenticated Supabase agent tooling is enabled, tools such as `list_migrations`, `list_tables`, `execute_sql`, `apply_migration`, and `deploy_edge_function` can read or change the project **that tool is authenticated to**. Confirm the authenticated project points at **`schdyxcunwcvddlcshwd`** so agent actions match this CLI-linked project.

## Media lifecycle worker

The `process-media-delete-jobs` function drains the `media_delete_jobs` queue.
Auth: `CRON_SECRET` bearer token (same as `generate-daily-drops` and other cron workers).

Sprint 4 adds an admin-only operator function:

```bash
supabase functions deploy admin-media-lifecycle-controls --project-ref schdyxcunwcvddlcshwd
```

Use the admin panel / `admin-media-lifecycle-controls` for read-only readiness previews and retention-setting updates.
Use `process-media-delete-jobs` dry-run for exact queue preview behavior.
Cron is enabled: `media-delete-worker-every-15m` (jobid 18, `*/15 * * * *`, batch_size 200). See `docs/media-lifecycle-operations-runbook.md` for rollback procedure.

```bash
# Deploy
supabase functions deploy process-media-delete-jobs --project-ref schdyxcunwcvddlcshwd

# Manual test (dry-run, reads queue without consuming)
curl -X POST "${SUPABASE_URL}/functions/v1/process-media-delete-jobs" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"dry_run": true}'
```

No new secrets required — uses existing `CRON_SECRET`, `BUNNY_STREAM_*`, `BUNNY_STORAGE_*`.

**Config:** `verify_jwt = false` in `supabase/config.toml` (CRON_SECRET bearer auth, same pattern as other cron workers).

## Safety checklist

- [ ] `supabase projects list` shows linked ref = `schdyxcunwcvddlcshwd`
- [ ] No accidental `supabase link` to another ref (e.g. `wvxzjnfzczepmnlaitdg`)
- [ ] Migrations reviewed before `db push`
- [ ] Function deploys don’t remove required secrets
