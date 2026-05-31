import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { isBrowserOriginRejected, jsonResponse, preflightResponse } from "../_shared/cors.ts";

const MESSAGE_SELECT =
  "id, match_id, sender_id, content, created_at, read_at, audio_url, audio_duration_seconds, video_url, video_duration_seconds, message_kind, ref_id, structured_payload";
const DATE_SUGGESTION_SELECT =
  "id, match_id, proposer_id, recipient_id, status, current_revision_id, draft_payload, expires_at, schedule_share_expires_at, expiring_soon_sent_at, date_plan_id, created_at, updated_at";
const DATE_SUGGESTION_REVISION_SELECT =
  "id, date_suggestion_id, revision_number, proposed_by, date_type_key, time_choice_key, place_mode_key, venue_text, optional_message, schedule_share_enabled, starts_at, ends_at, time_block, local_timezone, agreed_field_flags, created_at";
const DATE_PLAN_SELECT =
  "id, date_suggestion_id, match_id, starts_at, ends_at, venue_label, date_type_key, status, completion_initiated_by, completion_initiated_at, completion_confirmed_by, completion_confirmed_at";
const DATE_PLAN_PARTICIPANT_SELECT =
  "id, date_plan_id, user_id, calendar_title, calendar_issued_at";
const CHAT_IMAGE_MESSAGE_PREFIX = "__IMAGE__|";

type MediaKind = "image" | "voice" | "video" | "vibe_clip" | "thumbnail";

type MessageRow = {
  id: string;
  match_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  read_at: string | null;
  audio_url: string | null;
  audio_duration_seconds: number | null;
  video_url: string | null;
  video_duration_seconds: number | null;
  message_kind: string | null;
  ref_id: string | null;
  structured_payload: Record<string, unknown> | null;
};

type MediaAssetRow = {
  legacy_id: string | null;
  provider: string | null;
  provider_object_id: string | null;
  provider_path: string | null;
  mime_type: string | null;
  status: string | null;
  media_family: string | null;
};

type DateSuggestionRow = {
  id: string;
  match_id: string;
  proposer_id: string;
  recipient_id: string;
  status: string;
  current_revision_id: string | null;
  draft_payload: Record<string, unknown> | null;
  expires_at: string | null;
  schedule_share_expires_at: string | null;
  expiring_soon_sent_at: string | null;
  date_plan_id: string | null;
  created_at: string;
  updated_at: string;
};

type DateSuggestionRevisionRow = {
  id: string;
  date_suggestion_id: string;
  revision_number: number;
  proposed_by: string;
  date_type_key: string;
  time_choice_key: string;
  place_mode_key: string;
  venue_text: string | null;
  optional_message: string | null;
  schedule_share_enabled: boolean;
  starts_at: string | null;
  ends_at: string | null;
  time_block: string | null;
  local_timezone: string | null;
  agreed_field_flags: Record<string, boolean> | null;
  created_at: string;
};

type DatePlanRow = {
  id: string;
  date_suggestion_id: string;
  match_id: string;
  starts_at: string | null;
  ends_at: string | null;
  venue_label: string | null;
  date_type_key: string | null;
  status: string;
  completion_initiated_by: string | null;
  completion_initiated_at: string | null;
  completion_confirmed_by: string | null;
  completion_confirmed_at: string | null;
};

type DatePlanParticipantRow = {
  id: string;
  date_plan_id: string;
  user_id: string;
  calendar_title: string;
  calendar_issued_at: string;
};

type MatchArchivePayload = {
  archived_at: string;
  archived_by: string;
};

type ThreadPageCursor = {
  createdAt: string;
  id: string | null;
};

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseThreadPageCursor(value: unknown): ThreadPageCursor | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  try {
    const parsed = JSON.parse(text) as { created_at?: unknown; createdAt?: unknown; id?: unknown };
    const createdAt =
      typeof parsed.created_at === "string"
        ? parsed.created_at
        : typeof parsed.createdAt === "string"
          ? parsed.createdAt
          : null;
    const id = typeof parsed.id === "string" && isUuid(parsed.id) ? parsed.id : null;
    if (createdAt && !Number.isNaN(Date.parse(createdAt))) {
      return { createdAt, id };
    }
  } catch {
    // Older clients used a bare ISO timestamp cursor.
  }
  return !Number.isNaN(Date.parse(text)) ? { createdAt: text, id: null } : null;
}

function encodeThreadPageCursor(row: { created_at: string; id: string }): string {
  return JSON.stringify({ created_at: row.created_at, id: row.id });
}

function primaryPhotoPath(input: { photos?: unknown; avatar_url?: string | null }): string | null {
  const photos = Array.isArray(input.photos) ? input.photos : [];
  for (const photo of photos) {
    if (typeof photo === "string" && photo.trim()) return photo.trim();
  }
  return typeof input.avatar_url === "string" && input.avatar_url.trim() ? input.avatar_url.trim() : null;
}

function mediaFamilyForKind(kind: MediaKind): string {
  if (kind === "image") return "chat_image";
  if (kind === "voice") return "voice_message";
  if (kind === "thumbnail") return "chat_video_thumbnail";
  return "chat_video";
}

function isEligibleAssetForKind(asset: MediaAssetRow, kind: MediaKind): boolean {
  const objectId = typeof asset.provider_object_id === "string" ? asset.provider_object_id : "";
  if (
    asset.provider === "bunny_stream" &&
    asset.status !== "purged" &&
    objectId &&
    asset.media_family === "chat_video" &&
    (kind === "video" || kind === "vibe_clip" || kind === "thumbnail")
  ) {
    return true;
  }
  const path = typeof asset.provider_path === "string" ? asset.provider_path : "";
  if (asset.provider !== "bunny_storage" || asset.status === "purged" || !path) return false;
  if (kind === "image") return path.startsWith("photos/");
  if (kind === "voice") return path.startsWith("voice/");
  if (kind === "thumbnail") return path.includes("_thumb.");
  return path.startsWith("chat-videos/") && !path.includes("_thumb.");
}

function assetPriorityForKind(asset: MediaAssetRow, kind: MediaKind): number {
  if (kind !== "thumbnail") return 0;
  if (asset.media_family === "chat_video_thumbnail") return 2;
  if (asset.provider === "bunny_stream" && asset.media_family === "chat_video") return 1;
  return 0;
}

function mediaKey(messageId: string, kind: MediaKind): string {
  return `${messageId}:${kind}`;
}

function parsePrivateChatImageRef(content: string | null | undefined): string | null {
  const text = typeof content === "string" ? content.trim() : "";
  if (!text.startsWith(CHAT_IMAGE_MESSAGE_PREFIX)) return null;
  const ref = text.slice(CHAT_IMAGE_MESSAGE_PREFIX.length).trim();
  return /^photos\/[^?#\s]+/i.test(ref) ? ref : null;
}

function parseStructuredChatImageRef(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const row = payload as Record<string, unknown>;
  if (row.kind !== "chat_image") return null;
  if (row.v !== 2 || row.provider !== "bunny_storage") return null;
  const ref = typeof row.media_ref === "string" ? row.media_ref.trim() : "";
  return /^photos\/[^?#\s]+/i.test(ref) ? ref : null;
}

function extractChatImageMediaRef(row: {
  content?: string | null;
  structured_payload?: unknown;
}): string | null {
  return parseStructuredChatImageRef(row.structured_payload) ?? parsePrivateChatImageRef(row.content);
}

function formatChatImageMessageContent(mediaRef: string): string {
  return `${CHAT_IMAGE_MESSAGE_PREFIX}${mediaRef}`;
}

async function resolvePageMediaUrls(params: {
  serviceClient: ReturnType<typeof createClient>;
  rows: MessageRow[];
}): Promise<MessageRow[]> {
  const messageIds = params.rows.map((row) => row.id).filter(isUuid);
  if (messageIds.length === 0) return params.rows;

  const { data, error } = await params.serviceClient
    .from("media_assets")
    .select("legacy_id, provider, provider_object_id, provider_path, mime_type, status, media_family, created_at")
    .eq("legacy_table", "messages")
    .in("legacy_id", messageIds)
    .in("media_family", ["chat_image", "voice_message", "chat_video", "chat_video_thumbnail"])
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error || !Array.isArray(data)) {
    if (error) console.error("chat-thread-page media lookup failed:", error);
    return params.rows;
  }

  const assetsByKey = new Map<string, MediaAssetRow>();
  for (const asset of data as MediaAssetRow[]) {
    const messageId = asset.legacy_id;
    if (!messageId) continue;
    for (const kind of ["image", "voice", "video", "vibe_clip", "thumbnail"] as MediaKind[]) {
      const familyMatches =
        asset.media_family === mediaFamilyForKind(kind) ||
        (kind === "thumbnail" && asset.provider === "bunny_stream" && asset.media_family === "chat_video");
      if (!familyMatches) continue;
      if (!isEligibleAssetForKind(asset, kind)) continue;
      const key = mediaKey(messageId, kind);
      const existing = assetsByKey.get(key);
      if (!existing || assetPriorityForKind(asset, kind) > assetPriorityForKind(existing, kind)) {
        assetsByKey.set(key, asset);
      }
    }
  }

  const durableAssetRef = (messageId: string, kind: MediaKind): string | null => {
    const asset = assetsByKey.get(mediaKey(messageId, kind));
    if (!asset) return null;
    if (asset.provider === "bunny_stream" && asset.provider_object_id) {
      return kind === "thumbnail"
        ? `bunny_stream:${asset.provider_object_id}:thumbnail`
        : `bunny_stream:${asset.provider_object_id}`;
    }
    return asset.provider_path ?? null;
  };

  return Promise.all(
    params.rows.map(async (row) => {
      const next: MessageRow = {
        ...row,
        structured_payload:
          row.structured_payload && typeof row.structured_payload === "object" && !Array.isArray(row.structured_payload)
            ? { ...row.structured_payload }
            : row.structured_payload,
      };

      if (next.audio_url) {
        next.audio_url = durableAssetRef(next.id, "voice") ?? next.audio_url;
      }

      const shouldHydrateVideo =
        !!next.video_url || next.message_kind === "video" || next.message_kind === "vibe_clip";
      if (shouldHydrateVideo) {
        const kind = next.message_kind === "vibe_clip" ? "vibe_clip" : "video";
        const durableVideoRef = durableAssetRef(next.id, kind);
        if (durableVideoRef || next.video_url) next.video_url = durableVideoRef ?? next.video_url;
      }

      const existingPayload =
        next.structured_payload && typeof next.structured_payload === "object" && !Array.isArray(next.structured_payload)
          ? { ...(next.structured_payload as Record<string, unknown>) }
          : null;
      const durableThumbnailRef = (shouldHydrateVideo || !!next.video_url) ? durableAssetRef(next.id, "thumbnail") : null;
      const payload = existingPayload ?? (durableThumbnailRef ? {} : null);
      const thumbnailRef =
        typeof payload?.thumbnail_url === "string"
          ? payload.thumbnail_url
          : typeof payload?.poster_ref === "string"
            ? payload.poster_ref
            : null;
      if (payload) {
        const effectiveThumbnailRef = durableThumbnailRef ?? thumbnailRef;
        if (effectiveThumbnailRef) {
          payload.thumbnail_url = effectiveThumbnailRef;
          if (next.video_url || typeof payload.poster_ref === "string") payload.poster_ref = effectiveThumbnailRef;
        }
        next.structured_payload = payload;
      }

      const imageRef = extractChatImageMediaRef(next);
      if (imageRef) {
        const durableImageRef = durableAssetRef(next.id, "image");
        if (durableImageRef) {
          next.content = formatChatImageMessageContent(durableImageRef);
          if (payload?.kind === "chat_image" && payload.v === 2 && payload.provider === "bunny_storage") {
            payload.media_ref = durableImageRef;
            next.structured_payload = payload;
          }
        }
      }

      return next;
    }),
  );
}

async function loadPageDateSuggestions(
  serviceClient: ReturnType<typeof createClient>,
  matchId: string,
  rows: MessageRow[],
) {
  const ids = [...new Set(
    rows
      .filter((row) => row.message_kind === "date_suggestion" || row.message_kind === "date_suggestion_event")
      .map((row) => row.ref_id)
      .filter(isUuid),
  )];
  if (ids.length === 0) return [];

  const { data: suggestions, error } = await serviceClient
    .from("date_suggestions")
    .select(DATE_SUGGESTION_SELECT)
    .eq("match_id", matchId)
    .in("id", ids);

  if (error || !Array.isArray(suggestions) || suggestions.length === 0) {
    if (error) console.error("chat-thread-page date suggestion lookup failed:", error);
    return [];
  }

  const suggestionRows = suggestions as DateSuggestionRow[];
  const suggestionIds = suggestionRows.map((s) => s.id);
  const planIds = suggestionRows.map((s) => s.date_plan_id).filter(isUuid);

  const [revsRes, plansRes, participantsRes] = await Promise.all([
    serviceClient
      .from("date_suggestion_revisions")
      .select(DATE_SUGGESTION_REVISION_SELECT)
      .in("date_suggestion_id", suggestionIds)
      .order("revision_number", { ascending: true }),
    planIds.length > 0
      ? serviceClient.from("date_plans").select(DATE_PLAN_SELECT).in("id", planIds)
      : Promise.resolve({ data: [] as DatePlanRow[], error: null }),
    planIds.length > 0
      ? serviceClient.from("date_plan_participants").select(DATE_PLAN_PARTICIPANT_SELECT).in("date_plan_id", planIds)
      : Promise.resolve({ data: [] as DatePlanParticipantRow[], error: null }),
  ]);

  if (revsRes.error) console.error("chat-thread-page date revisions lookup failed:", revsRes.error);
  if (plansRes.error) console.error("chat-thread-page date plans lookup failed:", plansRes.error);
  if (participantsRes.error) console.error("chat-thread-page date participants lookup failed:", participantsRes.error);

  const revBySuggestion = new Map<string, DateSuggestionRevisionRow[]>();
  for (const rev of (revsRes.data ?? []) as DateSuggestionRevisionRow[]) {
    const arr = revBySuggestion.get(rev.date_suggestion_id) ?? [];
    arr.push(rev);
    revBySuggestion.set(rev.date_suggestion_id, arr);
  }

  const planById = new Map<string, DatePlanRow>();
  for (const plan of (plansRes.data ?? []) as DatePlanRow[]) {
    planById.set(plan.id, plan);
  }

  const participantsByPlan = new Map<string, DatePlanParticipantRow[]>();
  for (const participant of (participantsRes.data ?? []) as DatePlanParticipantRow[]) {
    const arr = participantsByPlan.get(participant.date_plan_id) ?? [];
    arr.push(participant);
    participantsByPlan.set(participant.date_plan_id, arr);
  }

  return suggestionRows.map((suggestion) => {
    const plan = suggestion.date_plan_id ? planById.get(suggestion.date_plan_id) : null;
    return {
      ...suggestion,
      revisions: revBySuggestion.get(suggestion.id) ?? [],
      date_plan: plan
        ? {
            ...plan,
            participants: participantsByPlan.get(plan.id) ?? [],
          }
        : null,
    };
  });
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
    const beforeCursor = parseThreadPageCursor(body?.before_created_at);

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
        match_archive: null,
        messages: [],
        date_suggestions: [],
        next_cursor: null,
      });
    }

    let messagesQuery = serviceClient
      .from("messages")
      .select(MESSAGE_SELECT)
      .eq("match_id", match.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);

    if (beforeCursor?.id) {
      messagesQuery = messagesQuery.or(
        `created_at.lt.${beforeCursor.createdAt},and(created_at.eq.${beforeCursor.createdAt},id.lt.${beforeCursor.id})`,
      );
    } else if (beforeCursor) {
      messagesQuery = messagesQuery.lt("created_at", beforeCursor.createdAt);
    }

    const [messagesRes, profileRes, presenceRes, archiveRes] = await Promise.all([
      messagesQuery,
      userClient.rpc("get_profile_for_viewer", { p_target_id: otherUserId }),
      userClient.rpc("get_chat_partner_presence", { p_match_id: match.id }).maybeSingle(),
      serviceClient
        .from("match_archives")
        .select("archived_at")
        .eq("match_id", match.id)
        .eq("user_id", currentUserId)
        .maybeSingle(),
    ]);

    if (messagesRes.error) throw messagesRes.error;
    if (profileRes.error) throw profileRes.error;

    const rowsDesc = (messagesRes.data ?? []) as MessageRow[];
    const rowsAsc = [...rowsDesc].reverse();
    const [resolvedRowsAsc, dateSuggestions] = await Promise.all([
      resolvePageMediaUrls({
        serviceClient,
        rows: rowsAsc,
      }),
      loadPageDateSuggestions(serviceClient, match.id, rowsAsc),
    ]);
    const presence = !presenceRes.error &&
      presenceRes.data &&
      typeof presenceRes.data === "object" &&
      (presenceRes.data as { can_view_presence?: unknown }).can_view_presence === true
      ? presenceRes.data as { is_online?: boolean | null; last_seen_at?: string | null }
      : null;

    const profile =
      profileRes.data && typeof profileRes.data === "object" && !Array.isArray(profileRes.data)
        ? profileRes.data as Record<string, unknown>
        : null;
    const otherUser = profile
      ? {
          ...profile,
          avatar_url: primaryPhotoPath({
            photos: profile.photos,
            avatar_url: typeof profile.avatar_url === "string" ? profile.avatar_url : null,
          }),
          last_seen_at: presence?.last_seen_at ?? null,
          is_online: presence?.is_online === true,
        }
      : null;
    const matchArchive: MatchArchivePayload | null =
      !archiveRes.error && archiveRes.data?.archived_at
        ? {
            archived_at: archiveRes.data.archived_at,
            archived_by: currentUserId,
          }
        : null;

    return jsonResponse(req, {
      success: true,
      match_id: match.id,
      other_user: otherUser,
      match_archive: matchArchive,
      messages: resolvedRowsAsc,
      date_suggestions: dateSuggestions,
      next_cursor: rowsDesc.length >= limit ? encodeThreadPageCursor(rowsDesc[rowsDesc.length - 1]!) : null,
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
