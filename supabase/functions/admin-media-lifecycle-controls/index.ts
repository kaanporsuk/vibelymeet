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
  media_assets?: JobAssetRow | JobAssetRow[] | null;
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

  const recommendationVerdict = orphanLikeTotal > 0 || failedJobTotal > 0
    ? "keep_disabled"
    : "enable_later";

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
      notes: [
        "The existing process-media-delete-jobs dry-run only previews queued pending/failed jobs.",
        "This admin snapshot adds promotable soft_deleted assets so operators can see what a real run would likely process first.",
        "verification_selfie remains worker-disabled and is excluded from rollout recommendations.",
      ],
    },
    recommended_activation: {
      verdict: recommendationVerdict,
      initial_batch_size: 10,
      initial_cadence: "every 15 minutes",
      retry_behavior: "DB-owned exponential backoff: 1m, 5m, 25m, 2h, 10h, up to per-family max_attempts (default 5).",
      initial_family_filter: null,
      rollback: [
        "Disable the scheduler / remove the cron job.",
        "Set worker_enabled = false for any affected media families in the admin panel.",
        "Leave existing queued jobs untouched while you inspect media_delete_jobs and provider logs.",
      ],
      rationale: recommendationVerdict === "keep_disabled"
        ? "Keep cron disabled until orphan-like or failed-job anomalies are resolved."
        : "One manual monitored live execution should happen before enabling cron. After that, start with a small batch and observe queue/error behavior.",
    },
  };
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
      .select("id, asset_id, provider, status, job_type, attempts, max_attempts, next_attempt_at, last_error, created_at, media_assets!inner(media_family, status, purge_after)"),
  ]);

  if (settingsResult.error) {
    throw new Error(`settings query failed: ${settingsResult.error.message}`);
  }
  if (assetsResult.error) {
    throw new Error(`assets query failed: ${assetsResult.error.message}`);
  }
  if (jobsResult.error) {
    throw new Error(`jobs query failed: ${jobsResult.error.message}`);
  }

  return buildSnapshot(
    (settingsResult.data ?? []) as SettingsRow[],
    (assetsResult.data ?? []) as AssetRow[],
    (jobsResult.data ?? []) as JobRow[],
  );
}

function ensureNonNegativeInteger(name: string, value: unknown, allowNull = true) {
  if (value === null && allowNull) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer${allowNull ? " or null" : ""}`);
  }
  return value;
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return auth.error;
  }

  try {
    if (req.method === "GET") {
      const snapshot = await fetchSnapshot(auth.admin);
      return json({ success: true, ...snapshot });
    }

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const action = typeof body.action === "string" ? body.action : "snapshot";
    if (action === "snapshot") {
      const snapshot = await fetchSnapshot(auth.admin);
      return json({ success: true, ...snapshot });
    }

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
