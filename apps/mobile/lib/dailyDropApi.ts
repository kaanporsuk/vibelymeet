import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import {
  DAILY_DROP_ACTIONABLE_STATUSES,
  DAILY_DROP_OUTCOME_STATUSES,
  DAILY_DROP_REPLY_MAX_LENGTH,
} from '@/lib/dailyDropSchedule';

/** Aligns with public.daily_drops.status CHECK */
export type DailyDropStatus =
  | 'active_unopened'
  | 'active_viewed'
  | 'active_opener_sent'
  | 'matched'
  | 'passed'
  | 'expired_no_action'
  | 'expired_no_reply'
  | 'invalidated';

export type DailyDropRow = {
  id: string;
  user_a_id: string;
  user_b_id: string;
  drop_date: string;
  starts_at: string;
  expires_at: string;
  status: DailyDropStatus;
  user_a_viewed: boolean;
  user_b_viewed: boolean;
  opener_sender_id: string | null;
  opener_text: string | null;
  opener_sent_at: string | null;
  reply_sender_id: string | null;
  reply_text: string | null;
  reply_sent_at: string | null;
  chat_unlocked: boolean;
  match_id: string | null;
  passed_by_user_id: string | null;
  pick_reasons: string[];
  affinity_score: number;
};

export type DailyDropPartner = {
  id: string;
  name: string;
  age: number;
  avatar_url: string | null;
  photos: string[] | null;
  about_me: string | null;
};

export type PastDropRow = {
  id: string;
  partner_id: string;
  partner_name: string;
  partner_avatar: string | null;
  drop_date: string;
  status: string;
  match_id: string | null;
};

function mapDrop(data: Record<string, unknown>): DailyDropRow {
  return {
    id: data.id as string,
    user_a_id: data.user_a_id as string,
    user_b_id: data.user_b_id as string,
    drop_date: data.drop_date as string,
    starts_at: data.starts_at as string,
    expires_at: data.expires_at as string,
    status: data.status as DailyDropStatus,
    user_a_viewed: (data.user_a_viewed as boolean) ?? false,
    user_b_viewed: (data.user_b_viewed as boolean) ?? false,
    opener_sender_id: data.opener_sender_id as string | null,
    opener_text: data.opener_text as string | null,
    opener_sent_at: data.opener_sent_at as string | null,
    reply_sender_id: data.reply_sender_id as string | null,
    reply_text: data.reply_text as string | null,
    reply_sent_at: data.reply_sent_at as string | null,
    chat_unlocked: (data.chat_unlocked as boolean) ?? false,
    match_id: data.match_id as string | null,
    passed_by_user_id: data.passed_by_user_id as string | null,
    pick_reasons: (data.pick_reasons as string[]) ?? [],
    affinity_score: (data.affinity_score as number) ?? 0,
  };
}

export function useDailyDrop(userId: string | null | undefined) {
  const [drop, setDrop] = useState<DailyDropRow | null>(null);
  const [partner, setPartner] = useState<DailyDropPartner | null>(null);
  const [pastDrops, setPastDrops] = useState<PastDropRow[]>([]);
  const [generationRanToday, setGenerationRanToday] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [timeRemaining, setTimeRemaining] = useState(0);

  const myRole = drop ? (drop.user_a_id === userId ? 'a' : 'b') : null;
  const partnerId = drop ? (myRole === 'a' ? drop.user_b_id : drop.user_a_id) : null;
  const iHaveViewed = drop ? (myRole === 'a' ? drop.user_a_viewed : drop.user_b_viewed) : false;
  const openerSentByMe = drop?.opener_sender_id === userId;
  const chatUnlocked = drop?.chat_unlocked ?? false;
  const matchId = drop?.match_id ?? null;
  const isExpired = drop ? new Date(drop.expires_at) <= new Date() : false;
  const pickReasons = drop?.pick_reasons ?? [];
  const affinityScore = drop?.affinity_score ?? 0;

  const fetchPartner = useCallback(async (id: string) => {
    const { data: profile } = await supabase.rpc('get_profile_for_viewer', {
      p_target_id: id,
    });
    if (!profile) {
      setPartner(null);
      return;
    }
    const row = profile as Record<string, unknown>;
    setPartner({
      id: row.id as string,
      name: (row.name as string | null) ?? 'Unknown',
      age: (row.age as number | null) ?? 0,
      avatar_url: (row.avatar_url as string | null) ?? null,
      photos: (row.photos as string[] | null) ?? null,
      about_me: (row.about_me as string | null) ?? null,
    });
  }, []);

  const fetchDrop = useCallback(async () => {
    if (!userId) {
      setGenerationRanToday(false);
      setIsLoading(false);
      return;
    }
    const now = new Date().toISOString();
    const orUser = `user_a_id.eq.${userId},user_b_id.eq.${userId}`;

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
      setDrop(null);
      setPartner(null);
      setIsLoading(false);
      return;
    }
    if (data) {
      setDrop(mapDrop(data as Record<string, unknown>));
      const pid = (data as DailyDropRow).user_a_id === userId ? (data as DailyDropRow).user_b_id : (data as DailyDropRow).user_a_id;
      await fetchPartner(pid);
    } else {
      setDrop(null);
      setPartner(null);
    }
    setIsLoading(false);
  }, [userId, fetchPartner]);

  const fetchPastDrops = useCallback(async () => {
    if (!userId) return;
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('daily_drops')
      .select('id, user_a_id, user_b_id, drop_date, status, match_id')
      .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
      .lt('drop_date', today)
      .order('drop_date', { ascending: false })
      .limit(14);
    if (error) {
      if (__DEV__) console.warn('[dailyDropApi] fetchPastDrops failed:', error.message);
      setPastDrops([]);
      return;
    }
    if (!data?.length) {
      setPastDrops([]);
      return;
    }
    const partnerIds = data.map((d) => (d.user_a_id === userId ? d.user_b_id : d.user_a_id));
    const profiles = await Promise.all(
      [...new Set(partnerIds)].map(async (id) => {
        const { data: profile, error: profileError } = await supabase.rpc('get_profile_for_viewer', {
          p_target_id: id,
        });
        if (profileError && __DEV__) console.warn('[dailyDropApi] get_profile_for_viewer failed:', profileError.message);
        return profile as { id?: string; name?: string | null; avatar_url?: string | null } | null;
      })
    );
    const profileMap: Record<string, { name: string; avatar_url: string | null }> = {};
    profiles.forEach((p) => {
      if (p?.id) profileMap[p.id] = { name: p.name ?? 'Unknown', avatar_url: p.avatar_url ?? null };
    });
    setPastDrops(
      data.map((d) => {
        const pid = d.user_a_id === userId ? d.user_b_id : d.user_a_id;
        const p = profileMap[pid];
        return {
          id: d.id,
          partner_id: pid,
          partner_name: p?.name ?? 'Unknown',
          partner_avatar: p?.avatar_url ?? null,
          drop_date: d.drop_date,
          status: d.status,
          match_id: d.match_id ?? null,
        };
      })
    );
  }, [userId]);

  useEffect(() => {
    fetchDrop();
    fetchPastDrops();
  }, [fetchDrop, fetchPastDrops]);

  useEffect(() => {
    if (!userId || !drop) return;
    const channel = supabase
      .channel(`daily-drop-${drop.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'daily_drops', filter: `id=eq.${drop.id}` }, (payload) => {
        setDrop(mapDrop((payload.new as Record<string, unknown>) ?? {}));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, drop?.id]);

  useEffect(() => {
    if (!drop) {
      setTimeRemaining(0);
      return;
    }
    const calc = () => {
      const diff = Math.max(0, Math.floor((new Date(drop.expires_at).getTime() - Date.now()) / 1000));
      setTimeRemaining(diff);
      if (diff === 0) fetchDrop();
    };
    calc();
    const t = setInterval(calc, 1000);
    return () => clearInterval(t);
  }, [drop?.expires_at, fetchDrop]);

  const markViewed = useCallback(async () => {
    if (!drop || !userId) return;
    const { data, error } = await supabase.rpc('daily_drop_transition', { p_drop_id: drop.id, p_action: 'view' });
    if (error) return;
    const payload = data as { drop?: Record<string, unknown> };
    if (payload?.drop) setDrop(mapDrop(payload.drop));
  }, [drop, userId]);

  const sendOpener = useCallback(async (text: string) => {
    if (!drop || !userId) return;
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 140) return;
    if (drop.opener_sender_id) return;
    const { data, error } = await supabase.functions.invoke('daily-drop-actions', {
      body: { drop_id: drop.id, action: 'send_opener', text: trimmed },
    });
    if (error) throw error;
    const payload = data as { drop?: Record<string, unknown> };
    if (payload?.drop) setDrop(mapDrop(payload.drop));
  }, [drop, userId]);

  const sendReply = useCallback(async (text: string) => {
    if (!drop || !userId) return;
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > DAILY_DROP_REPLY_MAX_LENGTH) return;
    if (!drop.opener_sender_id || drop.opener_sender_id === userId) return;
    if (drop.chat_unlocked) return;
    const { data, error } = await supabase.functions.invoke('daily-drop-actions', {
      body: { drop_id: drop.id, action: 'send_reply', text: trimmed },
    });
    if (error) throw error;
    const payload = data as { drop?: Record<string, unknown> };
    if (payload?.drop) setDrop(mapDrop(payload.drop));
  }, [drop, userId]);

  const passDrop = useCallback(async () => {
    if (!drop || !userId) return;
    const { data, error } = await supabase.rpc('daily_drop_transition', { p_drop_id: drop.id, p_action: 'pass' });
    if (error) throw error;
    const payload = data as { drop?: Record<string, unknown> };
    if (payload?.drop) setDrop(mapDrop(payload.drop));
  }, [drop, userId]);

  return {
    drop,
    partner,
    myRole,
    iHaveViewed,
    openerSentByMe,
    openerText: drop?.opener_text ?? null,
    replyText: drop?.reply_text ?? null,
    chatUnlocked,
    matchId,
    partnerId,
    timeRemaining,
    isExpired,
    hasDrop: !!drop,
    isLoading,
    pickReasons,
    affinityScore,
    pastDrops,
    generationRanToday,
    markViewed,
    sendOpener,
    sendReply,
    passDrop,
    refetch: fetchDrop,
  };
}
