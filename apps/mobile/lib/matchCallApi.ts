/**
 * Match call API: create/answer Daily rooms via daily-room Edge Function, update match_calls.
 * Same contract as web (src/hooks/useMatchCall.ts, supabase/functions/daily-room).
 */
import { parseMatchCallEdgeCode } from '@clientShared/chat/matchCallEdgeCodes';
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

type InvokeFail = { ok: false; code?: string; message?: string };
type InvokeOk<T> = { ok: true; data: T };

function readInvokeErrorMessage(data: unknown): string | undefined {
  if (data === null || typeof data !== 'object') return undefined;
  const err = (data as { error?: unknown }).error;
  return typeof err === 'string' ? err : undefined;
}

export async function createMatchCall(
  matchId: string,
  callType: 'voice' | 'video',
): Promise<InvokeOk<CreateMatchCallResult> | InvokeFail> {
  const { data, error } = await supabase.functions.invoke('daily-room', {
    body: { action: 'create_match_call', matchId, callType },
  });
  if (!error && data && typeof data === 'object' && 'token' in data && (data as { token?: string }).token) {
    const d = data as CreateMatchCallResult;
    return {
      ok: true,
      data: {
        call_id: d.call_id,
        room_name: d.room_name,
        room_url: d.room_url,
        token: d.token,
      },
    };
  }
  return {
    ok: false,
    code: parseMatchCallEdgeCode(data),
    message: readInvokeErrorMessage(data),
  };
}

export async function answerMatchCall(callId: string): Promise<InvokeOk<AnswerMatchCallResult> | InvokeFail> {
  const { data, error } = await supabase.functions.invoke('daily-room', {
    body: { action: 'answer_match_call', callId },
  });
  if (!error && data && typeof data === 'object' && 'token' in data && (data as { token?: string }).token) {
    const d = data as AnswerMatchCallResult;
    return {
      ok: true,
      data: {
        call_id: d.call_id,
        room_name: d.room_name,
        room_url: d.room_url,
        token: d.token,
      },
    };
  }
  return {
    ok: false,
    code: parseMatchCallEdgeCode(data),
    message: readInvokeErrorMessage(data),
  };
}

/**
 * Backend-owned lifecycle transition via match_call_transition RPC.
 * Only callee-initiated answers are exposed through `daily-room/answer_match_call`;
 * this helper covers the remaining client-originated terminal transitions.
 * Duration and timestamps are derived server-side; client-supplied values ignored.
 */
export async function updateMatchCallStatus(
  callId: string,
  status: 'ended' | 'declined' | 'missed',
): Promise<void> {
  const actionMap: Record<string, string> = {
    ended: 'end',
    declined: 'decline',
    missed: 'mark_missed',
  };
  const action = actionMap[status];
  if (!action) {
    if (__DEV__) console.warn('[matchCallApi] updateMatchCallStatus: unknown status', status);
    return;
  }
  const { data, error } = await supabase.rpc('match_call_transition', {
    p_call_id: callId,
    p_action: action,
  });
  if (error) {
    if (__DEV__) console.warn('[matchCallApi] match_call_transition failed:', error.message);
    throw new Error(`Failed to transition call: ${error.message}`);
  }
  const result = data as { ok?: boolean; code?: string } | null;
  if (result && result.ok === false && __DEV__) {
    console.warn('[matchCallApi] match_call_transition rejected:', result.code);
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
