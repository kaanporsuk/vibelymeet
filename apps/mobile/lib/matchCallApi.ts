/**
 * Match call API: create/answer Daily rooms via daily-room Edge Function, update match_calls.
 * Same contract as web (src/hooks/useMatchCall.ts, supabase/functions/daily-room).
 */
import { supabase } from '@/lib/supabase';

export type CreateMatchCallResult = {
  call_id: string;
  room_name: string;
  room_url: string;
  token: string;
};

export type AnswerMatchCallResult = {
  call_id: string;
  room_name: string;
  room_url: string;
  token: string;
};

export async function createMatchCall(matchId: string, callType: 'voice' | 'video'): Promise<CreateMatchCallResult | null> {
  const { data, error } = await supabase.functions.invoke('daily-room', {
    body: { action: 'create_match_call', matchId, callType },
  });
  if (error || !data?.token) return null;
  return {
    call_id: data.call_id,
    room_name: data.room_name,
    room_url: data.room_url,
    token: data.token,
  };
}

export async function answerMatchCall(callId: string): Promise<AnswerMatchCallResult | null> {
  const { data, error } = await supabase.functions.invoke('daily-room', {
    body: { action: 'answer_match_call', callId },
  });
  if (error || !data?.token) return null;
  return {
    call_id: data.call_id,
    room_name: data.room_name,
    room_url: data.room_url,
    token: data.token,
  };
}

export async function updateMatchCallStatus(
  callId: string,
  status: 'active' | 'ended' | 'declined' | 'missed',
  extra?: { ended_at?: string; started_at?: string; duration_seconds?: number }
): Promise<void> {
  const payload: Record<string, unknown> = { status };
  if (extra?.ended_at) payload.ended_at = extra.ended_at;
  if (extra?.started_at) payload.started_at = extra.started_at;
  if (extra?.duration_seconds != null) payload.duration_seconds = extra.duration_seconds;
  const { error } = await supabase.from('match_calls').update(payload).eq('id', callId);
  if (error) {
    if (__DEV__) console.warn('[matchCallApi] updateMatchCallStatus failed:', error.message);
    throw new Error(`Failed to update call status: ${error.message}`);
  }
}

export async function deleteMatchCallRoom(roomName: string): Promise<void> {
  try {
    await supabase.functions.invoke('daily-room', {
      body: { action: 'delete_room', roomName },
    });
  } catch {
    // best-effort
  }
}
