import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { isBrowserOriginRejected, jsonResponse, preflightResponse } from "../_shared/cors.ts";

const MESSAGE_SELECT =
  "id, match_id, sender_id, content, created_at, read_at, audio_url, audio_duration_seconds, video_url, video_duration_seconds, message_kind, ref_id, structured_payload";

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function primaryPhotoPath(input: { photos?: unknown; avatar_url?: string | null }): string | null {
  const photos = Array.isArray(input.photos) ? input.photos : [];
  for (const photo of photos) {
    if (typeof photo === "string" && photo.trim()) return photo.trim();
  }
  return typeof input.avatar_url === "string" && input.avatar_url.trim() ? input.avatar_url.trim() : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return preflightResponse(req);
  }

  if (isBrowserOriginRejected(req)) {
    return jsonResponse(req, { success: false, error: "origin_not_allowed" }, { status: 403 });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse(req, { success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null) as {
      other_user_id?: unknown;
      before_created_at?: unknown;
      limit?: unknown;
    } | null;
    const otherUserId = body?.other_user_id;
    if (!isUuid(otherUserId)) {
      return jsonResponse(req, { success: false, error: "invalid_other_user_id" }, { status: 400 });
    }

    const limitRaw = typeof body?.limit === "number" ? Math.floor(body.limit) : 28;
    const limit = Math.min(50, Math.max(1, limitRaw));
    const beforeCreatedAt =
      typeof body?.before_created_at === "string" && !Number.isNaN(Date.parse(body.before_created_at))
        ? body.before_created_at
        : null;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return jsonResponse(req, { success: false, error: "Unauthorized" }, { status: 401 });
    }

    const currentUserId = user.id;
    const { data: match, error: matchError } = await serviceClient
      .from("matches")
      .select("id, profile_id_1, profile_id_2")
      .or(
        `and(profile_id_1.eq.${currentUserId},profile_id_2.eq.${otherUserId}),and(profile_id_1.eq.${otherUserId},profile_id_2.eq.${currentUserId})`,
      )
      .maybeSingle();

    if (matchError) throw matchError;
    if (!match) {
      return jsonResponse(req, {
        success: true,
        match_id: null,
        other_user: null,
        messages: [],
        next_cursor: null,
      });
    }

    let messagesQuery = serviceClient
      .from("messages")
      .select(MESSAGE_SELECT)
      .eq("match_id", match.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (beforeCreatedAt) {
      messagesQuery = messagesQuery.lt("created_at", beforeCreatedAt);
    }

    const [messagesRes, profileRes, presenceRes] = await Promise.all([
      messagesQuery,
      serviceClient
        .from("profiles")
        .select("id, name, age, avatar_url, photos, photo_verified, subscription_tier, bunny_video_uid")
        .eq("id", otherUserId)
        .maybeSingle(),
      userClient.rpc("get_chat_partner_presence", { p_match_id: match.id }).maybeSingle(),
    ]);

    if (messagesRes.error) throw messagesRes.error;
    if (profileRes.error) throw profileRes.error;

    const rowsDesc = messagesRes.data ?? [];
    const rowsAsc = [...rowsDesc].reverse();
    const presence = !presenceRes.error &&
      presenceRes.data &&
      typeof presenceRes.data === "object" &&
      (presenceRes.data as { can_view_presence?: unknown }).can_view_presence === true
      ? presenceRes.data as { is_online?: boolean | null; last_seen_at?: string | null }
      : null;

    const profile = profileRes.data;
    const otherUser = profile
      ? {
          ...profile,
          avatar_url: primaryPhotoPath(profile),
          last_seen_at: presence?.last_seen_at ?? null,
          is_online: presence?.is_online === true,
        }
      : null;

    return jsonResponse(req, {
      success: true,
      match_id: match.id,
      other_user: otherUser,
      messages: rowsAsc,
      next_cursor: rowsDesc.length >= limit ? rowsDesc[rowsDesc.length - 1]?.created_at ?? null : null,
    });
  } catch (error) {
    console.error("chat-thread-page error:", error);
    return jsonResponse(
      req,
      { success: false, error: error instanceof Error ? error.message : "chat_thread_page_failed" },
      { status: 500 },
    );
  }
});
