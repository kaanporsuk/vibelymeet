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

/** Classified create_date_room failure (no secrets). */
export type RoomTokenFailureCode =
  | 'auth'
  | 'forbidden'
  | 'not_found'
  | 'session_ended'
  | 'ready_gate_required'
  | 'daily_provider'
  | 'network'
  | 'unknown';

export type GetDailyRoomTokenResult =
  | { ok: true; data: RoomTokenResult }
  | {
      ok: false;
      code: RoomTokenFailureCode;
      httpStatus?: number;
      serverCode?: string;
    };

export type EnterHandshakeResult =
  | { ok: true }
  | { ok: false; code?: string; message?: string };

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

function mapHttpStatusAndServerCode(
  status: number,
  serverCode?: string
): RoomTokenFailureCode {
  const c = serverCode ?? '';
  if (c === 'UNAUTHORIZED' || status === 401) return 'auth';
  if (c === 'READY_GATE_NOT_READY') return 'ready_gate_required';
  if (c === 'SESSION_ENDED') return 'session_ended';
  if (c === 'SESSION_NOT_FOUND' || c === 'ROOM_NOT_FOUND' || status === 404) return 'not_found';
  if (c === 'ACCESS_DENIED' || status === 403) return 'forbidden';
  if (c === 'DAILY_PROVIDER_ERROR' || status === 503 || status === 502 || status === 500) {
    return 'daily_provider';
  }
  return 'unknown';
}

type DailyRoomResponseBody = {
  room_name?: string;
  room_url?: string;
  token?: string;
  error?: string;
  code?: string;
};

/** Get Daily room token via daily-room Edge Function (create_date_room). Same contract as web; returns classified errors. */
export async function getDailyRoomToken(sessionId: string): Promise<GetDailyRoomTokenResult> {
  const { data, error, response } = await supabase.functions.invoke<DailyRoomResponseBody>('daily-room', {
    body: { action: 'create_date_room', sessionId },
  });

  if (!error && data?.token && data.room_name) {
    return {
      ok: true,
      data: {
        room_name: data.room_name,
        room_url: data.room_url ?? `https://vibelyapp.daily.co/${data.room_name}`,
        token: data.token,
      },
    };
  }

  if (!error && data && !data.token) {
    return {
      ok: false,
      code: 'daily_provider',
      httpStatus: response?.status,
      serverCode: data.code ?? 'MISSING_TOKEN',
    };
  }

  if (error) {
    const errName = error instanceof Error ? error.name : 'unknown';

    if (errName === 'FunctionsFetchError') {
      return { ok: false, code: 'network', serverCode: 'FETCH_FAILED' };
    }
    if (errName === 'FunctionsRelayError') {
      return { ok: false, code: 'network', serverCode: 'RELAY_ERROR' };
    }

    if (response && typeof (response as Response).clone === 'function') {
      const res = response as Response;
      const status = res.status;
      let body: DailyRoomResponseBody | null = null;
      try {
        body = await res.clone().json();
      } catch {
        /* non-JSON body */
      }
      const serverCode = body?.code;
      return {
        ok: false,
        code: mapHttpStatusAndServerCode(status, serverCode),
        httpStatus: status,
        serverCode: serverCode ?? body?.error,
      };
    }

    return { ok: false, code: 'unknown', serverCode: errName };
  }

  return { ok: false, code: 'unknown', serverCode: 'NO_RESPONSE' };
}

/** Server-owned: enter handshake (start timer). Idempotent; surfaces RPC JSON errors. */
export async function enterHandshake(sessionId: string): Promise<EnterHandshakeResult> {
  const { data, error } = await supabase.rpc('video_date_transition', {
    p_session_id: sessionId,
    p_action: 'enter_handshake',
  });

  if (error) {
    return { ok: false, code: 'RPC_ERROR', message: error.message };
  }

  const payload = data as { success?: boolean; code?: string; error?: string } | null;
  if (payload && payload.success === false) {
    return {
      ok: false,
      code: payload.code,
      message: payload.error,
    };
  }

  return { ok: true };
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

/** Record that current user "vibed" during handshake (participant_1_liked or participant_2_liked). Partner is never notified. */
export async function recordVibe(sessionId: string): Promise<boolean> {
  const { error } = await supabase.rpc('video_date_transition', {
    p_session_id: sessionId,
    p_action: 'vibe',
  });
  return !error;
}

/** At handshake end: check mutual vibe. Returns { state: 'date' } if both liked, else { state: 'ended' }. */
export async function completeHandshake(sessionId: string): Promise<{ state: 'date' | 'ended' } | null> {
  const { data, error } = await supabase.rpc('video_date_transition', {
    p_session_id: sessionId,
    p_action: 'complete_handshake',
  });
  if (error) return null;
  const state = (data as { state?: string } | null)?.state;
  if (state === 'date') return { state: 'date' };
  return { state: 'ended' };
}

/** Update event registration queue_status (in_handshake, in_date, in_survey, browsing, offline). */
export async function updateParticipantStatus(eventId: string, userId: string, status: string): Promise<boolean> {
  const { error } = await supabase.rpc('update_participant_status', {
    p_event_id: eventId,
    p_user_id: userId,
    p_status: status,
  });
  return !error;
}

export type PartnerProfileData = {
  name: string;
  age: number;
  avatarUrl: string | null;
  photos: string[];
  about_me: string | null;
  job: string | null;
  location: string | null;
  heightCm: number | null;
  tags: string[];
  prompts: { question: string; answer: string }[];
};

/** Fetch full partner profile for video date (session + profiles + profile_vibes). */
export async function fetchPartnerProfile(
  sessionId: string,
  userId: string,
  avatarUrlResolver: (path: string | null) => string
): Promise<{ partnerId: string; eventId: string; isParticipant1: boolean; partner: PartnerProfileData } | null> {
  const { data: session } = await supabase
    .from('video_sessions')
    .select('participant_1_id, participant_2_id, event_id')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session) return null;

  const isP1 = session.participant_1_id === userId;
  const partnerId = isP1 ? session.participant_2_id : session.participant_1_id;

  const { data: profile } = await supabase
    .from('profiles')
    .select('name, age, avatar_url, photos, about_me, job, location, height_cm, prompts')
    .eq('id', partnerId)
    .maybeSingle();
  if (!profile) return null;

  const { data: vibes } = await supabase
    .from('profile_vibes')
    .select('vibe_tags(label)')
    .eq('profile_id', partnerId);
  const tags = (vibes ?? [])
    .map((v: unknown) => {
      const vt = (v as { vibe_tags?: { label?: string } | { label?: string }[] | null })?.vibe_tags;
      if (Array.isArray(vt)) return vt.map((t) => t?.label).filter(Boolean);
      return vt?.label ? [vt.label] : [];
    })
    .flat()
    .filter(Boolean) as string[];

  const photoArr = (profile.photos as string[] | null) ?? [];
  const primaryPath = photoArr[0] ?? profile.avatar_url ?? null;
  const photos = photoArr.slice(0, 6).map((p) => avatarUrlResolver(p));
  const avatarUrlResolved = primaryPath ? avatarUrlResolver(primaryPath) : null;

  let prompts: { question: string; answer: string }[] = [];
  if (profile.prompts && Array.isArray(profile.prompts)) {
    prompts = (profile.prompts as { question?: string; answer?: string }[]).map((p) => ({
      question: p.question ?? '',
      answer: p.answer ?? '',
    }));
  }

  return {
    partnerId,
    eventId: session.event_id ?? '',
    isParticipant1: isP1,
    partner: {
      name: profile.name ?? 'Your date',
      age: profile.age ?? 0,
      avatarUrl: avatarUrlResolved,
      photos,
      about_me: profile.about_me ?? null,
      job: profile.job ?? null,
      location: profile.location ?? null,
      heightCm: profile.height_cm ?? null,
      tags,
      prompts,
    },
  };
}

const VIBE_PROMPTS = [
  "What's a weird talent you have? 🎭",
  "Dream travel destination? ✈️",
  "What's your go-to karaoke song? 🎤",
  "Best date you've ever been on? 💫",
  "What's something that instantly makes you smile? 😊",
  "If you could have dinner with anyone, who? 🍽️",
  "What's your love language? 💕",
  "Describe your perfect lazy Sunday ☀️",
  "What's on your bucket list? ✨",
  "What makes you feel most alive? 🔥",
  "Early bird or night owl? 🦉",
  "What's your comfort movie? 🎬",
  "Beach vacation or mountain adventure? 🏔️",
  "What are you passionate about? 💜",
  "What's your hidden gem restaurant? 🍜",
];

function fisherYatesShuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Get or seed vibe_questions for session; returns array of question strings. */
export async function getOrSeedVibeQuestions(sessionId: string): Promise<string[]> {
  const { data, error: fetchError } = await supabase
    .from('video_sessions')
    .select('vibe_questions')
    .eq('id', sessionId)
    .maybeSingle();
  if (fetchError) {
    if (__DEV__) console.warn('[videoDateApi] failed to fetch vibe_questions:', fetchError.message);
    return fisherYatesShuffle(VIBE_PROMPTS);
  }
  const stored = data?.vibe_questions as string[] | null;
  if (stored && Array.isArray(stored) && stored.length > 0) return stored;

  const shuffled = fisherYatesShuffle(VIBE_PROMPTS);

  // Only update if vibe_questions is currently null (prevents race between two clients)
  const { data: updated, error: updateError } = await supabase
    .from('video_sessions')
    .update({ vibe_questions: shuffled })
    .eq('id', sessionId)
    .is('vibe_questions', null)
    .select('vibe_questions')
    .maybeSingle();

  if (updateError) {
    if (__DEV__) console.warn('[videoDateApi] failed to seed vibe_questions:', updateError.message);
  }

  // If another client seeded first, fetch what they wrote
  if (!updated?.vibe_questions) {
    const { data: refetched } = await supabase
      .from('video_sessions')
      .select('vibe_questions')
      .eq('id', sessionId)
      .maybeSingle();
    const refetchedQuestions = refetched?.vibe_questions as string[] | null;
    if (refetchedQuestions && Array.isArray(refetchedQuestions) && refetchedQuestions.length > 0) {
      return refetchedQuestions;
    }
  }

  return (updated?.vibe_questions as string[]) ?? shuffled;
}

export type PostDateVerdictResult = {
  mutual: boolean;
  match_id?: string;
  persistent_match_created?: boolean | null;
};

/**
 * Post-date survey screen 1: single backend path (`post-date-verdict` Edge → `submit_post_date_verdict` RPC).
 * Do not write video_sessions / date_feedback for the mandatory verdict from the client.
 */
export async function submitVerdictAndCheckMutual(
  sessionId: string,
  _userId: string,
  _partnerId: string,
  liked: boolean
): Promise<PostDateVerdictResult | null> {
  const { data, error } = await supabase.functions.invoke('post-date-verdict', {
    body: { session_id: sessionId, liked },
  });
  if (error) return null;
  const row = data as { success?: boolean; mutual?: boolean; match_id?: string; persistent_match_created?: boolean | null } | null;
  if (row && row.success === false) return null;
  const mutual = row?.mutual === true;
  return {
    mutual,
    match_id: typeof row?.match_id === 'string' ? row.match_id : undefined,
    persistent_match_created: row?.persistent_match_created,
  };
}

/** Fetch user credits for +Time (extra_time_credits, extended_vibe_credits). */
export async function fetchUserCredits(userId: string): Promise<{ extraTime: number; extendedVibe: number }> {
  const { data } = await supabase
    .from('user_credits')
    .select('extra_time_credits, extended_vibe_credits')
    .eq('user_id', userId)
    .maybeSingle();
  return {
    extraTime: data?.extra_time_credits ?? 0,
    extendedVibe: data?.extended_vibe_credits ?? 0,
  };
}

/** Deduct one credit (extra_time or extended_vibe). Returns true if successful. */
export async function deductCredit(userId: string, creditType: 'extra_time' | 'extended_vibe'): Promise<boolean> {
  const { data, error } = await supabase.rpc('deduct_credit', {
    p_user_id: userId,
    p_credit_type: creditType,
  });
  return !error && data === true;
}

export { HANDSHAKE_SECONDS, DATE_SECONDS };
