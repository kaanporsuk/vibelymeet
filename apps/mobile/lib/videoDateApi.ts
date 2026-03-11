/**
 * Video date API: session state, Daily room token, and backend-owned transitions.
 * Uses same contracts as web: daily-room Edge Function, video_date_transition RPC.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export type VideoDateSession = {
  id: string;
  participant_1_id: string;
  participant_2_id: string;
  event_id: string;
  state?: string;
  phase?: string;
  ended_at: string | null;
  handshake_started_at: string | null;
  date_started_at: string | null;
  daily_room_name: string | null;
  daily_room_url: string | null;
};

export type VideoDatePartner = {
  id: string;
  name: string;
  age: number | null;
  avatar_url: string | null;
};

export type RoomTokenResult = {
  room_name: string;
  room_url: string;
  token: string;
};

const HANDSHAKE_SECONDS = 60;
const DATE_SECONDS = 300;

export function useVideoDateSession(
  sessionId: string | null | undefined,
  userId: string | null | undefined
) {
  const [session, setSession] = useState<VideoDateSession | null>(null);
  const [partner, setPartner] = useState<VideoDatePartner | null>(null);
  const [phase, setPhase] = useState<'handshake' | 'date' | 'ended'>('handshake');
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSession = useCallback(async () => {
    if (!sessionId || !userId) return;
    setLoading(true);
    setError(null);
    try {
      const { data: row, error: e } = await supabase
        .from('video_sessions')
        .select(
          'id, participant_1_id, participant_2_id, event_id, state, phase, ended_at, handshake_started_at, date_started_at, daily_room_name, daily_room_url'
        )
        .eq('id', sessionId)
        .maybeSingle();

      if (e || !row) {
        setError(e?.message ?? 'Session not found');
        setSession(null);
        setPartner(null);
        return;
      }

      const s = row as unknown as VideoDateSession;
      setSession(s);

      if (s.ended_at || (s.state === 'ended' || s.phase === 'ended')) {
        setPhase('ended');
        setTimeLeft(0);
        setLoading(false);
        return;
      }

      const partnerId = s.participant_1_id === userId ? s.participant_2_id : s.participant_1_id;
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, name, age, avatar_url')
        .eq('id', partnerId)
        .maybeSingle();

      if (profile) {
        setPartner(profile as unknown as VideoDatePartner);
      }

      const now = Date.now();
      if ((s.state === 'date' || s.phase === 'date') && s.date_started_at) {
        const elapsed = (now - new Date(s.date_started_at).getTime()) / 1000;
        setTimeLeft(Math.max(0, Math.ceil(DATE_SECONDS - elapsed)));
        setPhase('date');
      } else if (s.handshake_started_at) {
        const elapsed = (now - new Date(s.handshake_started_at).getTime()) / 1000;
        setTimeLeft(Math.max(0, Math.ceil(HANDSHAKE_SECONDS - elapsed)));
        setPhase('handshake');
      } else {
        setTimeLeft(HANDSHAKE_SECONDS);
        setPhase('handshake');
        // If no handshake_started_at yet, caller should invoke enter_handshake before joining Daily room
      }
    } finally {
      setLoading(false);
    }
  }, [sessionId, userId]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  useEffect(() => {
    if (!sessionId) return;
    const channel = supabase
      .channel(`video-date-session-${sessionId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'video_sessions', filter: `id=eq.${sessionId}` },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (row.ended_at || row.state === 'ended' || row.phase === 'ended') {
            setPhase('ended');
            setTimeLeft(0);
            setSession((prev) => (prev ? { ...prev, ended_at: row.ended_at as string | null, state: row.state as string } : null));
            return;
          }
          if (row.date_started_at) {
            const elapsed = (Date.now() - new Date(row.date_started_at as string).getTime()) / 1000;
            setTimeLeft(Math.max(0, Math.ceil(DATE_SECONDS - elapsed)));
            setPhase('date');
          }
          if (row.handshake_started_at) {
            const elapsed = (Date.now() - new Date(row.handshake_started_at as string).getTime()) / 1000;
            setTimeLeft(Math.max(0, Math.ceil(HANDSHAKE_SECONDS - elapsed)));
            setPhase('handshake');
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId]);

  return { session, partner, phase, timeLeft, loading, error, refetch: fetchSession };
}

/** Get Daily room token via daily-room Edge Function (create_date_room). Same contract as web. */
export async function getDailyRoomToken(sessionId: string): Promise<RoomTokenResult | null> {
  const { data, error } = await supabase.functions.invoke('daily-room', {
    body: { action: 'create_date_room', sessionId },
  });
  if (error || !data?.token) return null;
  return {
    room_name: data.room_name,
    room_url: data.room_url ?? `https://vibelyapp.daily.co/${data.room_name}`,
    token: data.token,
  };
}

/** Server-owned: enter handshake (start timer). Idempotent. */
export async function enterHandshake(sessionId: string): Promise<boolean> {
  const { error } = await supabase.rpc('video_date_transition', {
    p_session_id: sessionId,
    p_action: 'enter_handshake',
  });
  return !error;
}

/** Server-owned: end the date. Idempotent. */
export async function endVideoDate(sessionId: string, reason?: string): Promise<boolean> {
  const { error } = await supabase.rpc('video_date_transition', {
    p_session_id: sessionId,
    p_action: 'end',
    p_reason: reason ?? 'ended_from_client',
  });
  return !error;
}

/** Tell backend to delete the Daily room (best-effort). Same as web. */
export async function deleteDailyRoom(roomName: string): Promise<void> {
  try {
    await supabase.functions.invoke('daily-room', {
      body: { action: 'delete_room', roomName },
    });
  } catch {
    // best-effort
  }
}

export { HANDSHAKE_SECONDS, DATE_SECONDS };
