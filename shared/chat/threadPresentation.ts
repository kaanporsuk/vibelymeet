/**
 * Presentation-only helpers for chat thread: collapse repeated pending games and
 * quiet older terminal date rows. Does not mutate message data or backend state.
 */

const STALE_DATE_TERMINAL_STATUSES = new Set([
  "declined",
  "expired",
  "cancelled",
  "not_now",
]);

export type DateCardThreadUi = "normal" | "quiet_stale" | "quiet_completed";

export type ThreadPresentationRow<T> =
  | { type: "message"; message: T; dateUi: DateCardThreadUi }
  | {
      type: "pending_games_summary";
      clusterKey: string;
      hidden: T[];
      primary: T;
    }
  /** Shown above an expanded pending-game run so the thread can be collapsed again. */
  | { type: "pending_games_collapse"; clusterKey: string; hiddenCount: number };

function lastMessageIdMatching<T>(
  messages: T[],
  pred: (m: T) => boolean,
): string | null {
  let last: string | null = null;
  for (const m of messages) {
    const id = (m as { id: string }).id;
    if (pred(m)) last = id;
  }
  return last;
}

function computeLastStaleDateMessageId<T>(
  messages: T[],
  isDateTimeline: (m: T) => boolean,
  getRefId: (m: T) => string | null | undefined,
  suggestionStatus: (refId: string) => string | undefined,
): string | null {
  return lastMessageIdMatching(messages, (m) => {
    if (!isDateTimeline(m)) return false;
    const ref = getRefId(m);
    if (!ref) return false;
    const st = suggestionStatus(ref);
    return !!st && STALE_DATE_TERMINAL_STATUSES.has(st);
  });
}

function computeLastCompletedDateMessageId<T>(
  messages: T[],
  isDateTimeline: (m: T) => boolean,
  getRefId: (m: T) => string | null | undefined,
  suggestionStatus: (refId: string) => string | undefined,
): string | null {
  return lastMessageIdMatching(messages, (m) => {
    if (!isDateTimeline(m)) return false;
    const ref = getRefId(m);
    if (!ref) return false;
    return suggestionStatus(ref) === "completed";
  });
}

function pendingClusterKey<T>(run: T[]): string {
  const last = run[run.length - 1] as { id: string };
  return `pending-games-${last.id}`;
}

/**
 * Builds ordered presentation rows. When consecutive pending-game messages appear,
 * collapses all but the last into a single summary row (unless expandedPendingKey matches).
 */
export function buildThreadPresentationRows<T>(messages: T[], opts: {
  isDateTimeline: (m: T) => boolean;
  getRefId: (m: T) => string | null | undefined;
  suggestionStatus: (refId: string) => string | undefined;
  isPendingGame: (m: T) => boolean;
  expandedPendingKey: string | null;
}): ThreadPresentationRow<T>[] {
  const {
    isDateTimeline,
    getRefId,
    suggestionStatus,
    isPendingGame,
    expandedPendingKey,
  } = opts;

  const lastStaleId = computeLastStaleDateMessageId(
    messages,
    isDateTimeline,
    getRefId,
    suggestionStatus,
  );
  const lastCompletedId = computeLastCompletedDateMessageId(
    messages,
    isDateTimeline,
    getRefId,
    suggestionStatus,
  );

  const out: ThreadPresentationRow<T>[] = [];
  let i = 0;
  const n = messages.length;

  const pushMessage = (m: T) => {
    const id = (m as { id: string }).id;
    let dateUi: DateCardThreadUi = "normal";
    if (isDateTimeline(m)) {
      const ref = getRefId(m);
      if (ref) {
        const st = suggestionStatus(ref);
        if (st && STALE_DATE_TERMINAL_STATUSES.has(st) && id !== lastStaleId) {
          dateUi = "quiet_stale";
        } else if (st === "completed" && id !== lastCompletedId) {
          dateUi = "quiet_completed";
        }
      }
    }
    out.push({ type: "message", message: m, dateUi });
  };

  while (i < n) {
    const m = messages[i];
    if (isPendingGame(m)) {
      let j = i + 1;
      while (j < n && isPendingGame(messages[j]!)) j++;
      const run = messages.slice(i, j);
      if (run.length > 1) {
        const key = pendingClusterKey(run);
        if (expandedPendingKey === key) {
          out.push({
            type: "pending_games_collapse",
            clusterKey: key,
            hiddenCount: run.length - 1,
          });
          for (const x of run) pushMessage(x);
        } else {
          out.push({
            type: "pending_games_summary",
            clusterKey: key,
            hidden: run.slice(0, -1),
            primary: run[run.length - 1]!,
          });
          pushMessage(run[run.length - 1]!);
        }
      } else {
        pushMessage(m);
      }
      i = j;
      continue;
    }

    pushMessage(m);
    i++;
  }

  return out;
}
