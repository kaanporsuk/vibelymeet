import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { parseVibeGameEnvelopeFromStructuredPayload } from '../../../shared/vibely-games/parse';
import type { GameType, VibeGameEventType, VibeGameMessageEnvelopeV1 } from '../../../shared/vibely-games/types';

/** Client may never send `session_complete` (server-only). */
export type ClientVibeGameEventType = Exclude<VibeGameEventType, 'session_complete'>;

/**
 * Structured failures returned by `send-game-event` (HTTP 200, success: false).
 * Other string codes from the Edge function map to `other` with `code` preserved.
 */
export type SendGameEventRejectionCode =
  | 'session_already_complete'
  | 'event_index_out_of_order'
  | 'match_not_found'
  | 'access_denied'
  | 'client_session_complete_forbidden'
  | 'insert_failed'
  | 'internal_error'
  | 'invalid_json'
  | 'invalid_ids'
  | 'invalid_event_index'
  | 'invalid_event_fields'
  | 'unsupported_game_type'
  | 'session_start_must_be_index_0'
  | 'session_already_started'
  | 'missing_session_start'
  | 'invalid_event_after_start'
  | 'partner_event_required'
  | 'other';

const KNOWN_REJECTION_CODES = new Set<string>([
  'session_already_complete',
  'event_index_out_of_order',
  'match_not_found',
  'access_denied',
  'client_session_complete_forbidden',
  'insert_failed',
  'internal_error',
  'invalid_json',
  'invalid_ids',
  'invalid_event_index',
  'invalid_event_fields',
  'unsupported_game_type',
  'session_start_must_be_index_0',
  'session_already_started',
  'missing_session_start',
  'invalid_event_after_start',
  'partner_event_required',
]);

function normalizeRejectionCode(raw: string): SendGameEventRejectionCode {
  if (KNOWN_REJECTION_CODES.has(raw)) return raw as SendGameEventRejectionCode;
  return 'other';
}

/** Transport / Supabase client failures (no parsed JSON body). */
export type SendGameEventTransportCode = 'unauthorized' | 'network' | 'not_ok' | 'unknown';

export type SendGameEventError =
  | {
      kind: 'rejection';
      code: SendGameEventRejectionCode;
      /** Server hint for `event_index_out_of_order` */
      expectedEventIndex?: number;
      /** Original `error` string when `code === 'other'` */
      rawCode?: string;
    }
  | {
      kind: 'transport';
      code: SendGameEventTransportCode;
      message: string;
    };

export type GameEventMessageRow = {
  id: string;
  match_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  message_kind: string;
  structured_payload: Record<string, unknown>;
  /** Parsed when row is `vibe_game` with a valid envelope */
  envelope: VibeGameMessageEnvelopeV1 | null;
};

export type SendGameEventSuccess = {
  ok: true;
  idempotent: boolean;
  messages: GameEventMessageRow[];
};

export type SendGameEventResult = SendGameEventSuccess | { ok: false; error: SendGameEventError };

export type SendGameEventInput = {
  match_id: string;
  game_session_id: string;
  event_index: number;
  event_type: ClientVibeGameEventType;
  game_type: GameType;
  payload: Record<string, unknown>;
  /**
   * Idempotency key (UUID). If omitted, a new UUID is generated and sent as
   * `client_request_id` + `x-client-request-id`.
   */
  client_request_id?: string;
};

function mapRawRow(raw: unknown): GameEventMessageRow | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id : null;
  const match_id = typeof r.match_id === 'string' ? r.match_id : null;
  const sender_id = typeof r.sender_id === 'string' ? r.sender_id : null;
  const content = typeof r.content === 'string' ? r.content : null;
  const created_at = typeof r.created_at === 'string' ? r.created_at : null;
  const message_kind = typeof r.message_kind === 'string' ? r.message_kind : 'text';
  const sp = r.structured_payload;
  const structured_payload =
    sp !== null && typeof sp === 'object' && !Array.isArray(sp)
      ? (sp as Record<string, unknown>)
      : {};
  if (!id || !match_id || !sender_id || !content || !created_at) return null;
  return {
    id,
    match_id,
    sender_id,
    content,
    created_at,
    message_kind,
    structured_payload,
    envelope:
      message_kind === 'vibe_game' ? parseVibeGameEnvelopeFromStructuredPayload(structured_payload) : null,
  };
}

function newClientRequestId(): string {
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const n = (Math.random() * 16) | 0;
    return (ch === 'x' ? n : (n & 0x3) | 0x8).toString(16);
  });
}

/**
 * POST `send-game-event` with current session JWT. Parses success rows and typed rejections.
 */
export async function sendGameEvent(input: SendGameEventInput): Promise<SendGameEventResult> {
  const clientRequestId = input.client_request_id?.trim() || newClientRequestId();

  const body = {
    match_id: input.match_id,
    game_session_id: input.game_session_id,
    event_index: input.event_index,
    event_type: input.event_type,
    game_type: input.game_type,
    payload: input.payload,
    client_request_id: clientRequestId,
  };

  const { data, error } = await supabase.functions.invoke('send-game-event', {
    body,
    headers: { 'x-client-request-id': clientRequestId },
  });

  if (error) {
    const msg = error.message || 'invoke failed';
    const status = (error as { context?: { status?: number } }).context?.status;
    if (status === 401) {
      return { ok: false, error: { kind: 'transport', code: 'unauthorized', message: msg } };
    }
    return { ok: false, error: { kind: 'transport', code: 'network', message: msg } };
  }

  const payload = data as Record<string, unknown> | null;
  if (payload === null || typeof payload !== 'object') {
    return {
      ok: false,
      error: { kind: 'rejection', code: 'invalid_json', rawCode: 'invalid_json' },
    };
  }

  if (payload.success === true) {
    const idempotent = payload.idempotent === true;
    const rows: unknown[] = Array.isArray(payload.messages)
      ? payload.messages
      : payload.message !== undefined
        ? [payload.message]
        : [];
    const messages = rows.map(mapRawRow).filter((m): m is GameEventMessageRow => m !== null);
    return { ok: true, idempotent, messages };
  }

  if (payload.success === false) {
    const errStr = typeof payload.error === 'string' ? payload.error : 'unknown';
    const code = normalizeRejectionCode(errStr);
    const expectedRaw = payload.expected;
    const expectedEventIndex =
      typeof expectedRaw === 'number' && Number.isInteger(expectedRaw) ? expectedRaw : undefined;
    return {
      ok: false,
      error: {
        kind: 'rejection',
        code,
        expectedEventIndex,
        rawCode: code === 'other' ? errStr : undefined,
      },
    };
  }

  return {
    ok: false,
    error: { kind: 'transport', code: 'not_ok', message: 'Unexpected response shape' },
  };
}

/** `session_start` for Would You Rather (starter, `event_index` 0). */
export function startWouldRatherGame(params: {
  matchId: string;
  gameSessionId: string;
  optionA: string;
  optionB: string;
  senderVote: 'A' | 'B';
  client_request_id?: string;
}): Promise<SendGameEventResult> {
  return sendGameEvent({
    match_id: params.matchId,
    game_session_id: params.gameSessionId,
    event_index: 0,
    event_type: 'session_start',
    game_type: 'would_rather',
    payload: {
      option_a: params.optionA,
      option_b: params.optionB,
      sender_vote: params.senderVote,
    },
    client_request_id: params.client_request_id,
  });
}

/** Partner reply after starter's `session_start`. */
export function sendWouldRatherVote(params: {
  matchId: string;
  gameSessionId: string;
  eventIndex: number;
  receiverVote: 'A' | 'B';
  client_request_id?: string;
}): Promise<SendGameEventResult> {
  return sendGameEvent({
    match_id: params.matchId,
    game_session_id: params.gameSessionId,
    event_index: params.eventIndex,
    event_type: 'would_rather_vote',
    game_type: 'would_rather',
    payload: { receiver_vote: params.receiverVote },
    client_request_id: params.client_request_id,
  });
}

/**
 * TanStack mutation: `mutateAsync` resolves with `SendGameEventResult` (does not throw on
 * server rejections — check `result.ok`). On success only, invalidates the same query roots
 * as `useSendVoiceMessage` (thread + match list preview). Omits `date-suggestions`.
 */
export function useSendGameEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: SendGameEventInput) => sendGameEvent(vars),
    onSuccess: (result) => {
      if (!result.ok) return;
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });
}
