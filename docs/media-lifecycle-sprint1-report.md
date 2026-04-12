# Media Lifecycle — Sprint 1 Report

**Correction pass applied:** 2026-04-12

## Summary

Sprint 1 establishes the canonical media lifecycle foundation for Vibely.
No existing user-facing behavior was changed. New tables, RPCs, helpers,
and a worker function were added to support future media cleanup across
all provider surfaces (Bunny Stream, Bunny Storage, Supabase Storage).

## Migration

**File:** `supabase/migrations/20260417100000_media_lifecycle_foundation.sql`

### Tables Created

| Table | Purpose |
|---|---|
| `media_retention_settings` | Admin-configurable per-family retention policy (PK: media_family) |
| `media_assets` | One row per physical file/stream object across all providers |
| `media_references` | Links physical assets to product entities; tracks active/released state |
| `media_delete_jobs` | Deletion work queue with retry, backoff support |


### RPCs Created

| RPC | Caller | Purpose |
|---|---|---|
| `enqueue_media_delete` | service_role | Queue a purge job for an asset |
| `release_media_reference` | service_role | Release a reference; auto-transitions asset to soft_deleted when last ref released |
| `claim_media_delete_jobs` | service_role | Worker claims a batch of pending jobs (SKIP LOCKED) |
| `complete_media_delete_job` | service_role | Worker reports job result; updates asset status |
| `promote_purgeable_assets` | service_role | Moves soft_deleted assets past their purge_after to purge_ready + enqueues jobs |

### Dry-run Limitations

- The `process-media-delete-jobs` function supports a `dry_run` mode for safe previewing.
- **Dry-run only previews existing `pending` or `failed` jobs.**
- It does **not** simulate or preview the effect of `promote_purgeable_assets` (i.e., assets that would become eligible for deletion after promotion are not included).
- No jobs are claimed, mutated, or status-changed in dry-run mode. The output includes a `preview_count` of jobs that would be processed if run for real.

### Retention Defaults Seeded

| media_family | retention_mode | retention_days | eligible_days | worker_enabled | notes |
|---|---|---|---|---|---|
| vibe_video | soft_delete | 30 | — | true | 30d soft delete after removal |
| profile_photo | soft_delete | 30 | — | true | 30d soft delete after removal |
| event_cover | soft_delete | 90 | — | true | 90d soft delete after replacement |
| chat_image | retain_until_eligible | — | — | true | FOUNDATION ONLY — no auto-purge until Sprint 3 |
| chat_video | retain_until_eligible | — | — | true | FOUNDATION ONLY — no auto-purge until Sprint 3 |
| voice_message | retain_until_eligible | — | — | true | FOUNDATION ONLY — no auto-purge until Sprint 3 |
| chat_video_thumbnail | retain_until_eligible | — | — | true | FOUNDATION ONLY — follows chat_video, Sprint 3 |
| verification_selfie | soft_delete | 180 | — | **false** | PROVISIONAL — worker disabled until product owner confirms policy |

**Chat media safety:** Chat families use `retain_until_eligible` with `eligible_days = NULL`. This means:
1. `release_media_reference` sets `purge_after = NULL` on these assets
2. `promote_purgeable_assets` requires `purge_after IS NOT NULL`, so chat assets are never promoted
3. No auto-purge can run for any chat media until Sprint 3 implements actual eligibility logic (both sides deleted chat / both accounts deleted / one account deleted + other side deleted chat) AND sets `eligible_days` to a concrete value

**Verification selfie safety:** Row exists for FK validity but `worker_enabled = false` prevents any automated cleanup. Policy remains provisional until product owner confirms retention requirements.

### RLS Policies

- `media_retention_settings`: read by authenticated, full by service_role
- `media_assets`: own-read by owner, full by service_role
- `media_references`: own-read (via asset owner), full by service_role
- `media_delete_jobs`: service_role only

## Edge Function

**File:** `supabase/functions/process-media-delete-jobs/index.ts`

Worker function authenticated by `CRON_SECRET` bearer token.

**Real execution flow:**
1. Calls `promote_purgeable_assets` to seed queue
2. Calls `claim_media_delete_jobs` with SKIP LOCKED
3. For each job: dispatches to correct provider delete via `_shared/bunny-media.ts`
4. Calls `complete_media_delete_job` with result

**Dry-run flow:**
Pure read-only. Zero mutating operations of any kind.
1. SELECT existing pending/failed jobs (no lock, no claim)
2. Log what a real run would process
3. Return preview

Dry-run is an invocation-level decision (`{"dry_run": true}` in request body).
It never calls `promote_purgeable_assets`, `claim_media_delete_jobs`, or `complete_media_delete_job`. No status change, no attempt increment, no asset transition, no job enqueue. The database is left in exactly the state it was found.

**Params:**
- `family` — filter by media family (optional)
- `batch_size` — default 20, max 100
- `dry_run` — true = read-only preview only

**Config:** `[functions.process-media-delete-jobs]` with `verify_jwt = false` in `supabase/config.toml`.

## Shared Helpers

### `_shared/bunny-media.ts`
- `deleteBunnyStreamVideo(videoId)` — idempotent Bunny Stream DELETE
- `deleteBunnyStorageFile(storagePath)` — idempotent Bunny Storage DELETE
- `deleteSupabaseStorageFile(bucket, path)` — idempotent Supabase Storage DELETE
- `deleteMediaAsset(provider, objectId, path)` — dispatcher routing to correct provider
- All return structured `BunnyDeleteResult` with success/httpStatus/alreadyGone/detail/error
- Path traversal (`..`) rejected at helper level

### `_shared/media-lifecycle.ts`
- Typed constants: `PROVIDERS`, `MEDIA_FAMILIES`, `REF_TYPES`, `RELEASE_REASONS`
- `registerMediaAsset()` — insert into media_assets
- `createMediaReference()` — insert into media_references
- `releaseMediaReference()` — calls release_media_reference RPC
- `getAdminClient()` — service-role Supabase client
- Legacy mapping documentation table for backfill strategy

## Env Dependencies

No new env vars required beyond what already exists:
- `CRON_SECRET` (already used by other cron workers)
- `BUNNY_STREAM_LIBRARY_ID`, `BUNNY_STREAM_API_KEY` (already set)
- `BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_API_KEY` (already set)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (always available)

## Files Changed

| File | Action |
|---|---|
| `supabase/migrations/20260417100000_media_lifecycle_foundation.sql` | **NEW** — 4 tables, 5 RPCs, 3 triggers, RLS, seed data |
| `supabase/functions/_shared/bunny-media.ts` | **NEW** — provider deletion helpers |
| `supabase/functions/_shared/media-lifecycle.ts` | **NEW** — lifecycle constants, registration helpers, backfill mapping |
| `supabase/functions/process-media-delete-jobs/index.ts` | **NEW** — deletion worker Edge Function |
| `supabase/config.toml` | **MODIFIED** — added process-media-delete-jobs entry |
| `docs/supabase-live-backend-audit.md` | **MODIFIED** — table count 41→45, RPC list +5 media RPCs |
| `docs/supabase-full-backend-vs-frontend-audit.md` | **MODIFIED** — function count 35→36, function matrix row, cron/server-only flag |
| `docs/supabase-cloud-deploy.md` | **MODIFIED** — added media lifecycle worker deploy/test section |
| `docs/native-backend-contract-matrix.md` | **MODIFIED** — added media lifecycle section, updated EF inventory |
| `docs/chat-video-vibe-clip-architecture.md` | **MODIFIED** — added §7 media retention and cleanup policy |
| `docs/vibe-video-webhook-operator.md` | **MODIFIED** — added future orphan cleanup note |
| `docs/media-lifecycle-sprint1-report.md` | **NEW** — this report |

## Docs/Manifests Updated

| Document | What changed |
|---|---|
| `supabase/config.toml` | Added `[functions.process-media-delete-jobs]` with `verify_jwt = false` |
| `docs/supabase-live-backend-audit.md` | Table count 41 → 45 with 4 new media tables. RPC list updated with 5 new service_role-only media lifecycle RPCs. Annotation added explaining these are foundation tables, not yet replacing legacy columns. |
| `docs/supabase-full-backend-vs-frontend-audit.md` | Function count 35 → 36. Added `process-media-delete-jobs` row to per-function matrix (POST, verify_jwt=false, cron worker, Bunny Stream/Storage). Updated neither-client flag list. |
| `docs/supabase-cloud-deploy.md` | Added "Media lifecycle worker" section: deploy command, manual dry-run test curl, auth pattern (CRON_SECRET), config.toml note, no-new-secrets confirmation. |
| `docs/native-backend-contract-matrix.md` | Added "Media lifecycle (backend-only)" section with 4 tables + 1 EF. Updated Edge Functions inventory list. Annotation: no client changes required. |
| `docs/chat-video-vibe-clip-architecture.md` | Added §7 "Media retention and cleanup": current policy (retain_until_eligible, no auto-purge), purge eligibility rules (Sprint 3), explicit no-purge-until-Sprint-3 statement. |
| `docs/vibe-video-webhook-operator.md` | Updated orphan troubleshooting row: added forward reference to Sprint 2 `media_assets` tracking and `process-media-delete-jobs` worker. |

## Sprint 2 Scope (Disciplined)

Sprint 2 must:
1. **Add multi-vibe-video-capable backend structure** — asset/reference model supports multiple vibe videos per user from day one. Add a `profile_vibe_videos` junction or equivalent if needed for ordering/primary selection.
2. **Keep `profiles.bunny_video_uid` as a compatibility mirror** — current web/native surfaces read this column. Sprint 2 writes to both the new model AND the legacy column. Do not remove or stop writing the legacy column.
3. **Implement profile photo soft-delete/purge_after** — when `publish_photo_set` or `mark_photo_deleted` releases a photo, create asset + reference rows and set `purge_after` per the 30-day retention policy.
4. **NOT collapse chat retention into simple TTL logic** — chat media remains `retain_until_eligible` with no automatic purge. Sprint 3 owns the eligibility logic.
5. **NOT fully rewrite account deletion** — Sprint 2 may add asset registration for new uploads (dual-write) and a basic user-media enumeration helper, but the full account-delete media purge is Sprint 3/4 work.
6. **Schedule cron** for `process-media-delete-jobs` once backfill is verified.

## Risks

- **Zero risk to current behavior**: Sprint 1 adds new tables/functions only; no existing function or RPC was modified
- **Migration ordering**: new migration `20260417100000` must apply after all existing migrations (verified: latest existing is `20260416110000`)
- **FK to auth.users**: `media_assets.owner_user_id` uses `ON DELETE SET NULL` (not CASCADE) so account deletion preserves asset records for cleanup; this is intentional

## Deploy Steps

```bash
# 1. Push migration
npx supabase db push

# 2. Deploy new function
npx supabase functions deploy process-media-delete-jobs --no-verify-jwt

# 3. Verify tables exist
# (via Supabase MCP or SQL editor)
SELECT count(*) FROM media_retention_settings;
SELECT count(*) FROM media_assets;

# 4. Verify retention defaults
SELECT media_family, retention_mode, retention_days, eligible_days, worker_enabled
FROM media_retention_settings ORDER BY media_family;

# 5. Test worker (dry-run, empty queue expected, queue untouched)
curl -X POST "${SUPABASE_URL}/functions/v1/process-media-delete-jobs" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"dry_run": true}'
```

## Rollback

Drop in reverse order if needed (no existing data depends on these tables):
```sql
DROP FUNCTION IF EXISTS public.promote_purgeable_assets;
DROP FUNCTION IF EXISTS public.complete_media_delete_job;
DROP FUNCTION IF EXISTS public.claim_media_delete_jobs;
DROP FUNCTION IF EXISTS public.release_media_reference;
DROP FUNCTION IF EXISTS public.enqueue_media_delete;
DROP TABLE IF EXISTS public.media_delete_jobs;
DROP TABLE IF EXISTS public.media_references;
DROP TABLE IF EXISTS public.media_assets;
DROP TABLE IF EXISTS public.media_retention_settings;
```
