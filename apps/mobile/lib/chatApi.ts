import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useCallback, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { avatarUrl } from '@/lib/imageUrl';
import { uploadVoiceMessage, uploadChatVideoMessage } from '@/lib/chatMediaUpload';

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
  /** When set, match is archived (hidden from main list unless showing archived) */
  archived_at: string | null;
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
        .select('id, matched_at, last_message_at, profile_id_1, profile_id_2, archived_at')
        .or(`profile_id_1.eq.${userId},profile_id_2.eq.${userId}`)
        .order('last_message_at', { ascending: false, nullsFirst: false });
      if (error) throw error;
      if (!matches?.length) return [];

      const otherIds = matches.map((m) => (m.profile_id_1 === userId ? m.profile_id_2 : m.profile_id_1));
      const [profilesRes, messagesRes] = await Promise.all([
        supabase.from('profiles').select('id, name, age, avatar_url, photos').in('id', otherIds),
        supabase
          .from('messages')
          .select('match_id, content, created_at, read_at, sender_id')
          .in('match_id', matches.map((m) => m.id))
          .order('created_at', { ascending: false }),
      ]);
      const profiles = profilesRes.data || [];
      const lastMessages = (messagesRes.data || []).reduce<Record<string, { match_id: string; content: string; created_at: string; read_at: string | null; sender_id: string }>>((acc, msg) => {
        if (!acc[msg.match_id]) acc[msg.match_id] = msg;
        return acc;
      }, {});

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
  audio_url?: string | null;
  audio_duration_seconds?: number | null;
  video_url?: string | null;
  video_duration_seconds?: number | null;
  read_at?: string | null;
  status?: MessageStatusType;
  reaction?: ReactionEmoji | null;
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
          .select('id, match_id, sender_id, content, created_at, read_at, audio_url, audio_duration_seconds, video_url, video_duration_seconds')
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

      return {
        matchId: match.id,
        otherUser,
        messages: messages.map((m) => ({
          id: m.id,
          text: m.content,
          sender: (m.sender_id === currentUserId ? 'me' : 'them') as 'me' | 'them',
          time: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          audio_url: m.audio_url ?? undefined,
          audio_duration_seconds: m.audio_duration_seconds ?? undefined,
          video_url: m.video_url ?? undefined,
          video_duration_seconds: m.video_duration_seconds ?? undefined,
          read_at: m.read_at ?? undefined,
          status: mapStatus(m),
        })),
      };
    },
    enabled: !!otherUserId && !!currentUserId,
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ matchId, content }: { matchId: string; content: string }) => {
      const { data, error } = await supabase.functions.invoke('send-message', {
        body: { match_id: matchId, content: content.trim() },
      });
      if (error) throw error;
      const payload = data as { success?: boolean; message?: unknown };
      if (!payload?.success) throw new Error((payload as { error?: string })?.error || 'Send failed');
      return payload.message;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });
}

export function useRealtimeMessages(matchId: string | null, enabled: boolean) {
  const qc = useQueryClient();
  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['messages'] });
    qc.invalidateQueries({ queryKey: ['matches'] });
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

/** Typing indicator: broadcast when local user types, subscribe for partner typing. */
export function useTypingBroadcast(
  matchId: string | null,
  currentUserId: string | null | undefined,
  isTyping: boolean,
  enabled: boolean
) {
  const [partnerTyping, setPartnerTyping] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

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
        if (status === 'SUBSCRIBED' && isTyping) {
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
export function useSendVoiceMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      matchId,
      audioUri,
      durationSeconds,
      currentUserId,
    }: {
      matchId: string;
      audioUri: string;
      durationSeconds: number;
      currentUserId: string;
    }) => {
      const audioUrl = await uploadVoiceMessage(audioUri, matchId);
      const { data, error } = await supabase.from('messages').insert({
        match_id: matchId,
        sender_id: currentUserId,
        content: '🎤 Voice message',
        audio_url: audioUrl,
        audio_duration_seconds: Math.round(durationSeconds),
      }).select('id, match_id, sender_id, content, created_at, audio_url, audio_duration_seconds').single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });
}

/** Send chat video message: upload via upload-chat-video EF then insert (same as web). */
export function useSendChatVideoMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      matchId,
      videoUri,
      durationSeconds,
      currentUserId,
      mimeType,
    }: {
      matchId: string;
      videoUri: string;
      durationSeconds: number;
      currentUserId: string;
      mimeType?: string;
    }) => {
      const videoUrl = await uploadChatVideoMessage(videoUri, matchId, mimeType ?? 'video/mp4');
      const { data, error } = await supabase.from('messages').insert({
        match_id: matchId,
        sender_id: currentUserId,
        content: '📹 Video message',
        video_url: videoUrl,
        video_duration_seconds: Math.round(durationSeconds),
      }).select('id, match_id, sender_id, content, created_at, video_url, video_duration_seconds').single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });
}
