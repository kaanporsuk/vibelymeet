import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useCallback, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { avatarUrl } from '@/lib/imageUrl';
import { bestMatchSortKey, compatibilityPercent, type MatchScoreInput } from '@/lib/matchSortScore';
import { uploadVoiceMessage, uploadChatVideoMessage } from '@/lib/chatMediaUpload';
import {
  collapseVibeGameMessageRows,
  type ChatGameSessionMessageRow,
  type NativeHydratedGameSessionView,
} from '@/lib/chatGameSessions';
import { toRenderableMessageKind } from '../../../shared/chat/messageRouting';

export type { NativeHydratedGameSessionView };

export type MatchListItem = {
  id: string;
  name: string;
  age: number;
  image: string;
  lastMessage: string | null;
  time: string;
  unread: boolean;
  /** True if matched within last 24h (web parity for "new" pill) */
  isNew: boolean;
  matchId: string;
  /** When set, match is archived for the user who archived it (`archived_by`) */
  archived_at: string | null;
  archived_by: string | null;
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
    const channel = supabase
      .channel(`matches-realtime-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matches' }, (payload: { new: { profile_id_1: string; profile_id_2: string } }) => {
        const row = payload.new;
        if (row.profile_id_1 === userId || row.profile_id_2 === userId) {
          queryClient.invalidateQueries({ queryKey: ['matches'] });
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches' }, (payload: { new: { profile_id_1: string; profile_id_2: string } }) => {
        const row = payload.new;
        if (row.profile_id_1 === userId || row.profile_id_2 === userId) {
          queryClient.invalidateQueries({ queryKey: ['matches'] });
        }
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

      const otherIds = matches.map((m) => (m.profile_id_1 === userId ? m.profile_id_2 : m.profile_id_1));
      const profileIdsForFetch = [...otherIds, userId];
      const eventIds = matches
        .map((m) => (m as { event_id?: string | null }).event_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);

      const [profilesRes, vibesRes, messagesRes, eventsRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, name, age, avatar_url, photos, looking_for, location')
          .in('id', profileIdsForFetch),
        supabase.from('profile_vibes').select('profile_id, vibe_tags(label)').in('profile_id', profileIdsForFetch),
        supabase
          .from('messages')
          .select('match_id, content, created_at, read_at, sender_id')
          .in('match_id', matches.map((m) => m.id))
          .order('created_at', { ascending: false }),
        eventIds.length > 0
          ? supabase.from('events').select('id, title').in('id', eventIds)
          : Promise.resolve({ data: [] as { id: string; title: string }[] }),
      ]);
      if (profilesRes.error) throw profilesRes.error;
      if (vibesRes.error) throw vibesRes.error;
      if (messagesRes.error) throw messagesRes.error;
      if ('error' in eventsRes && eventsRes.error) throw eventsRes.error;

      const profiles = profilesRes.data || [];
      const profileVibes = (vibesRes.data || []) as unknown as {
        profile_id: string;
        vibe_tags: { label: string } | { label: string }[] | null;
      }[];
      const lastMessages = (messagesRes.data || []).reduce<Record<string, { match_id: string; content: string; created_at: string; read_at: string | null; sender_id: string }>>((acc, msg) => {
        if (!acc[msg.match_id]) acc[msg.match_id] = msg;
        return acc;
      }, {});

      const vibesByProfile: Record<string, string[]> = {};
      profileVibes.forEach((pv) => {
        if (!vibesByProfile[pv.profile_id]) vibesByProfile[pv.profile_id] = [];
        const vt = pv.vibe_tags;
        const label = Array.isArray(vt) ? vt[0]?.label : vt?.label;
        if (label && !vibesByProfile[pv.profile_id].includes(label)) {
          vibesByProfile[pv.profile_id].push(label);
        }
      });

      const events = (eventsRes.data || []) as { id: string; title: string }[];
      const eventsById: Record<string, string> = {};
      events.forEach((e) => {
        eventsById[e.id] = e.title;
      });

      const viewerProfile = profiles.find((p) => p.id === userId);
      const viewerVibes = vibesByProfile[userId] ?? [];
      const viewerLookingFor = (viewerProfile as { looking_for?: string | null }).looking_for ?? null;

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
        const photo = (profile as { photos?: string[] })?.photos?.[0] || (profile as { avatar_url?: string })?.avatar_url || '';
        const matchedAt = match.matched_at ? new Date(match.matched_at).getTime() : 0;
        const isNew = Date.now() - matchedAt < ONE_DAY_MS;
        const eventId = (match as { event_id?: string | null }).event_id;
        const eventTitle = eventId ? eventsById[eventId] ?? null : null;
        const lookingFor = (profile as { looking_for?: string | null }).looking_for ?? null;
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

        return {
          id: otherId,
          name: (profile as { name?: string })?.name || 'Unknown',
          age: (profile as { age?: number })?.age ?? 0,
          image: avatarUrl(photo, 'avatar'),
          lastMessage: lastMsg?.content ?? null,
          time: lastMsg ? formatTime(lastMsg.created_at) : 'new',
          unread: lastMsg ? !lastMsg.read_at && lastMsg.sender_id !== userId : false,
          isNew,
          matchId: match.id,
          archived_at: (match as { archived_at?: string | null }).archived_at ?? null,
          archived_by: (match as { archived_by?: string | null }).archived_by ?? null,
          vibes: otherVibes,
          looking_for: lookingFor,
          location,
          eventName: eventTitle,
          bestMatchScore,
          compatibilityPercent: compatPct,
        };
      });
    },
    enabled: !!userId,
  });
}

export type MessageStatusType = 'sending' | 'sent' | 'delivered' | 'read';
export type ReactionEmoji = '❤️' | '🔥' | '🤣' | '😮' | '👎';

export type ChatMessage = {
  id: string;
  text: string;
  sender: 'me' | 'them';
  time: string;
  /** Epoch ms from `created_at` — for deterministic merge ordering with local/outbox rows */
  sortAtMs?: number;
  audio_url?: string | null;
  audio_duration_seconds?: number | null;
  video_url?: string | null;
  video_duration_seconds?: number | null;
  read_at?: string | null;
  status?: MessageStatusType;
  reaction?: ReactionEmoji | null;
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
};

export function useMessages(otherUserId: string | undefined, currentUserId: string | null | undefined) {
  return useQuery({
    queryKey: ['messages', otherUserId, currentUserId],
    queryFn: async (): Promise<{ messages: ChatMessage[]; matchId: string | null; otherUser: ChatOtherUser | null }> => {
      if (!currentUserId || !otherUserId) return { messages: [], matchId: null, otherUser: null };
      const { data: match, error: matchError } = await supabase
        .from('matches')
        .select('id')
        .or(`and(profile_id_1.eq.${currentUserId},profile_id_2.eq.${otherUserId}),and(profile_id_1.eq.${otherUserId},profile_id_2.eq.${currentUserId})`)
        .maybeSingle();
      if (matchError) throw matchError;
      if (!match) return { messages: [], matchId: null, otherUser: null };

      const [messagesRes, otherUserRes] = await Promise.all([
        supabase
          .from('messages')
          .select(
            'id, match_id, sender_id, content, created_at, read_at, audio_url, audio_duration_seconds, video_url, video_duration_seconds, message_kind, ref_id, structured_payload'
          )
          .eq('match_id', match.id)
          .order('created_at', { ascending: true }),
        supabase.from('profiles').select('id, name, age, avatar_url, photos, last_seen_at').eq('id', otherUserId).maybeSingle(),
      ]);
      if (messagesRes.error) throw messagesRes.error;
      const messages = messagesRes.data || [];
      const otherRow = otherUserRes.data as { id: string; name?: string; age?: number; avatar_url?: string | null; photos?: string[] | null; last_seen_at?: string | null } | null;

      const otherUser: ChatOtherUser | null = otherRow
        ? {
            id: otherRow.id,
            name: otherRow.name ?? 'Unknown',
            age: otherRow.age ?? 0,
            avatar_url: otherRow.avatar_url ?? null,
            photos: otherRow.photos ?? null,
            last_seen_at: otherRow.last_seen_at ?? null,
          }
        : null;

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
          audio_duration_seconds: m.audio_duration_seconds ?? undefined,
          video_url: m.video_url ?? undefined,
          video_duration_seconds: m.video_duration_seconds ?? undefined,
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

      const rowsForGames: ChatGameSessionMessageRow[] = messages.map((m) => {
        const row = m as typeof m & {
          message_kind?: string | null;
          ref_id?: string | null;
          structured_payload?: unknown;
        };
        return {
          id: m.id,
          sender_id: m.sender_id,
          content: m.content,
          created_at: m.created_at,
          read_at: m.read_at,
          audio_url: m.audio_url,
          audio_duration_seconds: m.audio_duration_seconds,
          video_url: m.video_url,
          video_duration_seconds: m.video_duration_seconds,
          message_kind: row.message_kind ?? null,
          ref_id: row.ref_id ?? null,
          structured_payload: row.structured_payload ?? null,
        };
      });

      return {
        matchId: match.id,
        otherUser,
        messages: collapseVibeGameMessageRows(rowsForGames, currentUserId, otherUserId, mapDbRowToChatMessage),
      };
    },
    enabled: !!otherUserId && !!currentUserId,
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
  if (error) throw error;
  const payload = data as { success?: boolean; message?: unknown; error?: string };
  if (!payload?.success) throw new Error(payload?.error || 'Send failed');
  return payload.message;
}

/** Canonical server-owned publish for Vibe Clip messages. */
export async function invokePublishVibeClip(params: {
  matchId: string;
  videoUrl: string;
  durationMs: number;
  clientRequestId: string;
  thumbnailUrl?: string | null;
  aspectRatio?: number | null;
}): Promise<unknown> {
  const body: Record<string, unknown> = {
    match_id: params.matchId,
    message_kind: 'vibe_clip',
    video_url: params.videoUrl,
    duration_ms: params.durationMs,
    client_request_id: params.clientRequestId,
  };
  if (params.thumbnailUrl) body.thumbnail_url = params.thumbnailUrl;
  if (typeof params.aspectRatio === 'number' && Number.isFinite(params.aspectRatio) && params.aspectRatio > 0) {
    body.aspect_ratio = params.aspectRatio;
  }
  const { data, error } = await supabase.functions.invoke('send-message', { body });
  if (error) throw error;
  const payload = data as { success?: boolean; message?: unknown; error?: string };
  if (!payload?.success) throw new Error(payload?.error || 'Vibe Clip publish failed');
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
    }) => {
      return invokeSendMessageEdge({ matchId, content, clientRequestId });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
      qc.invalidateQueries({ queryKey: ['date-suggestions'] });
    },
  });
}

/** Mark partner's unread messages read (SECURITY DEFINER RPC — RLS blocks direct UPDATE on others' rows). */
export async function markMatchMessagesRead(matchId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_match_messages_read', { p_match_id: matchId });
  if (error) throw error;
}

export function useRealtimeMessages(matchId: string | null, enabled: boolean) {
  const qc = useQueryClient();
  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['messages'] });
    qc.invalidateQueries({ queryKey: ['matches'] });
    qc.invalidateQueries({ queryKey: ['date-suggestions'] });
  }, [qc]);
  useEffect(() => {
    if (!matchId || !enabled) return;
    const channel = supabase
      .channel(`messages-${matchId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `match_id=eq.${matchId}` }, invalidate)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `match_id=eq.${matchId}` }, invalidate)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [matchId, enabled, invalidate]);
}

/**
 * Single global `messages` postgres_changes subscription for inbox / OS badge counts (not per-match).
 *
 * Supabase Realtime: for Postgres Changes, rows are delivered only to clients that pass SELECT RLS on
 * `public.messages` (see Supabase docs “Interaction with Postgres Changes”). Our policies restrict
 * visibility to messages in matches where the user is a participant — not all traffic on the table.
 * Channel `private` / `realtime.messages` policies apply to Broadcast/Presence, not Postgres Changes.
 *
 * Intentional overlap: `useRealtimeMessages(matchId)` still runs in open chat for `messages` query
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
          channel.send({ type: 'broadcast', event: 'typing', payload: { userId: currentUserId, typing: true } });
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
      channelRef.current.send({ type: 'broadcast', event: 'typing', payload: { userId: currentUserId, typing } });
    },
    [matchId, currentUserId]
  );

  useEffect(() => {
    if (!enabled) return;
    sendTyping(isTyping);
  }, [isTyping, enabled, sendTyping]);

  return { partnerTyping };
}

/** Send voice message: upload via upload-voice EF then insert (same as web). */
export async function insertVoiceMessageRow(params: {
  matchId: string;
  currentUserId: string;
  audioUrl: string;
  durationSeconds: number;
  clientRequestId?: string;
}) {
  const { matchId, currentUserId, audioUrl, durationSeconds, clientRequestId } = params;
  const row: Record<string, unknown> = {
    match_id: matchId,
    sender_id: currentUserId,
    content: '🎤 Voice message',
    audio_url: audioUrl,
    audio_duration_seconds: Math.round(durationSeconds),
  };
  if (clientRequestId?.trim()) {
    row.structured_payload = { client_request_id: clientRequestId.trim(), v: 1 };
  }
  const { data, error } = await supabase
    .from('messages')
    .insert(row)
    .select('id, match_id, sender_id, content, created_at, audio_url, audio_duration_seconds')
    .single();
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === '23505' && clientRequestId?.trim()) {
      const { data: existing } = await supabase
        .from('messages')
        .select('id, match_id, sender_id, content, created_at, audio_url, audio_duration_seconds')
        .eq('match_id', matchId)
        .eq('sender_id', currentUserId)
        .contains('structured_payload', { client_request_id: clientRequestId.trim() })
        .maybeSingle();
      if (existing) return existing;
    }
    throw error;
  }
  return data;
}

export function useSendVoiceMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      matchId,
      audioUri,
      durationSeconds,
      currentUserId,
      clientRequestId,
    }: {
      matchId: string;
      audioUri: string;
      durationSeconds: number;
      currentUserId: string;
      clientRequestId?: string;
    }) => {
      const audioUrl = await uploadVoiceMessage(audioUri, matchId);
      return insertVoiceMessageRow({
        matchId,
        currentUserId,
        audioUrl,
        durationSeconds,
        clientRequestId,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });
}

/** Send chat video message: upload via upload-chat-video EF then insert (same as web). */
export async function insertChatVideoMessageRow(params: {
  matchId: string;
  currentUserId: string;
  videoUrl: string;
  durationSeconds: number;
  clientRequestId?: string;
}) {
  const { matchId, currentUserId, videoUrl, durationSeconds, clientRequestId } = params;
  const row: Record<string, unknown> = {
    match_id: matchId,
    sender_id: currentUserId,
    content: '📹 Video message',
    video_url: videoUrl,
    video_duration_seconds: Math.round(durationSeconds),
  };
  if (clientRequestId?.trim()) {
    row.structured_payload = { client_request_id: clientRequestId.trim(), v: 1 };
  }
  const { data, error } = await supabase
    .from('messages')
    .insert(row)
    .select('id, match_id, sender_id, content, created_at, video_url, video_duration_seconds')
    .single();
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === '23505' && clientRequestId?.trim()) {
      const { data: existing } = await supabase
        .from('messages')
        .select('id, match_id, sender_id, content, created_at, video_url, video_duration_seconds')
        .eq('match_id', matchId)
        .eq('sender_id', currentUserId)
        .contains('structured_payload', { client_request_id: clientRequestId.trim() })
        .maybeSingle();
      if (existing) return existing;
    }
    throw error;
  }
  return data;
}

export function useSendChatVideoMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      matchId,
      videoUri,
      durationSeconds,
      currentUserId,
      mimeType,
      clientRequestId,
    }: {
      matchId: string;
      videoUri: string;
      durationSeconds: number;
      currentUserId: string;
      mimeType?: string;
      clientRequestId?: string;
    }) => {
      const uploaded = await uploadChatVideoMessage(videoUri, matchId, mimeType ?? 'video/mp4');
      return insertChatVideoMessageRow({
        matchId,
        currentUserId,
        videoUrl: uploaded.videoUrl,
        durationSeconds,
        clientRequestId,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });
}
