/**
 * process-media-delete-jobs
 *
 * Worker Edge Function that drains the media_delete_jobs queue.
 *
 * Real execution flow:
 *   1. cold-tier active hot Bunny Storage assets that have gone cold
 *   2. enqueue_uploaded_media_orphan_deletes — sweep old uploaded/no-ref assets
 *   3. promote_purgeable_assets — move expired soft_deleted → purge_ready + enqueue
 *   4. claim_media_delete_jobs — SKIP LOCKED batch claim
 *   5. For each job: call provider delete via _shared/bunny-media.ts
 *   6. complete_media_delete_job — record result (success/fail)
 *
 * Dry-run flow ({"dry_run": true}):
 *   Pure read-only.  Zero mutating operations of any kind.
 *   1. Preview pending/failed jobs, promotable soft-deletes, and uploaded orphans
 *   2. Log what a real run would process or enqueue
 *   3. Return preview
 *   No promote, no claim, no complete, no status change, no attempt increment.
 *
 * Auth: CRON_SECRET bearer token (same pattern as other cron workers).
 * Invocation: pg_cron HTTP POST or manual curl.
 *
 * Env required:
 *   CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   BUNNY_STREAM_LIBRARY_ID, BUNNY_STREAM_API_KEY,
 *   BUNNY_STORAGE_ZONE, BUNNY_STORAGE_API_KEY
 *
 * Optional for cold tiering:
 *   BUNNY_ARCHIVE_STORAGE_ZONE, BUNNY_ARCHIVE_STORAGE_API_KEY
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  archiveBunnyStorageFile,
  deleteBunnyStorageFile,
  deleteMediaAsset,
  type BunnyStorageZoneTier,
} from "../_shared/bunny-media.ts";
import { captureMediaTelemetry } from "../_shared/media-telemetry.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function mediaTelemetryErrorCode(detail: string | null | undefined): string {
  const value = detail?.toLowerCase() ?? "";
  if (value.includes("invalid_storage_path")) return "invalid_storage_path";
  if (value.includes("config")) return "provider_config_error";
  if (value.includes("network")) return "provider_network_error";
  if (value.includes("timeout")) return "provider_timeout";
  if (value.includes("archive_upload_failed")) return "archive_upload_failed";
  if (value.includes("hot_fetch_failed")) return "hot_fetch_failed";
  if (value.includes("failed")) return "provider_operation_failed";
  return "media_operation_failed";
}

interface JobRow {
  id: string;
  asset_id: string;
  provider: string;
  job_type: string;
  provider_object_id: string | null;
  provider_path: string | null;
  attempts: number;
  max_attempts: number;
}

interface MediaAssetStorageTierRow {
  storage_zone?: string | null;
}

interface ColdTierCandidateRow {
  id: string;
  media_family: string | null;
  provider: string | null;
  provider_path: string | null;
  storage_zone: string | null;
  last_accessed_at: string | null;
  created_at: string | null;
}

interface UploadedOrphanRow {
  asset_id: string;
  media_family: string;
  provider: string;
  provider_object_id: string | null;
  provider_path: string | null;
  job_id: string | null;
}

interface WorkerStats {
  uploadedOrphans: number;
  promoted: number;
  claimed: number;
  completed: number;
  failed: number;
  skipped: number;
  archived: number;
  archiveFailed: number;
  errors: string[];
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // ── Auth ───────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") || "";
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  // ── Optional body params ───────────────────────────────────────────────────
  let familyFilter: string | null = null;
  let batchSize = 20;
  let isDryRun = false;
  try {
    const body = await req.json();
    if (body?.family) familyFilter = String(body.family);
    if (body?.batch_size && Number.isFinite(body.batch_size)) {
      batchSize = Math.min(Math.max(1, body.batch_size), 200);
    }
    if (body?.dry_run === true) isDryRun = true;
  } catch {
    // No body or invalid JSON — defaults apply
  }

  const workerId = `worker-${crypto.randomUUID().slice(0, 8)}-${Date.now()}`;
  const stats: WorkerStats = {
    uploadedOrphans: 0,
    promoted: 0,
    claimed: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    archived: 0,
    archiveFailed: 0,
    errors: [],
  };

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const archiveZoneConfigured = Boolean(
      Deno.env.get("BUNNY_ARCHIVE_STORAGE_ZONE")?.trim() ||
        Deno.env.get("BUNNY_STORAGE_ARCHIVE_ZONE")?.trim(),
    );
    const archiveKeyConfigured = Boolean(
      Deno.env.get("BUNNY_ARCHIVE_STORAGE_API_KEY")?.trim() ||
        Deno.env.get("BUNNY_STORAGE_ARCHIVE_API_KEY")?.trim(),
    );
    if (archiveZoneConfigured !== archiveKeyConfigured) {
      const missing = archiveZoneConfigured ? "archive API key" : "archive storage zone";
      const message = `cold-tier skipped: missing ${missing}`;
      console.error(`[${workerId}] ${message}`);
      stats.errors.push(message);
    }
    const archiveConfigured = archiveZoneConfigured && archiveKeyConfigured;
    const coldAccessCutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const coldCreatedCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    // ── Dry-run path: pure read-only preview ────────────────────────────────
    // Dry-run executes ZERO mutating operations.  No promote, no claim, no
    // complete, no status change, no attempt increment.  It reads claimable
    // jobs plus promotion/orphan/cold-tier candidates and reports what a real
    // run would process or enqueue.
    if (isDryRun) {
      console.log(
        `[${workerId}] DRY_RUN preview family=${familyFilter ?? "all"} batch=${batchSize}`,
      );

      const { data: preview, error: previewError } = await supabase.rpc(
        "preview_media_delete_worker_run",
        { p_limit: batchSize, p_family_filter: familyFilter },
      );

      if (previewError) {
        console.error(`[${workerId}] dry-run preview error:`, previewError.message);
        return json({ success: false, error: "Dry-run preview failed", detail: previewError.message, stats }, 500);
      }

      const previewRecord = (preview ?? {}) as Record<string, unknown>;
      const preview_count = typeof previewRecord.preview_count === "number" ? previewRecord.preview_count : 0;
      let coldTierPreview: ColdTierCandidateRow[] = [];
      if (archiveConfigured) {
        let coldPreviewQuery = supabase
          .from("media_assets")
          .select("id, media_family, provider, provider_path, storage_zone, last_accessed_at, created_at")
          .eq("status", "active")
          .eq("provider", "bunny_storage")
          .eq("storage_zone", "hot")
          .lt("created_at", coldCreatedCutoff)
          .or(`last_accessed_at.is.null,last_accessed_at.lt.${coldAccessCutoff}`)
          .order("last_accessed_at", { ascending: true, nullsFirst: true })
          .limit(Math.min(Math.max(1, batchSize), 100));
        if (familyFilter) coldPreviewQuery = coldPreviewQuery.eq("media_family", familyFilter);
        const { data: coldPreviewRows, error: coldPreviewError } = await coldPreviewQuery;
        if (coldPreviewError) {
          stats.errors.push(`cold-tier dry-run select: ${coldPreviewError.message}`);
        } else {
          coldTierPreview = (coldPreviewRows ?? []) as ColdTierCandidateRow[];
        }
      }

      console.log(`[${workerId}] dry-run complete, ${preview_count} rows previewed, zero mutations`);
      return json({
        success: true,
        dry_run: true,
        message: "Dry-run preview only — zero mutations performed.",
        worker_id: workerId,
        preview_count,
        cold_tier_preview_count: coldTierPreview.length,
        cold_tier_preview: coldTierPreview,
        preview,
        stats,
      });
    }

    // ── Step 1: Cold-tier eligible active hot Bunny Storage assets ─────────
    // Assets become archive candidates only after they are both old enough and
    // unused recently. URL issuance updates last_accessed_at.
    if (archiveConfigured) {
      let coldQuery = supabase
        .from("media_assets")
        .select("id, media_family, provider, provider_path, storage_zone, last_accessed_at, created_at")
        .eq("status", "active")
        .eq("provider", "bunny_storage")
        .eq("storage_zone", "hot")
        .lt("created_at", coldCreatedCutoff)
        .or(`last_accessed_at.is.null,last_accessed_at.lt.${coldAccessCutoff}`)
        .order("last_accessed_at", { ascending: true, nullsFirst: true })
        .limit(Math.min(Math.max(1, batchSize), 100));
      if (familyFilter) coldQuery = coldQuery.eq("media_family", familyFilter);

      const { data: coldRows, error: coldError } = await coldQuery;
      if (coldError) {
        console.error(`[${workerId}] cold-tier select error:`, coldError.message);
        stats.errors.push(`cold-tier select: ${coldError.message}`);
      } else {
        for (const row of (coldRows ?? []) as ColdTierCandidateRow[]) {
          if (!row.provider_path) {
            stats.archiveFailed++;
            stats.errors.push(`cold-tier ${row.id}: missing_provider_path`);
            continue;
          }
          const result = await archiveBunnyStorageFile(row.provider_path);
          if (!result.success) {
            stats.archiveFailed++;
            const detail = result.error ?? result.detail;
            await supabase
              .from("media_assets")
              .update({ archive_error: detail.slice(0, 500) })
              .eq("id", row.id)
              .eq("storage_zone", "hot");
            void captureMediaTelemetry({
              event: "media_archive_failed",
              distinct_id: row.id,
              properties: {
                worker_id: workerId,
                asset_present: true,
                media_family: row.media_family,
                provider: row.provider,
                error_code: mediaTelemetryErrorCode(detail),
              },
            });
            continue;
          }

          const { data: updatedArchiveRow, error: updateArchiveError } = await supabase
            .from("media_assets")
            .update({
              storage_zone: "archive",
              archived_at: new Date().toISOString(),
              archive_error: null,
            })
            .eq("id", row.id)
            .eq("storage_zone", "hot")
            .select("id")
            .maybeSingle();
          if (updateArchiveError || !updatedArchiveRow) {
            stats.archiveFailed++;
            const detail = updateArchiveError?.message ?? "row_not_updated";
            stats.errors.push(`cold-tier update ${row.id}: ${detail}`);
            continue;
          }

          stats.archived++;
          const hotDeleteResult = await deleteBunnyStorageFile(row.provider_path, "hot");
          if (!hotDeleteResult.success) {
            const detail = hotDeleteResult.error ?? hotDeleteResult.detail;
            stats.errors.push(`cold-tier hot cleanup ${row.id}: ${detail}`);
            void captureMediaTelemetry({
              event: "media_archive_hot_delete_failed",
              distinct_id: row.id,
              properties: {
                worker_id: workerId,
                asset_present: true,
                media_family: row.media_family,
                provider: row.provider,
                error_code: mediaTelemetryErrorCode(detail),
              },
            });
          }
          void captureMediaTelemetry({
            event: "media_archived_to_cold_storage",
            distinct_id: row.id,
            properties: {
              worker_id: workerId,
              asset_present: true,
              media_family: row.media_family,
              provider: row.provider,
              last_accessed_at: row.last_accessed_at,
              created_at: row.created_at,
            },
          });
        }
      }
    }

    console.log(
      `[${workerId}] archived=${stats.archived} archive_failed=${stats.archiveFailed} ` +
        `family=${familyFilter ?? "all"} batch=${batchSize}`,
    );

    // ── Step 2a: Enqueue uploaded-but-unattached orphan assets ──────────────
    // Chat uploads that never publish are swept after 24h; profile/event draft
    // uploads after 7d. The SQL helper owns the family thresholds.
    const { data: orphanRowsResult, error: orphanError } = await supabase.rpc(
      "enqueue_uploaded_media_orphan_delete_rows",
      { p_limit: batchSize * 2, p_family_filter: familyFilter },
    );

    if (orphanError) {
      console.error(`[${workerId}] enqueue_uploaded_media_orphan_delete_rows error:`, orphanError.message);
      stats.errors.push(`uploaded_orphans: ${orphanError.message}`);
    } else {
      const orphanRows = (orphanRowsResult ?? []) as UploadedOrphanRow[];
      stats.uploadedOrphans = orphanRows.length;
      for (const row of orphanRows) {
        void captureMediaTelemetry({
          event: "media_uploaded_orphan_delete_enqueued",
          distinct_id: row.asset_id,
          properties: {
            worker_id: workerId,
            asset_present: true,
            media_family: row.media_family,
            provider: row.provider,
            provider_path_present: Boolean(row.provider_path),
            provider_object_present: Boolean(row.provider_object_id),
            job_present: Boolean(row.job_id),
          },
        });
      }
    }

    console.log(
      `[${workerId}] uploaded_orphans=${stats.uploadedOrphans} family=${familyFilter ?? "all"} batch=${batchSize}`,
    );

    // ── Step 2b: Promote purgeable soft-deleted assets (real execution only) ─
    const { data: promoteResult, error: promoteError } = await supabase.rpc(
      "promote_purgeable_assets",
      { p_limit: batchSize * 2, p_family_filter: familyFilter },
    );

    if (promoteError) {
      console.error(`[${workerId}] promote_purgeable_assets error:`, promoteError.message);
      stats.errors.push(`promote: ${promoteError.message}`);
    } else {
      stats.promoted = typeof promoteResult === "number" ? promoteResult : 0;
    }

    console.log(
      `[${workerId}] promoted=${stats.promoted} family=${familyFilter ?? "all"} batch=${batchSize}`,
    );

    // ── Step 3: Claim jobs ───────────────────────────────────────────────────
    const { data: jobs, error: claimError } = await supabase.rpc(
      "claim_media_delete_jobs",
      {
        p_worker_id: workerId,
        p_batch_size: batchSize,
        p_family_filter: familyFilter,
      },
    );

    if (claimError) {
      console.error(`[${workerId}] claim_media_delete_jobs error:`, claimError.message);
      return json({
        success: false,
        error: "Failed to claim jobs",
        detail: claimError.message,
        stats,
      }, 500);
    }

    const claimed = (jobs as JobRow[]) || [];
    stats.claimed = claimed.length;

    if (claimed.length === 0) {
      console.log(`[${workerId}] no jobs to process`);
      return json({ success: true, message: "No jobs to process", stats });
    }

    console.log(`[${workerId}] claimed ${claimed.length} jobs`);

    // ── Step 4: Process each claimed job ─────────────────────────────────────
    for (const job of claimed) {
      console.log(
        `[${workerId}] processing job=${job.id} asset=${job.asset_id} ` +
        `provider=${job.provider} type=${job.job_type} ` +
        `attempt=${job.attempts + 1}/${job.max_attempts}`,
      );

      if (job.job_type !== "admin_purge" && job.job_type !== "account_delete") {
        const { count: activeRefs, error: activeRefsError } = await supabase
          .from("media_references")
          .select("id", { count: "exact", head: true })
          .eq("asset_id", job.asset_id)
          .eq("is_active", true);

        if (activeRefsError) {
          console.error(`[${workerId}] active-ref guard job=${job.id} error:`, activeRefsError.message);
          stats.errors.push(`active-ref guard ${job.id}: ${activeRefsError.message}`);
          await supabase.rpc("complete_media_delete_job", {
            p_job_id: job.id,
            p_success: false,
            p_error: `active_ref_guard_failed:${activeRefsError.message}`,
          });
          stats.failed++;
          continue;
        }

        if ((activeRefs ?? 0) > 0) {
          const { error: assetResetError } = await supabase
            .from("media_assets")
            .update({
              status: "active",
              deleted_at: null,
              purge_after: null,
              purged_at: null,
              last_error: null,
            })
            .eq("id", job.asset_id);
          if (assetResetError) {
            console.error(`[${workerId}] active-ref asset reset job=${job.id} error:`, assetResetError.message);
            stats.errors.push(`active-ref asset reset ${job.id}: ${assetResetError.message}`);
            const { error: completeError } = await supabase.rpc("complete_media_delete_job", {
              p_job_id: job.id,
              p_success: false,
              p_error: `active_ref_asset_reset_failed:${assetResetError.message}`,
            });
            if (completeError) {
              console.error(`[${workerId}] complete active-ref reset failure job=${job.id} error:`, completeError.message);
              stats.errors.push(`complete active-ref reset ${job.id}: ${completeError.message}`);
            }
            stats.failed++;
            continue;
          }

          const { error: jobDeleteError } = await supabase
            .from("media_delete_jobs")
            .delete()
            .eq("id", job.id)
            .in("status", ["claimed", "pending", "failed"]);
          if (jobDeleteError) {
            console.error(`[${workerId}] active-ref job delete job=${job.id} error:`, jobDeleteError.message);
            stats.errors.push(`active-ref job delete ${job.id}: ${jobDeleteError.message}`);
            const { error: completeError } = await supabase.rpc("complete_media_delete_job", {
              p_job_id: job.id,
              p_success: false,
              p_error: `active_ref_job_delete_failed:${jobDeleteError.message}`,
            });
            if (completeError) {
              console.error(`[${workerId}] complete active-ref delete failure job=${job.id} error:`, completeError.message);
              stats.errors.push(`complete active-ref delete ${job.id}: ${completeError.message}`);
            }
            stats.failed++;
            continue;
          }
          console.log(
            `[${workerId}] skipped job=${job.id} asset=${job.asset_id} active_refs=${activeRefs}`,
          );
          stats.skipped++;
          continue;
        }
      }

      let storageTier: BunnyStorageZoneTier = "hot";
      if (job.provider === "bunny_storage") {
        const { data: assetTierRow } = await supabase
          .from("media_assets")
          .select("storage_zone")
          .eq("id", job.asset_id)
          .maybeSingle();
        const tier = (assetTierRow as MediaAssetStorageTierRow | null)?.storage_zone;
        storageTier = tier === "archive" ? "archive" : "hot";
      }

      const result = await deleteMediaAsset(
        job.provider,
        job.provider_object_id,
        job.provider_path,
        storageTier,
      );

      console.log(
        `[${workerId}] delete_result job=${job.id} success=${result.success} ` +
        `http=${result.httpStatus} already_gone=${result.alreadyGone} ` +
        `detail=${result.detail}`,
      );

      const { error: completeError } = await supabase.rpc("complete_media_delete_job", {
        p_job_id: job.id,
        p_success: result.success,
        p_error: result.success ? null : (result.error ?? result.detail),
      });

      if (completeError) {
        console.error(`[${workerId}] complete job=${job.id} error:`, completeError.message);
        stats.errors.push(`complete ${job.id}: ${completeError.message}`);
      }

      if (result.success) {
        stats.completed++;
      } else {
        stats.failed++;
      }
    }

    console.log(
      `[${workerId}] done archived=${stats.archived} archive_failed=${stats.archiveFailed} ` +
      `promoted=${stats.promoted} claimed=${stats.claimed} ` +
      `completed=${stats.completed} failed=${stats.failed} skipped=${stats.skipped}`,
    );

    return json({ success: true, worker_id: workerId, stats });
  } catch (err) {
    console.error(`[${workerId}] unexpected error:`, err);
    return json({
      success: false,
      error: "Internal worker error",
      detail: String(err),
      worker_id: workerId,
      stats,
    }, 500);
  }
});
