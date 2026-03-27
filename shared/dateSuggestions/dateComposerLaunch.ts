/**
 * Client-only context for where the date-suggestion composer was opened from.
 * Does not persist to the backend — keeps existing date_suggestion semantics unchanged.
 */
export type DateComposerLaunchSource = "vibe_clip" | "default";

export const CLIP_DATE_COMPOSER_PILL = "From this Vibe Clip";

export const CLIP_DATE_COMPOSER_SUBCOPY =
  "You connected through video — propose something real while the spark is fresh.";

/** Micro-hint under the clip’s “Suggest a date” affordance (not inside the composer). */
export const CLIP_DATE_ACTION_HINT = "Turn the moment into plans";
