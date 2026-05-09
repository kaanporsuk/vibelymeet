export const MATCH_MUTE_DURATIONS = ["1hour", "1day", "1week", "forever"] as const;

export type MatchMuteDuration = (typeof MATCH_MUTE_DURATIONS)[number];

export function isMatchMuteDuration(value: unknown): value is MatchMuteDuration {
  return typeof value === "string" && (MATCH_MUTE_DURATIONS as readonly string[]).includes(value);
}

export function getMatchMuteDurationLabel(duration: MatchMuteDuration): string {
  switch (duration) {
    case "1hour":
      return "1 hour";
    case "1day":
      return "1 day";
    case "1week":
      return "1 week";
    case "forever":
      return "indefinitely";
  }
}

export function getMatchMuteDurationOptionLabel(duration: MatchMuteDuration): string {
  switch (duration) {
    case "1hour":
      return "1 Hour";
    case "1day":
      return "1 Day";
    case "1week":
      return "1 Week";
    case "forever":
      return "Until I turn it back on";
  }
}

export function getMatchMuteDurationDescription(duration: MatchMuteDuration): string {
  switch (duration) {
    case "1hour":
      return "Take a quick break";
    case "1day":
      return "Silence for 24 hours";
    case "1week":
      return "A longer pause";
    case "forever":
      return "Mute indefinitely";
  }
}
