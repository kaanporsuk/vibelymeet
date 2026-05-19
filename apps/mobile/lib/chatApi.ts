import { useInfiniteQuery, useQuery, useMutation, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { useEffect, useCallback, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { avatarUrl } from '@/lib/imageUrl';
import { resolvePrimaryProfilePhotoPath } from '../../../shared/profilePhoto/resolvePrimaryProfilePhotoPath';
import { bestMatchSortKey, compatibilityPercent, type MatchScoreInput } from '@/lib/matchSortScore';
import { uploadVoiceMessage } from '@/lib/chatMediaUpload';
import { resolveMessageMediaForDisplay } from '@/lib/mediaAssetResolver';
import { parseChatImageMessageContent } from '@/lib/chatMessageContent';
import {
  collapseVibeGameMessageRows,
  type ChatGameSessionMessageRow,
  type NativeHydratedGameSessionView,
} from '@/lib/chatGameSessions';
import { toRenderableMessageKind } from '../../../shared/chat/messageRouting';
import type { ConversationPreview } from '../../../shared/chat/conversationListPreview';
import {
  conversationPreviewSearchText,
  getConversationPreview,
  getEmptyConversationPreview,
} from '../../../shared/chat/conversationListPreview';
import type { ReactionPair } from '../../../shared/chat/messageReactionModel';
import { threadMessagesQueryKey, type ThreadInvalidateScope } from '../../../shared/chat/queryKeys';
import type { DateSuggestionWithRelations } from '@/lib/useDateSuggestionData';
import { fetchUserProfile, fetchUserProfiles, type UserProfileView } from '@/lib/fetchUserProfile';

/** Matches `profiles` select columns in `useMatches` below (intent fields typed for scoring). */
type ChatMatchesProfileRow = {
  id: string;
  name?: string | null;
  age?: number | null;
  avatar_url?: string | null;
  photos?: string[] | null;
  looking_for?: string | null;
  relationship_intent?: string | null;
  location?: string | null;
  bunny_video_uid?: string | null;
  vibes?: string[];
};

function profileIntentForMatch(
  p: Pick<ChatMatchesProfileRow, 'relationship_intent' | 'looking_for'> | undefined,
): string | null {
  return p?.relationship_intent ?? p?.looking_for ?? null;
}

function profileViewToChatMatchRow(profile: UserProfileView | null): ChatMatchesProfileRow | null {
  if (!profile?.id) return null;
  return {
    id: profile.id,
    name: profile.name,
    age: profile.age,
    avatar_url: profile.avatar_url,
    photos: profile.photos,
    looking_for: profile.looking_for,
    relationship_intent: profile.relationship_intent,
    location: profile.display_location ?? profile.location,
    bunny_video_uid: profile.bunny_video_uid,
    vibes: profile.vibes,
  };
}

async function fetchChatMatchProfiles(profileIds: string[]): Promise<ChatMatchesProfileRow[]> {
  const uniqueIds = Array.from(new Set(profileIds.filter(Boolean)));
  const profiles = await fetchUserProfiles(uniqueIds);
  return profiles.map(profileViewToChatMatchRow).filter((profile): profile is ChatMatchesProfileRow => !!profile);
}

export type { NativeHydratedGameSessionView };
export type { ThreadInvalidateScope };

/** Exported for outbox + hydration paths that need the same scoped invalidation as send mutations */
export function invalidateAfterThreadMutation(qc: QueryClient, scope: ThreadInvalidateScope | undefined) {
  if (scope?.otherUserId && scope?.currentUserId) {
    qc.invalidateQueries({
      queryKey: threadMessagesQueryKey(scope.otherUserId, scope.currentUserId),
      exact: true,
    });
  }
  if (scope?.matchId) {
    qc.invalidateQueries({ queryKey: ['date-suggestions', scope.matchId] });
  }
  qc.invalidateQueries({ queryKey: ['matches'] });
  qc.invalidateQueries({ queryKey: ['profile-live-counts'] });
}
export type { ReactionPair };
export type { ReactionEmoji } from '../../../shared/chat/messageReactionModel';

const BLOCKED_MESSAGE_COPY = "You can't message this person.";

type SendMessagePayload = {
  success?: boolean;
  message?: unknown;
  error?: string;
  code?: string;
};

function isBlockedSendCode(value: unknown): boolean {
  return value === 'blocked_pair' || value === 'message_blocked' || value === 'blocked';
}

async function parseFunctionErrorPayload(error: unknown): Promise<SendMessagePayload | null> {
  const context = (error as { context?: { clone?: () => { json?: () => Promise<unknown> }; json?: () => Promise<unknown> } })?.context;
  try {
    const cloned = context?.clone?.();
    const parsed = cloned?.json ? await cloned.json() : context?.json ? await context.json() : null;
    return parsed && typeof parsed === 'object' ? parsed as SendMessagePayload : null;
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
  throw new Error('Send failed');
}

function assertSendMessagePayload(payload: SendMessagePayload | null | undefined, fallback: string): asserts payload is SendMessagePayload & { success: true } {
  if (!payload?.success) {
    if (isBlockedSendCode(payload?.code) || isBlockedSendCode(payload?.error)) {
      throw new Error(BLOCKED_MESSAGE_COPY);
    }
    throw new Error(payload?.error || fallback);
  }
}

export type MatchListItem = {
  id: string;
  name: string;
  age: number;
  image: string;
  conversationPreview: ConversationPreview;
  /** For client search (“matched on message”); includes `you` when preview uses You prefix. */
  messageSearchHaystack: string;
  time: string;
  unread: boolean;
  /** True if matched within last 24h (web parity for "new" pill) */
  isNew: boolean;
  matchId: string;
  /** Per-user archive state derived from `match_archives` for the current viewer. */
  archived_at: string | null;
  archived_by: string | null;
  bunnyVideoUid?: string | null;
  /** Vibe labels from `profile_vibes` / `vibe_tags` (all tags for search; web list UI may show fewer). */
  vibes: string[];
  looking_for: string | null;
  location: string | null;
  eventName: string | null;
  /** Deterministic; larger = better (Best Match sort). */
  bestMatchScore: number;
  /** Same inputs as bestMatchScore; for parity with web row badge if needed. */
  compatibilityPercent: number;
};

export function useMatches(userId: string | null | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    const invalidateMatches = () => {
      queryClient.invalidateQueries({ queryKey: ['matches'] });
      queryClient.invalidateQueries({ queryKey: ['profile-live-counts'] });
    };
    const channel = supabase.channel(`matches-realtime-${userId}`);
    for (const filter of [`profile_id_1=eq.${userId}`, `profile_id_2=eq.${userId}`]) {
      channel
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matches', filter }, invalidateMatches)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter }, invalidateMatches);
    }
    channel
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_archives', filter: `user_id=eq.${userId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['matches'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, queryClient]);

  return useQuery({
    queryKey: ['matches', userId],
    queryFn: async (): Promise<MatchListItem[]> => {
      if (!userId) return [];
      const { data: matches, error } = await supabase
        .from('matches')
        .select('id, matched_at, last_message_at, profile_id_1, profile_id_2, archived_at, archived_by, event_id')
        .or(`profile_id_1.eq.${userId},profile_id_2.eq.${userId}`)
        .order('last_message_at', { ascending: false, nullsFirst: false });
      if (error) throw error;
      if (!matches?.length) return [];
      const matchIds = matches.map((m) => m.id);

      const otherIds = matches.map((m) => (m.profile_id_1 === userId ? m.profile_id_2 : m.profile_id_1));
      const profileIdsForFetch = [...otherIds, userId];
      const eventIds = matches
        .map((m) => (m as { event_id?: string | null }).event_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);

      const [profiles, messagesRes, eventsRes, archivesRes] = await Promise.all([
        fetchChatMatchProfiles(profileIdsForFetch),
        supabase
          .from('messages')
          .select(
            'match_id, content, created_at, read_at, sender_id, message_kind, audio_url, video_url, structured_payload'
          )
          .in('match_id', matchIds)
          .order('created_at', { ascending: false }),
        eventIds.length > 0
          ? supabase.from('events').select('id, title').in('id', eventIds)
          : Promise.resolve({ data: [] as { id: string; title: string }[] }),
        supabase.from('match_archives').select('match_id, archived_at').eq('user_id', userId).in('match_id', matchIds),
      ]);
      if (messagesRes.error) throw messagesRes.error;
      if ('error' in eventsRes && eventsRes.error) throw eventsRes.error;
      if (archivesRes.error) throw archivesRes.error;

      type MatchLatestRow = {
        match_id: string;
        content: string | null;
        created_at: string;
        read_at: string | null;
        sender_id: string;
        message_kind: string | null;
        audio_url: string | null;
        video_url: string | null;
        structured_payload: unknown;
      };
      const lastMessages = (messagesRes.data || []).reduce<Record<string, MatchLatestRow>>((acc, msg) => {
        const row = msg as MatchLatestRow;
        if (!acc[row.match_id]) acc[row.match_id] = row;
        return acc;
      }, {});

      const vibesByProfile: Record<string, string[]> = {};
      profiles.forEach((profile) => {
        vibesByProfile[profile.id] = profile.vibes ?? [];
      });

      const events = (eventsRes.data || []) as { id: string; title: string }[];
      const eventsById: Record<string, string> = {};
      events.forEach((e) => {
        eventsById[e.id] = e.title;
      });
      const archivedAtByMatch: Record<string, string> = {};
      ((archivesRes.data || []) as { match_id: string; archived_at: string }[]).forEach((archive) => {
        archivedAtByMatch[archive.match_id] = archive.archived_at;
      });

      const viewerProfile = profiles.find((p) => p.id === userId);
      const viewerVibes = vibesByProfile[userId] ?? [];
      const viewerLookingFor = profileIntentForMatch(viewerProfile);

      const formatTime = (createdAt: string) => {
        const d = new Date(createdAt);
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        if (diffMs < 60000) return 'now';
        if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m`;
        if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h`;
        return d.toLocaleDateString();
      };

      const ONE_DAY_MS = 24 * 60 * 60 * 1000;
      return matches.map((match) => {
        const otherId = match.profile_id_1 === userId ? match.profile_id_2 : match.profile_id_1;
        const profile = profiles.find((p) => p.id === otherId);
        const lastMsg = lastMessages[match.id];
        const photo = resolvePrimaryProfilePhotoPath({
          photos: profile?.photos,
          avatar_url: profile?.avatar_url,
        });
        const matchedAt = match.matched_at ? new Date(match.matched_at).getTime() : 0;
        const isNew = Date.now() - matchedAt < ONE_DAY_MS;
        const eventId = (match as { event_id?: string | null }).event_id;
        const eventTitle = eventId ? eventsById[eventId] ?? null : null;
        const lookingFor = profileIntentForMatch(profile);
        const location = (profile as { location?: string | null }).location ?? null;
        const otherVibes = vibesByProfile[otherId] ?? [];
        const scoreInput: MatchScoreInput = {
          viewerVibeLabels: viewerVibes,
          otherVibeLabels: otherVibes,
          viewerLookingFor,
          otherLookingFor: lookingFor,
          hasSharedEventContext: !!eventId,
        };
        const bestMatchScore = bestMatchSortKey(scoreInput);
        const compatPct = compatibilityPercent(scoreInput);

        const conversationPreview = lastMsg
          ? getConversationPreview(
              {
                content: lastMsg.content,
                message_kind: lastMsg.message_kind,
                audio_url: lastMsg.audio_url,
                video_url: lastMsg.video_url,
                sender_id: lastMsg.sender_id,
                structured_payload: lastMsg.structured_payload,
              },
              userId,
            )
          : getEmptyConversationPreview();

        return {
          id: otherId,
          name: profile?.name || 'Unknown',
          age: profile?.age ?? 0,
          image: avatarUrl(photo, 'avatar'),
          conversationPreview,
          messageSearchHaystack: conversationPreviewSearchText(conversationPreview),
          time: lastMsg ? formatTime(lastMsg.created_at) : 'new',
          unread: lastMsg ? !lastMsg.read_at && lastMsg.sender_id !== userId : false,
          isNew,
          matchId: match.id,
          archived_at: archivedAtByMatch[match.id] ?? null,
          archived_by: archivedAtByMatch[match.id] ? userId : null,
          vibes: otherVibes,
          looking_for: lookingFor,
          location,
          eventName: eventTitle,
          bunnyVideoUid: profile?.bunny_video_uid ?? null,
          bestMatchScore,
          compatibilityPercent: compatPct,
        };
      });
    },
    enabled: !!userId,
  });
}

export type MessageStatusType = 'sending' | 'sent' | 'delivered' | 'read';
export type ChatMessage = {
  id: string;
  text: string;
  sender: 'me' | 'them';
  time: string;
  /** Epoch ms from `created_at` — for deterministic merge ordering with local/outbox rows */
  sortAtMs?: number;
  audio_url?: string | null;
  audio_source_ref?: string | null;
  audio_duration_seconds?: number | null;
  image_source_ref?: string | null;
  video_url?: string | null;
  video_source_ref?: string | null;
  video_duration_seconds?: number | null;
  thumbnail_source_ref?: string | null;
  read_at?: string | null;
  status?: MessageStatusType;
  /** Filled in UI layer from `message_reactions` + partner id (not a DB column on messages). */
  reactionPair?: ReactionPair | null;
  messageKind?: 'text' | 'date_suggestion' | 'date_suggestion_event' | 'vibe_game_session' | 'vibe_clip';
  refId?: string | null;
  structuredPayload?: Record<string, unknown> | null;
  /** Populated when `messageKind === 'vibe_game_session'` (collapsed thread rows). */
  gameSessionView?: NativeHydratedGameSessionView;
};

export type ChatOtherUser = {
  id: string;
  name: string;
  age: number;
  avatar_url: string | null;
  photos: string[] | null;
  last_seen_at: string | null;
  bunny_video_uid?: string | null;
};

type ChatPresenceRow = {
  can_view_presence?: boolean | null;
  is_online?: boolean | null;
  last_seen_at?: string | null;
};

const CHAT_THREAD_PAGE_SIZE = 28;
const CHAT_MESSAGE_SELECT =
  'id, match_id, sender_id, content, created_at, read_at, audio_url, audio_duration_seconds, video_url, video_duration_seconds, message_kind, ref_id, structured_payload';
let chatThreadPageEdgeUnavailable = false;

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
  messages: ChatMessage[];
  matchId: string | null;
  otherUser: ChatOtherUser | null;
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
  other_user?: {
    id: string;
    name?: string | null;
    age?: number | null;
    avatar_url?: string | null;
    photos?: string[] | null;
    last_seen_at?: string | null;
    bunny_video_uid?: string | null;
  } | null;
  match_archive?: { archived_at?: string | null; archived_by?: string | null } | null;
  messages?: ChatRawMessageRow[];
  date_suggestions?: DateSuggestionWithRelations[];
  next_cursor?: string | null;
  error?: string;
};

function normalizeRawMessage(row: Partial<ChatRawMessageRow> & { id: string }): ChatRawMessageRow {
  return {
    id: row.id,
    match_id: row.match_id ?? '',
    sender_id: row.sender_id ?? '',
    content: row.content ?? '',
    created_at: row.created_at ?? new Date(0).toISOString(),
    read_at: row.read_at ?? null,
    audio_url: row.audio_url ?? null,
    audio_duration_seconds: row.audio_duration_seconds ?? null,
    video_url: row.video_url ?? null,
    video_duration_seconds: row.video_duration_seconds ?? null,
    message_kind: row.message_kind ?? 'text',
    ref_id: row.ref_id ?? null,
    structured_payload: row.structured_payload ?? null,
  };
}

function isResolvedOrLocalMediaRef(value: string): boolean {
  return /^https?:\/\//i.test(value) || value.startsWith('blob:') || value.startsWith('file:') || value.startsWith('data:');
}

function durableChatMediaSourceRef(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || isResolvedOrLocalMediaRef(trimmed)) return undefined;
  return trimmed;
}

function structuredPayloadObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function collectChatMediaSourceRefs(row: {
  content: string;
  audio_url?: string | null;
  video_url?: string | null;
  structured_payload?: unknown;
}) {
  const payload = structuredPayloadObject(row.structured_payload);
  const thumbnailRef = typeof payload?.thumbnail_url === 'string' ? payload.thumbnail_url : null;
  return {
    audio: durableChatMediaSourceRef(row.audio_url),
    image: durableChatMediaSourceRef(
      parseChatImageMessageContent(row.content, { allowPrivateMediaRefs: true }),
    ),
    video: durableChatMediaSourceRef(row.video_url),
    thumbnail: durableChatMediaSourceRef(thumbnailRef),
  };
}

type ThreadPageCursor = {
  createdAt: string;
  id: string | null;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseThreadPageCursor(value: string | null | undefined): ThreadPageCursor | null {
  if (!value?.trim()) return null;
  const text = value.trim();
  try {
    const parsed = JSON.parse(text) as { created_at?: unknown; createdAt?: unknown; id?: unknown };
    const createdAt =
      typeof parsed.created_at === 'string'
        ? parsed.created_at
        : typeof parsed.createdAt === 'string'
          ? parsed.createdAt
          : null;
    const id = typeof parsed.id === 'string' && isUuid(parsed.id) ? parsed.id : null;
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

function mapRawRowToGameRow(row: ChatRawMessageRow): ChatGameSessionMessageRow {
  const sourceRefs = collectChatMediaSourceRefs(row);
  return {
    id: row.id,
    sender_id: row.sender_id,
    content: row.content,
    created_at: row.created_at,
    read_at: row.read_at,
    audio_url: row.audio_url,
    audio_source_ref: sourceRefs.audio,
    audio_duration_seconds: row.audio_duration_seconds,
    image_source_ref: sourceRefs.image,
    video_url: row.video_url,
    video_source_ref: sourceRefs.video,
    video_duration_seconds: row.video_duration_seconds,
    thumbnail_source_ref: sourceRefs.thumbnail,
    message_kind: row.message_kind,
    ref_id: row.ref_id,
    structured_payload: row.structured_payload,
  };
}

export async function hydrateChatRowsForDisplay(params: {
  rows: ChatRawMessageRow[];
  currentUserId: string;
  otherUserId: string;
}): Promise<ChatMessage[]> {
  const { rows, currentUserId, otherUserId } = params;
  const rowsForGames = rows.map((row) => mapRawRowToGameRow(normalizeRawMessage(row)));
  const resolvedRowsForGames = await Promise.all(
    rowsForGames.map((row) => resolveMessageMediaForDisplay(row)),
  );

  const mapStatus = (m: { sender_id: string; read_at: string | null }): MessageStatusType => {
    if (m.sender_id !== currentUserId) return 'sent';
    return m.read_at ? 'read' : 'delivered';
  };

  const mapDbRowToChatMessage = (m: ChatGameSessionMessageRow): ChatMessage => {
    const kind = toRenderableMessageKind(m.message_kind) as ChatMessage['messageKind'];
    return {
      id: m.id,
      text: m.content,
      sender: (m.sender_id === currentUserId ? 'me' : 'them') as 'me' | 'them',
      time: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      sortAtMs: new Date(m.created_at).getTime(),
      audio_url: m.audio_url ?? undefined,
      audio_source_ref: m.audio_source_ref ?? undefined,
      audio_duration_seconds: m.audio_duration_seconds ?? undefined,
      image_source_ref: m.image_source_ref ?? undefined,
      video_url: m.video_url ?? undefined,
      video_source_ref: m.video_source_ref ?? undefined,
      video_duration_seconds: m.video_duration_seconds ?? undefined,
      thumbnail_source_ref: m.thumbnail_source_ref ?? undefined,
      read_at: m.read_at ?? undefined,
      status: mapStatus(m),
      messageKind: kind,
      refId: m.ref_id ?? null,
      structuredPayload:
        m.structured_payload !== null &&
        m.structured_payload !== undefined &&
        typeof m.structured_payload === 'object' &&
        !Array.isArray(m.structured_payload)
          ? (m.structured_payload as Record<string, unknown>)
          : null,
    };
  };

  return collapseVibeGameMessageRows(resolvedRowsForGames, currentUserId, otherUserId, mapDbRowToChatMessage);
}

async function fetchDirectChatThreadPage(params: {
  otherUserId: string;
  currentUserId: string;
  beforeCreatedAt?: string | null;
  limit: number;
}): Promise<ChatThreadPage> {
  const { otherUserId, currentUserId, beforeCreatedAt, limit } = params;
  const { data: match, error: matchError } = await supabase
    .from('matches')
    .select('id')
    .or(`and(profile_id_1.eq.${currentUserId},profile_id_2.eq.${otherUserId}),and(profile_id_1.eq.${otherUserId},profile_id_2.eq.${currentUserId})`)
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
    .from('messages')
    .select(CHAT_MESSAGE_SELECT)
    .eq('match_id', match.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (beforeCreatedAt) {
    const cursor = parseThreadPageCursor(beforeCreatedAt);
    if (cursor?.id) {
      messagesQuery = messagesQuery.or(
        `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
      );
    } else if (cursor) {
      messagesQuery = messagesQuery.lt('created_at', cursor.createdAt);
    }
  }

  const [messagesRes, otherUserRes, presenceRes, archiveRes] = await Promise.all([
    messagesQuery,
    fetchUserProfile(otherUserId),
    supabase.rpc('get_chat_partner_presence', { p_match_id: match.id }).maybeSingle(),
    supabase.from('match_archives').select('archived_at').eq('match_id', match.id).eq('user_id', currentUserId).maybeSingle(),
  ]);
  if (messagesRes.error) throw messagesRes.error;

  const rawDesc = (messagesRes.data ?? []).map((row) => normalizeRawMessage(row as ChatRawMessageRow));
  const rawAsc = [...rawDesc].reverse();
  const presenceData = presenceRes.data as ChatPresenceRow | null;
  const presence = !presenceRes.error && presenceData?.can_view_presence ? presenceData : null;
  const otherUser: ChatOtherUser | null = otherUserRes
    ? {
        id: otherUserRes.id,
        name: otherUserRes.name ?? 'Unknown',
        age: otherUserRes.age ?? 0,
        avatar_url: resolvePrimaryProfilePhotoPath({
          photos: otherUserRes.photos,
          avatar_url: otherUserRes.avatar_url,
        }),
        photos: otherUserRes.photos ?? null,
        last_seen_at: presence?.last_seen_at ?? null,
        bunny_video_uid: otherUserRes.bunny_video_uid ?? null,
      }
    : null;

  return {
    matchId: match.id,
    otherUser,
    matchArchive:
      !archiveRes.error && archiveRes.data?.archived_at
        ? { archived_at: archiveRes.data.archived_at, archived_by: currentUserId }
        : null,
    dateSuggestions: [],
    messages: await hydrateChatRowsForDisplay({ rows: rawAsc, currentUserId, otherUserId }),
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
  const { data, error } = await supabase.functions.invoke('chat-thread-page', {
    body: {
      other_user_id: params.otherUserId,
      before_created_at: params.beforeCreatedAt ?? null,
      limit: params.limit,
    },
  });
  if (error) throw error;
  const payload = data as ChatThreadPagePayload | null;
  if (!payload?.success) throw new Error(payload?.error || 'chat_thread_page_failed');
  const rawRows = (payload.messages ?? []).map(normalizeRawMessage);
  const otherUser: ChatOtherUser | null = payload.other_user
    ? {
        id: payload.other_user.id,
        name: payload.other_user.name ?? 'Unknown',
        age: payload.other_user.age ?? 0,
        avatar_url: payload.other_user.avatar_url ?? null,
        photos: payload.other_user.photos ?? null,
        last_seen_at: payload.other_user.last_seen_at ?? null,
        bunny_video_uid: payload.other_user.bunny_video_uid ?? null,
      }
    : null;
  return {
    matchId: payload.match_id ?? null,
    otherUser,
    matchArchive:
      payload.match_archive?.archived_at
        ? {
            archived_at: payload.match_archive.archived_at,
            archived_by: payload.match_archive.archived_by ?? params.currentUserId,
          }
        : null,
    dateSuggestions: payload.date_suggestions ?? [],
    messages: await hydrateChatRowsForDisplay({
      rows: rawRows,
      currentUserId: params.currentUserId,
      otherUserId: params.otherUserId,
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

export function useMessages(otherUserId: string | undefined, currentUserId: string | null | undefined) {
  const qc = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: threadMessagesQueryKey(otherUserId ?? '', currentUserId ?? ''),
    queryFn: ({ pageParam }) => {
      if (!currentUserId || !otherUserId) {
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
        beforeCreatedAt: typeof pageParam === 'string' ? pageParam : null,
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
    qc.setQueryData(['date-suggestions', query.data.matchId], (old: unknown) => {
      const byId = new Map<string, DateSuggestionWithRelations>();
      if (Array.isArray(old)) {
        for (const suggestion of old) byId.set(suggestion.id, suggestion);
      }
      for (const suggestion of query.data.dateSuggestions) {
        byId.set(suggestion.id, suggestion);
      }
      return Array.from(byId.values());
    });
  }, [query.data?.dateSuggestions, query.data?.matchId, qc]);

  return query;
}

export function prefetchChatThread(queryClient: QueryClient, otherUserId: string, currentUserId: string) {
  if (!otherUserId || !currentUserId) return Promise.resolve();
  return queryClient.prefetchInfiniteQuery({
    queryKey: threadMessagesQueryKey(otherUserId, currentUserId),
    queryFn: ({ pageParam }) =>
      fetchChatThreadPage({
        otherUserId,
        currentUserId,
        beforeCreatedAt: typeof pageParam === 'string' ? pageParam : null,
        limit: CHAT_THREAD_PAGE_SIZE,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: ChatThreadPage) => lastPage.nextCursor ?? undefined,
  });
}

export async function invokeSendMessageEdge(params: {
  matchId: string;
  content: string;
  clientRequestId?: string;
}): Promise<unknown> {
  const { matchId, content, clientRequestId } = params;
  const body: Record<string, string> = { match_id: matchId, content: content.trim() };
  if (clientRequestId?.trim()) {
    body.client_request_id = clientRequestId.trim();
  }
  const { data, error } = await supabase.functions.invoke('send-message', { body });
  if (error) await throwMappedSendMessageError(error);
  const payload = data as { success?: boolean; message?: unknown; error?: string; code?: string };
  assertSendMessagePayload(payload, 'Send failed');
  return payload.message;
}

/** Canonical server-owned publish for voice messages (after upload-voice). */
export async function invokePublishVoiceMessage(params: {
  matchId: string;
  audioUrl: string;
  durationSeconds: number;
  clientRequestId: string;
}): Promise<unknown> {
  const body: Record<string, unknown> = {
    match_id: params.matchId,
    message_kind: 'voice',
    audio_url: params.audioUrl,
    audio_duration_seconds: Math.round(params.durationSeconds),
    client_request_id: params.clientRequestId,
  };
  const { data, error } = await supabase.functions.invoke('send-message', { body });
  if (error) await throwMappedSendMessageError(error);
  const payload = data as { success?: boolean; message?: unknown; error?: string; code?: string };
  assertSendMessagePayload(payload, 'Voice message publish failed');
  return payload.message;
}

export function useSendMessage() {
  const qc = useQueryClient();
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
      return invokeSendMessageEdge({ matchId, content, clientRequestId });
    },
    onSuccess: (_data, variables) => {
      invalidateAfterThreadMutation(qc, variables.invalidateScope);
    },
  });
}

/** Mark partner's unread messages read (SECURITY DEFINER RPC — RLS blocks direct UPDATE on others' rows). */
export async function markMatchMessagesRead(matchId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_match_messages_read', { p_match_id: matchId });
  if (error) throw error;
}

/** Scoped thread patching on message INSERT/UPDATE. Incoming sound: deferred — see repo `src/lib/chatIncomingSound.ts`. */
export function useRealtimeMessages(opts: {
  matchId: string | null;
  enabled: boolean;
  threadOtherUserId: string | null | undefined;
  threadCurrentUserId: string | null | undefined;
}) {
  const { matchId, enabled, threadOtherUserId, threadCurrentUserId } = opts;
  const qc = useQueryClient();
  const invalidateThread = useCallback(() => {
    if (threadOtherUserId && threadCurrentUserId) {
      qc.invalidateQueries({
        queryKey: threadMessagesQueryKey(threadOtherUserId, threadCurrentUserId),
        exact: true,
      });
    }
  }, [qc, threadOtherUserId, threadCurrentUserId]);

  const invalidatePeripheralCaches = useCallback((rowMatchId: string | null | undefined, kind?: string | null) => {
    qc.invalidateQueries({ queryKey: ['matches'] });
    qc.invalidateQueries({ queryKey: ['profile-live-counts'] });
    const isDateRow = kind === 'date_suggestion' || kind === 'date_suggestion_event';
    if (rowMatchId && isDateRow) {
      qc.invalidateQueries({ queryKey: ['date-suggestions', rowMatchId] });
    }
  }, [qc]);

  const patchMessage = useCallback(
    async (event: 'INSERT' | 'UPDATE', raw: unknown) => {
      if (!threadOtherUserId || !threadCurrentUserId || !matchId) return;
      if (!raw || typeof raw !== 'object' || !('id' in raw)) {
        invalidateThread();
        return;
      }
      const row = normalizeRawMessage(raw as Partial<ChatRawMessageRow> & { id: string });
      if (row.match_id !== matchId) return;

      const renderableKind = toRenderableMessageKind(row.message_kind);
      invalidatePeripheralCaches(row.match_id, renderableKind);
      if (row.message_kind === 'vibe_game' || renderableKind === 'vibe_game_session') {
        invalidateThread();
        return;
      }

      let hydrated: ChatMessage[];
      try {
        hydrated = await hydrateChatRowsForDisplay({
          rows: [row],
          currentUserId: threadCurrentUserId,
          otherUserId: threadOtherUserId,
        });
      } catch {
        invalidateThread();
        return;
      }
      const message = hydrated[0];
      if (!message) {
        invalidateThread();
        return;
      }

      const key = threadMessagesQueryKey(threadOtherUserId, threadCurrentUserId);
      let patched = false;
      qc.setQueryData<InfiniteData<ChatThreadPage>>(key, (old) => {
        if (!old?.pages?.length) return old;
        let found = false;
        const pages = old.pages.map((page, pageIndex) => {
          const existingIndex = page.messages.findIndex((m) => m.id === message.id);
          if (existingIndex >= 0) {
            found = true;
            patched = true;
            const messages = page.messages.map((m) => (m.id === message.id ? { ...m, ...message } : m));
            return { ...page, messages };
          }
          if (event === 'INSERT' && pageIndex === 0) {
            patched = true;
            const latestById = new Map<string, ChatMessage>();
            for (const m of [...page.messages, message]) {
              latestById.set(m.id, m);
            }
            const messages = Array.from(latestById.values())
              .sort((a, b) => (a.sortAtMs ?? 0) - (b.sortAtMs ?? 0));
            return { ...page, messages };
          }
          return page;
        });
        if (event === 'UPDATE' && !found) return old;
        return { ...old, pages };
      });

      if (event === 'INSERT' && !patched) {
        invalidateThread();
      }
    },
    [
      invalidatePeripheralCaches,
      invalidateThread,
      matchId,
      qc,
      threadCurrentUserId,
      threadOtherUserId,
    ],
  );

  useEffect(() => {
    if (!matchId || !enabled) return;
    const channel = supabase
      .channel(`messages-${matchId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `match_id=eq.${matchId}` }, (payload) => {
        void patchMessage('INSERT', payload.new);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `match_id=eq.${matchId}` }, (payload) => {
        void patchMessage('UPDATE', payload.new);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [matchId, enabled, patchMessage]);
}

/**
 * Single global `messages` postgres_changes subscription for inbox / OS badge counts (not per-match).
 *
 * Supabase Realtime: for Postgres Changes, rows are delivered only to clients that pass SELECT RLS on
 * `public.messages` (see Supabase docs “Interaction with Postgres Changes”). Our policies restrict
 * visibility to INSERT/UPDATE rows in matches where the user is a participant — not all traffic on the table.
 * DELETE events only expose old primary keys and are not participant-scoped here, so deletes are left
 * to focused chat invalidation, match archive invalidation, and polling rather than table-wide fan-out.
 * Channel `private` / `realtime.messages` policies apply to Broadcast/Presence, not Postgres Changes.
 *
 * Intentional overlap: `useRealtimeMessages` still runs in open chat for scoped `messages` query
 * invalidation; this hook only touches `unread-message-count` + `badge-count`. No feedback loop:
 * `invalidateQueries` does not emit Realtime events.
 */
export function useGlobalMessagesInboxInvalidation(userId: string | null | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const invalidateInbox = () => {
      qc.invalidateQueries({ queryKey: ['unread-message-count'] });
      qc.invalidateQueries({ queryKey: ['badge-count'] });
      qc.invalidateQueries({ queryKey: ['unread-home'] });
      qc.invalidateQueries({ queryKey: ['unread-home-info-bar'] });
    };
    const channel = supabase
      .channel('global-messages-inbox')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        invalidateInbox
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        invalidateInbox
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_archives', filter: `user_id=eq.${userId}` },
        invalidateInbox
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, qc]);
}

/** Typing indicator: broadcast when local user types, subscribe for partner typing. */
export function useTypingBroadcast(
  matchId: string | null,
  currentUserId: string | null | undefined,
  isTyping: boolean,
  enabled: boolean
) {
  const [partnerTyping, setPartnerTyping] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const isTypingRef = useRef(isTyping);

  useEffect(() => {
    isTypingRef.current = isTyping;
  }, [isTyping]);

  useEffect(() => {
    if (!matchId || !currentUserId || !enabled) {
      setPartnerTyping(false);
      return;
    }
    const channelName = `chat-typing-${matchId}`;
    const channel = supabase.channel(channelName);
    channelRef.current = channel;
    channel
      .on('broadcast', { event: 'typing' }, (payload) => {
        const { userId, typing } = (payload.payload as { userId?: string; typing?: boolean }) ?? {};
        if (userId && userId !== currentUserId) setPartnerTyping(typing === true);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && isTypingRef.current) {
          void (channel.send as (args: Record<string, unknown>) => Promise<unknown>)({
            type: 'broadcast',
            event: 'typing',
            payload: { userId: currentUserId, typing: true },
            extras: { httpSend: true },
          });
        }
      });
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
      setPartnerTyping(false);
    };
  }, [matchId, currentUserId, enabled]);

  const sendTyping = useCallback(
    (typing: boolean) => {
      if (!matchId || !currentUserId || !channelRef.current) return;
      void (channelRef.current.send as (args: Record<string, unknown>) => Promise<unknown>)({
        type: 'broadcast',
        event: 'typing',
        payload: { userId: currentUserId, typing },
        extras: { httpSend: true },
      });
    },
    [matchId, currentUserId]
  );

  useEffect(() => {
    if (!enabled) return;
    sendTyping(isTyping);
  }, [isTyping, enabled, sendTyping]);

  return { partnerTyping };
}
