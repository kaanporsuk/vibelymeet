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

type JobAssetRow = {
  media_family: MediaFamily;
  status: string;
  purge_after: string | null;
};

type CountRow = {
  media_family: string;
  status: string;
  job_type?: string | null;
  count: number;
};

type OrphanRow = {
  bucket: string;
  media_family: string;
  count: number;
};

type SnapshotSummary = {
  asset_status_counts?: CountRow[];
  job_status_counts?: CountRow[];
  orphan_like_counts?: OrphanRow[];
  orphan_like_total?: number;
  failed_job_total?: number;
  would_process_now?: {
    promotable_assets?: number;
    queued_jobs?: number;
    total_candidates?: number;
    by_family?: Array<{
      media_family: string;
      promotable_assets: number;
      queued_jobs: number;
      total_candidates: number;
    }>;
    explanation?: string;
  };
};

type CronRunRow = {
  runid: number;
  status: string;
  start_time: string;
  end_time: string | null;
  duration_ms?: number | null;
};

type CronStatusCode = "found" | "missing_job" | "rpc_error" | "inactive" | "recent_runs_unavailable";

type AuditLogResult = {
  audit_logged: boolean;
  audit_error: string | null;
};

type SnapshotCore = ReturnType<typeof buildSnapshotFromSummary>;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildSnapshotFromSummary(settings: SettingsRow[], summary: SnapshotSummary) {
  const settingsByFamily = new Map(settings.map((row) => [row.media_family, row]));
  const ownedPolicies = OWNED_MEDIA_FAMILIES.map((family) => settingsByFamily.get(family)).filter(Boolean) as SettingsRow[];
  const chatPolicies = CHAT_MEDIA_FAMILIES.map((family) => settingsByFamily.get(family)).filter(Boolean) as SettingsRow[];
  const verificationPolicy = settingsByFamily.get("verification_selfie") ?? null;

  const firstChat = chatPolicies[0] ?? null;
  const chatConsistent = chatPolicies.every((row) =>
    row.retention_mode === firstChat?.retention_mode
    && row.eligible_days === firstChat?.eligible_days
    && row.worker_enabled === firstChat?.worker_enabled,
  );

  const orphanLikeTotal = Number(summary.orphan_like_total ?? 0);
  const failedJobTotal = Number(summary.failed_job_total ?? 0);
  const wouldProcessNow = summary.would_process_now ?? {};
  const verdict = orphanLikeTotal > 0 || failedJobTotal > 0 ? "keep_disabled" : "healthy";

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
      asset_status_counts: summary.asset_status_counts ?? [],
      job_status_counts: summary.job_status_counts ?? [],
      orphan_like_counts: summary.orphan_like_counts ?? [],
      would_process_now: {
        promotable_assets: Number(wouldProcessNow.promotable_assets ?? 0),
        queued_jobs: Number(wouldProcessNow.queued_jobs ?? 0),
        total_candidates: Number(wouldProcessNow.total_candidates ?? 0),
        by_family: wouldProcessNow.by_family ?? [],
        explanation: wouldProcessNow.explanation
          ?? "Read-only aggregate preview that combines claimable pending/failed jobs with soft_deleted assets a real run would promote before claiming. No mutations are performed.",
      },
      failed_job_total: failedJobTotal,
      orphan_like_total: orphanLikeTotal,
      notes: [
        "The process-media-delete-jobs dry-run only previews existing queued pending/failed jobs.",
        "This admin snapshot uses aggregate SQL to include promotable soft_deleted assets without scanning raw rows in the Edge Function.",
        "verification_selfie remains worker-disabled and is excluded from rollout recommendations.",
      ],
    },
    recommended_activation: {
      verdict,
      initial_batch_size: 10,
      initial_cadence: "every 15 minutes",
      retry_behavior: "DB-owned exponential backoff: 1m, 5m, 25m, 2h, 10h, up to per-family max_attempts (default 5). Abandoned jobs reset attempts before requeue so they are claimable.",
      initial_family_filter: null,
      rollback: [
        "Disable the scheduler: UPDATE cron.job SET active = false WHERE jobname = 'media-delete-worker-every-15m';",
        "Set worker_enabled = false for the affected family in the admin panel.",
        "Leave existing queued jobs untouched while you inspect media_delete_jobs and provider logs.",
      ],
      rationale: verdict === "healthy"
        ? "System healthy — cron is running on schedule."
        : "Anomalies detected — investigate before next worker run.",
    },
  };
}

function numericRecordValue(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function validationResponse(error: unknown) {
  return json({
    success: false,
    error: error instanceof Error ? error.message : "Invalid media lifecycle input",
  }, 400);
}

function buildActivationRecommendation(
  core: SnapshotCore,
  opsStatus: {
    health: Record<string, unknown> | null;
    cron_status: {
      status: CronStatusCode;
      found: boolean;
      jobname: string;
      message?: string | null;
      recent_runs_unavailable?: boolean;
    } | null;
    cron_job: { active: boolean } | null;
  },
) {
  const issues: string[] = [];
  const orphanLikeTotal = Number(core.readiness.orphan_like_total ?? 0);
  const failedJobTotal = Number(core.readiness.failed_job_total ?? 0);

  if (orphanLikeTotal > 0) {
    issues.push(`${orphanLikeTotal} orphan-like asset${orphanLikeTotal === 1 ? "" : "s"}`);
  }
  if (failedJobTotal > 0) {
    issues.push(`${failedJobTotal} failed or abandoned delete job${failedJobTotal === 1 ? "" : "s"}`);
  }

  if (!opsStatus.health) {
    issues.push("media lifecycle health RPC unavailable");
  } else {
    const staleClaimed = numericRecordValue(opsStatus.health, "stale_claimed_count");
    if (staleClaimed > 0) {
      issues.push(`${staleClaimed} stale claimed job${staleClaimed === 1 ? "" : "s"}`);
    }
    if (opsStatus.health.healthy === false && failedJobTotal === 0 && staleClaimed === 0) {
      issues.push("health RPC reported an unhealthy state");
    }
  }

  const cronStatus = opsStatus.cron_status?.status ?? "rpc_error";
  if (cronStatus === "missing_job") {
    issues.push("cron job missing");
  } else if (cronStatus === "rpc_error") {
    issues.push("cron status RPC unavailable");
  } else if (cronStatus === "inactive") {
    issues.push("cron job paused");
  } else if (opsStatus.cron_job?.active !== true) {
    issues.push("cron job not active");
  }

  const verdict = issues.length > 0 ? "keep_disabled" : "healthy";

  return {
    ...core.recommended_activation,
    verdict,
    rationale: verdict === "healthy"
      ? "Healthy: cron is active, the health RPC is clean, and no failed, abandoned, stale, or orphan-like media lifecycle anomalies are present."
      : `Hold: ${issues.join("; ")}.`,
  };
}

// ── Ops: fetch cron status + recent runs via SECURITY DEFINER RPC ─────────────
//
// The cron schema (cron.job, cron.job_run_details) is NOT exposed through
// PostgREST regardless of key. Calling .schema("cron").from("job") always
// returns an error that was previously swallowed, producing cron_job: null.
// Keep the fast cron.job read separate from best-effort run history so an
// expensive cron.job_run_details read cannot make an active scheduler look down.

async function fetchCronStatusViaSQL(admin: ReturnType<typeof createClient>) {
  const [healthResult, cronJobResult] = await Promise.all([
    admin.rpc("summarize_media_lifecycle_health"),
    admin.rpc("get_media_worker_cron_job_status"),
  ]);

  if (healthResult.error) {
    console.error("[admin-media-lifecycle-controls] health RPC failed:", healthResult.error.message);
  }

  const health = healthResult.data as unknown as Record<string, unknown> | null;
  let cronRaw = cronJobResult.data as unknown as Record<string, unknown> | null;
  let runsRaw: Record<string, unknown> | null = null;
  let runsError: { message: string } | null = null;

  if (cronJobResult.error) {
    const legacyResult = await admin.rpc("get_media_worker_cron_status");
    if (!legacyResult.error) {
      cronRaw = legacyResult.data as unknown as Record<string, unknown> | null;
      runsRaw = legacyResult.data as unknown as Record<string, unknown> | null;
      runsError = null;
    } else {
      console.error("[admin-media-lifecycle-controls] cron job status RPC failed:", cronJobResult.error.message);
      console.error("[admin-media-lifecycle-controls] legacy cron status RPC failed:", legacyResult.error.message);
    }
  }

  if (cronJobResult.error && !cronRaw) {
    return {
      health,
      cron_status: {
        status: "rpc_error" as CronStatusCode,
        found: false,
        jobname: MEDIA_WORKER_JOB_NAME,
        message: cronJobResult.error.message,
      },
      cron_job: null,
      recent_runs: [] as CronRunRow[],
    };
  }

  if (!cronRaw || !cronRaw.found) {
    return {
      health,
      cron_status: {
        status: "missing_job" as CronStatusCode,
        found: false,
        jobname: (cronRaw?.jobname as string | undefined) ?? MEDIA_WORKER_JOB_NAME,
        message: "Cron job was not found in cron.job.",
      },
      cron_job: null,
      recent_runs: [] as CronRunRow[],
    };
  }

  if (!cronJobResult.error) {
    const runsResult = await admin.rpc("get_media_worker_cron_run_history");
    if (runsResult.error) {
      console.error("[admin-media-lifecycle-controls] cron run history RPC failed:", runsResult.error.message);
    }
    runsRaw = runsResult.data as unknown as Record<string, unknown> | null;
    runsError = runsResult.error;
  }

  const runsUnavailable = Boolean(runsError) || runsRaw?.status === "recent_runs_unavailable";
  const recentRuns = runsUnavailable ? [] : ((runsRaw?.recent_runs as CronRunRow[] | null) ?? []);
  const rawCronStatus = (cronRaw.status as CronStatusCode | undefined) ?? ((cronRaw.active as boolean) ? "found" : "inactive");
  const baseCronStatus = rawCronStatus === "recent_runs_unavailable" && (cronRaw.active as boolean)
    ? "found"
    : rawCronStatus;
  const runHistoryMessage = runsError?.message
    ?? (runsRaw?.recent_runs_error as string | null)
    ?? null;

  return {
    health,
    cron_status: {
      status: baseCronStatus,
      found: true,
      jobname: cronRaw.jobname as string,
      message: runHistoryMessage,
      recent_runs_unavailable: runsUnavailable,
    },
    cron_job: {
      job_id: cronRaw.job_id as number,
      jobname: cronRaw.jobname as string,
      schedule: cronRaw.schedule as string,
      active: cronRaw.active as boolean,
      last_succeeded_at: (runsRaw?.last_succeeded_at as string | null) ?? null,
      last_failed_at: (runsRaw?.last_failed_at as string | null) ?? null,
      consecutive_failures: (runsRaw?.consecutive_failures as number) ?? 0,
    },
    recent_runs: recentRuns.map((r, index) => ({
      runid: r.runid ?? index,
      status: r.status,
      start_time: r.start_time,
      end_time: r.end_time ?? null,
      duration_ms: r.duration_ms ?? null,
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
  const [settingsResult, summaryResult] = await Promise.all([
    admin
      .from("media_retention_settings")
      .select("media_family, retention_mode, retention_days, eligible_days, worker_enabled, dry_run, batch_size, max_attempts, notes, updated_at, updated_by")
      .order("media_family", { ascending: true }),
    admin.rpc("summarize_media_lifecycle_snapshot"),
  ]);

  if (settingsResult.error) throw new Error(`settings query failed: ${settingsResult.error.message}`);
  if (summaryResult.error) throw new Error(`snapshot summary RPC failed: ${summaryResult.error.message}`);

  const core = buildSnapshotFromSummary(
    (settingsResult.data ?? []) as SettingsRow[],
    (summaryResult.data ?? {}) as SnapshotSummary,
  );

  const [opsStatus, opsJobs] = await Promise.all([
    fetchCronStatusViaSQL(admin),
    fetchOpsJobLists(admin),
  ]);
  const recommendedActivation = buildActivationRecommendation(core, opsStatus);

  return {
    ...core,
    recommended_activation: recommendedActivation,
    ops: {
      health: opsStatus.health,
      cron_status: opsStatus.cron_status,
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
  targetType: string,
  targetKey: string | null,
  details: Record<string, unknown>,
): Promise<AuditLogResult> {
  const { error } = await admin.from("admin_activity_logs").insert({
    admin_id: adminUserId,
    action_type: actionType,
    target_type: targetType,
    target_id: null,
    details: { ...details, target_key: targetKey },
  });
  if (error) {
    console.error("admin-media-lifecycle-controls activity log failed:", error.message);
    return { audit_logged: false, audit_error: error.message };
  }
  return { audit_logged: true, audit_error: null };
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
        cron_status: opsStatus.cron_status,
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

      const audit = await logAdminAction(auth.admin, auth.userId, "media_jobs_requeue_stale", "media_delete_jobs", null, {
        stale_minutes: staleMinutes,
        requeued_count: requeuedCount,
      });

      console.log(`[admin-media-lifecycle-controls] requeue_stale: requeued=${requeuedCount} stale_minutes=${staleMinutes} admin=${auth.userId}`);
      return json({ success: true, requeued_count: requeuedCount, ...audit });
    }

    // ── Mutation: retry_failed ────────────────────────────────────────────────

    if (action === "retry_failed") {
      const family = typeof body.family === "string" ? body.family : null;
      const status = typeof body.status === "string" ? body.status : null;
      const limit = typeof body.limit === "number" ? body.limit : 50;
      const resetAttempts = body.reset_attempts === true;

      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        return json({ success: false, error: "limit must be an integer between 1 and 500" }, 400);
      }
      if (status !== null && !["failed", "abandoned"].includes(status)) {
        return json({ success: false, error: "status must be failed, abandoned, or null" }, 400);
      }

      const { data: retriedCount, error: retryError } = await auth.admin
        .rpc("retry_failed_media_delete_jobs", {
          p_family: family,
          p_limit: limit,
          p_reset_attempts: resetAttempts,
          p_status: status,
        });

      if (retryError) {
        console.error("retry_failed RPC failed:", retryError.message);
        return json({ success: false, error: retryError.message }, 500);
      }

      const audit = await logAdminAction(auth.admin, auth.userId, "media_jobs_retry_failed", "media_delete_jobs", null, {
        family,
        status,
        limit,
        reset_attempts: resetAttempts,
        retried_count: retriedCount,
      });

      console.log(`[admin-media-lifecycle-controls] retry_failed: retried=${retriedCount} family=${family ?? "all"} status=${status ?? "all"} reset_attempts=${resetAttempts} admin=${auth.userId}`);
      return json({ success: true, retried_count: retriedCount, ...audit });
    }

    // ── Mutation: repair_orphan_event_covers ────────────────────────────────

    if (action === "repair_orphan_event_covers") {
      const limit = typeof body.limit === "number" ? body.limit : 50;
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        return json({ success: false, error: "limit must be an integer between 1 and 500" }, 400);
      }

      const { data: repairResult, error: repairError } = await auth.admin
        .rpc("repair_event_cover_media_lifecycle", { p_limit: limit });

      if (repairError) {
        console.error("repair_orphan_event_covers RPC failed:", repairError.message);
        return json({ success: false, error: repairError.message }, 500);
      }

      const repairSummary = (repairResult ?? {}) as Record<string, unknown>;
      const syncedEvents = numericRecordValue(repairSummary, "synced_events");
      const softDeletedAssets = numericRecordValue(repairSummary, "soft_deleted_assets");
      const repairedCount = numericRecordValue(repairSummary, "repaired_count") || syncedEvents + softDeletedAssets;

      const audit = await logAdminAction(auth.admin, auth.userId, "media_orphan_event_covers_repaired", "media_assets", null, {
        limit,
        repaired_count: repairedCount,
        synced_events: syncedEvents,
        soft_deleted_assets: softDeletedAssets,
      });

      const snapshot = await fetchSnapshot(auth.admin);
      console.log(`[admin-media-lifecycle-controls] repair_orphan_event_covers: repaired=${repairedCount} synced_events=${syncedEvents} soft_deleted_assets=${softDeletedAssets} limit=${limit} admin=${auth.userId}`);
      return json({
        success: true,
        repaired_count: repairedCount,
        synced_events: syncedEvents,
        soft_deleted_assets: softDeletedAssets,
        ...audit,
        ...snapshot,
      });
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
        try {
          updates.retention_days = ensureNonNegativeInteger("retention_days", body.retention_days);
        } catch (error) {
          return validationResponse(error);
        }
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

      const audit = await logAdminAction(auth.admin, auth.userId, "media_retention_setting_updated", "media_retention_settings", String(mediaFamily), {
        before: currentRow,
        after: updatedRow,
      });

      const snapshot = await fetchSnapshot(auth.admin);
      return json({ success: true, updated: updatedRow, ...audit, ...snapshot });
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
        try {
          updates.eligible_days = ensureNonNegativeInteger("eligible_days", body.eligible_days);
        } catch (error) {
          return validationResponse(error);
        }
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

      const audit = await logAdminAction(auth.admin, auth.userId, "media_retention_chat_policy_updated", "media_retention_settings", "chat_media_group", {
        before: currentRows,
        after: updatedRows,
      });

      const snapshot = await fetchSnapshot(auth.admin);
      return json({ success: true, updated: updatedRows, ...audit, ...snapshot });
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
