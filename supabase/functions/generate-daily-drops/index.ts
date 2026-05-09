import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { capture as posthogCapture } from "../_shared/posthog.ts";
import { pickPairs, type MatcherUser } from "../_shared/dailyDropMatcher.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function authError(status: number, body: { error: string }, cronSecretMissing: boolean): Response {
  const code = cronSecretMissing ? 503 : status;
  const msg = cronSecretMissing ? "Service unavailable" : body.error;
  return new Response(JSON.stringify({ error: msg }), {
    status: code,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type ServiceClient = ReturnType<typeof createClient>;
type GenerationRunStatus = "succeeded" | "skipped" | "failed" | "partial";
type GenerationRunSource = "cron" | "admin" | "unknown";
type SupabaseDbError = {
  message?: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
};
type PostgrestFilterBuilder = {
  gte: (column: string, value: string) => PostgrestFilterBuilder;
  or: (filters: string) => PromiseLike<{ data: unknown[] | null; error: SupabaseDbError | null }>;
};

type CompleteGenerationRunArgs = {
  status: GenerationRunStatus;
  source: GenerationRunSource;
  force: boolean;
  adminId: string | null;
  pairsCreated?: number;
  usersNotified?: number;
  unpairedUsers?: number | null;
  reason?: string | null;
  error?: string | null;
  details?: Record<string, unknown>;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function dbErrorMessage(error: SupabaseDbError | null | undefined, fallback: string): string {
  return error?.message || fallback;
}

function dbErrorDetails(error: SupabaseDbError | null | undefined): Record<string, unknown> {
  return {
    db_code: error?.code ?? null,
    db_details: error?.details ?? null,
    db_hint: error?.hint ?? null,
  };
}

const ELIGIBLE_FILTER_CHUNK_SIZE = 100;

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

async function selectEligiblePairRows<T extends Record<string, unknown>>(
  supabase: ServiceClient,
  table: string,
  selectColumns: string,
  leftColumn: string,
  rightColumn: string,
  eligibleUserIds: string[],
  configure?: (query: PostgrestFilterBuilder) => PostgrestFilterBuilder,
): Promise<{ data: T[]; error: SupabaseDbError | null }> {
  const rows: T[] = [];
  const seenRows = new Set<string>();

  for (const chunk of chunkValues(eligibleUserIds, ELIGIBLE_FILTER_CHUNK_SIZE)) {
    const eligibleIdsCsv = chunk.join(",");
    let query = supabase
      .from(table)
      .select(selectColumns) as unknown as PostgrestFilterBuilder;
    query = configure ? configure(query) : query;

    const { data, error } = await query.or(`${leftColumn}.in.(${eligibleIdsCsv}),${rightColumn}.in.(${eligibleIdsCsv})`);
    if (error) {
      return { data: rows, error };
    }

    for (const row of data ?? []) {
      const key = JSON.stringify(row);
      if (seenRows.has(key)) continue;
      seenRows.add(key);
      rows.push(row as T);
    }
  }

  return { data: rows, error: null };
}

async function createGenerationRun(
  supabase: ServiceClient,
  source: GenerationRunSource,
  force: boolean,
  adminId: string | null,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("daily_drop_generation_runs")
      .insert({
        status: "started",
        source,
        force,
        admin_id: adminId,
      })
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[generate-daily-drops] run_tracking_insert_failed", error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (error) {
    console.error("[generate-daily-drops] run_tracking_insert_failed", error);
    return null;
  }
}

async function completeGenerationRun(
  supabase: ServiceClient,
  runId: string | null,
  args: CompleteGenerationRunArgs,
): Promise<void> {
  const completion = {
    run_finished_at: new Date().toISOString(),
    status: args.status,
    pairs_created: args.pairsCreated ?? 0,
    users_notified: args.usersNotified ?? 0,
    unpaired_users: args.unpairedUsers ?? null,
    reason: args.reason ?? null,
    error: args.error ?? null,
    details: args.details ?? {},
  };

  if (runId) {
    try {
      const { error } = await supabase
        .from("daily_drop_generation_runs")
        .update(completion)
        .eq("id", runId);
      if (error) {
        console.error("[generate-daily-drops] run_tracking_update_failed", error.message);
      }
    } catch (error) {
      console.error("[generate-daily-drops] run_tracking_update_failed", error);
    }
  }

  void posthogCapture({
    event: `daily_drop_run_${args.status}`,
    distinct_id: args.adminId ?? `cron:${args.source}`,
    properties: {
      run_id: runId,
      source: args.source,
      force: args.force,
      pairs_created: completion.pairs_created,
      users_notified: completion.users_notified,
      unpaired_users: completion.unpaired_users,
      reason: completion.reason,
      error: completion.error,
    },
  });

  if (!args.adminId) return;

  try {
    const { error } = await supabase
      .from("admin_activity_logs")
      .insert({
        admin_id: args.adminId,
        action_type: "generate_daily_drops",
        target_type: "daily_drop",
        target_id: null,
        details: {
          run_id: runId,
          source: args.source,
          force: args.force,
          status: args.status,
          pairs_created: completion.pairs_created,
          users_notified: completion.users_notified,
          unpaired_users: completion.unpaired_users,
          reason: completion.reason,
          error: completion.error,
        },
      });
    if (error) {
      console.error("[generate-daily-drops] admin_audit_insert_failed", error.message);
    }
  } catch (error) {
    console.error("[generate-daily-drops] admin_audit_insert_failed", error);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let requestBody: { force?: boolean } = {};
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      requestBody = await req.json();
    } catch {
      requestBody = {};
    }
  }
  const forceRegenerate = Boolean(requestBody.force);

  const cronSecret = Deno.env.get("CRON_SECRET");
  const cronSecretMissing = !cronSecret || cronSecret.trim() === "";
  const incoming = req.headers.get("Authorization");

  let isCron = false;
  let isAdminJwt = false;
  let adminUserId: string | null = null;

  if (incoming && !cronSecretMissing && incoming === `Bearer ${cronSecret}`) {
    isCron = true;
  } else {
    if (!incoming) {
      return authError(401, { error: "Unauthorized" }, cronSecretMissing);
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: incoming } },
    });
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
    if (authErr || !user) {
      return authError(401, { error: "Unauthorized" }, cronSecretMissing);
    }
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const { data: roleRow } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) {
      return authError(403, { error: "Forbidden" }, cronSecretMissing);
    }
    isAdminJwt = true;
    adminUserId = user.id;
  }

  if (forceRegenerate && !isAdminJwt) {
    return jsonResponse({ success: false, error: "force_regenerate_requires_admin_jwt" }, 403);
  }

  const generationSource: GenerationRunSource = isCron ? "cron" : isAdminJwt ? "admin" : "unknown";
  let supabase: ServiceClient | null = null;
  let generationRunId: string | null = null;

  try {
    supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    generationRunId = await createGenerationRun(supabase, generationSource, forceRegenerate, adminUserId);
    void posthogCapture({
      event: "daily_drop_run_started",
      distinct_id: adminUserId ?? `cron:${generationSource}`,
      properties: {
        run_id: generationRunId,
        source: generationSource,
        force: forceRegenerate,
      },
    });

    const failGenerationRun = async (
      errorCode: string,
      message: string,
      details: Record<string, unknown> = {},
    ): Promise<Response> => {
      await completeGenerationRun(supabase!, generationRunId, {
        status: "failed",
        source: generationSource,
        force: forceRegenerate,
        adminId: adminUserId,
        error: message,
        details: { error_code: errorCode, ...details },
      });
      return jsonResponse({ success: false, error: errorCode, details: message });
    };

    const failDbStep = async (
      step: string,
      error: SupabaseDbError | null | undefined,
      details: Record<string, unknown> = {},
    ): Promise<Response> => {
      console.error("[generate-daily-drops] database_step_failed", {
        step,
        message: error?.message,
        code: error?.code,
      });
      return failGenerationRun(
        "database_step_failed",
        dbErrorMessage(error, `Daily Drop database step failed: ${step}`),
        { step, ...dbErrorDetails(error), ...details },
      );
    };

    const today = new Date().toISOString().split("T")[0];
    const now = new Date();

    // Next 18:00 UTC (aligned with pg_cron batch hour)
    const expiresAtUtc = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
        18,
        0,
        0,
        0,
      ),
    );

    // STEP 1: Expire old unresolved drops in one database-owned statement.
    const { error: expirePendingError } = await supabase.rpc("expire_pending_daily_drops");
    if (expirePendingError) {
      return await failDbStep("expire_pending_daily_drops", expirePendingError);
    }

    // STEP 2: Apply cooldowns for every expired/passed pair missing an active
    // cooldown. This recovers safely if cron was down for more than one day.
    const { data: pendingCooldownPairs, error: pendingCooldownPairsError } = await supabase
      .rpc("select_pending_cooldown_pairs");
    if (pendingCooldownPairsError) {
      return await failDbStep("select_pending_cooldown_pairs", pendingCooldownPairsError);
    }

    type PendingCooldownPair = {
      user_a_id: string;
      user_b_id: string;
      drop_status: string;
      expired_at?: string | null;
    };

    for (const drop of (pendingCooldownPairs || []) as PendingCooldownPair[]) {
      let cooldownDays = 7;
      let reason = "no_action";
      if (drop.drop_status === "expired_no_reply") { cooldownDays = 21; reason = "no_reply"; }
      if (drop.drop_status === "passed") { cooldownDays = 30; reason = "passed"; }

      const cooldownDate = new Date(now);
      cooldownDate.setUTCDate(cooldownDate.getUTCDate() + cooldownDays);

      const { error: cooldownError } = await supabase.rpc("apply_drop_cooldown", {
        p_user_a: drop.user_a_id,
        p_user_b: drop.user_b_id,
        p_cooldown_until: cooldownDate.toISOString().split("T")[0],
        p_reason: reason,
      });
      if (cooldownError) {
        return await failDbStep("apply_drop_cooldown", cooldownError, {
          drop_status: drop.drop_status,
          cooldown_reason: reason,
          expired_at: drop.expired_at ?? null,
        });
      }
    }

    // STEP 3: Check if drops already exist for today
    const { count: existingCount, error: existingCountError } = await supabase
      .from("daily_drops")
      .select("id", { count: "exact", head: true })
      .eq("drop_date", today);
    if (existingCountError) {
      return await failDbStep("count_existing_today_drops", existingCountError, { drop_date: today });
    }

    if ((existingCount || 0) > 0) {
      if (forceRegenerate && isAdminJwt) {
        const { error: deleteError } = await supabase.from("daily_drops").delete().eq("drop_date", today);
        if (deleteError) {
          return await failDbStep("delete_existing_today_drops", deleteError, {
            drop_date: today,
            existing_count: existingCount ?? 0,
          });
        }
      } else {
        await completeGenerationRun(supabase, generationRunId, {
          status: "skipped",
          source: generationSource,
          force: forceRegenerate,
          adminId: adminUserId,
          reason: "Drops already generated for today",
          details: { existing_count: existingCount ?? 0, drop_date: today },
        });
        return jsonResponse({ success: false, reason: "Drops already generated for today", existing: existingCount });
      }
    }

    // STEP 4: Get eligible users (active in last 7 days, by last_seen_at with updated_at fallback)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();

    const { data: eligibleUsers, error: eligibleUsersError } = await supabase
      .from("profiles")
      .select(
        "id, name, gender, interested_in, age, preferred_age_min, preferred_age_max, last_seen_at, updated_at, is_suspended, is_paused, paused_until, account_paused, account_paused_until, discoverable, discovery_mode, discovery_snooze_until, discovery_audience",
      )
      .or("is_suspended.is.null,is_suspended.eq.false");
    if (eligibleUsersError) {
      return await failDbStep("select_eligible_users", eligibleUsersError);
    }

    type EligibleRow = {
      id: string;
      gender?: string | null;
      interested_in?: string[] | null;
      age?: number | null;
      preferred_age_min?: number | null;
      preferred_age_max?: number | null;
      last_seen_at?: string | null;
      updated_at?: string | null;
      is_suspended?: boolean | null;
      is_paused?: boolean | null;
      paused_until?: string | null;
      account_paused?: boolean | null;
      account_paused_until?: string | null;
      discoverable?: boolean | null;
      discovery_mode?: string | null;
      discovery_snooze_until?: string | null;
      discovery_audience?: string | null;
    };

    const sevenDaysAgoMs = new Date(sevenDaysAgo).getTime();

    const eligibleUsersFiltered = (eligibleUsers || []).filter((u: EligibleRow) => {
      // Recency: prefer last_seen_at, fall back to updated_at when null
      const recencySource = u.last_seen_at ?? u.updated_at ?? null;
      if (!recencySource) return false;
      const recencyDate = new Date(recencySource);
      if (Number.isNaN(recencyDate.getTime())) return false;
      if (recencyDate.getTime() < sevenDaysAgoMs) return false;

      if (u.is_suspended) return false;
      if (u.discoverable === false) return false;
      if ((u.discovery_audience ?? "everyone") === "hidden") return false;
      if ((u.discovery_mode ?? "visible") === "hidden") return false;
      if ((u.discovery_mode ?? "visible") === "snoozed") {
        const until = u.discovery_snooze_until;
        if (!until) return false;
        const untilDate = new Date(until);
        if (Number.isNaN(untilDate.getTime())) return false;
        if (untilDate > now) return false;
      }
      // Legacy pause check
      if (u.is_paused) {
        const until = u.paused_until;
        if (!until) return false;
        const untilDate = new Date(until);
        if (Number.isNaN(untilDate.getTime())) return false;
        if (untilDate > now) return false;
      }
      // New pause check
      if (u.account_paused) {
        const until = u.account_paused_until;
        if (!until) return false;
        const untilDate = new Date(until);
        if (Number.isNaN(untilDate.getTime())) return false;
        if (untilDate > now) return false;
      }
      return true;
    });

    eligibleUsersFiltered.sort((a: { id: string }, b: { id: string }) =>
      a.id.localeCompare(b.id)
    );

    if (eligibleUsersFiltered.length < 2) {
      await completeGenerationRun(supabase, generationRunId, {
        status: "skipped",
        source: generationSource,
        force: forceRegenerate,
        adminId: adminUserId,
        reason: "Not enough eligible users",
        details: { eligible_users: eligibleUsersFiltered.length, drop_date: today },
      });
      return jsonResponse({ success: true, pairs_created: 0, reason: "Not enough eligible users" });
    }

    // STEP 5: Get exclusions, scoped to currently eligible users to avoid
    // monotonically growing full-table scans of matches/blocks/reports.
    const eligibleUserIds = eligibleUsersFiltered.map((u: EligibleRow) => u.id);
    const { data: existingMatches, error: existingMatchesError } = await selectEligiblePairRows<{
      profile_id_1: string;
      profile_id_2: string;
    }>(
      supabase,
      "matches",
      "profile_id_1, profile_id_2",
      "profile_id_1",
      "profile_id_2",
      eligibleUserIds,
    );
    if (existingMatchesError) {
      return await failDbStep("select_existing_matches", existingMatchesError);
    }

    const { data: blocks, error: blocksError } = await selectEligiblePairRows<{
      blocker_id: string;
      blocked_id: string;
    }>(
      supabase,
      "blocked_users",
      "blocker_id, blocked_id",
      "blocker_id",
      "blocked_id",
      eligibleUserIds,
    );
    if (blocksError) {
      return await failDbStep("select_blocked_users", blocksError);
    }

    const { data: reports, error: reportsError } = await selectEligiblePairRows<{
      reporter_id: string;
      reported_id: string;
    }>(
      supabase,
      "user_reports",
      "reporter_id, reported_id",
      "reporter_id",
      "reported_id",
      eligibleUserIds,
    );
    if (reportsError) {
      return await failDbStep("select_user_reports", reportsError);
    }

    const { data: activeCooldowns, error: activeCooldownsError } = await selectEligiblePairRows<{
      user_a_id: string;
      user_b_id: string;
    }>(
      supabase,
      "daily_drop_cooldowns",
      "user_a_id, user_b_id",
      "user_a_id",
      "user_b_id",
      eligibleUserIds,
      (query) => query.gte("cooldown_until", today),
    );
    if (activeCooldownsError) {
      return await failDbStep("select_active_cooldowns", activeCooldownsError);
    }

    const matchSet = new Set((existingMatches || []).map(m => [m.profile_id_1, m.profile_id_2].sort().join(":")));
    const blockSet = new Set((blocks || []).flatMap(b => [`${b.blocker_id}:${b.blocked_id}`, `${b.blocked_id}:${b.blocker_id}`]));
    const reportSet = new Set((reports || []).flatMap(r => [`${r.reporter_id}:${r.reported_id}`, `${r.reported_id}:${r.reporter_id}`]));
    const cooldownSet = new Set((activeCooldowns || []).map(c => [c.user_a_id, c.user_b_id].sort().join(":")));

    // STEP 6: Get vibe tags for scoring
    // Co-attendance is used only for internal event-based discovery eligibility.
    // Daily Drop rows, reasons, and notifications below do not expose event ids,
    // event names, or "you both attended" copy to users.
    const { data: confirmedRegistrations, error: confirmedRegistrationsError } = await supabase
      .from("event_registrations")
      .select("profile_id, event_id")
      .in("profile_id", eligibleUserIds)
      .eq("admission_status", "confirmed");
    if (confirmedRegistrationsError) {
      return await failDbStep("select_confirmed_event_registrations", confirmedRegistrationsError);
    }

    const sharedEventIds = [...new Set((confirmedRegistrations || []).map((row: { event_id: string }) => row.event_id))];
    const { data: sharedEvents, error: sharedEventsError } = sharedEventIds.length > 0
      ? await supabase
        .from("events")
        .select("id, status, archived_at, event_date, duration_minutes, ended_at")
        .in("id", sharedEventIds)
      : { data: [], error: null };
    if (sharedEventsError) {
      return await failDbStep("select_shared_events", sharedEventsError);
    }

    type SharedEventRow = {
      id: string;
      status?: string | null;
      archived_at?: string | null;
      event_date?: string | null;
      duration_minutes?: number | null;
      ended_at?: string | null;
    };

    const eventIsQualifying = (event: SharedEventRow): boolean => {
      if (event.archived_at) return false;
      const status = event.status ?? "upcoming";
      if (status === "cancelled" || status === "draft") return false;
      const baseEnd = event.ended_at
        ? new Date(event.ended_at)
        : event.event_date
          ? new Date(new Date(event.event_date).getTime() + (event.duration_minutes ?? 60) * 60000)
          : null;
      if (!baseEnd || Number.isNaN(baseEnd.getTime())) return false;
      return now.getTime() <= baseEnd.getTime() + 6 * 60 * 60 * 1000;
    };

    const qualifyingEventIds = new Set(
      ((sharedEvents || []) as SharedEventRow[])
        .filter(eventIsQualifying)
        .map((event) => event.id),
    );

    const confirmedEventMap: Record<string, Set<string>> = {};
    (confirmedRegistrations || []).forEach((row: { profile_id: string; event_id: string }) => {
      if (!qualifyingEventIds.has(row.event_id)) return;
      if (!confirmedEventMap[row.profile_id]) confirmedEventMap[row.profile_id] = new Set();
      confirmedEventMap[row.profile_id].add(row.event_id);
    });

    const shareConfirmedEvent = (aId: string, bId: string): boolean => {
      const aEvents = confirmedEventMap[aId];
      const bEvents = confirmedEventMap[bId];
      if (!aEvents || !bEvents) return false;
      for (const eventId of aEvents) {
        if (bEvents.has(eventId)) return true;
      }
      return false;
    };

    const canDiscover = (viewer: EligibleRow, target: EligibleRow): boolean => {
      const audience = target.discovery_audience ?? "everyone";
      if (audience === "hidden") return false;
      if (audience === "event_based") return shareConfirmedEvent(viewer.id, target.id);
      return true;
    };

    const mutuallyDiscoverable = (a: EligibleRow, b: EligibleRow): boolean =>
      canDiscover(a, b) && canDiscover(b, a);

    const { data: allVibes, error: allVibesError } = await supabase
      .from("profile_vibes")
      .select("profile_id, vibe_tag_id")
      .in("profile_id", eligibleUserIds);
    if (allVibesError) {
      return await failDbStep("select_profile_vibes", allVibesError);
    }

    const vibeMap: Record<string, Set<string>> = {};
    (allVibes || []).forEach(v => {
      if (!vibeMap[v.profile_id]) vibeMap[v.profile_id] = new Set();
      vibeMap[v.profile_id].add(v.vibe_tag_id);
    });

    // STEP 7: Get tag labels
    const allTagIds = new Set((allVibes || []).map(v => v.vibe_tag_id));
    const tagIds = Array.from(allTagIds);
    const { data: tagLabels, error: tagLabelsError } = tagIds.length > 0
      ? await supabase.from("vibe_tags").select("id, label, emoji").in("id", tagIds)
      : { data: [], error: null };
    if (tagLabelsError) {
      return await failDbStep("select_vibe_tag_labels", tagLabelsError);
    }
    const tagMap: Record<string, { label: string; emoji: string }> = {};
    (tagLabels || []).forEach(t => { tagMap[t.id] = { label: t.label, emoji: t.emoji }; });

    // STEPS 8 + 9: Score + greedy-pair via the shared matcher module so the
    // algorithm is unit-tested independently of the Edge Function harness.
    const matcherUsers: MatcherUser[] = eligibleUsersFiltered.map((u: EligibleRow) => ({
      id: u.id,
      gender: u.gender ?? null,
      interested_in: u.interested_in ?? null,
      age: u.age ?? null,
      preferred_age_min: u.preferred_age_min ?? null,
      preferred_age_max: u.preferred_age_max ?? null,
    }));

    const eligibleById: Record<string, EligibleRow> = {};
    for (const u of eligibleUsersFiltered) eligibleById[u.id] = u;

    const matcherResult = pickPairs({
      users: matcherUsers,
      vibeMap,
      tagMap,
      matchSet,
      blockSet,
      reportSet,
      cooldownSet,
      mutuallyDiscoverable: (a, b) => {
        const ra = eligibleById[a.id];
        const rb = eligibleById[b.id];
        if (!ra || !rb) return false;
        return mutuallyDiscoverable(ra, rb);
      },
    });

    const pairs = matcherResult.pairs;
    const paired = new Set<string>(pairs.flatMap((p) => [p.user_a_id, p.user_b_id]));

    // STEP 10: Insert pairs
    let insertedRows = 0;
    if (pairs.length > 0) {
      const inserts = pairs.map(p => ({
        user_a_id: p.user_a_id,
        user_b_id: p.user_b_id,
        drop_date: today,
        starts_at: now.toISOString(),
        expires_at: expiresAtUtc.toISOString(),
        status: "active_unopened",
        affinity_score: p.affinity_score,
        pick_reasons: p.pick_reasons,
      }));
      const { data: inserted, error: insertError } = await supabase
        .from("daily_drops")
        .insert(inserts)
        .select("id");

      if (insertError) {
        console.error("[generate-daily-drops] insert_failed", {
          message: insertError.message,
          code: insertError.code,
          attempted: pairs.length,
        });
        await completeGenerationRun(supabase, generationRunId, {
          status: "failed",
          source: generationSource,
          force: forceRegenerate,
          adminId: adminUserId,
          error: insertError.message,
          details: {
            code: insertError.code,
            pairs_attempted: pairs.length,
            drop_date: today,
          },
        });
        return jsonResponse({
          success: false,
          error: "insert_failed",
          details: insertError.message,
          pairs_attempted: pairs.length,
        });
      }

      insertedRows = inserted?.length ?? 0;
      if (insertedRows !== pairs.length) {
        console.error("[generate-daily-drops] insert_partial", {
          attempted: pairs.length,
          persisted: insertedRows,
        });
        await completeGenerationRun(supabase, generationRunId, {
          status: "partial",
          source: generationSource,
          force: forceRegenerate,
          adminId: adminUserId,
          pairsCreated: insertedRows,
          error: "insert_partial",
          details: {
            pairs_attempted: pairs.length,
            pairs_persisted: insertedRows,
            drop_date: today,
          },
        });
        return jsonResponse({
          success: false,
          error: "insert_partial",
          pairs_attempted: pairs.length,
          pairs_persisted: insertedRows,
        });
      }
      console.log("[generate-daily-drops] insert_ok", { pairs_persisted: insertedRows, drop_date: today });
    }

    // STEP 11: Notify only after confirmed inserts
    const notifiedUserIds = new Set<string>();
    for (const pair of pairs) {
      notifiedUserIds.add(pair.user_a_id);
      notifiedUserIds.add(pair.user_b_id);
    }

    if (notifiedUserIds.size > 0) {
      console.log("[generate-daily-drops] notify_fanout_start", { users: notifiedUserIds.size });
    }
    let notifiedSuccessCount = 0;
    let notificationFailures = 0;
    const NOTIFY_CONCURRENCY = 25;
    const userIdList = [...notifiedUserIds];
    for (let i = 0; i < userIdList.length; i += NOTIFY_CONCURRENCY) {
      const chunk = userIdList.slice(i, i + NOTIFY_CONCURRENCY);
      const settled = await Promise.allSettled(chunk.map((userId) =>
        supabase.functions.invoke("send-notification", {
          body: {
            user_id: userId,
            category: "daily_drop",
            title: "💧 Your Daily Drop is ready",
            body: "Someone new is waiting to meet you. Open the app to see who.",
            data: { url: "/matches" },
          },
        }).then(({ error }) => {
          if (error) throw error;
        })
      ));
      settled.forEach((result, idx) => {
        if (result.status === "fulfilled") {
          notifiedSuccessCount += 1;
        } else {
          notificationFailures += 1;
          console.error("[generate-daily-drops] notify_failed", chunk[idx], result.reason?.message ?? result.reason);
        }
      });
    }
    if (notifiedUserIds.size > 0) {
      console.log("[generate-daily-drops] notify_fanout_end", {
        attempted: notifiedUserIds.size,
        succeeded: notifiedSuccessCount,
        failed: notificationFailures,
      });
    }

    await completeGenerationRun(supabase, generationRunId, {
      status: notificationFailures > 0 ? "partial" : insertedRows > 0 ? "succeeded" : "skipped",
      source: generationSource,
      force: forceRegenerate,
      adminId: adminUserId,
      pairsCreated: insertedRows,
      usersNotified: notifiedSuccessCount,
      unpairedUsers: eligibleUsersFiltered.length - paired.size,
      reason: notificationFailures > 0
        ? "Some notifications failed"
        : insertedRows > 0
          ? null
          : "No compatible pairs",
      details: {
        eligible_users: eligibleUsersFiltered.length,
        drop_date: today,
        notifications_attempted: notifiedUserIds.size,
        notification_failures: notificationFailures,
      },
    });

    return jsonResponse({
      success: true,
      pairs_created: insertedRows,
      users_notified: notifiedSuccessCount,
      notification_failures: notificationFailures,
      unpaired_users: eligibleUsersFiltered.length - paired.size,
    });
  } catch (error) {
    console.error("generate-daily-drops error:", error);
    if (supabase) {
      await completeGenerationRun(supabase, generationRunId, {
        status: "failed",
        source: generationSource,
        force: forceRegenerate,
        adminId: adminUserId,
        error: (error as Error).message,
      });
    }
    return jsonResponse({ success: false, error: (error as Error).message });
  }
});
