import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DAILY_API_KEY = Deno.env.get("DAILY_API_KEY")!;
const DAILY_API_URL = "https://api.daily.co/v1";

async function deleteDailyRoom(roomName: string): Promise<void> {
  try {
    await fetch(`${DAILY_API_URL}/rooms/${encodeURIComponent(roomName)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${DAILY_API_KEY}` },
    });
  } catch {
    // best-effort
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization") || "";
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  /** Avoid racing with clients still tearing down (~30s ring + transitions). */
  const cutoffIso = new Date(Date.now() - 120_000).toISOString();

  const { data: rows, error } = await supabase
    .from("match_calls")
    .select("id, daily_room_name, status, ended_at")
    .in("status", ["missed", "declined", "ended"])
    .not("daily_room_name", "is", null)
    .lte("ended_at", cutoffIso)
    .order("ended_at", { ascending: true })
    .limit(40);

  if (error) {
    console.error("match-call-room-cleanup query:", error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let deleted = 0;
  for (const row of rows ?? []) {
    const name = row.daily_room_name as string | null;
    if (!name) continue;
    await deleteDailyRoom(name);
    deleted++;
  }

  console.log(
    JSON.stringify({
      event: "match_call_room_cleanup_batch",
      cutoff_iso: cutoffIso,
      candidates: rows?.length ?? 0,
      daily_delete_attempts: deleted,
    }),
  );

  return new Response(
    JSON.stringify({
      ok: true,
      candidates: rows?.length ?? 0,
      daily_delete_attempts: deleted,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
