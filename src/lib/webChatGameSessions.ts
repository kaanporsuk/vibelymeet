import { parseVibeGameEnvelopeFromStructuredPayload } from "../../shared/vibely-games/parse";
import { foldVibeGameSession } from "../../shared/vibely-games/reducer";
import type { GameType, VibeGameMessageEnvelopeV1, VibeGameSnapshotV1 } from "../../shared/vibely-games/types";
import { toRenderableMessageKind } from "../../shared/chat/messageRouting";
import type { GamePayload } from "@/types/games";

export type WebChatMessageRow = {
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

type RowEnv = { row: WebChatMessageRow; envelope: VibeGameMessageEnvelopeV1 };

export type WebHydratedGameSessionView = {
  gameSessionId: string;
  gameType: GameType | null;
  status: VibeGameSnapshotV1["status"];
  foldedSnapshot: VibeGameSnapshotV1;
  foldWarnings: string[];
  starterUserId: string | null;
  latestMessageId: string;
  latestEventIndex: number;
  lastActorId: string | null;
  backingMessageIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type CollapsedMessage = {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  read_at: string | null;
  audio_url: string | null;
  audio_duration_seconds: number | null;
  video_url: string | null;
  video_duration_seconds: number | null;
  message_kind: "text" | "date_suggestion" | "date_suggestion_event" | "vibe_game_session";
  ref_id: string | null;
  structured_payload: Record<string, unknown> | null;
  game_session_view?: WebHydratedGameSessionView;
};

function findSessionStartActor(events: VibeGameMessageEnvelopeV1[]): string | null {
  const sorted = [...events].sort((x, y) => x.event_index - y.event_index);
  const start = sorted.find((e) => e.event_type === "session_start");
  return start?.actor_id ?? null;
}

function latestEnvelopeByIndex(events: VibeGameMessageEnvelopeV1[]): VibeGameMessageEnvelopeV1 | null {
  if (!events.length) return null;
  return [...events].sort((a, b) => a.event_index - b.event_index)[events.length - 1] ?? null;
}

function buildSessionView(gameSessionId: string, items: RowEnv[]): WebHydratedGameSessionView | null {
  try {
    if (!items.length) return null;
    const envelopes = items.map((i) => i.envelope);
    const { snapshot, warnings } = foldVibeGameSession(envelopes);
    const rows = [...items.map((i) => i.row)].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    const sortedEnv = [...envelopes].sort((a, b) => a.event_index - b.event_index);
    const lastEv = latestEnvelopeByIndex(envelopes);
    let latestRow = rows[0]!;
    for (const r of rows) {
      if (new Date(r.created_at).getTime() >= new Date(latestRow.created_at).getTime()) latestRow = r;
    }
    return {
      gameSessionId,
      gameType: snapshot.game_type,
      status: snapshot.status,
      foldedSnapshot: snapshot,
      foldWarnings: warnings,
      starterUserId: findSessionStartActor(sortedEnv),
      latestMessageId: latestRow.id,
      latestEventIndex: sortedEnv.length ? sortedEnv[sortedEnv.length - 1]!.event_index : 0,
      lastActorId: lastEv?.actor_id ?? null,
      backingMessageIds: rows.map((r) => r.id),
      createdAt: rows[0]!.created_at,
      updatedAt: rows[rows.length - 1]!.created_at,
    };
  } catch {
    return null;
  }
}

export function collapseVibeGameRowsForWeb(rows: WebChatMessageRow[]): CollapsedMessage[] {
  const groups = new Map<string, RowEnv[]>();
  const emitIndexBySession = new Map<string, number>();

  rows.forEach((row, index) => {
    if (row.message_kind !== "vibe_game") return;
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

  const viewBySession = new Map<string, WebHydratedGameSessionView>();
  for (const [sid, items] of groups) {
    const view = buildSessionView(sid, items);
    if (view) viewBySession.set(sid, view);
  }

  const out: CollapsedMessage[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.message_kind !== "vibe_game") {
      out.push({
        ...row,
        message_kind: toRenderableMessageKind(row.message_kind),
        structured_payload:
          row.structured_payload && typeof row.structured_payload === "object" && !Array.isArray(row.structured_payload)
            ? (row.structured_payload as Record<string, unknown>)
            : null,
      });
      continue;
    }
    const envelope = parseVibeGameEnvelopeFromStructuredPayload(row.structured_payload);
    if (!envelope) {
      // Safe fallback: malformed vibe_game rows render as plain text, never crash chat.
      out.push({
        ...row,
        message_kind: "text",
        structured_payload:
          row.structured_payload && typeof row.structured_payload === "object" && !Array.isArray(row.structured_payload)
            ? (row.structured_payload as Record<string, unknown>)
            : null,
      });
      continue;
    }
    const sid = envelope.game_session_id;
    const canonicalEmitIndex = emitIndexBySession.get(sid);
    if (canonicalEmitIndex === undefined || i !== canonicalEmitIndex) continue;
    const view = viewBySession.get(sid);
    if (!view) {
      out.push({
        ...row,
        message_kind: "text",
        structured_payload:
          row.structured_payload && typeof row.structured_payload === "object" && !Array.isArray(row.structured_payload)
            ? (row.structured_payload as Record<string, unknown>)
            : null,
      });
      continue;
    }
    out.push({
      ...row,
      message_kind: "vibe_game_session",
      structured_payload: null,
      game_session_view: view,
    });
  }
  return out;
}

export function webGamePayloadFromSessionView(view: WebHydratedGameSessionView): GamePayload | null {
  const snap = view.foldedSnapshot;
  const step = snap.status === "complete" ? "completed" : "active";
  if (snap.game_type === "2truths") {
    return {
      gameType: "2truths",
      step,
      data: {
        statements: [...snap.statements],
        lieIndex: snap.lie_index,
        guessedIndex: snap.guessed_index,
        isCorrect: snap.is_correct,
      },
    };
  }
  if (snap.game_type === "would_rather") {
    return {
      gameType: "would_rather",
      step,
      data: {
        optionA: snap.option_a,
        optionB: snap.option_b,
        senderVote: snap.sender_vote,
        receiverVote: snap.receiver_vote,
        isMatch: snap.is_match,
      },
    };
  }
  if (snap.game_type === "charades") {
    return {
      gameType: "charades",
      step,
      data: {
        answer: snap.answer,
        emojis: [...snap.emojis],
        guesses: [...snap.guesses],
        isGuessed: snap.is_guessed,
      },
    };
  }
  if (snap.game_type === "scavenger") {
    return {
      gameType: "scavenger",
      step,
      data: {
        prompt: snap.prompt,
        senderPhotoUrl: snap.sender_photo_url,
        receiverPhotoUrl: snap.receiver_photo_url,
        isUnlocked: snap.is_unlocked === true || snap.status === "complete",
      },
    };
  }
  if (snap.game_type === "roulette") {
    return {
      gameType: "roulette",
      step,
      data: {
        question: snap.question,
        senderAnswer: snap.sender_answer,
        receiverAnswer: snap.receiver_answer,
        isUnlocked: snap.is_unlocked === true || snap.status === "complete",
      },
    };
  }
  if (snap.game_type === "intuition") {
    return {
      gameType: "intuition",
      step,
      data: {
        prediction: snap.options[snap.sender_choice] ?? "",
        options: [snap.options[0], snap.options[1]],
        senderChoice: snap.sender_choice,
        receiverResponse: snap.receiver_result,
      },
    };
  }
  return null;
}
