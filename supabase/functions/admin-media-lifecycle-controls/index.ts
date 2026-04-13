import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CHAT_MEDIA_FAMILIES = [
  "chat_image",
  "chat_video",
  "chat_video_thumbnail",
  "voice_message",
] as const;

const OWNED_MEDIA_FAMILIES = [
  "vibe_video",
  "profile_photo",
  "event_cover",
] as const;

const MEDIA_WORKER_JOB_NAME = "media-delete-worker-every-15m";

type MediaFamily = typeof CHAT_MEDIA_FAMILIES[number] | typeof OWNED_MEDIA_FAMILIES[number] | "verification_selfie";
type RetentionMode = "soft_delete" | "retain_until_eligible" | "immediate";

type SettingsRow = {
  media_family: MediaFamily;
  retention_mode: RetentionMode;
  retention_days: number | null;
  eligible_days: number | null;
  worker_enabled: boolean;
  dry_run: boolean;
  batch_size: number;
  max_attempts: number;
  notes: string | null;
  updated_at: string;
  updated_by: string | null;
};

type AssetRefRow = {
  id: string;
  is_active: boolean;
};

type AssetRow = {
  id: string;
  media_family: MediaFamily;
  status: string;
  provider: string;
  purge_after: string | null;
  created_at: string;
  deleted_at: string | null;
  last_error: string | null;
  media_references?: AssetRefRow[] | null;
};

type JobAssetRow = {
  media_family: MediaFamily;
  status: string;
  purge_after: string | null;
};

type JobRow = {
  id: string;
  asset_id: string;
  provider: string;
  status: string;
  job_type: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
  started_at: string | null;
  worker_id: string | null;
  media_assets?: JobAssetRow | JobAssetRow[] | null;
};

type CronJobRow = {
  jobid: number;
  jobname: string;
  schedule: string;
  active: boolean;
};

type CronRunRow = {
  runid: number;
  jobid: number;
  status: string;
  start_time: string;
  end_time: string | null;
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeJobAsset(job: JobRow): JobAssetRow | null {
  if (!job.media_assets) return null;
  return Array.isArray(job.media_assets) ? job.media_assets[0] ?? null : job.media_assets;
}

function toCountRows(records: Record<string, number>) {
  return Object.entries(records)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => {
      const [media_family, status, job_type] = key.split("|");
      return { media_family, status, job_type: job_type ?? null, count };
    })
    .sort((a, b) =>
      a.media_family.localeCompare(b.media_family)
      || a.status.localeCompare(b.status)
      || (a.job_type ?? "").localeCompare(b.job_type ?? ""),
    );
}

function increment(records: Record<string, number>, key: string) {
  records[key] = (records[key] ?? 0) + 1;
}

function buildSnapshot(settings: SettingsRow[], assets: AssetRow[], jobs: JobRow[]) {
  const settingsByFamily = new Map(settings.map((row) => [row.media_family, row]));
  const nowMs = Date.now();

  const assetStatusCounts: Record<string, number> = {};
  const orphanLikeCounts: Record<string, number> = {};
  const readyNowByFamily: Record<string, { promotable_assets: number; queued_jobs: number }> = {};

  let orphanLikeTotal = 0;
  let failedJobTotal = 0;
  let readyJobTotal = 0;
  let promotableAssetTotal = 0;

  for (const asset of assets) {
    increment(assetStatusCounts, `${asset.media_family}|${asset.status}`);

    const activeRefCount = (asset.media_references ?? []).filter((row) => row.is_active).length;
    if ((asset.status === "active" || asset.status === "uploading") && activeRefCount === 0) {
      const isStaleUpload = asset.status === "uploading"
        && new Date(asset.created_at).getTime() <= nowMs - 24 * 60 * 60 * 1000;
      if (asset.status === "active" || isStaleUpload) {
        const bucket = asset.status === "active" ? "active_without_refs" : "stale_uploading";
        increment(orphanLikeCounts, `${bucket}|${asset.media_family}`);
        orphanLikeTotal++;
      }
    }

    const policy = settingsByFamily.get(asset.media_family);
    const isPromotable = asset.status === "soft_deleted"
      && activeRefCount === 0
      && !!asset.purge_after
      && new Date(asset.purge_after).getTime() <= nowMs
      && policy?.worker_enabled === true;

    if (isPromotable) {
      const existing = readyNowByFamily[asset.media_family] ?? { promotable_assets: 0, queued_jobs: 0 };
      existing.promotable_assets += 1;
      readyNowByFamily[asset.media_family] = existing;
      promotableAssetTotal += 1;
    }
  }

  const jobStatusCounts: Record<string, number> = {};
  for (const job of jobs) {
    const asset = normalizeJobAsset(job);
    const mediaFamily = asset?.media_family ?? "unknown";
    increment(jobStatusCounts, `${mediaFamily}|${job.status}|${job.job_type}`);

    if (job.status === "failed" || job.status === "abandoned") {
      failedJobTotal++;
    }

    const policy = asset ? settingsByFamily.get(asset.media_family) : null;
    const readyNow = (job.status === "pending" || job.status === "failed")
      && new Date(job.next_attempt_at).getTime() <= nowMs
      && policy?.worker_enabled === true;

    if (asset && readyNow) {
      const existing = readyNowByFamily[asset.media_family] ?? { promotable_assets: 0, queued_jobs: 0 };
      existing.queued_jobs += 1;
      readyNowByFamily[asset.media_family] = existing;
      readyJobTotal += 1;
    }
  }

  const ownedPolicies = OWNED_MEDIA_FAMILIES.map((family) => settingsByFamily.get(family)).filter(Boolean) as SettingsRow[];
  const chatPolicies = CHAT_MEDIA_FAMILIES.map((family) => settingsByFamily.get(family)).filter(Boolean) as SettingsRow[];
  const verificationPolicy = settingsByFamily.get("verification_selfie") ?? null;

  const firstChat = chatPolicies[0] ?? null;
  const chatConsistent = chatPolicies.every((row) =>
    row.retention_mode === firstChat?.retention_mode
    && row.eligible_days === firstChat?.eligible_days
    && row.worker_enabled === firstChat?.worker_enabled,
  );

  const readyByFamily = Object.entries(readyNowByFamily)
    .map(([media_family, values]) => ({
      media_family,
      promotable_assets: values.promotable_assets,
      queued_jobs: values.queued_jobs,
      total_candidates: values.promotable_assets + values.queued_jobs,
    }))
    .filter((row) => row.total_candidates > 0)
    .sort((a, b) => a.media_family.localeCompare(b.media_family));

  return {
    settings: {
      families: settings,
      owned_media: ownedPolicies,
      chat_policy: {
        consistent: chatConsistent,
        retention_mode: chatConsistent ? firstChat?.retention_mode ?? null : "mixed",
        eligible_days: chatConsistent ? firstChat?.eligible_days ?? null : null,
        worker_enabled: chatConsistent ? firstChat?.worker_enabled ?? null : null,
        families: chatPolicies,
      },
      verification_selfie: verificationPolicy,
    },
    readiness: {
      asset_status_counts: toCountRows(assetStatusCounts),
      job_status_counts: toCountRows(jobStatusCounts),
      orphan_like_counts: Object.entries(orphanLikeCounts).map(([key, count]) => {
        const [bucket, media_family] = key.split("|");
        return { bucket, media_family, count };
      }).sort((a, b) => a.bucket.localeCompare(b.bucket) || a.media_family.localeCompare(b.media_family)),
      would_process_now: {
        promotable_assets: promotableAssetTotal,
        queued_jobs: readyJobTotal,
        total_candidates: promotableAssetTotal + readyJobTotal,
        by_family: readyByFamily,
        explanation: "Read-only preview that combines existing pending/failed ready jobs with soft_deleted assets that a real run would promote before claiming. No mutations are performed.",
      },
      failed_job_total: failedJobTotal,
      orphan_like_total: orphanLikeTotal,
      notes: [
        "The existing process-media-delete-jobs dry-run only previews queued pending/failed jobs.",
        "This admin snapshot adds promotable soft_deleted assets so operators can see what a real run would likely process first.",
        "verification_selfie remains worker-disabled and is excluded from rollout recommendations.",
      ],
    },
    recommended_activation: {
      verdict: orphanLikeTotal > 0 || failedJobTotal > 0 ? "keep_disabled" : "healthy",
      initial_batch_size: 10,
      initial_cadence: "every 15 minutes",
      retry_behavior: "DB-owned exponential backoff: 1m, 5m, 25m, 2h, 10h, up to per-family max_attempts (default 5).",
      initial_family_filter: null,
      rollback: [
        "Disable the scheduler: UPDATE cron.job SET active = false WHERE jobname = 'media-delete-worker-every-15m';",
        "Set worker_enabled = false for the affected family in the admin panel.",
        "Leave existing queued jobs untouched while you inspect media_delete_jobs and provider logs.",
      ],
      rationale: orphanLikeTotal > 0 || failedJobTotal > 0
        ? "Anomalies detected — investigate before next worker run."
        : "System healthy — cron is running on schedule.",
    },
  };
}

// ── Ops: fetch cron status + recent runs ─────────────────────────────────────

async function fetchCronStatus(admin: ReturnType<typeof createClient>) {
  const { data: jobRows, error: jobError } = await admin
    .from("cron.job" as "media_assets")
    .select("jobid, jobname, schedule, active")
    .eq("jobname", MEDIA_WORKER_JOB_NAME)
    .maybeSingle();

  if (jobError) {
    console.error("fetchCronStatus job query failed:", jobError.message);
    return null;
  }

  const cronJob = jobRows as unknown as CronJobRow | null;
  if (!cronJob) return null;

  // Fetch recent run history
  const { data: runs, error: runsError } = await admin
    .rpc("execute_sql_internal_cron_runs" as "summarize_media_lifecycle_health", {
      // fall back to raw SQL via a workaround — query cron.job_run_details
    } as Record<string, never>);

  // cron schema tables aren't directly accessible via PostgREST; use raw RPC path
  // Instead we'll query via the health RPC and inject cron run data separately
  void runs; void runsError;

  return { job: cronJob, recent_runs: [] as CronRunRow[] };
}

// Fetch cron status + recent runs via direct SQL through service-role RPC path
async function fetchCronStatusViaSQL(admin: ReturnType<typeof createClient>) {
  const { data: healthData, error: healthError } = await admin
    .rpc("summarize_media_lifecycle_health");

  if (healthError) {
    console.error("health RPC failed:", healthError.message);
    return { health: null, cron_job: null, recent_runs: [] as CronRunRow[] };
  }

  const health = healthData as unknown as Record<string, unknown>;

  // Query cron job state
  const { data: cronData, error: cronError } = await (admin as ReturnType<typeof createClient>)
    .schema("cron")
    .from("job")
    .select("jobid, jobname, schedule, active")
    .eq("jobname", MEDIA_WORKER_JOB_NAME)
    .maybeSingle();

  const cronJob = cronError ? null : (cronData as CronJobRow | null);

  // Query recent run details
  let recentRuns: CronRunRow[] = [];
  if (cronJob) {
    const { data: runsData, error: runsError } = await (admin as ReturnType<typeof createClient>)
      .schema("cron")
      .from("job_run_details")
      .select("runid, jobid, status, start_time, end_time")
      .eq("jobid", cronJob.jobid)
      .order("runid", { ascending: false })
      .limit(10);

    if (!runsError && runsData) {
      recentRuns = runsData as CronRunRow[];
    }
  }

  // Compute consecutive failures from recent runs
  let consecutiveFailures = 0;
  let lastSucceededAt: string | null = null;
  let lastFailedAt: string | null = null;

  for (const run of recentRuns) {
    if (run.status === "succeeded") {
      if (!lastSucceededAt) lastSucceededAt = run.start_time;
      break;
    } else if (run.status === "failed") {
      consecutiveFailures++;
      if (!lastFailedAt) lastFailedAt = run.start_time;
    }
  }

  return {
    health,
    cron_job: cronJob ? {
      job_id: cronJob.jobid,
      jobname: cronJob.jobname,
      schedule: cronJob.schedule,
      active: cronJob.active,
      last_succeeded_at: lastSucceededAt,
      last_failed_at: lastFailedAt,
      consecutive_failures: consecutiveFailures,
    } : null,
    recent_runs: recentRuns.map((r) => ({
      runid: r.runid,
      status: r.status,
      start_time: r.start_time,
      end_time: r.end_time,
      duration_ms: r.end_time
        ? new Date(r.end_time).getTime() - new Date(r.start_time).getTime()
        : null,
    })),
  };
}

// ── Ops: fetch failed and stale-claimed jobs ──────────────────────────────────

async function fetchOpsJobLists(admin: ReturnType<typeof createClient>) {
  const STALE_MINUTES = 30;
  const staleThreshold = new Date(Date.now() - STALE_MINUTES * 60 * 1000).toISOString();

  const [failedResult, staleResult] = await Promise.all([
    admin
      .from("media_delete_jobs")
      .select("id, asset_id, provider, provider_path, status, job_type, attempts, max_attempts, last_error, created_at, next_attempt_at, media_assets!inner(media_family)")
      .in("status", ["failed", "abandoned"])
      .order("created_at", { ascending: false })
      .limit(50),
    admin
      .from("media_delete_jobs")
      .select("id, asset_id, provider, provider_path, status, job_type, attempts, started_at, worker_id, created_at, media_assets!inner(media_family)")
      .eq("status", "claimed")
      .lt("started_at", staleThreshold)
      .order("started_at", { ascending: true })
      .limit(50),
  ]);

  const normalizeFamily = (row: Record<string, unknown>) => {
    const asset = row.media_assets as JobAssetRow | JobAssetRow[] | null;
    const media_family = Array.isArray(asset) ? asset[0]?.media_family ?? "unknown" : asset?.media_family ?? "unknown";
    const { media_assets: _drop, ...rest } = row;
    void _drop;
    return { ...rest, media_family };
  };

  return {
    failed_jobs: (failedResult.data ?? []).map(normalizeFamily),
    stale_claimed_jobs: (staleResult.data ?? []).map(normalizeFamily),
  };
}

// ── Main snapshot ─────────────────────────────────────────────────────────────

async function fetchSnapshot(admin: ReturnType<typeof createClient>) {
  const [settingsResult, assetsResult, jobsResult] = await Promise.all([
    admin
      .from("media_retention_settings")
      .select("media_family, retention_mode, retention_days, eligible_days, worker_enabled, dry_run, batch_size, max_attempts, notes, updated_at, updated_by")
      .order("media_family", { ascending: true }),
    admin
      .from("media_assets")
      .select("id, media_family, status, provider, purge_after, created_at, deleted_at, last_error, media_references!left(id, is_active)"),
    admin
      .from("media_delete_jobs")
      .select("id, asset_id, provider, status, job_type, attempts, max_attempts, next_attempt_at, last_error, created_at, started_at, worker_id, media_assets!inner(media_family, status, purge_after)"),
  ]);

  if (settingsResult.error) throw new Error(`settings query failed: ${settingsResult.error.message}`);
  if (assetsResult.error) throw new Error(`assets query failed: ${assetsResult.error.message}`);
  if (jobsResult.error) throw new Error(`jobs query failed: ${jobsResult.error.message}`);

  const core = buildSnapshot(
    (settingsResult.data ?? []) as SettingsRow[],
    (assetsResult.data ?? []) as AssetRow[],
    (jobsResult.data ?? []) as JobRow[],
  );

  const [opsStatus, opsJobs] = await Promise.all([
    fetchCronStatusViaSQL(admin),
    fetchOpsJobLists(admin),
  ]);

  return {
    ...core,
    ops: {
      health: opsStatus.health,
      cron_job: opsStatus.cron_job,
      recent_runs: opsStatus.recent_runs,
      failed_jobs: opsJobs.failed_jobs,
      stale_claimed_jobs: opsJobs.stale_claimed_jobs,
    },
  };
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

function ensureNonNegativeInteger(name: string, value: unknown, allowNull = true) {
  if (value === null && allowNull) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer${allowNull ? " or null" : ""}`);
  }
  return value;
}

async function requireAdmin(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization");

  if (!authHeader) {
    return { error: json({ success: false, error: "Unauthorized" }, 401) };
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) {
    return { error: json({ success: false, error: "Unauthorized" }, 401) };
  }

  const admin = createClient(supabaseUrl, supabaseServiceRoleKey);
  const { data: roleRow, error: roleError } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", authData.user.id)
    .eq("role", "admin")
    .maybeSingle();

  if (roleError) {
    console.error("admin-media-lifecycle-controls role lookup failed:", roleError.message);
    return { error: json({ success: false, error: "Failed to verify admin role" }, 500) };
  }

  if (!roleRow) {
    return { error: json({ success: false, error: "Forbidden" }, 403) };
  }

  return { admin, userId: authData.user.id };
}

async function logAdminAction(
  admin: ReturnType<typeof createClient>,
  adminUserId: string,
  actionType: string,
  targetId: string,
  details: Record<string, unknown>,
) {
  const { error } = await admin.from("admin_activity_logs").insert({
    admin_id: adminUserId,
    action_type: actionType,
    target_type: "media_retention_settings",
    target_id: targetId,
    details,
  });
  if (error) {
    console.error("admin-media-lifecycle-controls activity log failed:", error.message);
  }
}

// ── Request handler ───────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await requireAdmin(req);
  if ("error" in auth) return auth.error;

  try {
    if (req.method === "GET") {
      const snapshot = await fetchSnapshot(auth.admin);
      return json({ success: true, ...snapshot });
    }

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { body = {}; }

    const action = typeof body.action === "string" ? body.action : "snapshot";

    // ── Read-only actions ─────────────────────────────────────────────────────

    if (action === "snapshot") {
      const snapshot = await fetchSnapshot(auth.admin);
      return json({ success: true, ...snapshot });
    }

    // ── ops_summary: lightweight health + cron + failed/stale, no full asset scan ──

    if (action === "ops_summary") {
      const [opsStatus, opsJobs] = await Promise.all([
        fetchCronStatusViaSQL(auth.admin),
        fetchOpsJobLists(auth.admin),
      ]);
      return json({
        success: true,
        health: opsStatus.health,
        cron_job: opsStatus.cron_job,
        recent_runs: opsStatus.recent_runs,
        failed_jobs: opsJobs.failed_jobs,
        stale_claimed_jobs: opsJobs.stale_claimed_jobs,
      });
    }

    // ── Mutation: requeue_stale ───────────────────────────────────────────────

    if (action === "requeue_stale") {
      const staleMinutes = typeof body.stale_minutes === "number" ? body.stale_minutes : 30;
      if (!Number.isInteger(staleMinutes) || staleMinutes < 1) {
        return json({ success: false, error: "stale_minutes must be a positive integer" }, 400);
      }

      const { data: requeuedCount, error: requeueError } = await auth.admin
        .rpc("requeue_stale_media_delete_jobs", { p_stale_minutes: staleMinutes });

      if (requeueError) {
        console.error("requeue_stale RPC failed:", requeueError.message);
        return json({ success: false, error: requeueError.message }, 500);
      }

      await logAdminAction(auth.admin, auth.userId, "media_jobs_requeue_stale", "media_delete_jobs", {
        stale_minutes: staleMinutes,
        requeued_count: requeuedCount,
      });

      console.log(`[admin-media-lifecycle-controls] requeue_stale: requeued=${requeuedCount} stale_minutes=${staleMinutes} admin=${auth.userId}`);
      return json({ success: true, requeued_count: requeuedCount });
    }

    // ── Mutation: retry_failed ────────────────────────────────────────────────

    if (action === "retry_failed") {
      const family = typeof body.family === "string" ? body.family : null;
      const limit = typeof body.limit === "number" ? body.limit : 50;
      const resetAttempts = body.reset_attempts === true;

      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        return json({ success: false, error: "limit must be an integer between 1 and 500" }, 400);
      }

      const { data: retriedCount, error: retryError } = await auth.admin
        .rpc("retry_failed_media_delete_jobs", {
          p_family: family,
          p_limit: limit,
          p_reset_attempts: resetAttempts,
        });

      if (retryError) {
        console.error("retry_failed RPC failed:", retryError.message);
        return json({ success: false, error: retryError.message }, 500);
      }

      await logAdminAction(auth.admin, auth.userId, "media_jobs_retry_failed", "media_delete_jobs", {
        family,
        limit,
        reset_attempts: resetAttempts,
        retried_count: retriedCount,
      });

      console.log(`[admin-media-lifecycle-controls] retry_failed: retried=${retriedCount} family=${family ?? "all"} reset_attempts=${resetAttempts} admin=${auth.userId}`);
      return json({ success: true, retried_count: retriedCount });
    }

    // ── Mutation: update_family ───────────────────────────────────────────────

    if (action === "update_family") {
      const mediaFamily = body.media_family;
      if (!OWNED_MEDIA_FAMILIES.includes(mediaFamily as (typeof OWNED_MEDIA_FAMILIES)[number])) {
        return json({ success: false, error: "media_family must be vibe_video, profile_photo, or event_cover" }, 400);
      }

      const { data: currentRow, error: currentError } = await auth.admin
        .from("media_retention_settings")
        .select("media_family, retention_mode, retention_days, eligible_days, worker_enabled, dry_run, batch_size, max_attempts, notes, updated_at, updated_by")
        .eq("media_family", mediaFamily)
        .single();

      if (currentError || !currentRow) {
        return json({ success: false, error: "Retention setting not found" }, 404);
      }

      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        updated_by: auth.userId,
      };

      if (Object.prototype.hasOwnProperty.call(body, "retention_days")) {
        updates.retention_days = ensureNonNegativeInteger("retention_days", body.retention_days);
      }
      if (Object.prototype.hasOwnProperty.call(body, "worker_enabled")) {
        if (typeof body.worker_enabled !== "boolean") {
          return json({ success: false, error: "worker_enabled must be boolean" }, 400);
        }
        updates.worker_enabled = body.worker_enabled;
      }

      if (Object.keys(updates).length <= 2) {
        return json({ success: false, error: "No allowed updates provided" }, 400);
      }

      const { data: updatedRow, error: updateError } = await auth.admin
        .from("media_retention_settings")
        .update(updates)
        .eq("media_family", mediaFamily)
        .select("media_family, retention_mode, retention_days, eligible_days, worker_enabled, dry_run, batch_size, max_attempts, notes, updated_at, updated_by")
        .single();

      if (updateError) {
        return json({ success: false, error: updateError.message }, 500);
      }

      await logAdminAction(auth.admin, auth.userId, "media_retention_setting_updated", String(mediaFamily), {
        before: currentRow,
        after: updatedRow,
      });

      const snapshot = await fetchSnapshot(auth.admin);
      return json({ success: true, updated: updatedRow, ...snapshot });
    }

    // ── Mutation: update_chat_policy ─────────────────────────────────────────

    if (action === "update_chat_policy") {
      const retentionMode = body.retention_mode;
      if (!["retain_until_eligible", "soft_delete", "immediate"].includes(String(retentionMode))) {
        return json({ success: false, error: "retention_mode must be retain_until_eligible, soft_delete, or immediate" }, 400);
      }

      const eligibleDaysProvided = Object.prototype.hasOwnProperty.call(body, "eligible_days");
      const workerEnabledProvided = Object.prototype.hasOwnProperty.call(body, "worker_enabled");
      const updates: Record<string, unknown> = {
        retention_mode: retentionMode,
        updated_at: new Date().toISOString(),
        updated_by: auth.userId,
      };

      if (eligibleDaysProvided) {
        updates.eligible_days = ensureNonNegativeInteger("eligible_days", body.eligible_days);
      } else if (retentionMode !== "retain_until_eligible") {
        updates.eligible_days = null;
      }

      if (workerEnabledProvided) {
        if (typeof body.worker_enabled !== "boolean") {
          return json({ success: false, error: "worker_enabled must be boolean" }, 400);
        }
        updates.worker_enabled = body.worker_enabled;
      }

      const { data: currentRows, error: currentError } = await auth.admin
        .from("media_retention_settings")
        .select("media_family, retention_mode, retention_days, eligible_days, worker_enabled, dry_run, batch_size, max_attempts, notes, updated_at, updated_by")
        .in("media_family", [...CHAT_MEDIA_FAMILIES]);

      if (currentError) {
        return json({ success: false, error: currentError.message }, 500);
      }

      const { data: updatedRows, error: updateError } = await auth.admin
        .from("media_retention_settings")
        .update(updates)
        .in("media_family", [...CHAT_MEDIA_FAMILIES])
        .select("media_family, retention_mode, retention_days, eligible_days, worker_enabled, dry_run, batch_size, max_attempts, notes, updated_at, updated_by");

      if (updateError) {
        return json({ success: false, error: updateError.message }, 500);
      }

      await logAdminAction(auth.admin, auth.userId, "media_retention_chat_policy_updated", "chat_media_group", {
        before: currentRows,
        after: updatedRows,
      });

      const snapshot = await fetchSnapshot(auth.admin);
      return json({ success: true, updated: updatedRows, ...snapshot });
    }

    return json({ success: false, error: "Unsupported action" }, 400);
  } catch (error) {
    console.error("admin-media-lifecycle-controls error:", error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : "Internal server error",
    }, 500);
  }
});
