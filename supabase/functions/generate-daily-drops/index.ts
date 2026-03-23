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
  }

  if (forceRegenerate && !isAdminJwt) {
    return new Response(
      JSON.stringify({ success: false, error: "force_regenerate_requires_admin_jwt" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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
    await supabase
      .from("daily_drops")
      .update({ status: "expired_no_action", updated_at: new Date().toISOString() })
      .lt("expires_at", now.toISOString())
      .in("status", ["active_unopened", "active_viewed"]);

    await supabase
      .from("daily_drops")
      .update({ status: "expired_no_reply", updated_at: new Date().toISOString() })
      .lt("expires_at", now.toISOString())
      .eq("status", "active_opener_sent");

    // STEP 2: Apply cooldowns for yesterday's drops only (avoid rows touched today for unrelated reasons)
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayDate = yesterday.toISOString().split("T")[0];

    const { data: newlyExpired } = await supabase
      .from("daily_drops")
      .select("user_a_id, user_b_id, status")
      .eq("drop_date", yesterdayDate)
      .in("status", ["expired_no_action", "expired_no_reply", "passed"]);

    if (newlyExpired) {
      for (const drop of newlyExpired) {
        let cooldownDays = 7;
        let reason = "no_action";
        if (drop.status === "expired_no_reply") { cooldownDays = 21; reason = "no_reply"; }
        if (drop.status === "passed") { cooldownDays = 30; reason = "passed"; }

        const cooldownDate = new Date();
        cooldownDate.setUTCDate(cooldownDate.getUTCDate() + cooldownDays);

        await supabase
          .from("daily_drop_cooldowns")
          .upsert({
            user_a_id: drop.user_a_id,
            user_b_id: drop.user_b_id,
            cooldown_until: cooldownDate.toISOString().split("T")[0],
            reason,
          }, { onConflict: "user_a_id,user_b_id" });
      }
    }

    // STEP 3: Check if drops already exist for today
    const { count: existingCount } = await supabase
      .from("daily_drops")
      .select("id", { count: "exact", head: true })
      .eq("drop_date", today);

    if ((existingCount || 0) > 0) {
      if (forceRegenerate && isAdminJwt) {
        await supabase.from("daily_drops").delete().eq("drop_date", today);
      } else {
        return new Response(
          JSON.stringify({ success: false, reason: "Drops already generated for today", existing: existingCount }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // STEP 4: Get eligible users (active in last 7 days)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();

    const { data: eligibleUsers } = await supabase
      .from("profiles")
      .select("id, name, gender, interested_in, age, is_suspended, is_paused, paused_until")
      .gte("updated_at", sevenDaysAgo)
      .or("is_suspended.is.null,is_suspended.eq.false");

    const eligibleUsersFiltered = (eligibleUsers || []).filter(
      (u: { is_paused?: boolean; paused_until?: string | null }) => {
        if (!u.is_paused) return true;
        const until = u.paused_until;
        if (!until) {
          // paused indefinitely or missing timestamp: treat as still paused
          return false;
        }
        const untilDate = new Date(until);
        if (Number.isNaN(untilDate.getTime())) {
          // invalid timestamp: safest is to keep user paused
          return false;
        }
        return untilDate <= now;
      }
    );

    eligibleUsersFiltered.sort((a: { id: string }, b: { id: string }) =>
      a.id.localeCompare(b.id)
    );

    if (!eligibleUsersFiltered || eligibleUsersFiltered.length < 2) {
      return new Response(
        JSON.stringify({ success: true, pairs_created: 0, reason: "Not enough eligible users" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // STEP 5: Get exclusions
    const { data: existingMatches } = await supabase.from("matches").select("profile_id_1, profile_id_2");
    const { data: blocks } = await supabase.from("blocked_users").select("blocker_id, blocked_id");
    const { data: activeCooldowns } = await supabase.from("daily_drop_cooldowns").select("user_a_id, user_b_id").gte("cooldown_until", today);

    const matchSet = new Set((existingMatches || []).map(m => [m.profile_id_1, m.profile_id_2].sort().join(":")));
    const blockSet = new Set((blocks || []).flatMap(b => [`${b.blocker_id}:${b.blocked_id}`, `${b.blocked_id}:${b.blocker_id}`]));
    const cooldownSet = new Set((activeCooldowns || []).map(c => `${c.user_a_id}:${c.user_b_id}`));

    // STEP 6: Get vibe tags for scoring
    const userIds = eligibleUsersFiltered.map(u => u.id);
    const { data: allVibes } = await supabase.from("profile_vibes").select("profile_id, vibe_tag_id").in("profile_id", userIds);

    const vibeMap: Record<string, Set<string>> = {};
    (allVibes || []).forEach(v => {
      if (!vibeMap[v.profile_id]) vibeMap[v.profile_id] = new Set();
      vibeMap[v.profile_id].add(v.vibe_tag_id);
    });

    // STEP 7: Get tag labels
    const allTagIds = new Set((allVibes || []).map(v => v.vibe_tag_id));
    const { data: tagLabels } = await supabase.from("vibe_tags").select("id, label, emoji").in("id", Array.from(allTagIds));
    const tagMap: Record<string, { label: string; emoji: string }> = {};
    (tagLabels || []).forEach(t => { tagMap[t.id] = { label: t.label, emoji: t.emoji }; });

    // STEP 8: Gender compatibility
    const isGenderCompatible = (a: typeof eligibleUsers[0], b: typeof eligibleUsers[0]): boolean => {
      const aInt = (a.interested_in as string[]) || [];
      const bInt = (b.interested_in as string[]) || [];
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

        if (matchSet.has(pairKey) || blockSet.has(`${a.id}:${b.id}`) || blockSet.has(`${b.id}:${a.id}`) || cooldownSet.has(pairKey)) continue;
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
        return new Response(
          JSON.stringify({
            success: false,
            error: "insert_failed",
            details: insertError.message,
            pairs_attempted: pairs.length,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      insertedRows = inserted?.length ?? 0;
      if (insertedRows !== pairs.length) {
        console.error("[generate-daily-drops] insert_partial", {
          attempted: pairs.length,
          persisted: insertedRows,
        });
        return new Response(
          JSON.stringify({
            success: false,
            error: "insert_partial",
            pairs_attempted: pairs.length,
            pairs_persisted: insertedRows,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
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
    for (const userId of notifiedUserIds) {
      try {
        await supabase.functions.invoke("send-notification", {
          body: {
            user_id: userId,
            category: "daily_drop",
            title: "💧 Your Daily Drop is ready",
            body: "Someone new is waiting to meet you. Open the app to see who.",
            data: { url: "/matches" },
          },
        });
      } catch (e) {
        console.error("[generate-daily-drops] notify_failed", userId, e);
      }
    }
    if (notifiedUserIds.size > 0) {
      console.log("[generate-daily-drops] notify_fanout_end", { users: notifiedUserIds.size });
    }

    return new Response(
      JSON.stringify({
        success: true,
        pairs_created: insertedRows,
        users_notified: notifiedUserIds.size,
        unpaired_users: eligibleUsersFiltered.length - paired.size,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("generate-daily-drops error:", error);
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
