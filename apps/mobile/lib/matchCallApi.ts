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
  /** Set when the backend reused an existing open call instead of creating a new one. */
  reused?: boolean;
  /** call_type of the existing call when the request was reused; may differ from the request. */
  existing_call_type?: 'voice' | 'video';
  /** True when the existing call's call_type differs from the requested call_type. */
  call_type_mismatch?: boolean;
  /** Status of the existing call when reused: usually "ringing" or "active". */
  status?: 'ringing' | 'active' | 'ended' | 'missed' | 'declined';
};

export type IncomingMatchCallAvailable = {
  code: 'INCOMING_CALL_AVAILABLE';
  call_id: string;
  match_id: string;
  existing_call_type: 'voice' | 'video';
  status: 'ringing' | 'active';
};

export type AnswerMatchCallResult = {
  call_id: string;
  room_name: string;
  room_url: string;
  token: string;
};

export type JoinMatchCallResult = AnswerMatchCallResult;

export type MatchCallTransitionAction =
  | 'answer'
  | 'decline'
  | 'end'
  | 'mark_missed'
  | 'heartbeat'
  | 'joined'
  | 'join_failed';

export type MatchCallTransitionResult = {
  ok?: boolean;
  code?: string;
  status?: string;
  idempotent?: boolean;
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
): Promise<
  | InvokeOk<CreateMatchCallResult>
  | { ok: false; code: 'INCOMING_CALL_AVAILABLE'; data: IncomingMatchCallAvailable }
  | InvokeFail
> {
  const { data, error } = await supabase.functions.invoke('daily-room', {
    body: { action: 'create_match_call', matchId, callType },
  });
  if (!error && data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (obj.code === 'INCOMING_CALL_AVAILABLE' && typeof obj.call_id === 'string') {
      return {
        ok: false,
        code: 'INCOMING_CALL_AVAILABLE',
        data: {
          code: 'INCOMING_CALL_AVAILABLE',
          call_id: obj.call_id,
          match_id: typeof obj.match_id === 'string' ? obj.match_id : matchId,
          existing_call_type:
            obj.existing_call_type === 'voice' || obj.existing_call_type === 'video'
              ? obj.existing_call_type
              : callType,
          status:
            obj.status === 'ringing' || obj.status === 'active'
              ? (obj.status as 'ringing' | 'active')
              : 'ringing',
        },
      };
    }
    if (typeof obj.token === 'string' && obj.token) {
      const d = obj as CreateMatchCallResult & Record<string, unknown>;
      return {
        ok: true,
        data: {
          call_id: d.call_id,
          room_name: d.room_name,
          room_url: d.room_url,
          token: d.token,
          reused: Boolean(obj.reused),
          existing_call_type:
            obj.existing_call_type === 'voice' || obj.existing_call_type === 'video'
              ? obj.existing_call_type
              : undefined,
          call_type_mismatch: Boolean(obj.call_type_mismatch),
          status:
            obj.status === 'ringing' ||
            obj.status === 'active' ||
            obj.status === 'ended' ||
            obj.status === 'missed' ||
            obj.status === 'declined'
              ? (obj.status as CreateMatchCallResult['status'])
              : undefined,
        },
      };
    }
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

export async function joinMatchCall(callId: string): Promise<InvokeOk<JoinMatchCallResult> | InvokeFail> {
  const { data, error } = await supabase.functions.invoke('daily-room', {
    body: { action: 'join_match_call', callId },
  });
  if (!error && data && typeof data === 'object' && 'token' in data && (data as { token?: string }).token) {
    const d = data as JoinMatchCallResult;
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

export async function transitionMatchCall(
  callId: string,
  action: MatchCallTransitionAction,
): Promise<MatchCallTransitionResult> {
  const { data, error } = await supabase.rpc('match_call_transition', {
    p_call_id: callId,
    p_action: action,
  });
  if (error) {
    throw new Error(`Failed to transition call: ${error.message}`);
  }
  const result = (data ?? null) as MatchCallTransitionResult | null;
  if (result?.ok === false) {
    throw new Error(`Match call transition rejected: ${result.code ?? 'unknown'}`);
  }
  return result ?? { ok: true };
}

/**
 * Backend-owned lifecycle transition via match_call_transition RPC.
 * Maps legacy action names to RPC action strings.
 * Duration and timestamps are derived server-side; client-supplied values ignored.
 */
export async function updateMatchCallStatus(
  callId: string,
  status: 'active' | 'ended' | 'declined' | 'missed',
  _extra?: { ended_at?: string; started_at?: string; duration_seconds?: number }
): Promise<void> {
  const actionMap: Record<string, string> = {
    active: 'answer',
    ended: 'end',
    declined: 'decline',
    missed: 'mark_missed',
  };
  const action = actionMap[status];
  if (!action) {
    if (__DEV__) console.warn('[matchCallApi] updateMatchCallStatus: unknown status', status);
    return;
  }
  await transitionMatchCall(callId, action as MatchCallTransitionAction);
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
