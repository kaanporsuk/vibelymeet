import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { captureSupabaseError } from "@/lib/errorTracking";
import { collapseVibeGameRowsForWeb, type WebHydratedGameSessionView } from "@/lib/webChatGameSessions";
import { resolveChatMessageMediaForDisplay } from "@/lib/chatMediaResolver";
import { parseChatImageMessageContent } from "@/lib/chatMessageContent";
import { toRenderableMessageKind } from "../../shared/chat/messageRouting";
import { threadMessagesQueryKey, type ThreadInvalidateScope } from "../../shared/chat/queryKeys";
import { resolvePrimaryProfilePhotoPath } from "../../shared/profilePhoto/resolvePrimaryProfilePhotoPath";
import * as vibeGameParse from "../../shared/vibely-games/parse";
import type { DateSuggestionWithRelations } from "@/hooks/useDateSuggestionData";
import { fetchUserProfile } from "@/services/fetchUserProfile";

export type { ThreadInvalidateScope };

/** Exported for web chat outbox (same invalidation as send mutations). */
export function invalidateAfterThreadMutation(qc: QueryClient, scope: ThreadInvalidateScope | undefined) {
  if (scope?.otherUserId && scope?.currentUserId) {
    qc.invalidateQueries({
      queryKey: threadMessagesQueryKey(scope.otherUserId, scope.currentUserId),
      exact: true,
    });
  }
  if (scope?.matchId) {
    qc.invalidateQueries({ queryKey: ["date-suggestions", scope.matchId] });
  }
  qc.invalidateQueries({ queryKey: ["matches"] });
  qc.invalidateQueries({ queryKey: ["profile-live-counts"] });
}

const BLOCKED_MESSAGE_COPY = "You can't message this person.";
const CHAT_THREAD_PAGE_SIZE = 28;
const CHAT_MESSAGE_SELECT =
  "id, match_id, sender_id, content, created_at, read_at, audio_url, audio_duration_seconds, video_url, video_duration_seconds, message_kind, ref_id, structured_payload";
let chatThreadPageEdgeUnavailable = false;

type SendMessagePayload = {
  success?: boolean;
  message?: unknown;
  error?: string;
  code?: string;
};

function isBlockedSendCode(value: unknown): boolean {
  return value === "blocked_pair" || value === "message_blocked" || value === "blocked";
}

async function parseFunctionErrorPayload(error: unknown): Promise<SendMessagePayload | null> {
  const context = (error as { context?: { clone?: () => { json?: () => Promise<unknown> }; json?: () => Promise<unknown> } })?.context;
  try {
    const cloned = context?.clone?.();
    const parsed = cloned?.json ? await cloned.json() : context?.json ? await context.json() : null;
    return parsed && typeof parsed === "object" ? parsed as SendMessagePayload : null;
  } catch {
    return null;
  }
}

async function throwMappedSendMessageError(error: unknown): Promise<never> {
  const payload = await parseFunctionErrorPayload(error);
  if (isBlockedSendCode(payload?.code) || isBlockedSendCode(payload?.error)) {
    throw new Error(BLOCKED_MESSAGE_COPY);
  }
  if (error instanceof Error) throw error;
  throw new Error("Send failed");
}

function assertSendMessagePayload(payload: SendMessagePayload | null | undefined, fallback: string): asserts payload is SendMessagePayload & { success: true } {
  if (!payload?.success) {
    if (isBlockedSendCode(payload?.code) || isBlockedSendCode(payload?.error)) {
      throw new Error(BLOCKED_MESSAGE_COPY);
    }
    throw new Error(payload?.error || fallback);
  }
}

export interface Message {
  id: string;
  text: string;
  sender: "me" | "them";
  time: string;
  createdAt: string;
  /** Partner read receipt for outbound messages (matches native `read_at` → status). */
  readAt?: string | null;
  audioUrl?: string;
  audioSourceRef?: string;
  audioDuration?: number;
  imageSourceRef?: string;
  videoUrl?: string;
  videoSourceRef?: string;
  videoDuration?: number;
  thumbnailSourceRef?: string;
  messageKind?: "text" | "date_suggestion" | "date_suggestion_event" | "vibe_game_session" | "vibe_clip";
  refId?: string | null;
  structuredPayload?: Record<string, unknown> | null;
  gameSessionView?: WebHydratedGameSessionView;
}

type ChatOtherUser = {
  id: string;
  name: string | null;
  age: number | null;
  avatar_url: string | null;
  photos: unknown;
  last_seen_at: string | null;
  is_online: boolean;
  photo_verified: boolean | null;
  subscription_tier: string | null;
  bunny_video_uid: string | null;
} | null;

type ChatPresenceRow = {
  can_view_presence?: boolean | null;
  is_online?: boolean | null;
  last_seen_at?: string | null;
};

export type ChatRawMessageRow = {
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

export type ChatThreadPage = {
  messages: Message[];
  matchId: string | null;
  otherUser: ChatOtherUser;
  matchArchive: { archived_at: string; archived_by: string } | null;
  dateSuggestions: DateSuggestionWithRelations[];
  nextCursor: string | null;
  pageSize: number;
};

export type ChatThreadData = ChatThreadPage & {
  pages: ChatThreadPage[];
  pageParams: unknown[];
  hasMore: boolean;
  loadedMessageCount: number;
};

type ChatThreadPagePayload = {
  success?: boolean;
  match_id?: string | null;
  other_user?: ChatOtherUser;
  match_archive?: { archived_at?: string | null; archived_by?: string | null } | null;
  messages?: ChatRawMessageRow[];
  date_suggestions?: DateSuggestionWithRelations[];
  next_cursor?: string | null;
  error?: string;
};

function normalizeRawMessage(row: Partial<ChatRawMessageRow> & { id: string }): ChatRawMessageRow {
  return {
    id: row.id,
    match_id: row.match_id ?? "",
    sender_id: row.sender_id ?? "",
    content: row.content ?? "",
    created_at: row.created_at ?? new Date(0).toISOString(),
    read_at: row.read_at ?? null,
    audio_url: row.audio_url ?? null,
    audio_duration_seconds: row.audio_duration_seconds ?? null,
    video_url: row.video_url ?? null,
    video_duration_seconds: row.video_duration_seconds ?? null,
    message_kind: row.message_kind ?? "text",
    ref_id: row.ref_id ?? null,
    structured_payload: row.structured_payload ?? null,
  };
}

function isResolvedOrLocalMediaRef(value: string): boolean {
  return /^https?:\/\//i.test(value) || value.startsWith("blob:") || value.startsWith("file:") || value.startsWith("data:");
}

function durableChatMediaSourceRef(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || isResolvedOrLocalMediaRef(trimmed)) return undefined;
  return trimmed;
}

function structuredPayloadObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function collectChatMediaSourceRefs(row: {
  content: string;
  audio_url?: string | null;
  video_url?: string | null;
  structured_payload?: unknown;
}) {
  const payload = structuredPayloadObject(row.structured_payload);
  const thumbnailRef = typeof payload?.thumbnail_url === "string" ? payload.thumbnail_url : null;
  return {
    audio: durableChatMediaSourceRef(row.audio_url),
    image: durableChatMediaSourceRef(
      parseChatImageMessageContent(row.content, { allowPrivateMediaRefs: true }),
    ),
    video: durableChatMediaSourceRef(row.video_url),
    thumbnail: durableChatMediaSourceRef(thumbnailRef),
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value);
}

type ThreadPageCursor = {
  createdAt: string;
  id: string | null;
};

function parseThreadPageCursor(value: string | null | undefined): ThreadPageCursor | null {
  if (!value?.trim()) return null;
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
    // Older cached pages may still hold a bare ISO timestamp cursor.
  }
  return !Number.isNaN(Date.parse(text)) ? { createdAt: text, id: null } : null;
}

function encodeThreadPageCursor(row: { created_at: string; id: string }): string {
  return JSON.stringify({ created_at: row.created_at, id: row.id });
}

function collectVibeGameSessionIds(rows: ChatRawMessageRow[]): string[] {
  const sessionIds = new Set<string>();
  for (const row of rows) {
    if (row.message_kind !== "vibe_game") continue;
    const envelope = vibeGameParse.parseVibeGameEnvelopeFromStructuredPayload(row.structured_payload);
    const sessionId = envelope?.game_session_id;
    if (sessionId && isUuid(sessionId)) sessionIds.add(sessionId);
  }
  return [...sessionIds];
}

function postgrestInList(values: string[]): string {
  return `(${values.map((value) => `"${value}"`).join(",")})`;
}

async function expandVibeGameRowsForDisplay(
  matchId: string | null | undefined,
  rows: ChatRawMessageRow[],
): Promise<ChatRawMessageRow[]> {
  if (!matchId || rows.length === 0) return rows;
  const sessionIds = collectVibeGameSessionIds(rows);
  if (sessionIds.length === 0) return rows;

  const { data, error } = await supabase
    .from("messages")
    .select(CHAT_MESSAGE_SELECT)
    .eq("match_id", matchId)
    .eq("message_kind", "vibe_game")
    .filter("structured_payload->>game_session_id", "in", postgrestInList(sessionIds))
    .order("created_at", { ascending: true });

  if (error) {
    captureSupabaseError("chat-vibe-game-session-expand", error);
    return rows;
  }

  const byId = new Map<string, ChatRawMessageRow>();
  for (const row of rows) byId.set(row.id, normalizeRawMessage(row));
  for (const row of data ?? []) byId.set(row.id, normalizeRawMessage(row as ChatRawMessageRow));
  return [...byId.values()].sort((a, b) => {
    const t = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (t !== 0) return t;
    return a.id.localeCompare(b.id);
  });
}

export async function hydrateChatRowsForDisplay(
  rows: ChatRawMessageRow[],
  currentUserId: string,
): Promise<Message[]> {
  const collapsedRows = collapseVibeGameRowsForWeb(rows.map(normalizeRawMessage));
  const mediaSourceRefsById = new Map(
    collapsedRows.map((row) => [row.id, collectChatMediaSourceRefs(row)] as const),
  );
  const displayRows = await Promise.all(collapsedRows.map((row) => resolveChatMessageMediaForDisplay(row)));

  return displayRows.map((row) => {
    const sourceRefs = mediaSourceRefsById.get(row.id);
    return {
      id: row.id,
      text: row.content,
      sender: row.sender_id === currentUserId ? ("me" as const) : ("them" as const),
      time: new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      createdAt: row.created_at,
      readAt: row.read_at,
      audioUrl: row.audio_url || undefined,
      audioSourceRef: sourceRefs?.audio,
      audioDuration: row.audio_duration_seconds || undefined,
      imageSourceRef: sourceRefs?.image,
      videoUrl: row.video_url || undefined,
      videoSourceRef: sourceRefs?.video,
      videoDuration: row.video_duration_seconds || undefined,
      thumbnailSourceRef: sourceRefs?.thumbnail,
      messageKind: toRenderableMessageKind(row.message_kind) as Message["messageKind"],
      refId: row.ref_id,
      structuredPayload: row.structured_payload ?? null,
      gameSessionView: row.game_session_view,
    };
  });
}

async function hydrateChatPageRowsForDisplay(params: {
  matchId: string | null | undefined;
  rows: ChatRawMessageRow[];
  currentUserId: string;
}): Promise<Message[]> {
  const rowsWithCompleteGameSessions = await expandVibeGameRowsForDisplay(params.matchId, params.rows);
  return hydrateChatRowsForDisplay(rowsWithCompleteGameSessions, params.currentUserId);
}

async function fetchDirectChatThreadPage(params: {
  otherUserId: string;
  currentUserId: string;
  beforeCreatedAt?: string | null;
  limit: number;
}): Promise<ChatThreadPage> {
  const { otherUserId, currentUserId, beforeCreatedAt, limit } = params;
  const { data: match, error: matchError } = await supabase
    .from("matches")
    .select("id")
    .or(
      `and(profile_id_1.eq.${currentUserId},profile_id_2.eq.${otherUserId}),and(profile_id_1.eq.${otherUserId},profile_id_2.eq.${currentUserId})`,
    )
    .maybeSingle();

  if (matchError) throw matchError;
  if (!match) {
    return {
      messages: [],
      matchId: null,
      otherUser: null,
      matchArchive: null,
      dateSuggestions: [],
      nextCursor: null,
      pageSize: limit,
    };
  }

  let messagesQuery = supabase
    .from("messages")
    .select(CHAT_MESSAGE_SELECT)
    .eq("match_id", match.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  if (beforeCreatedAt) {
    const cursor = parseThreadPageCursor(beforeCreatedAt);
    if (cursor?.id) {
      messagesQuery = messagesQuery.or(
        `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
      );
    } else if (cursor) {
      messagesQuery = messagesQuery.lt("created_at", cursor.createdAt);
    }
  }

  const [messagesRes, otherUserRes, presenceRes] = await Promise.all([
    messagesQuery,
    fetchUserProfile(otherUserId),
    supabase
      .rpc("get_chat_partner_presence", { p_match_id: match.id })
      .maybeSingle(),
  ]);

  if (messagesRes.error) throw messagesRes.error;

  const rawDesc = (messagesRes.data ?? []).map((row) => normalizeRawMessage(row as ChatRawMessageRow));
  const rawAsc = [...rawDesc].reverse();
  const presenceData = presenceRes.data as ChatPresenceRow | null;
  const presence = !presenceRes.error && presenceData?.can_view_presence ? presenceData : null;
  const otherUser = otherUserRes
    ? {
        id: otherUserRes.id,
        name: otherUserRes.name,
        age: otherUserRes.age,
        photos: otherUserRes.photos,
        photo_verified: otherUserRes.photo_verified,
        subscription_tier: otherUserRes.subscription_tier,
        bunny_video_uid: otherUserRes.bunny_video_uid,
        avatar_url: resolvePrimaryProfilePhotoPath({
          photos: otherUserRes.photos,
          avatar_url: otherUserRes.avatar_url,
        }),
        last_seen_at: presence?.last_seen_at ?? null,
        is_online: presence?.is_online ?? false,
      }
    : null;

  return {
    matchId: match.id,
    otherUser,
    matchArchive: null,
    dateSuggestions: [],
    messages: await hydrateChatPageRowsForDisplay({
      matchId: match.id,
      rows: rawAsc,
      currentUserId,
    }),
    nextCursor: rawDesc.length >= limit ? encodeThreadPageCursor(rawDesc[rawDesc.length - 1]!) : null,
    pageSize: limit,
  };
}

async function fetchEdgeChatThreadPage(params: {
  otherUserId: string;
  currentUserId: string;
  beforeCreatedAt?: string | null;
  limit: number;
}): Promise<ChatThreadPage> {
  const { data, error } = await supabase.functions.invoke("chat-thread-page", {
    body: {
      other_user_id: params.otherUserId,
      before_created_at: params.beforeCreatedAt ?? null,
      limit: params.limit,
    },
  });
  if (error) throw error;
  const payload = data as ChatThreadPagePayload | null;
  if (!payload?.success) throw new Error(payload?.error || "chat_thread_page_failed");
  const rawRows = (payload.messages ?? []).map(normalizeRawMessage);
  return {
    matchId: payload.match_id ?? null,
    otherUser: payload.other_user ?? null,
    matchArchive:
      payload.match_archive?.archived_at
        ? {
            archived_at: payload.match_archive.archived_at,
            archived_by: payload.match_archive.archived_by ?? params.currentUserId,
          }
        : null,
    dateSuggestions: payload.date_suggestions ?? [],
    messages: await hydrateChatPageRowsForDisplay({
      matchId: payload.match_id ?? null,
      rows: rawRows,
      currentUserId: params.currentUserId,
    }),
    nextCursor: payload.next_cursor ?? null,
    pageSize: params.limit,
  };
}

async function fetchChatThreadPage(params: {
  otherUserId: string;
  currentUserId: string;
  beforeCreatedAt?: string | null;
  limit?: number;
}): Promise<ChatThreadPage> {
  const limit = params.limit ?? CHAT_THREAD_PAGE_SIZE;
  if (!chatThreadPageEdgeUnavailable) {
    try {
      return await fetchEdgeChatThreadPage({ ...params, limit });
    } catch {
      chatThreadPageEdgeUnavailable = true;
    }
  }
  return fetchDirectChatThreadPage({ ...params, limit });
}

function flattenChatPages(data: InfiniteData<ChatThreadPage>): ChatThreadData {
  const firstPage = data.pages[0] ?? {
    messages: [],
    matchId: null,
    otherUser: null,
    matchArchive: null,
    dateSuggestions: [],
    nextCursor: null,
    pageSize: CHAT_THREAD_PAGE_SIZE,
  };
  const chronologicalPages = [...data.pages].reverse();
  const allMessages = chronologicalPages.flatMap((page) => page.messages);
  const lastIndexById = new Map<string, number>();
  allMessages.forEach((message, index) => lastIndexById.set(message.id, index));
  const messages = allMessages.filter((message, index) => lastIndexById.get(message.id) === index);
  const suggestionById = new Map<string, DateSuggestionWithRelations>();
  for (const page of chronologicalPages) {
    for (const suggestion of page.dateSuggestions) {
      suggestionById.set(suggestion.id, suggestion);
    }
  }
  const oldestLoadedPage = data.pages[data.pages.length - 1];

  return {
    ...firstPage,
    messages,
    dateSuggestions: Array.from(suggestionById.values()),
    pages: data.pages,
    pageParams: data.pageParams,
    hasMore: Boolean(oldestLoadedPage?.nextCursor),
    loadedMessageCount: messages.length,
  };
}

export const useMessages = (otherUserId: string, currentUserId?: string) => {
  const queryClient = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: threadMessagesQueryKey(otherUserId, currentUserId || ""),
    queryFn: ({ pageParam }) => {
      if (!currentUserId) {
        return Promise.resolve({
          messages: [],
          matchId: null,
          otherUser: null,
          matchArchive: null,
          dateSuggestions: [],
          nextCursor: null,
          pageSize: CHAT_THREAD_PAGE_SIZE,
        } satisfies ChatThreadPage);
      }
      return fetchChatThreadPage({
        otherUserId,
        currentUserId,
        beforeCreatedAt: typeof pageParam === "string" ? pageParam : null,
        limit: CHAT_THREAD_PAGE_SIZE,
      });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: ChatThreadPage) => lastPage.nextCursor ?? undefined,
    enabled: !!otherUserId && !!currentUserId,
    select: flattenChatPages,
  });

  useEffect(() => {
    if (!query.data?.matchId || !query.data.dateSuggestions.length) return;
    queryClient.setQueryData(["date-suggestions", query.data.matchId], (old: unknown) => {
      const byId = new Map<string, DateSuggestionWithRelations>();
      if (Array.isArray(old)) {
        for (const suggestion of old) byId.set(suggestion.id, suggestion);
      }
      for (const suggestion of query.data.dateSuggestions) {
        byId.set(suggestion.id, suggestion);
      }
      return Array.from(byId.values());
    });
  }, [query.data?.dateSuggestions, query.data?.matchId, queryClient]);

  return query;
};

export function prefetchChatThread(queryClient: QueryClient, otherUserId: string, currentUserId: string) {
  if (!otherUserId || !currentUserId) return Promise.resolve();
  return queryClient.prefetchInfiniteQuery({
    queryKey: threadMessagesQueryKey(otherUserId, currentUserId),
    queryFn: ({ pageParam }) =>
      fetchChatThreadPage({
        otherUserId,
        currentUserId,
        beforeCreatedAt: typeof pageParam === "string" ? pageParam : null,
        limit: CHAT_THREAD_PAGE_SIZE,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: ChatThreadPage) => lastPage.nextCursor ?? undefined,
  });
}

export const useSendMessage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      matchId,
      content,
      clientRequestId,
    }: {
      matchId: string;
      content: string;
      clientRequestId?: string;
      invalidateScope?: ThreadInvalidateScope;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const body: Record<string, string> = {
        match_id: matchId,
        content: content.trim(),
      };
      if (clientRequestId?.trim()) {
        body.client_request_id = clientRequestId.trim();
      }

      const { data, error } = await supabase.functions.invoke("send-message", {
        body,
      });

      if (error) {
        captureSupabaseError("send-message", error);
        await throwMappedSendMessageError(error);
      }

      const payload = data as SendMessagePayload | null | undefined;
      assertSendMessagePayload(payload, "Send failed");
      return payload.message;
    },
    onSuccess: (_data, variables) => {
      invalidateAfterThreadMutation(queryClient, variables.invalidateScope);
    },
  });
};

/** Canonical server-owned publish for Vibe Clip video messages. */
export const usePublishVibeClip = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      matchId: string;
      videoUrl: string;
      durationMs: number;
      clientRequestId: string;
      thumbnailUrl?: string | null;
      aspectRatio?: number | null;
      invalidateScope?: ThreadInvalidateScope;
    }) => {
      const body: Record<string, unknown> = {
        match_id: params.matchId,
        message_kind: "vibe_clip",
        video_url: params.videoUrl,
        duration_ms: params.durationMs,
        client_request_id: params.clientRequestId,
      };
      if (params.thumbnailUrl) body.thumbnail_url = params.thumbnailUrl;
      if (typeof params.aspectRatio === "number" && Number.isFinite(params.aspectRatio) && params.aspectRatio > 0) {
        body.aspect_ratio = params.aspectRatio;
      }

      const { data, error } = await supabase.functions.invoke("send-message", { body });
      if (error) {
        captureSupabaseError("publish-vibe-clip", error);
        await throwMappedSendMessageError(error);
      }
      const payload = data as SendMessagePayload | null;
      assertSendMessagePayload(payload, "Vibe Clip publish failed");
      return payload.message;
    },
    onSuccess: (_data, variables) => {
      invalidateAfterThreadMutation(queryClient, variables.invalidateScope);
    },
  });
};

/** Canonical server-owned publish for voice messages (after upload-voice). */
export const usePublishVoiceMessage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      matchId: string;
      audioUrl: string;
      durationSeconds: number;
      clientRequestId: string;
      invalidateScope?: ThreadInvalidateScope;
    }) => {
      const body: Record<string, unknown> = {
        match_id: params.matchId,
        message_kind: "voice",
        audio_url: params.audioUrl,
        audio_duration_seconds: Math.round(params.durationSeconds),
        client_request_id: params.clientRequestId,
      };

      const { data, error } = await supabase.functions.invoke("send-message", { body });
      if (error) {
        captureSupabaseError("publish-voice-message", error);
        await throwMappedSendMessageError(error);
      }
      const payload = data as SendMessagePayload | null;
      assertSendMessagePayload(payload, "Voice message publish failed");
      return payload.message;
    },
    onSuccess: (_data, variables) => {
      invalidateAfterThreadMutation(queryClient, variables.invalidateScope);
    },
  });
};
