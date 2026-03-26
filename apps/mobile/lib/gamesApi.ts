import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { parseVibeGameEnvelopeFromStructuredPayload } from '../../../shared/vibely-games/parse';
import type { GameType, VibeGameEventType, VibeGameMessageEnvelopeV1 } from '../../../shared/vibely-games/types';
import type { NativeHydratedGameSessionView } from '@/lib/chatGameSessions';

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

function randomUuidV4(): string {
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

function newClientRequestId(): string {
  return randomUuidV4();
}

/** New `game_session_id` for starting a native (or any client) arcade session. */
export function newVibeGameSessionId(): string {
  return randomUuidV4();
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

/** `session_start` for Two Truths (starter, `event_index` 0). */
export function startTwoTruthsGame(params: {
  matchId: string;
  gameSessionId: string;
  statements: [string, string, string];
  lieIndex: 0 | 1 | 2;
  client_request_id?: string;
}): Promise<SendGameEventResult> {
  return sendGameEvent({
    match_id: params.matchId,
    game_session_id: params.gameSessionId,
    event_index: 0,
    event_type: 'session_start',
    game_type: '2truths',
    payload: {
      statements: params.statements,
      lie_index: params.lieIndex,
    },
    client_request_id: params.client_request_id,
  });
}

/** Partner guess after starter's `session_start`. */
export function sendTwoTruthsGuess(params: {
  matchId: string;
  gameSessionId: string;
  eventIndex: number;
  guessIndex: 0 | 1 | 2;
  client_request_id?: string;
}): Promise<SendGameEventResult> {
  return sendGameEvent({
    match_id: params.matchId,
    game_session_id: params.gameSessionId,
    event_index: params.eventIndex,
    event_type: 'two_truths_guess',
    game_type: '2truths',
    payload: { guess_index: params.guessIndex },
    client_request_id: params.client_request_id,
  });
}

/** `session_start` for Intuition (starter, `event_index` 0). */
export function startIntuitionGame(params: {
  matchId: string;
  gameSessionId: string;
  options: [string, string];
  senderChoice: 0 | 1;
  client_request_id?: string;
}): Promise<SendGameEventResult> {
  return sendGameEvent({
    match_id: params.matchId,
    game_session_id: params.gameSessionId,
    event_index: 0,
    event_type: 'session_start',
    game_type: 'intuition',
    payload: {
      options: params.options,
      sender_choice: params.senderChoice,
    },
    client_request_id: params.client_request_id,
  });
}

/** `session_start` for Roulette (starter, `event_index` 0). */
export function startRouletteGame(params: {
  matchId: string;
  gameSessionId: string;
  question: string;
  senderAnswer: string;
  client_request_id?: string;
}): Promise<SendGameEventResult> {
  return sendGameEvent({
    match_id: params.matchId,
    game_session_id: params.gameSessionId,
    event_index: 0,
    event_type: 'session_start',
    game_type: 'roulette',
    payload: {
      question: params.question,
      sender_answer: params.senderAnswer,
    },
    client_request_id: params.client_request_id,
  });
}

/** `session_start` for Charades (starter, `event_index` 0). */
export function startCharadesGame(params: {
  matchId: string;
  gameSessionId: string;
  answer: string;
  emojis: string[];
  client_request_id?: string;
}): Promise<SendGameEventResult> {
  return sendGameEvent({
    match_id: params.matchId,
    game_session_id: params.gameSessionId,
    event_index: 0,
    event_type: 'session_start',
    game_type: 'charades',
    payload: {
      answer: params.answer,
      emojis: params.emojis,
    },
    client_request_id: params.client_request_id,
  });
}

/** `session_start` for Scavenger (starter, `event_index` 0). */
export function startScavengerGame(params: {
  matchId: string;
  gameSessionId: string;
  prompt: string;
  senderPhotoUrl: string;
  client_request_id?: string;
}): Promise<SendGameEventResult> {
  return sendGameEvent({
    match_id: params.matchId,
    game_session_id: params.gameSessionId,
    event_index: 0,
    event_type: 'session_start',
    game_type: 'scavenger',
    payload: {
      prompt: params.prompt,
      sender_photo_url: params.senderPhotoUrl,
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

/** Partner photo after starter's Scavenger `session_start`. */
export function sendScavengerPhoto(params: {
  matchId: string;
  gameSessionId: string;
  eventIndex: number;
  receiverPhotoUrl: string;
  client_request_id?: string;
}): Promise<SendGameEventResult> {
  return sendGameEvent({
    match_id: params.matchId,
    game_session_id: params.gameSessionId,
    event_index: params.eventIndex,
    event_type: 'scavenger_photo',
    game_type: 'scavenger',
    payload: { receiver_photo_url: params.receiverPhotoUrl },
    client_request_id: params.client_request_id,
  });
}

/** Partner guess after starter's Charades `session_start`. */
export function sendCharadesGuess(params: {
  matchId: string;
  gameSessionId: string;
  eventIndex: number;
  guess: string;
  client_request_id?: string;
}): Promise<SendGameEventResult> {
  return sendGameEvent({
    match_id: params.matchId,
    game_session_id: params.gameSessionId,
    event_index: params.eventIndex,
    event_type: 'charades_guess',
    game_type: 'charades',
    payload: { guess: params.guess },
    client_request_id: params.client_request_id,
  });
}

/** Partner answer after starter's Roulette `session_start`. */
export function sendRouletteAnswer(params: {
  matchId: string;
  gameSessionId: string;
  eventIndex: number;
  receiverAnswer: string;
  client_request_id?: string;
}): Promise<SendGameEventResult> {
  return sendGameEvent({
    match_id: params.matchId,
    game_session_id: params.gameSessionId,
    event_index: params.eventIndex,
    event_type: 'roulette_answer',
    game_type: 'roulette',
    payload: { receiver_answer: params.receiverAnswer },
    client_request_id: params.client_request_id,
  });
}

/** Partner response after starter's Intuition `session_start`. */
export function sendIntuitionResult(params: {
  matchId: string;
  gameSessionId: string;
  eventIndex: number;
  result: 'correct' | 'wrong';
  client_request_id?: string;
}): Promise<SendGameEventResult> {
  return sendGameEvent({
    match_id: params.matchId,
    game_session_id: params.gameSessionId,
    event_index: params.eventIndex,
    event_type: 'intuition_result',
    game_type: 'intuition',
    payload: { result: params.result },
    client_request_id: params.client_request_id,
  });
}

/**
 * Validates hydrated session + folded snapshot, then returns args for `sendWouldRatherVote`
 * (`event_index` = `view.latestEventIndex + 1`). Returns null if the viewer cannot act.
 */
export function buildWouldRatherReceiverVoteParams(
  view: NativeHydratedGameSessionView,
  matchId: string,
  receiverVote: 'A' | 'B'
): {
  matchId: string;
  gameSessionId: string;
  eventIndex: number;
  receiverVote: 'A' | 'B';
} | null {
  const mid = matchId.trim();
  if (!mid) return null;
  if (view.gameType !== 'would_rather') return null;
  const snap = view.foldedSnapshot;
  if (snap.game_type !== 'would_rather') return null;
  if (snap.status !== 'active') return null;
  if (snap.receiver_vote != null) return null;
  if (!view.canCurrentUserActNext) return null;
  if (!view.gameSessionId) return null;
  if (typeof snap.option_a !== 'string' || !snap.option_a.trim()) return null;
  if (typeof snap.option_b !== 'string' || !snap.option_b.trim()) return null;
  const nextIndex = view.latestEventIndex + 1;
  if (nextIndex < 1) return null;
  return {
    matchId: mid,
    gameSessionId: view.gameSessionId,
    eventIndex: nextIndex,
    receiverVote,
  };
}

/**
 * Validates hydrated session + folded snapshot, then returns args for `sendTwoTruthsGuess`
 * (`event_index` = `view.latestEventIndex + 1`). Returns null if the viewer cannot act.
 */
export function buildTwoTruthsGuessParams(
  view: NativeHydratedGameSessionView,
  matchId: string,
  guessIndex: 0 | 1 | 2
): {
  matchId: string;
  gameSessionId: string;
  eventIndex: number;
  guessIndex: 0 | 1 | 2;
} | null {
  const mid = matchId.trim();
  if (!mid) return null;
  if (view.gameType !== '2truths') return null;
  const snap = view.foldedSnapshot;
  if (snap.game_type !== '2truths') return null;
  if (snap.status !== 'active') return null;
  if (snap.guessed_index != null) return null;
  if (!view.canCurrentUserActNext) return null;
  if (!view.gameSessionId) return null;
  if (!Array.isArray(snap.statements) || snap.statements.length !== 3) return null;
  const nextIndex = view.latestEventIndex + 1;
  if (nextIndex < 1) return null;
  return {
    matchId: mid,
    gameSessionId: view.gameSessionId,
    eventIndex: nextIndex,
    guessIndex,
  };
}

/**
 * Validates hydrated session + folded snapshot, then returns args for `sendIntuitionResult`
 * (`event_index` = `view.latestEventIndex + 1`). Returns null if the viewer cannot act.
 */
export function buildIntuitionResultParams(
  view: NativeHydratedGameSessionView,
  matchId: string,
  result: 'correct' | 'wrong'
): {
  matchId: string;
  gameSessionId: string;
  eventIndex: number;
  result: 'correct' | 'wrong';
} | null {
  const mid = matchId.trim();
  if (!mid) return null;
  if (view.gameType !== 'intuition') return null;
  const snap = view.foldedSnapshot;
  if (snap.game_type !== 'intuition') return null;
  if (snap.status !== 'active') return null;
  if (snap.receiver_result != null) return null;
  if (!view.canCurrentUserActNext) return null;
  if (!view.gameSessionId) return null;
  if (!Array.isArray(snap.options) || snap.options.length !== 2) return null;
  if (snap.sender_choice !== 0 && snap.sender_choice !== 1) return null;
  const nextIndex = view.latestEventIndex + 1;
  if (nextIndex < 1) return null;
  return {
    matchId: mid,
    gameSessionId: view.gameSessionId,
    eventIndex: nextIndex,
    result,
  };
}

/**
 * Validates hydrated session + folded snapshot, then returns args for `sendRouletteAnswer`
 * (`event_index` = `view.latestEventIndex + 1`). Returns null if the viewer cannot act.
 */
export function buildRouletteAnswerParams(
  view: NativeHydratedGameSessionView,
  matchId: string,
  receiverAnswer: string
): {
  matchId: string;
  gameSessionId: string;
  eventIndex: number;
  receiverAnswer: string;
} | null {
  const mid = matchId.trim();
  if (!mid) return null;
  if (view.gameType !== 'roulette') return null;
  const snap = view.foldedSnapshot;
  if (snap.game_type !== 'roulette') return null;
  if (snap.status !== 'active') return null;
  if (snap.receiver_answer != null) return null;
  if (!view.canCurrentUserActNext) return null;
  if (!view.gameSessionId) return null;
  const q = typeof snap.question === 'string' ? snap.question.trim() : '';
  const sa = typeof snap.sender_answer === 'string' ? snap.sender_answer.trim() : '';
  const ra = receiverAnswer.trim();
  if (!q || !sa || !ra) return null;
  const nextIndex = view.latestEventIndex + 1;
  if (nextIndex < 1) return null;
  return {
    matchId: mid,
    gameSessionId: view.gameSessionId,
    eventIndex: nextIndex,
    receiverAnswer: ra,
  };
}

/**
 * Validates hydrated session + folded snapshot, then returns args for `sendCharadesGuess`
 * (`event_index` = `view.latestEventIndex + 1`). Returns null if the viewer cannot act.
 */
export function buildCharadesGuessParams(
  view: NativeHydratedGameSessionView,
  matchId: string,
  guess: string
): {
  matchId: string;
  gameSessionId: string;
  eventIndex: number;
  guess: string;
} | null {
  const mid = matchId.trim();
  if (!mid) return null;
  if (view.gameType !== 'charades') return null;
  const snap = view.foldedSnapshot;
  if (snap.game_type !== 'charades') return null;
  if (snap.status !== 'active') return null;
  if (snap.is_guessed === true) return null;
  if (!view.canCurrentUserActNext) return null;
  if (!view.gameSessionId) return null;
  if (!Array.isArray(snap.emojis) || snap.emojis.length === 0) return null;
  if (typeof snap.answer !== 'string' || !snap.answer.trim()) return null;
  const g = guess.trim();
  if (!g) return null;
  const nextIndex = view.latestEventIndex + 1;
  if (nextIndex < 1) return null;
  return {
    matchId: mid,
    gameSessionId: view.gameSessionId,
    eventIndex: nextIndex,
    guess: g,
  };
}

/**
 * Validates hydrated session + folded snapshot, then returns args for `sendScavengerPhoto`
 * (`event_index` = `view.latestEventIndex + 1`). Returns null if the viewer cannot act.
 */
export function buildScavengerPhotoParams(
  view: NativeHydratedGameSessionView,
  matchId: string,
  receiverPhotoUrl: string
): {
  matchId: string;
  gameSessionId: string;
  eventIndex: number;
  receiverPhotoUrl: string;
} | null {
  const mid = matchId.trim();
  if (!mid) return null;
  if (view.gameType !== 'scavenger') return null;
  const snap = view.foldedSnapshot;
  if (snap.game_type !== 'scavenger') return null;
  if (snap.status !== 'active') return null;
  if (snap.receiver_photo_url != null || snap.is_unlocked === true) return null;
  if (!view.canCurrentUserActNext) return null;
  if (!view.gameSessionId) return null;
  if (typeof snap.prompt !== 'string' || !snap.prompt.trim()) return null;
  if (typeof snap.sender_photo_url !== 'string' || !snap.sender_photo_url.trim()) return null;
  const photoUrl = receiverPhotoUrl.trim();
  if (!photoUrl) return null;
  const nextIndex = view.latestEventIndex + 1;
  if (nextIndex < 1) return null;
  return {
    matchId: mid,
    gameSessionId: view.gameSessionId,
    eventIndex: nextIndex,
    receiverPhotoUrl: photoUrl,
  };
}

/** Native Would You Rather: receiver pick only (uses live `send-game-event`). */
export function sendWouldRatherChoice(
  view: NativeHydratedGameSessionView,
  matchId: string,
  receiverVote: 'A' | 'B',
  client_request_id?: string
): Promise<SendGameEventResult> {
  const params = buildWouldRatherReceiverVoteParams(view, matchId, receiverVote);
  if (!params) {
    return Promise.resolve({
      ok: false,
      error: { kind: 'transport', code: 'unknown', message: 'Cannot submit this choice right now.' },
    });
  }
  return sendWouldRatherVote({ ...params, client_request_id });
}

/** Native Two Truths: receiver guess only (uses live `send-game-event`). */
export function sendTwoTruthsChoice(
  view: NativeHydratedGameSessionView,
  matchId: string,
  guessIndex: 0 | 1 | 2,
  client_request_id?: string
): Promise<SendGameEventResult> {
  const params = buildTwoTruthsGuessParams(view, matchId, guessIndex);
  if (!params) {
    return Promise.resolve({
      ok: false,
      error: { kind: 'transport', code: 'unknown', message: 'Cannot submit this guess right now.' },
    });
  }
  return sendTwoTruthsGuess({ ...params, client_request_id });
}

/** Native Intuition: receiver marks sender prediction as correct/wrong. */
export function sendIntuitionChoice(
  view: NativeHydratedGameSessionView,
  matchId: string,
  result: 'correct' | 'wrong',
  client_request_id?: string
): Promise<SendGameEventResult> {
  const params = buildIntuitionResultParams(view, matchId, result);
  if (!params) {
    return Promise.resolve({
      ok: false,
      error: { kind: 'transport', code: 'unknown', message: 'Cannot submit this response right now.' },
    });
  }
  return sendIntuitionResult({ ...params, client_request_id });
}

/** Native Roulette: receiver answer only (uses live `send-game-event`). */
export function sendRouletteChoice(
  view: NativeHydratedGameSessionView,
  matchId: string,
  receiverAnswer: string,
  client_request_id?: string
): Promise<SendGameEventResult> {
  const params = buildRouletteAnswerParams(view, matchId, receiverAnswer);
  if (!params) {
    return Promise.resolve({
      ok: false,
      error: { kind: 'transport', code: 'unknown', message: 'Cannot submit this answer right now.' },
    });
  }
  return sendRouletteAnswer({ ...params, client_request_id });
}

/** Native Charades: receiver guess only (uses live `send-game-event`). */
export function sendCharadesChoice(
  view: NativeHydratedGameSessionView,
  matchId: string,
  guess: string,
  client_request_id?: string
): Promise<SendGameEventResult> {
  const params = buildCharadesGuessParams(view, matchId, guess);
  if (!params) {
    return Promise.resolve({
      ok: false,
      error: { kind: 'transport', code: 'unknown', message: 'Cannot submit this guess right now.' },
    });
  }
  return sendCharadesGuess({ ...params, client_request_id });
}

/** Native Scavenger: receiver photo only (uses live `send-game-event`). */
export function sendScavengerChoice(
  view: NativeHydratedGameSessionView,
  matchId: string,
  receiverPhotoUrl: string,
  client_request_id?: string
): Promise<SendGameEventResult> {
  const params = buildScavengerPhotoParams(view, matchId, receiverPhotoUrl);
  if (!params) {
    return Promise.resolve({
      ok: false,
      error: { kind: 'transport', code: 'unknown', message: 'Cannot submit this photo right now.' },
    });
  }
  return sendScavengerPhoto({ ...params, client_request_id });
}

export function formatSendGameEventError(err: SendGameEventError): string {
  if (err.kind === 'transport') return err.message || 'Something went wrong. Try again.';
  switch (err.code) {
    case 'session_already_complete':
      return 'This round already finished.';
    case 'event_index_out_of_order':
      return 'Out of sync with the server. Pull to refresh, then try again.';
    case 'access_denied':
    case 'match_not_found':
      return 'Could not reach this game. Try again later.';
    case 'partner_event_required':
      return 'Not your turn.';
    case 'insert_failed':
      return 'Could not save your pick. Try again.';
    case 'session_already_started':
      return 'This game round was already started. Refresh the chat.';
    case 'session_start_must_be_index_0':
      return 'Could not start the round. Try again.';
    case 'invalid_event_fields':
      return 'Some game details are invalid. Edit and try again.';
    default:
      return err.rawCode || err.code || 'Could not send your pick.';
  }
}

/**
 * Start a new Two Truths session (`session_start`, `event_index` 0). Invalidates messages on success.
 */
export function useStartTwoTruthsGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      matchId: string;
      gameSessionId: string;
      statements: [string, string, string];
      lieIndex: 0 | 1 | 2;
    }) =>
      startTwoTruthsGame({
        matchId: vars.matchId,
        gameSessionId: vars.gameSessionId,
        statements: vars.statements,
        lieIndex: vars.lieIndex,
      }),
    onSuccess: (result) => {
      if (!result.ok) return;
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });
}

/**
 * Start a new Intuition session (`session_start`, `event_index` 0). Invalidates messages on success.
 */
export function useStartIntuitionGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      matchId: string;
      gameSessionId: string;
      options: [string, string];
      senderChoice: 0 | 1;
    }) =>
      startIntuitionGame({
        matchId: vars.matchId,
        gameSessionId: vars.gameSessionId,
        options: vars.options,
        senderChoice: vars.senderChoice,
      }),
    onSuccess: (result) => {
      if (!result.ok) return;
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });
}

/**
 * Start a new Roulette session (`session_start`, `event_index` 0). Invalidates messages on success.
 */
export function useStartRouletteGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      matchId: string;
      gameSessionId: string;
      question: string;
      senderAnswer: string;
    }) =>
      startRouletteGame({
        matchId: vars.matchId,
        gameSessionId: vars.gameSessionId,
        question: vars.question,
        senderAnswer: vars.senderAnswer,
      }),
    onSuccess: (result) => {
      if (!result.ok) return;
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });
}

/**
 * Start a new Charades session (`session_start`, `event_index` 0). Invalidates messages on success.
 */
export function useStartCharadesGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      matchId: string;
      gameSessionId: string;
      answer: string;
      emojis: string[];
    }) =>
      startCharadesGame({
        matchId: vars.matchId,
        gameSessionId: vars.gameSessionId,
        answer: vars.answer,
        emojis: vars.emojis,
      }),
    onSuccess: (result) => {
      if (!result.ok) return;
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });
}

/**
 * Start a new Scavenger session (`session_start`, `event_index` 0). Invalidates messages on success.
 */
export function useStartScavengerGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      matchId: string;
      gameSessionId: string;
      prompt: string;
      senderPhotoUrl: string;
    }) =>
      startScavengerGame({
        matchId: vars.matchId,
        gameSessionId: vars.gameSessionId,
        prompt: vars.prompt,
        senderPhotoUrl: vars.senderPhotoUrl,
      }),
    onSuccess: (result) => {
      if (!result.ok) return;
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });
}

/**
 * Start a new Would You Rather session (`session_start`, `event_index` 0). Invalidates messages on success.
 */
export function useStartWouldRatherGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      matchId: string;
      gameSessionId: string;
      optionA: string;
      optionB: string;
      senderVote: 'A' | 'B';
    }) =>
      startWouldRatherGame({
        matchId: vars.matchId,
        gameSessionId: vars.gameSessionId,
        optionA: vars.optionA,
        optionB: vars.optionB,
        senderVote: vars.senderVote,
      }),
    onSuccess: (result) => {
      if (!result.ok) return;
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });
}

/**
 * Mutation: submit receiver vote; on `result.ok` invalidates messages + matches (server is source of truth).
 */
export function useSendWouldRatherChoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      view: NativeHydratedGameSessionView;
      matchId: string;
      receiverVote: 'A' | 'B';
    }) => sendWouldRatherChoice(vars.view, vars.matchId, vars.receiverVote),
    onSuccess: (result) => {
      if (!result.ok) return;
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });
}

/**
 * Mutation: submit receiver guess; on `result.ok` invalidates messages + matches (server is source of truth).
 */
export function useSendTwoTruthsChoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      view: NativeHydratedGameSessionView;
      matchId: string;
      guessIndex: 0 | 1 | 2;
    }) => sendTwoTruthsChoice(vars.view, vars.matchId, vars.guessIndex),
    onSuccess: (result) => {
      if (!result.ok) return;
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });
}

/**
 * Mutation: submit receiver response; on `result.ok` invalidates messages + matches.
 */
export function useSendIntuitionChoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      view: NativeHydratedGameSessionView;
      matchId: string;
      result: 'correct' | 'wrong';
    }) => sendIntuitionChoice(vars.view, vars.matchId, vars.result),
    onSuccess: (result) => {
      if (!result.ok) return;
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });
}

/**
 * Mutation: submit receiver answer; on `result.ok` invalidates messages + matches.
 */
export function useSendRouletteChoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      view: NativeHydratedGameSessionView;
      matchId: string;
      receiverAnswer: string;
    }) => sendRouletteChoice(vars.view, vars.matchId, vars.receiverAnswer),
    onSuccess: (result) => {
      if (!result.ok) return;
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });
}

/**
 * Mutation: submit receiver guess; on `result.ok` invalidates messages + matches.
 */
export function useSendCharadesChoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      view: NativeHydratedGameSessionView;
      matchId: string;
      guess: string;
    }) => sendCharadesChoice(vars.view, vars.matchId, vars.guess),
    onSuccess: (result) => {
      if (!result.ok) return;
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });
}

/**
 * Mutation: submit receiver photo; on `result.ok` invalidates messages + matches.
 */
export function useSendScavengerChoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      view: NativeHydratedGameSessionView;
      matchId: string;
      receiverPhotoUrl: string;
    }) => sendScavengerChoice(vars.view, vars.matchId, vars.receiverPhotoUrl),
    onSuccess: (result) => {
      if (!result.ok) return;
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
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
