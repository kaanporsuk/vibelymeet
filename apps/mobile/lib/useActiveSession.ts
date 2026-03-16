/**
 * Active session detection for rejoin banner — parity with web Dashboard.
 * Detects event_registrations where queue_status in (in_handshake, in_date, in_ready_gate) and current_room_id set,
 * and linked video_sessions row is not ended.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export type ActiveSession = {
  sessionId: string;
  eventId: string;
  partnerName?: string | null;
};

export function useActiveSession(userId: string | null | undefined): {
  activeSession: ActiveSession | null;
  refetch: () => Promise<void>;
} {
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);

  const check = useCallback(async () => {
    if (!userId) {
      setActiveSession(null);
      return;
    }
    const { data: reg, error: regError } = await supabase
      .from('event_registrations')
      .select('event_id, current_room_id, queue_status, current_partner_id')
      .eq('profile_id', userId)
      .in('queue_status', ['in_handshake', 'in_date', 'in_ready_gate'])
      .not('current_room_id', 'is', null)
      .maybeSingle();

    if (regError) {
      if (__DEV__) console.warn('[useActiveSession] reg query failed:', regError.message);
      setActiveSession(null);
      return;
    }

    if (!reg?.current_room_id) {
      setActiveSession(null);
      return;
    }
    const { data: session, error: sessionError } = await supabase
      .from('video_sessions')
      .select('id, ended_at')
      .eq('id', reg.current_room_id)
      .is('ended_at', null)
      .maybeSingle();

    if (sessionError) {
      if (__DEV__) console.warn('[useActiveSession] session query failed:', sessionError.message);
      setActiveSession(null);
      return;
    }

    if (!session) {
      setActiveSession(null);
      return;
    }
    let partnerName: string | null = null;
    if (reg.current_partner_id) {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('name')
        .eq('id', reg.current_partner_id)
        .maybeSingle();
      if (profileError) {
        if (__DEV__) console.warn('[useActiveSession] partner query failed:', profileError.message);
        partnerName = null;
      } else {
        partnerName = profile?.name ?? null;
      }
    }
    setActiveSession({
      sessionId: session.id,
      eventId: reg.event_id,
      partnerName,
    });
  }, [userId]);

  useEffect(() => {
    check();
  }, [check]);

  return { activeSession, refetch: check };
}
