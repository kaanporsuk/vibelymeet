import type { VibeGameMessageEnvelopeV1 } from "../vibely-games/types";

export type GameSessionCollapseRow = {
  id: string;
  created_at: string;
  message_kind: string | null;
  structured_payload: unknown;
};

type RowEnvelope<TRow extends GameSessionCollapseRow> = {
  row: TRow;
  envelope: VibeGameMessageEnvelopeV1;
};

// Keep this parser local so shared/chat can run without a runtime dependency on
// the vibely-games package boundary; the stronger fold still happens downstream.
function parseGameEnvelope(structuredPayload: unknown): VibeGameMessageEnvelopeV1 | null {
  if (!structuredPayload || typeof structuredPayload !== "object" || Array.isArray(structuredPayload)) {
    return null;
  }
  const payload = structuredPayload as Record<string, unknown>;
  if (payload.schema !== "vibely.game_event" || payload.version !== 1) return null;
  if (typeof payload.game_session_id !== "string" || !payload.game_session_id) return null;
  if (typeof payload.event_id !== "string" || !payload.event_id) return null;
  if (typeof payload.event_index !== "number" || !Number.isFinite(payload.event_index)) return null;
  if (typeof payload.event_type !== "string" || !payload.event_type) return null;
  if (typeof payload.game_type !== "string" || !payload.game_type) return null;
  if (typeof payload.actor_id !== "string" || !payload.actor_id) return null;
  if (typeof payload.emitted_at !== "string" || !payload.emitted_at) return null;
  if (!payload.payload || typeof payload.payload !== "object" || Array.isArray(payload.payload)) return null;
  return payload as unknown as VibeGameMessageEnvelopeV1;
}

function collectSessionGroups<TRow extends GameSessionCollapseRow>(rows: TRow[]) {
  const groups = new Map<string, RowEnvelope<TRow>[]>();
  const emitIndexBySession = new Map<string, number>();

  rows.forEach((row, index) => {
    if (row.message_kind !== "vibe_game") return;
    const envelope = parseGameEnvelope(row.structured_payload);
    if (!envelope) return;
    const sid = envelope.game_session_id;
    if (!groups.has(sid)) groups.set(sid, []);
    groups.get(sid)!.push({ row, envelope });

    const prevIdx = emitIndexBySession.get(sid);
    if (prevIdx === undefined) {
      emitIndexBySession.set(sid, index);
      return;
    }

    const prevRow = rows[prevIdx]!;
    const tPrev = new Date(prevRow.created_at).getTime();
    const tNew = new Date(row.created_at).getTime();
    if (tNew > tPrev || (tNew === tPrev && index > prevIdx)) {
      emitIndexBySession.set(sid, index);
    }
  });

  return { groups, emitIndexBySession };
}

/**
 * Shared collapse algorithm:
 * - Parse valid `vibe_game` rows by session id.
 * - Emit one synthetic row per session at the canonical newest backing index.
 * - Fallback malformed rows to regular mapping.
 */
export function collapseGameSessionRows<TRow extends GameSessionCollapseRow, TView, TOut>(params: {
  rows: TRow[];
  mapRegularRow: (row: TRow) => TOut;
  buildSessionView: (sessionId: string, items: RowEnvelope<TRow>[]) => TView | null;
  mapCollapsedRow: (args: { sessionId: string; view: TView; anchorRow: TRow }) => TOut;
}): TOut[] {
  const { rows, mapRegularRow, buildSessionView, mapCollapsedRow } = params;
  const { groups, emitIndexBySession } = collectSessionGroups(rows);

  const viewBySession = new Map<string, TView>();
  for (const [sid, items] of groups) {
    const view = buildSessionView(sid, items);
    if (view) viewBySession.set(sid, view);
  }

  const out: TOut[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.message_kind !== "vibe_game") {
      out.push(mapRegularRow(row));
      continue;
    }

    const envelope = parseGameEnvelope(row.structured_payload);
    if (!envelope) {
      out.push(mapRegularRow(row));
      continue;
    }

    const sid = envelope.game_session_id;
    const canonicalEmitIndex = emitIndexBySession.get(sid);
    if (canonicalEmitIndex === undefined) {
      out.push(mapRegularRow(row));
      continue;
    }
    if (i !== canonicalEmitIndex) continue;

    const view = viewBySession.get(sid);
    if (!view) {
      out.push(mapRegularRow(row));
      continue;
    }

    out.push(mapCollapsedRow({ sessionId: sid, view, anchorRow: row }));
  }

  return out;
}
