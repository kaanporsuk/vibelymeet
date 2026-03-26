import { parseVibeGameEnvelopeFromStructuredPayload } from '../../../shared/vibely-games/parse';
import { foldVibeGameSession } from '../../../shared/vibely-games/reducer';
import type { GameType, VibeGameMessageEnvelopeV1, VibeGameSnapshotV1 } from '../../../shared/vibely-games/types';
import type { ChatMessage } from '@/lib/chatApi';

/** DB row shape needed to hydrate and collapse `vibe_game` messages (thread order = `created_at` ascending). */
export type ChatGameSessionMessageRow = {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  read_at: string | null;
  audio_url: string | null;
  audio_duration_seconds: number | null;
  video_url: string | null;
  video_duration_seconds: number | null;
  message_kind: string | null;
  ref_id: string | null;
  structured_payload: unknown;
};

type RowEnv = { row: ChatGameSessionMessageRow; envelope: VibeGameMessageEnvelopeV1 };

/**
 * Stable native view model for one persisted game session (one future bubble).
 * Multiple `messages` rows with the same `game_session_id` fold into one item.
 */
export type NativeHydratedGameSessionView = {
  gameSessionId: string;
  gameType: GameType | null;
  status: VibeGameSnapshotV1['status'];
  foldedSnapshot: VibeGameSnapshotV1;
  foldWarnings: string[];
  /** `actor_id` on the `session_start` envelope, if present */
  starterUserId: string | null;
  /** Deterministic [smallerId, largerId] for the two chat participants */
  participantUserIdsSorted: [string, string];
  /** Row id of the newest backing message by `created_at` */
  latestMessageId: string;
  latestEventIndex: number;
  lastActorId: string | null;
  backingMessageIds: string[];
  createdAt: string;
  updatedAt: string;
  canCurrentUserActNext: boolean;
};

function sortedParticipantPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function findSessionStartActor(events: VibeGameMessageEnvelopeV1[]): string | null {
  const sorted = [...events].sort((x, y) => x.event_index - y.event_index);
  const start = sorted.find((e) => e.event_type === 'session_start');
  return start?.actor_id ?? null;
}

function latestEnvelopeByIndex(events: VibeGameMessageEnvelopeV1[]): VibeGameMessageEnvelopeV1 | null {
  if (!events.length) return null;
  return [...events].sort((a, b) => a.event_index - b.event_index)[events.length - 1] ?? null;
}

function computeCanCurrentUserActNext(
  snapshot: VibeGameSnapshotV1,
  starterId: string | null,
  currentUserId: string
): boolean {
  if (snapshot.status !== 'active' || !starterId) return false;
  switch (snapshot.game_type) {
    case '2truths':
      return snapshot.guessed_index === undefined && currentUserId !== starterId;
    case 'would_rather':
      return snapshot.receiver_vote === undefined && currentUserId !== starterId;
    case 'charades':
      return snapshot.is_guessed !== true && currentUserId !== starterId;
    case 'scavenger':
      return snapshot.is_unlocked !== true && currentUserId !== starterId;
    case 'roulette':
      return snapshot.is_unlocked !== true && currentUserId !== starterId;
    case 'intuition':
      return snapshot.receiver_result === undefined && currentUserId !== starterId;
    default:
      return false;
  }
}

function buildSessionView(
  gameSessionId: string,
  items: RowEnv[],
  currentUserId: string,
  otherUserId: string
): NativeHydratedGameSessionView | null {
  try {
    if (!items.length) return null;
    const envelopes = items.map((i) => i.envelope);
    const { snapshot, warnings } = foldVibeGameSession(envelopes);
    const rows = [...items.map((i) => i.row)].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    const sortedEnv = [...envelopes].sort((a, b) => a.event_index - b.event_index);
    const lastEv = latestEnvelopeByIndex(envelopes);
    let latestRow = rows[0]!;
    for (const r of rows) {
      if (new Date(r.created_at).getTime() >= new Date(latestRow.created_at).getTime()) latestRow = r;
    }
    const starterUserId = findSessionStartActor(sortedEnv);
    const latestEventIndex = sortedEnv.length ? sortedEnv[sortedEnv.length - 1]!.event_index : 0;
    const canCurrentUserActNext = computeCanCurrentUserActNext(snapshot, starterUserId, currentUserId);
    return {
      gameSessionId,
      gameType: snapshot.game_type,
      status: snapshot.status,
      foldedSnapshot: snapshot,
      foldWarnings: warnings,
      starterUserId,
      participantUserIdsSorted: sortedParticipantPair(currentUserId, otherUserId),
      latestMessageId: latestRow.id,
      latestEventIndex,
      lastActorId: lastEv?.actor_id ?? null,
      backingMessageIds: rows.map((r) => r.id),
      createdAt: rows[0]!.created_at,
      updatedAt: rows[rows.length - 1]!.created_at,
      canCurrentUserActNext,
    };
  } catch {
    return null;
  }
}

function messageStatusForRow(row: ChatGameSessionMessageRow, currentUserId: string): NonNullable<ChatMessage['status']> {
  if (row.sender_id !== currentUserId) return 'sent';
  return row.read_at ? 'read' : 'delivered';
}

/**
 * Walk rows in `created_at` order (caller must pre-sort).
 * - Each non-`vibe_game` row maps with `mapRegularRow`.
 * - Valid `vibe_game` rows: one `vibe_game_session` item is emitted at the **newest** backing row for that
 *   `game_session_id` (max `created_at`, tie-break later thread index); other rows for that session are
 *   omitted (folded into `gameSessionView`).
 * - Unparseable `vibe_game` rows map with `mapRegularRow` (safe fallback).
 */
export function collapseVibeGameMessageRows(
  rows: ChatGameSessionMessageRow[],
  currentUserId: string,
  otherUserId: string,
  mapRegularRow: (row: ChatGameSessionMessageRow) => ChatMessage
): ChatMessage[] {
  const groups = new Map<string, RowEnv[]>();
  /** Thread index where the collapsed bubble is projected (newest backing row for the session). */
  const emitIndexBySession = new Map<string, number>();

  rows.forEach((row, index) => {
    if (row.message_kind !== 'vibe_game') return;
    const envelope = parseVibeGameEnvelopeFromStructuredPayload(row.structured_payload);
    if (!envelope) return;
    const sid = envelope.game_session_id;
    if (!groups.has(sid)) groups.set(sid, []);
    groups.get(sid)!.push({ row, envelope });

    const prevIdx = emitIndexBySession.get(sid);
    if (prevIdx === undefined) {
      emitIndexBySession.set(sid, index);
    } else {
      const prevRow = rows[prevIdx]!;
      const tPrev = new Date(prevRow.created_at).getTime();
      const tNew = new Date(row.created_at).getTime();
      if (tNew > tPrev || (tNew === tPrev && index > prevIdx)) {
        emitIndexBySession.set(sid, index);
      }
    }
  });

  const viewBySession = new Map<string, NativeHydratedGameSessionView>();
  for (const [sid, items] of groups) {
    const view = buildSessionView(sid, items, currentUserId, otherUserId);
    if (view) viewBySession.set(sid, view);
  }

  const out: ChatMessage[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.message_kind !== 'vibe_game') {
      out.push(mapRegularRow(row));
      continue;
    }
    const envelope = parseVibeGameEnvelopeFromStructuredPayload(row.structured_payload);
    if (!envelope) {
      out.push(mapRegularRow(row));
      continue;
    }
    const sid = envelope.game_session_id;
    // Single gate: emit the collapsed bubble only at the canonical (latest) backing index for this session.
    // Intermediate valid `vibe_game` rows are omitted; do not require or compare against the first row index.
    const canonicalEmitIndex = emitIndexBySession.get(sid);
    if (canonicalEmitIndex === undefined) {
      out.push(mapRegularRow(row));
      continue;
    }
    if (i !== canonicalEmitIndex) {
      continue;
    }

    const view = viewBySession.get(sid);
    if (!view) {
      out.push(mapRegularRow(row));
      continue;
    }

    const anchorRow = rows[i]!;

    out.push({
      id: `vibe-game-session:${sid}`,
      text: '🎮 Game',
      sender: anchorRow.sender_id === currentUserId ? 'me' : 'them',
      time: new Date(anchorRow.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      read_at: anchorRow.read_at ?? undefined,
      status: messageStatusForRow(anchorRow, currentUserId),
      messageKind: 'vibe_game_session',
      refId: null,
      structuredPayload: null,
      gameSessionView: view,
    });
  }

  return out;
}

/**
 * Non-UI smoke: returns true when grouping + fold behave on a tiny synthetic would_rather session.
 * Safe to call from devtools or a future test runner.
 */
export function verifyChatGameSessionsCollapseSmoke(): boolean {
  try {
    const uid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const pid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const sessionId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const basePayload = {
      schema: 'vibely.game_event' as const,
      version: 1 as const,
      game_session_id: sessionId,
      game_type: 'would_rather' as const,
      emitted_at: new Date().toISOString(),
    };
    const rows: ChatGameSessionMessageRow[] = [
      {
        id: 'm1',
        sender_id: uid,
        content: 'Game',
        created_at: '2025-01-01T10:00:00.000Z',
        read_at: null,
        audio_url: null,
        audio_duration_seconds: null,
        video_url: null,
        video_duration_seconds: null,
        message_kind: 'vibe_game',
        ref_id: null,
        structured_payload: {
          ...basePayload,
          event_id: 'm1',
          event_index: 0,
          event_type: 'session_start',
          actor_id: uid,
          payload: { option_a: 'A', option_b: 'B', sender_vote: 'A' },
        },
      },
      {
        id: 'm2',
        sender_id: pid,
        content: 'Game',
        created_at: '2025-01-01T10:01:00.000Z',
        read_at: null,
        audio_url: null,
        audio_duration_seconds: null,
        video_url: null,
        video_duration_seconds: null,
        message_kind: 'vibe_game',
        ref_id: null,
        structured_payload: {
          ...basePayload,
          event_id: 'm2',
          event_index: 1,
          event_type: 'would_rather_vote',
          actor_id: pid,
          payload: { receiver_vote: 'A' },
        },
      },
    ];
    const mapped = collapseVibeGameMessageRows(rows, uid, pid, (r): ChatMessage => ({
      id: r.id,
      text: r.content,
      sender: r.sender_id === uid ? 'me' : 'them',
      time: '',
      read_at: r.read_at ?? undefined,
      status: 'sent',
      messageKind: 'text',
    }));
    if (mapped.length !== 1) return false;
    const m = mapped[0]!;
    if (m.messageKind !== 'vibe_game_session' || !m.gameSessionView) return false;
    if (m.gameSessionView.foldedSnapshot.game_type !== 'would_rather') return false;
    if (m.gameSessionView.foldedSnapshot.status !== 'complete') return false;
    if (m.gameSessionView.backingMessageIds.length !== 2) return false;
    if (m.id !== `vibe-game-session:${sessionId}`) return false;
    // Chronology: bubble is projected at the latest backing row (here: m2), not m1.
    if (m.sender !== 'them' || m.gameSessionView.latestMessageId !== 'm2') return false;

    const withText: ChatGameSessionMessageRow[] = [
      {
        id: 't0',
        sender_id: uid,
        content: 'hey',
        created_at: '2025-01-01T09:58:00.000Z',
        read_at: null,
        audio_url: null,
        audio_duration_seconds: null,
        video_url: null,
        video_duration_seconds: null,
        message_kind: 'text',
        ref_id: null,
        structured_payload: null,
      },
      ...rows,
    ];
    const mapped2 = collapseVibeGameMessageRows(withText, uid, pid, (r): ChatMessage => ({
      id: r.id,
      text: r.content,
      sender: r.sender_id === uid ? 'me' : 'them',
      time: '',
      read_at: r.read_at ?? undefined,
      status: 'sent',
      messageKind: 'text',
    }));
    if (mapped2.length !== 2 || mapped2[0]!.id !== 't0' || mapped2[1]!.messageKind !== 'vibe_game_session') return false;

    const withTrailingText: ChatGameSessionMessageRow[] = [
      ...rows,
      {
        id: 't1',
        sender_id: pid,
        content: 'after',
        created_at: '2025-01-01T10:02:00.000Z',
        read_at: null,
        audio_url: null,
        audio_duration_seconds: null,
        video_url: null,
        video_duration_seconds: null,
        message_kind: 'text',
        ref_id: null,
        structured_payload: null,
      },
    ];
    const mapped3 = collapseVibeGameMessageRows(withTrailingText, uid, pid, (r): ChatMessage => ({
      id: r.id,
      text: r.content,
      sender: r.sender_id === uid ? 'me' : 'them',
      time: '',
      read_at: r.read_at ?? undefined,
      status: 'sent',
      messageKind: 'text',
    }));
    if (mapped3.length !== 2 || mapped3[0]!.messageKind !== 'vibe_game_session' || mapped3[1]!.id !== 't1') return false;

    const withBadMiddle: ChatGameSessionMessageRow[] = [
      rows[0]!,
      {
        id: 'bad',
        sender_id: uid,
        content: 'broken game row',
        created_at: '2025-01-01T10:00:30.000Z',
        read_at: null,
        audio_url: null,
        audio_duration_seconds: null,
        video_url: null,
        video_duration_seconds: null,
        message_kind: 'vibe_game',
        ref_id: null,
        structured_payload: { not: 'an envelope' },
      },
      rows[1]!,
    ];
    const mapped4 = collapseVibeGameMessageRows(withBadMiddle, uid, pid, (r): ChatMessage => ({
      id: r.id,
      text: r.content,
      sender: r.sender_id === uid ? 'me' : 'them',
      time: '',
      read_at: r.read_at ?? undefined,
      status: 'sent',
      messageKind: 'text',
    }));
    // m1 is skipped (folded); malformed row maps as regular; synthetic emits at m2's index.
    if (mapped4.length !== 2) return false;
    if (mapped4[0]!.id !== 'bad' || mapped4[1]!.messageKind !== 'vibe_game_session') return false;
    if (mapped4[1]!.gameSessionView?.backingMessageIds.join(',') !== 'm1,m2') return false;

    return true;
  } catch {
    return false;
  }
}
