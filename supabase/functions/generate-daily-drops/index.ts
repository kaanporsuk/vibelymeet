import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";

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

    // STEP 1: Expire old unresolved drops
    const { error: expireNoActionError } = await supabase
      .from("daily_drops")
      .update({ status: "expired_no_action", updated_at: new Date().toISOString() })
      .lt("expires_at", now.toISOString())
      .in("status", ["active_unopened", "active_viewed"]);
    if (expireNoActionError) {
      return await failDbStep("expire_old_unopened_drops", expireNoActionError);
    }

    const { error: expireNoReplyError } = await supabase
      .from("daily_drops")
      .update({ status: "expired_no_reply", updated_at: new Date().toISOString() })
      .lt("expires_at", now.toISOString())
      .eq("status", "active_opener_sent");
    if (expireNoReplyError) {
      return await failDbStep("expire_old_opener_sent_drops", expireNoReplyError);
    }

    // STEP 2: Apply cooldowns for yesterday's drops only (avoid rows touched today for unrelated reasons)
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayDate = yesterday.toISOString().split("T")[0];

    const { data: newlyExpired, error: newlyExpiredError } = await supabase
      .from("daily_drops")
      .select("user_a_id, user_b_id, status")
      .eq("drop_date", yesterdayDate)
      .in("status", ["expired_no_action", "expired_no_reply", "passed"]);
    if (newlyExpiredError) {
      return await failDbStep("select_newly_expired_drops", newlyExpiredError);
    }

    if (newlyExpired) {
      for (const drop of newlyExpired) {
        let cooldownDays = 7;
        let reason = "no_action";
        if (drop.status === "expired_no_reply") { cooldownDays = 21; reason = "no_reply"; }
        if (drop.status === "passed") { cooldownDays = 30; reason = "passed"; }

        const cooldownDate = new Date();
        cooldownDate.setUTCDate(cooldownDate.getUTCDate() + cooldownDays);
        const [cooldownUserA, cooldownUserB] = [drop.user_a_id, drop.user_b_id].sort();

        const { error: cooldownError } = await supabase
          .from("daily_drop_cooldowns")
          .upsert({
            user_a_id: cooldownUserA,
            user_b_id: cooldownUserB,
            cooldown_until: cooldownDate.toISOString().split("T")[0],
            reason,
          }, { onConflict: "user_a_id,user_b_id" });
        if (cooldownError) {
          return await failDbStep("upsert_daily_drop_cooldown", cooldownError, {
            drop_status: drop.status,
            cooldown_reason: reason,
          });
        }
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

    // STEP 4: Get eligible users (active in last 7 days)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();

    const { data: eligibleUsers, error: eligibleUsersError } = await supabase
      .from("profiles")
      .select(
        "id, name, gender, interested_in, age, is_suspended, is_paused, paused_until, account_paused, account_paused_until, discoverable, discovery_mode, discovery_snooze_until, discovery_audience",
      )
      .gte("updated_at", sevenDaysAgo)
      .or("is_suspended.is.null,is_suspended.eq.false");
    if (eligibleUsersError) {
      return await failDbStep("select_eligible_users", eligibleUsersError);
    }

    type EligibleRow = {
      id: string;
      gender?: string | null;
      interested_in?: string[] | null;
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

    const eligibleUsersFiltered = (eligibleUsers || []).filter((u: EligibleRow) => {
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

    if (!eligibleUsersFiltered || eligibleUsersFiltered.length < 2) {
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

    // STEP 5: Get exclusions
    const { data: existingMatches, error: existingMatchesError } = await supabase.from("matches").select("profile_id_1, profile_id_2");
    if (existingMatchesError) {
      return await failDbStep("select_existing_matches", existingMatchesError);
    }

    const { data: blocks, error: blocksError } = await supabase.from("blocked_users").select("blocker_id, blocked_id");
    if (blocksError) {
      return await failDbStep("select_blocked_users", blocksError);
    }

    const { data: reports, error: reportsError } = await supabase.from("user_reports").select("reporter_id, reported_id");
    if (reportsError) {
      return await failDbStep("select_user_reports", reportsError);
    }

    const { data: activeCooldowns, error: activeCooldownsError } = await supabase
      .from("daily_drop_cooldowns")
      .select("user_a_id, user_b_id")
      .gte("cooldown_until", today);
    if (activeCooldownsError) {
      return await failDbStep("select_active_cooldowns", activeCooldownsError);
    }

    const matchSet = new Set((existingMatches || []).map(m => [m.profile_id_1, m.profile_id_2].sort().join(":")));
    const blockSet = new Set((blocks || []).flatMap(b => [`${b.blocker_id}:${b.blocked_id}`, `${b.blocked_id}:${b.blocker_id}`]));
    const reportSet = new Set((reports || []).flatMap(r => [`${r.reporter_id}:${r.reported_id}`, `${r.reported_id}:${r.reporter_id}`]));
    const cooldownSet = new Set((activeCooldowns || []).map(c => [c.user_a_id, c.user_b_id].sort().join(":")));

    // STEP 6: Get vibe tags for scoring
    const userIds = eligibleUsersFiltered.map(u => u.id);
    // Co-attendance is used only for internal event-based discovery eligibility.
    // Daily Drop rows, reasons, and notifications below do not expose event ids,
    // event names, or "you both attended" copy to users.
    const { data: confirmedRegistrations, error: confirmedRegistrationsError } = await supabase
      .from("event_registrations")
      .select("profile_id, event_id")
      .in("profile_id", userIds)
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
      .in("profile_id", userIds);
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

    // STEP 8: Gender compatibility
    const isGenderCompatible = (a: EligibleRow, b: EligibleRow): boolean => {
      const aInt = Array.isArray(a.interested_in) ? a.interested_in : [];
      const bInt = Array.isArray(b.interested_in) ? b.interested_in : [];
      const aLikesB = aInt.length === 0 || aInt.includes(b.gender);
      const bLikesA = bInt.length === 0 || bInt.includes(a.gender);
      return aLikesB && bLikesA;
    };

    // STEP 9: Score and pair
    const scoredPairs: Array<{ id_a: string; id_b: string; score: number; reasons: string[] }> = [];

    for (let i = 0; i < eligibleUsersFiltered.length; i++) {
      for (let j = i + 1; j < eligibleUsersFiltered.length; j++) {
        const a = eligibleUsersFiltered[i], b = eligibleUsersFiltered[j];
        const [lo, hi] = [a.id, b.id].sort();
        const pairKey = `${lo}:${hi}`;

        if (
          matchSet.has(pairKey)
          || blockSet.has(`${a.id}:${b.id}`)
          || blockSet.has(`${b.id}:${a.id}`)
          || reportSet.has(`${a.id}:${b.id}`)
          || reportSet.has(`${b.id}:${a.id}`)
          || cooldownSet.has(pairKey)
        ) continue;
        if (!mutuallyDiscoverable(a, b)) continue;
        if (!isGenderCompatible(a, b)) continue;

        const aVibes = vibeMap[a.id] || new Set();
        const bVibes = vibeMap[b.id] || new Set();
        let overlap = 0;
        const sharedTagIds: string[] = [];
        aVibes.forEach(tagId => { if (bVibes.has(tagId)) { overlap++; sharedTagIds.push(tagId); } });

        const reasons: string[] = [];
        const sharedLabels = sharedTagIds.slice(0, 3).map(id => {
          const tag = tagMap[id];
          return tag ? `${tag.emoji} ${tag.label}` : null;
        }).filter(Boolean);

        if (sharedLabels.length > 0) reasons.push(`Shared vibes: ${sharedLabels.join(", ")}`);
        if (overlap >= 3) reasons.push("Strong vibe alignment");
        if (reasons.length === 0) reasons.push("New connection opportunity");

        scoredPairs.push({ id_a: lo, id_b: hi, score: overlap, reasons });
      }
    }

    scoredPairs.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const c = a.id_a.localeCompare(b.id_a);
      if (c !== 0) return c;
      return a.id_b.localeCompare(b.id_b);
    });

    const paired = new Set<string>();
    const pairs: Array<{ user_a_id: string; user_b_id: string; affinity_score: number; pick_reasons: string[] }> = [];

    for (const sp of scoredPairs) {
      if (paired.has(sp.id_a) || paired.has(sp.id_b)) continue;
      paired.add(sp.id_a);
      paired.add(sp.id_b);
      pairs.push({ user_a_id: sp.id_a, user_b_id: sp.id_b, affinity_score: sp.score, pick_reasons: sp.reasons });
    }

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
    for (const userId of notifiedUserIds) {
      try {
        const { error: notifyError } = await supabase.functions.invoke("send-notification", {
          body: {
            user_id: userId,
            category: "daily_drop",
            title: "💧 Your Daily Drop is ready",
            body: "Someone new is waiting to meet you. Open the app to see who.",
            data: { url: "/matches" },
          },
        });
        if (notifyError) {
          notificationFailures += 1;
          console.error("[generate-daily-drops] notify_failed", userId, notifyError.message ?? notifyError);
          continue;
        }
        notifiedSuccessCount += 1;
      } catch (e) {
        notificationFailures += 1;
        console.error("[generate-daily-drops] notify_failed", userId, e);
      }
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
