import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { sendNotification } from '@/lib/notifications';
import { DailyDropData, DailyDropPartner, PastDrop } from '@/types/dailyDrop';

export function useDailyDrop() {
  const { user } = useAuth();
  const [drop, setDrop] = useState<DailyDropData | null>(null);
  const [partner, setPartner] = useState<DailyDropPartner | null>(null);
  const [pastDrops, setPastDrops] = useState<PastDrop[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  const myRole = drop ? (drop.user_a_id === user?.id ? 'a' : 'b') : null;
  const partnerId = drop ? (myRole === 'a' ? drop.user_b_id : drop.user_a_id) : null;
  const iHaveViewed = drop ? (myRole === 'a' ? drop.user_a_viewed : drop.user_b_viewed) : false;
  const openerSentByMe = drop?.opener_sender_id === user?.id;
  const chatUnlocked = drop?.chat_unlocked ?? false;
  const matchId = drop?.match_id ?? null;
  const isExpired = drop ? new Date(drop.expires_at) <= new Date() : false;
  const hasDrop = !!drop;
  const pickReasons = (drop?.pick_reasons ?? []) as string[];
  const affinityScore = drop?.affinity_score ?? 0;

  // Fetch partner profile
  const fetchPartner = useCallback(async (id: string) => {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, name, age, gender, bio, avatar_url, photos, bunny_video_uid, bunny_video_status, vibe_caption')
      .eq('id', id)
      .maybeSingle();

    if (!profile) { setPartner(null); return; }

    const { data: vibeData } = await supabase
      .from('profile_vibes')
      .select('vibe_tags(label)')
      .eq('profile_id', id);

    type VibeRow = { vibe_tags: { label: string } | null };
    const vibes = (vibeData as VibeRow[])?.map(v => v.vibe_tags?.label).filter(Boolean) as string[] || [];

    setPartner({
      id: profile.id,
      name: profile.name,
      age: profile.age,
      gender: profile.gender,
      bio: profile.bio,
      avatar_url: profile.avatar_url,
      photos: profile.photos,
      bunny_video_uid: profile.bunny_video_uid,
      bunny_video_status: profile.bunny_video_status,
      vibe_caption: profile.vibe_caption,
      vibes,
    });
  }, []);

  // Fetch current drop
  const fetchDrop = useCallback(async () => {
    if (!user) { setIsLoading(false); return; }

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('daily_drops')
      .select('*')
      .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`)
      .gt('expires_at', now)
      .order('drop_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error fetching daily drop:', error);
      setIsLoading(false);
      return;
    }

    if (data) {
      const dropData: DailyDropData = {
        id: data.id,
        user_a_id: data.user_a_id,
        user_b_id: data.user_b_id,
        drop_date: data.drop_date,
        starts_at: data.starts_at,
        expires_at: data.expires_at,
        status: data.status,
        user_a_viewed: data.user_a_viewed ?? false,
        user_b_viewed: data.user_b_viewed ?? false,
        opener_sender_id: data.opener_sender_id,
        opener_text: data.opener_text,
        opener_sent_at: data.opener_sent_at,
        reply_sender_id: data.reply_sender_id,
        reply_text: data.reply_text,
        reply_sent_at: data.reply_sent_at,
        chat_unlocked: data.chat_unlocked ?? false,
        match_id: data.match_id,
        passed_by_user_id: data.passed_by_user_id,
        pick_reasons: (data.pick_reasons as string[]) ?? [],
        affinity_score: data.affinity_score ?? 0,
      };
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
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, name, avatar_url')
      .in('id', partnerIds);

    const profileMap: Record<string, { name: string; avatar_url: string | null }> = {};
    profiles?.forEach(p => { profileMap[p.id] = p; });

    setPastDrops(data.map(d => {
      const pid = d.user_a_id === user.id ? d.user_b_id : d.user_a_id;
      const p = profileMap[pid];
      return {
        id: d.id,
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
    if (!user || !drop) return;

    const channel = supabase
      .channel(`daily-drop-${drop.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'daily_drops',
        filter: `id=eq.${drop.id}`,
      }, (payload) => {
        const d = payload.new as any;
        setDrop({
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
          pick_reasons: (d.pick_reasons as string[]) ?? [],
          affinity_score: d.affinity_score ?? 0,
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, drop?.id]);

  // Countdown timer
  useEffect(() => {
    if (!drop) { setTimeRemaining(0); return; }

    const calc = () => {
      const diff = Math.max(0, Math.floor((new Date(drop.expires_at).getTime() - Date.now()) / 1000));
      setTimeRemaining(diff);
      if (diff === 0) fetchDrop();
    };

    calc();
    timerRef.current = setInterval(calc, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [drop?.expires_at, fetchDrop]);

  // Actions
  const markViewed = useCallback(async () => {
    if (!drop || !user || !myRole) return;

    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    if (myRole === 'a') updates.user_a_viewed = true;
    else updates.user_b_viewed = true;

    if (drop.status === 'active_unopened') updates.status = 'active_viewed';

    await supabase.from('daily_drops').update(updates).eq('id', drop.id);
    setDrop(prev => prev ? { ...prev, ...updates } : null);
  }, [drop, user, myRole]);

  const sendOpener = useCallback(async (text: string) => {
    if (!drop || !user || !partnerId) return;
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 140) return;
    if (drop.opener_sender_id) return; // already sent
    if (drop.status.startsWith('expired') || drop.status === 'passed' || drop.status === 'matched') return;

    const updates = {
      opener_sender_id: user.id,
      opener_text: trimmed,
      opener_sent_at: new Date().toISOString(),
      status: 'active_opener_sent',
      updated_at: new Date().toISOString(),
    };

    await supabase.from('daily_drops').update(updates).eq('id', drop.id);
    setDrop(prev => prev ? { ...prev, ...updates } : null);

    // Notify partner
    sendNotification({
      user_id: partnerId,
      category: 'daily_drop',
      title: '💧 Your Daily Drop sent you a message',
      body: 'Reply before 6 PM tomorrow to unlock chat',
      data: { url: '/matches' },
    });
  }, [drop, user, partnerId]);

  const sendReply = useCallback(async (text: string) => {
    if (!drop || !user || !partnerId) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!drop.opener_sender_id || drop.opener_sender_id === user.id) return;
    if (drop.chat_unlocked) return;

    // Create match
    const p1 = [user.id, partnerId].sort()[0];
    const p2 = [user.id, partnerId].sort()[1];

    const { data: matchData } = await supabase
      .from('matches')
      .insert({ profile_id_1: p1, profile_id_2: p2 })
      .select('id')
      .single();

    const newMatchId = matchData?.id;
    if (!newMatchId) return;

    // Update drop
    const updates = {
      reply_sender_id: user.id,
      reply_text: trimmed,
      reply_sent_at: new Date().toISOString(),
      chat_unlocked: true,
      match_id: newMatchId,
      status: 'matched',
      updated_at: new Date().toISOString(),
    };

    await supabase.from('daily_drops').update(updates).eq('id', drop.id);

    // Insert opener + reply as first messages
    await supabase.from('messages').insert([
      {
        match_id: newMatchId,
        sender_id: drop.opener_sender_id!,
        content: drop.opener_text!,
        created_at: drop.opener_sent_at!,
      },
      {
        match_id: newMatchId,
        sender_id: user.id,
        content: trimmed,
      },
    ]);

    setDrop(prev => prev ? { ...prev, ...updates, match_id: newMatchId } : null);

    // Notify opener sender
    sendNotification({
      user_id: drop.opener_sender_id!,
      category: 'new_match',
      title: "You're connected! 🎉",
      body: `You and ${partner?.name ?? 'someone'} matched through Daily Drop`,
      data: { url: `/chat/${newMatchId}` },
    });
  }, [drop, user, partnerId, partner?.name]);

  const passDrop = useCallback(async () => {
    if (!drop || !user) return;

    const updates = {
      passed_by_user_id: user.id,
      status: 'passed',
      updated_at: new Date().toISOString(),
    };

    await supabase.from('daily_drops').update(updates).eq('id', drop.id);
    setDrop(prev => prev ? { ...prev, ...updates } : null);
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
    markViewed,
    sendOpener,
    sendReply,
    passDrop,
    refetch: fetchDrop,
  };
}
