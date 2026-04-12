/**
 * process-media-delete-jobs
 *
 * Worker Edge Function that drains the media_delete_jobs queue.
 *
 * Real execution flow:
 *   1. promote_purgeable_assets — move expired soft_deleted → purge_ready + enqueue
 *   2. claim_media_delete_jobs — SKIP LOCKED batch claim
 *   3. For each job: call provider delete via _shared/bunny-media.ts
 *   4. complete_media_delete_job — record result (success/fail)
 *
 * Dry-run flow ({"dry_run": true}):
 *   Pure read-only.  Zero mutating operations of any kind.
 *   1. SELECT existing pending/failed jobs (no lock, no claim)
 *   2. Log what a real run would process
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
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { deleteMediaAsset } from "../_shared/bunny-media.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

interface DryRunPreviewRow {
  job_id: string;
  asset_id: string;
  provider: string;
  job_type: string;
  provider_object_id: string | null;
  provider_path: string | null;
  media_family: string;
  owner_user_id: string | null;
  attempts: number;
}

interface WorkerStats {
  promoted: number;
  claimed: number;
  completed: number;
  failed: number;
  skipped: number;
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
      batchSize = Math.min(Math.max(1, body.batch_size), 100);
    }
    if (body?.dry_run === true) isDryRun = true;
  } catch {
    // No body or invalid JSON — defaults apply
  }

  const workerId = `worker-${crypto.randomUUID().slice(0, 8)}-${Date.now()}`;
  const stats: WorkerStats = {
    promoted: 0,
    claimed: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // ── Dry-run path: pure read-only preview ────────────────────────────────
    // Dry-run executes ZERO mutating operations.  No promote, no claim, no
    // complete, no status change, no attempt increment.  It reads existing
    // pending/failed jobs and reports what a real run would process.
    if (isDryRun) {
      console.log(
        `[${workerId}] DRY_RUN preview family=${familyFilter ?? "all"} batch=${batchSize}`,
      );

      let query = supabase
        .from("media_delete_jobs")
        .select(`
          id,
          asset_id,
          provider,
          job_type,
          provider_object_id,
          provider_path,
          attempts,
          media_assets!inner ( media_family, owner_user_id )
        `)
        .in("status", ["pending", "failed"])
        .lte("next_attempt_at", new Date().toISOString())
        .order("next_attempt_at", { ascending: true })
        .limit(batchSize);

      if (familyFilter) {
        query = query.eq("media_assets.media_family", familyFilter);
      }

      const { data: preview, error: previewError } = await query;

      if (previewError) {
        console.error(`[${workerId}] dry-run preview error:`, previewError.message);
        return json({ success: false, error: "Dry-run preview failed", detail: previewError.message, stats }, 500);
      }

      const rows = (preview ?? []) as unknown as DryRunPreviewRow[];
      stats.claimed = rows.length;

      for (const row of rows) {
        console.log(
          `[${workerId}] DRY_RUN would_delete job=${row.job_id ?? row.id} ` +
          `asset=${row.asset_id} provider=${row.provider} ` +
          `object_id=${row.provider_object_id} path=${row.provider_path} ` +
          `attempts=${row.attempts}`,
        );
        stats.skipped++;
      }

      console.log(`[${workerId}] dry-run complete, ${rows.length} jobs previewed, zero mutations`);
      return json({ success: true, dry_run: true, message: "Dry-run preview only — zero mutations performed", worker_id: workerId, stats });
    }

    // ── Step 1: Promote purgeable assets (real execution only) ───────────────
    const { data: promoteResult, error: promoteError } = await supabase.rpc(
      "promote_purgeable_assets",
      { p_limit: batchSize * 2 },
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

    // ── Step 2: Claim jobs ───────────────────────────────────────────────────
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

    // ── Step 3: Process each claimed job ─────────────────────────────────────
    for (const job of claimed) {
      console.log(
        `[${workerId}] processing job=${job.id} asset=${job.asset_id} ` +
        `provider=${job.provider} type=${job.job_type} ` +
        `attempt=${job.attempts + 1}/${job.max_attempts}`,
      );

      const result = await deleteMediaAsset(
        job.provider,
        job.provider_object_id,
        job.provider_path,
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
      `[${workerId}] done promoted=${stats.promoted} claimed=${stats.claimed} ` +
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
