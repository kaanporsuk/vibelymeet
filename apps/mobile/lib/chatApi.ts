import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { avatarUrl } from '@/lib/imageUrl';

export type MatchListItem = {
  id: string;
  name: string;
  age: number;
  image: string;
  lastMessage: string | null;
  time: string;
  unread: boolean;
  matchId: string;
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
        .select('id, matched_at, last_message_at, profile_id_1, profile_id_2')
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

      return matches.map((match) => {
        const otherId = match.profile_id_1 === userId ? match.profile_id_2 : match.profile_id_1;
        const profile = profiles.find((p) => p.id === otherId);
        const lastMsg = lastMessages[match.id];
        const photo = (profile as { photos?: string[] })?.photos?.[0] || (profile as { avatar_url?: string })?.avatar_url || '';
        return {
          id: otherId,
          name: (profile as { name?: string })?.name || 'Unknown',
          age: (profile as { age?: number })?.age ?? 0,
          image: avatarUrl(photo),
          lastMessage: lastMsg?.content ?? null,
          time: lastMsg ? formatTime(lastMsg.created_at) : 'new',
          unread: lastMsg ? !lastMsg.read_at && lastMsg.sender_id !== userId : false,
          matchId: match.id,
        };
      });
    },
    enabled: !!userId,
  });
}

export type ChatMessage = {
  id: string;
  text: string;
  sender: 'me' | 'them';
  time: string;
};

export function useMessages(otherUserId: string | undefined, currentUserId: string | null | undefined) {
  return useQuery({
    queryKey: ['messages', otherUserId, currentUserId],
    queryFn: async (): Promise<{ messages: ChatMessage[]; matchId: string | null }> => {
      if (!currentUserId || !otherUserId) return { messages: [], matchId: null };
      const { data: match, error: matchError } = await supabase
        .from('matches')
        .select('id')
        .or(`and(profile_id_1.eq.${currentUserId},profile_id_2.eq.${otherUserId}),and(profile_id_1.eq.${otherUserId},profile_id_2.eq.${currentUserId})`)
        .maybeSingle();
      if (matchError) throw matchError;
      if (!match) return { messages: [], matchId: null };

      const { data: messages, error: msgError } = await supabase
        .from('messages')
        .select('id, match_id, sender_id, content, created_at')
        .eq('match_id', match.id)
        .order('created_at', { ascending: true });
      if (msgError) throw msgError;

      return {
        matchId: match.id,
        messages: (messages || []).map((m) => ({
          id: m.id,
          text: m.content,
          sender: (m.sender_id === currentUserId ? 'me' : 'them') as 'me' | 'them',
          time: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
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
