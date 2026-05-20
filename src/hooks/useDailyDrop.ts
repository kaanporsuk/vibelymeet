import { useState, useEffect, useCallback, useRef } from 'react';
import { useUserProfile } from "@/contexts/AuthContext";
import { supabase } from '@/integrations/supabase/client';
import { DailyDropData, DailyDropPartner, PastDrop } from '@/types/dailyDrop';
import {
  DAILY_DROP_ACTIONABLE_STATUSES,
  DAILY_DROP_OUTCOME_STATUSES,
  DAILY_DROP_REPLY_MAX_LENGTH,
} from '@/lib/dailyDropSchedule';

type DailyDropRow = Omit<
  DailyDropData,
  'status' | 'user_a_viewed' | 'user_b_viewed' | 'chat_unlocked' | 'pick_reasons' | 'affinity_score'
> & {
  status: DailyDropData['status'];
  user_a_viewed?: boolean | null;
  user_b_viewed?: boolean | null;
  chat_unlocked?: boolean | null;
  pick_reasons?: unknown;
  affinity_score?: number | null;
};

type DailyDropActionPayload = {
  drop?: DailyDropRow;
  match_id?: string;
};

function normalizePickReasons(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((reason): reason is string => typeof reason === 'string')
    : [];
}

function toDailyDropData(d: DailyDropRow): DailyDropData {
  return {
    id: d.id,
    user_a_id: d.user_a_id,
    user_b_id: d.user_b_id,
    drop_date: d.drop_date,
    starts_at: d.starts_at,
    expires_at: d.expires_at,
    status: d.status,
    user_a_viewed: d.user_a_viewed ?? false,
    user_b_viewed: d.user_b_viewed ?? false,
    opener_sender_id: d.opener_sender_id,
    opener_text: d.opener_text,
    opener_sent_at: d.opener_sent_at,
    reply_sender_id: d.reply_sender_id,
    reply_text: d.reply_text,
    reply_sent_at: d.reply_sent_at,
    chat_unlocked: d.chat_unlocked ?? false,
    match_id: d.match_id,
    passed_by_user_id: d.passed_by_user_id,
    pick_reasons: normalizePickReasons(d.pick_reasons),
    affinity_score: d.affinity_score ?? 0,
  };
}

export function useDailyDrop() {
  const { user } = useUserProfile();
  const [drop, setDrop] = useState<DailyDropData | null>(null);
  const [partner, setPartner] = useState<DailyDropPartner | null>(null);
  const [pastDrops, setPastDrops] = useState<PastDrop[]>([]);
  const [generationRanToday, setGenerationRanToday] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  const myRole = drop ? (drop.user_a_id === user?.id ? 'a' : 'b') : null;
  const partnerId = drop ? (myRole === 'a' ? drop.user_b_id : drop.user_a_id) : null;
  const iHaveViewed = drop ? (myRole === 'a' ? drop.user_a_viewed : drop.user_b_viewed) : false;
  const openerSentByMe = drop?.opener_sender_id === user?.id;
  const chatUnlocked = drop?.chat_unlocked ?? false;
  const matchId = drop?.match_id ?? null;
  const dropId = drop?.id ?? null;
  const dropExpiresAt = drop?.expires_at ?? null;
  const userId = user?.id ?? null;
  const isExpired = drop ? new Date(drop.expires_at) <= new Date() : false;
  const hasDrop = !!drop;
  const pickReasons = (drop?.pick_reasons ?? []) as string[];
  const affinityScore = drop?.affinity_score ?? 0;

  // Fetch partner profile
  const fetchPartner = useCallback(async (id: string) => {
    const { data: profile } = await supabase.rpc('get_profile_for_viewer', {
      p_target_id: id,
    });

    if (!profile) { setPartner(null); return; }
    const row = profile as Record<string, unknown>;
    const vibes = Array.isArray(row.vibes)
      ? row.vibes.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      : [];

    setPartner({
      id: row.id as string,
      name: (row.name as string | null) ?? 'Unknown',
      age: (row.age as number | null) ?? 0,
      gender: (row.gender as string | null) ?? 'unknown',
      about_me: (row.about_me as string | null) ?? null,
      avatar_url: (row.avatar_url as string | null) ?? null,
      photos: (row.photos as string[] | null) ?? null,
      bunny_video_uid: (row.bunny_video_uid as string | null) ?? null,
      bunny_video_status: (row.bunny_video_status as string | null) ?? null,
      vibe_video_signed_playback_required: row.vibe_video_signed_playback_required === true,
      vibe_video_playback_ref:
        typeof row.vibe_video_playback_ref === 'string'
          ? row.vibe_video_playback_ref
          : row.vibe_video_playback_ref === null
            ? null
            : null,
      vibe_caption: (row.vibe_caption as string | null) ?? null,
      vibes,
    });
  }, []);

  // Fetch current drop
  const fetchDrop = useCallback(async () => {
    if (!user) {
      setGenerationRanToday(false);
      setIsLoading(false);
      return;
    }

    const now = new Date().toISOString();
    const orUser = `user_a_id.eq.${user.id},user_b_id.eq.${user.id}`;

    let { data, error } = await supabase
      .from('daily_drops')
      .select('*')
      .or(orUser)
      .gt('expires_at', now)
      .in('status', [...DAILY_DROP_ACTIONABLE_STATUSES])
      .order('drop_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && !data) {
      const second = await supabase
        .from('daily_drops')
        .select('*')
        .or(orUser)
        .gt('expires_at', now)
        .in('status', [...DAILY_DROP_OUTCOME_STATUSES])
        .order('drop_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      data = second.data;
      error = second.error;
    }

    const { data: genRan } = await supabase.rpc('daily_drops_generation_ran_today');
    setGenerationRanToday(Boolean(genRan));

    if (error) {
      console.error('Error fetching daily drop:', error);
      setIsLoading(false);
      return;
    }

    if (data) {
      const dropData = toDailyDropData(data as DailyDropRow);
      setDrop(dropData);

      const pid = dropData.user_a_id === user.id ? dropData.user_b_id : dropData.user_a_id;
      await fetchPartner(pid);
    } else {
      setDrop(null);
      setPartner(null);
    }

    setIsLoading(false);
  }, [user, fetchPartner]);

  // Fetch past drops
  const fetchPastDrops = useCallback(async () => {
    if (!user) return;

    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
      .from('daily_drops')
      .select('id, user_a_id, user_b_id, drop_date, status, match_id')
      .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`)
      .lt('drop_date', today)
      .order('drop_date', { ascending: false })
      .limit(14);

    if (!data?.length) { setPastDrops([]); return; }

    const partnerIds = data.map(d => d.user_a_id === user.id ? d.user_b_id : d.user_a_id);
    const profiles = await Promise.all(
      [...new Set(partnerIds)].map(async (id) => {
        const { data: profile } = await supabase.rpc('get_profile_for_viewer', {
          p_target_id: id,
        });
        return profile as { id?: string; name?: string | null; avatar_url?: string | null } | null;
      }),
    );

    const profileMap: Record<string, { name: string; avatar_url: string | null }> = {};
    profiles.forEach(p => {
      if (p?.id) profileMap[p.id] = { name: p.name ?? 'Unknown', avatar_url: p.avatar_url ?? null };
    });

    setPastDrops(data.map(d => {
      const pid = d.user_a_id === user.id ? d.user_b_id : d.user_a_id;
      const p = profileMap[pid];
      return {
        id: d.id,
        partner_id: pid,
        partner_name: p?.name ?? 'Unknown',
        partner_avatar: p?.avatar_url ?? null,
        drop_date: d.drop_date,
        status: d.status,
        match_id: d.match_id,
      };
    }));
  }, [user]);

  // Initial fetch
  useEffect(() => {
    fetchDrop();
    fetchPastDrops();
  }, [fetchDrop, fetchPastDrops]);

  // Realtime subscription
  useEffect(() => {
    if (!userId || !dropId) return;

    const channel = supabase
      .channel(`daily-drop-${dropId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'daily_drops',
        filter: `id=eq.${dropId}`,
      }, (payload) => {
        setDrop(toDailyDropData(payload.new as DailyDropRow));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId, dropId]);

  // Countdown timer
  useEffect(() => {
    if (!dropExpiresAt) { setTimeRemaining(0); return; }

    const calc = () => {
      const diff = Math.max(0, Math.floor((new Date(dropExpiresAt).getTime() - Date.now()) / 1000));
      setTimeRemaining(diff);
      if (diff === 0) fetchDrop();
    };

    calc();
    timerRef.current = setInterval(calc, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [dropExpiresAt, fetchDrop]);

  // Actions
  const markViewed = useCallback(async () => {
    if (!drop || !user || !myRole) return;

    const { data, error } = await supabase.rpc('daily_drop_transition', {
      p_drop_id: drop.id,
      p_action: 'view',
    });
    if (error) {
      console.error('Error marking daily drop viewed:', error);
      return;
    }
    const payload = data as DailyDropActionPayload | null;
    if (payload?.drop) {
      setDrop(toDailyDropData(payload.drop));
    }
  }, [drop, user, myRole]);

  const sendOpener = useCallback(async (text: string) => {
    if (!drop || !user || !partnerId) return;
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 140) return;
    if (drop.opener_sender_id) return; // already sent
    if (drop.status.startsWith('expired') || drop.status === 'passed' || drop.status === 'matched') return;

    const { data, error } = await supabase.functions.invoke('daily-drop-actions', {
      body: {
        drop_id: drop.id,
        action: 'send_opener',
        text: trimmed,
      },
    });
    if (error) {
      console.error('Error sending daily drop opener:', error);
      return;
    }
    const payload = data as DailyDropActionPayload | null;
    if (payload?.drop) {
      setDrop(toDailyDropData(payload.drop));
    }
  }, [drop, user, partnerId]);

  const sendReply = useCallback(async (text: string) => {
    if (!drop || !user || !partnerId) return;
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > DAILY_DROP_REPLY_MAX_LENGTH) return;
    if (!drop.opener_sender_id || drop.opener_sender_id === user.id) return;
    if (drop.chat_unlocked) return;

    const { data, error } = await supabase.functions.invoke('daily-drop-actions', {
      body: {
        drop_id: drop.id,
        action: 'send_reply',
        text: trimmed,
      },
    });
    if (error) {
      console.error('Error sending daily drop reply:', error);
      return;
    }
    const payload = data as DailyDropActionPayload | null;
    const newMatchId = payload?.match_id;
    if (payload?.drop) {
      setDrop(toDailyDropData(payload.drop));
    }
  }, [drop, user, partnerId]);

  const passDrop = useCallback(async () => {
    if (!drop || !user) return;

    const { data, error } = await supabase.rpc('daily_drop_transition', {
      p_drop_id: drop.id,
      p_action: 'pass',
    });
    if (error) {
      console.error('Error passing daily drop:', error);
      return;
    }
    const payload = data as DailyDropActionPayload | null;
    if (payload?.drop) {
      setDrop(toDailyDropData(payload.drop));
    }
  }, [drop, user]);

  return {
    drop,
    partner,
    myRole,
    status: drop?.status ?? null,
    iHaveViewed,
    openerText: drop?.opener_text ?? null,
    openerSentByMe,
    replyText: drop?.reply_text ?? null,
    chatUnlocked,
    matchId,
    pickReasons,
    affinityScore,
    timeRemaining,
    isExpired,
    hasDrop,
    isLoading,
    pastDrops,
    generationRanToday,
    markViewed,
    sendOpener,
    sendReply,
    passDrop,
    refetch: fetchDrop,
  };
}
