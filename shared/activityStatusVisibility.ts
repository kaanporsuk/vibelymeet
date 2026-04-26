export const ACTIVITY_STATUS_VISIBILITIES = [
  "matches",
  "event_connections",
  "nobody",
] as const;

export type ActivityStatusVisibility = (typeof ACTIVITY_STATUS_VISIBILITIES)[number];

export function normalizeActivityStatusVisibility(value: unknown): ActivityStatusVisibility {
  return ACTIVITY_STATUS_VISIBILITIES.includes(value as ActivityStatusVisibility)
    ? (value as ActivityStatusVisibility)
    : "matches";
}

export function getActivityVisibilityLabel(value: unknown): string {
  switch (normalizeActivityStatusVisibility(value)) {
    case "event_connections":
      return "Event connections";
    case "nobody":
      return "Nobody";
    case "matches":
    default:
      return "Matches only";
  }
}

export function getActivityVisibilityDescription(value: unknown): string {
  switch (normalizeActivityStatusVisibility(value)) {
    case "event_connections":
      return "Your matches and people connected to you through an active event can see your activity where Vibely shows event presence.";
    case "nobody":
      return "Hide your active and last-seen status from other people.";
    case "matches":
    default:
      return "Only your matches can see when you were recently active.";
  }
}

export function hasRenderablePresence(lastSeenAt: string | null | undefined): boolean {
  if (lastSeenAt == null || lastSeenAt.trim() === "") return false;
  return Number.isFinite(new Date(lastSeenAt).getTime());
}
