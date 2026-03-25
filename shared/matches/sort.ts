export const MATCHES_CONVERSATION_SORT_STORAGE_KEY = "vibely_matches_conversation_sort_v1";

export type ConversationSortOption = "recent" | "needsReply" | "best";

type SortableConversationRow = {
  matchId: string;
  unread: boolean;
  bestMatchScore: number;
};

export function parseStoredConversationSort(raw: string | null): ConversationSortOption {
  if (!raw) return "recent";
  if (raw === "recent" || raw === "needsReply" || raw === "best") return raw;
  if (raw === "unread") return "needsReply";
  if (raw === "compatibility") return "best";
  return "recent";
}

export function conversationSortShortLabel(mode: ConversationSortOption): string {
  switch (mode) {
    case "needsReply":
      return "Needs Reply";
    case "best":
      return "Best Match";
    default:
      return "Recent";
  }
}

export function orderIndexByMatchId(rows: readonly { matchId: string }[]): Map<string, number> {
  const map = new Map<string, number>();
  rows.forEach((row, i) => map.set(row.matchId, i));
  return map;
}

export function sortConversations<T extends SortableConversationRow>(
  rows: readonly T[],
  mode: ConversationSortOption,
  recentOrder: ReadonlyMap<string, number>
): T[] {
  const list = [...rows];
  const tieRecent = (a: T, b: T) =>
    (recentOrder.get(a.matchId) ?? 0) - (recentOrder.get(b.matchId) ?? 0);

  switch (mode) {
    case "needsReply":
      list.sort((a, b) => {
        const du = (b.unread ? 1 : 0) - (a.unread ? 1 : 0);
        return du !== 0 ? du : tieRecent(a, b);
      });
      break;
    case "best":
      list.sort((a, b) => {
        const ds = b.bestMatchScore - a.bestMatchScore;
        return ds !== 0 ? ds : tieRecent(a, b);
      });
      break;
    default:
      list.sort(tieRecent);
      break;
  }

  return list;
}
