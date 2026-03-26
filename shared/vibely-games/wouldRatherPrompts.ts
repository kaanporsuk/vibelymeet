/**
 * Canonical Would You Rather prompt pairs (persisted payload uses snake_case keys).
 * Kept in shared so native + web draw from the same bank without duplicating strings.
 */

export type WouldRatherPromptPair = {
  option_a: string;
  option_b: string;
};

/** Same content previously lived in `src/types/games.ts` as WOULD_RATHER_OPTIONS. */
export const WOULD_RATHER_PROMPT_PAIRS: ReadonlyArray<WouldRatherPromptPair> = [
  { option_a: "Travel to the past", option_b: "Travel to the future" },
  { option_a: "Read minds", option_b: "Be invisible" },
  { option_a: "Live in the city", option_b: "Live in the countryside" },
  { option_a: "Always be early", option_b: "Always be late" },
  { option_a: "Have unlimited money", option_b: "Have unlimited time" },
  { option_a: "Never use social media", option_b: "Never watch TV" },
  { option_a: "Be a famous musician", option_b: "Be a famous actor" },
  { option_a: "Have breakfast for dinner", option_b: "Have dinner for breakfast" },
];

export function randomWouldRatherPrompt(): WouldRatherPromptPair {
  const i = Math.floor(Math.random() * WOULD_RATHER_PROMPT_PAIRS.length);
  return WOULD_RATHER_PROMPT_PAIRS[i]!;
}
