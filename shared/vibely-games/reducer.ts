import type {
  CharadesSnapshot,
  EmptySnapshot,
  IntuitionSnapshot,
  RouletteSnapshot,
  ScavengerSnapshot,
  TwoTruthsSnapshot,
  VibeGameFoldResult,
  VibeGameMessageEnvelopeV1,
  VibeGameSnapshotV1,
  WouldRatherSnapshot,
} from "./types";

function emptySnapshot(): EmptySnapshot {
  return { game_type: null, status: "empty" };
}

/** Normalize for charades matching (aligned with simple server check). */
export function normalizeGuess(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function charadesGuessMatches(answer: string, guess: string): boolean {
  const a = normalizeGuess(answer);
  const g = normalizeGuess(guess);
  if (!a || !g) return false;
  return a === g || a.includes(g) || g.includes(a);
}

/**
 * Fold append-only events for one game_session_id (pre-sorted by event_index ascending).
 */
export function foldVibeGameSession(
  events: VibeGameMessageEnvelopeV1[]
): VibeGameFoldResult {
  const warnings: string[] = [];
  let snapshot: VibeGameSnapshotV1 = emptySnapshot();

  const sorted = [...events].sort((a, b) => a.event_index - b.event_index);

  for (let i = 0; i < sorted.length; i++) {
    const ev = sorted[i]!;
    if (i > 0 && sorted[i - 1]!.event_index >= ev.event_index) {
      warnings.push("non_monotonic_event_index_in_input");
    }

    switch (ev.event_type) {
      case "session_start": {
        const p = ev.payload as Record<string, unknown>;
        switch (ev.game_type) {
          case "2truths": {
            const st = p.statements as string[];
            const li = p.lie_index as number;
            snapshot = {
              game_type: "2truths",
              status: "active",
              statements: [st[0]!, st[1]!, st[2]!],
              lie_index: li as 0 | 1 | 2,
            };
            break;
          }
          case "would_rather":
            snapshot = {
              game_type: "would_rather",
              status: "active",
              option_a: String(p.option_a),
              option_b: String(p.option_b),
              sender_vote: p.sender_vote as "A" | "B",
            };
            break;
          case "charades":
            snapshot = {
              game_type: "charades",
              status: "active",
              answer: String(p.answer),
              emojis: Array.isArray(p.emojis) ? (p.emojis as string[]) : [],
              guesses: [],
            };
            break;
          case "scavenger":
            snapshot = {
              game_type: "scavenger",
              status: "active",
              prompt: String(p.prompt),
              sender_photo_url: String(p.sender_photo_url),
            };
            break;
          case "roulette":
            snapshot = {
              game_type: "roulette",
              status: "active",
              question: String(p.question),
              sender_answer: String(p.sender_answer),
            };
            break;
          case "intuition":
            snapshot = {
              game_type: "intuition",
              status: "active",
              options: [String((p.options as string[])[0]), String((p.options as string[])[1])] as [
                string,
                string,
              ],
              sender_choice: p.sender_choice as 0 | 1,
            };
            break;
          default:
            warnings.push("unknown_game_type_session_start");
        }
        break;
      }
      case "two_truths_guess": {
        if (snapshot.game_type !== "2truths") break;
        const s: TwoTruthsSnapshot = snapshot;
        const gi = (ev.payload as { guess_index: number }).guess_index as 0 | 1 | 2;
        snapshot = {
          game_type: "2truths",
          status: "complete",
          statements: s.statements,
          lie_index: s.lie_index,
          guessed_index: gi,
          is_correct: gi === s.lie_index,
        };
        break;
      }
      case "would_rather_vote": {
        if (snapshot.game_type !== "would_rather") break;
        const s: WouldRatherSnapshot = snapshot;
        const rv = (ev.payload as { receiver_vote: "A" | "B" }).receiver_vote;
        snapshot = {
          game_type: "would_rather",
          status: "complete",
          option_a: s.option_a,
          option_b: s.option_b,
          sender_vote: s.sender_vote,
          receiver_vote: rv,
          is_match: s.sender_vote === rv,
        };
        break;
      }
      case "charades_guess": {
        if (snapshot.game_type !== "charades") break;
        const s: CharadesSnapshot = snapshot;
        const guess = String((ev.payload as { guess: string }).guess);
        const nextGuesses: string[] = [...s.guesses, guess];
        const hit = charadesGuessMatches(s.answer, guess);
        snapshot = {
          game_type: "charades",
          status: hit ? "complete" : "active",
          answer: s.answer,
          emojis: s.emojis,
          guesses: nextGuesses,
          is_guessed: hit,
        };
        break;
      }
      case "scavenger_photo": {
        if (snapshot.game_type !== "scavenger") break;
        const s: ScavengerSnapshot = snapshot;
        const url = String((ev.payload as { receiver_photo_url: string }).receiver_photo_url);
        snapshot = {
          game_type: "scavenger",
          status: "complete",
          prompt: s.prompt,
          sender_photo_url: s.sender_photo_url,
          receiver_photo_url: url,
          is_unlocked: true,
        };
        break;
      }
      case "roulette_answer": {
        if (snapshot.game_type !== "roulette") break;
        const s: RouletteSnapshot = snapshot;
        snapshot = {
          game_type: "roulette",
          status: "complete",
          question: s.question,
          sender_answer: s.sender_answer,
          receiver_answer: String((ev.payload as { receiver_answer: string }).receiver_answer),
          is_unlocked: true,
        };
        break;
      }
      case "intuition_result": {
        if (snapshot.game_type !== "intuition") break;
        const s: IntuitionSnapshot = snapshot;
        snapshot = {
          game_type: "intuition",
          status: "complete",
          options: s.options,
          sender_choice: s.sender_choice,
          receiver_result: (ev.payload as { result: "correct" | "wrong" }).result,
        };
        break;
      }
      case "session_complete": {
        if (snapshot.status === "empty") break;
        const st = snapshot.status;
        if (st === "complete") break;
        if (snapshot.game_type === "2truths") {
          const s: TwoTruthsSnapshot = snapshot;
          snapshot = { ...s, status: "complete" };
        } else if (snapshot.game_type === "would_rather") {
          const s: WouldRatherSnapshot = snapshot;
          snapshot = { ...s, status: "complete" };
        } else if (snapshot.game_type === "charades") {
          const s: CharadesSnapshot = snapshot;
          snapshot = { ...s, status: "complete" };
        } else if (snapshot.game_type === "scavenger") {
          const s: ScavengerSnapshot = snapshot;
          snapshot = { ...s, status: "complete" };
        } else if (snapshot.game_type === "roulette") {
          const s: RouletteSnapshot = snapshot;
          snapshot = { ...s, status: "complete" };
        } else if (snapshot.game_type === "intuition") {
          const s: IntuitionSnapshot = snapshot;
          snapshot = { ...s, status: "complete" };
        }
        break;
      }
      default:
        warnings.push(`unhandled_event:${ev.event_type}`);
    }
  }

  return { snapshot, warnings };
}
