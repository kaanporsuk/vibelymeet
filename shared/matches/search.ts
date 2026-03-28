export type SearchHitKind = "name" | "vibe" | "intent" | "location" | "event" | "message" | null;

export type SearchableMatch = {
  name?: string | null;
  vibes?: string[] | null;
  looking_for?: string | null;
  location?: string | null;
  eventName?: string | null;
  lastMessage?: string | null;
  /** When set, used for “matched on message” instead of `lastMessage` (structured preview search tokens). */
  messageSearchHaystack?: string | null;
};

type IntentHaystackBuilder = (lookingFor: string) => string;

function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function getMatchSearchHitKind(
  match: SearchableMatch,
  query: string,
  buildIntentHaystack: IntentHaystackBuilder
): SearchHitKind {
  const q = normalizeSearchText(query);
  if (!q) return null;
  if (normalizeSearchText(match.name).includes(q)) return "name";
  if ((match.vibes ?? []).some((v) => normalizeSearchText(v).includes(q))) return "vibe";
  if (normalizeSearchText(buildIntentHaystack(match.looking_for ?? "")).includes(q)) return "intent";
  if (normalizeSearchText(match.location).includes(q)) return "location";
  if (normalizeSearchText(match.eventName).includes(q)) return "event";
  const messageHaystack = normalizeSearchText(match.messageSearchHaystack ?? match.lastMessage);
  if (messageHaystack.includes(q)) return "message";
  return null;
}

export function matchPassesClientSearch(
  match: SearchableMatch,
  query: string,
  buildIntentHaystack: IntentHaystackBuilder
): boolean {
  return getMatchSearchHitKind(match, query, buildIntentHaystack) !== null;
}
