export type IntuitionOptionPair = readonly [string, string];

// Mirrors current web arcade options for Intuition.
const INTUITION_OPTIONS: readonly IntuitionOptionPair[] = [
  ['Staying In', 'Going Out'],
  ['Coffee', 'Tea'],
  ['Morning Person', 'Night Owl'],
  ['Sweet', 'Savory'],
  ['Beach', 'Mountains'],
  ['Cats', 'Dogs'],
  ['Books', 'Movies'],
  ['Plan Everything', 'Go With The Flow'],
] as const;

export function randomIntuitionOptions(): IntuitionOptionPair {
  const i = Math.floor(Math.random() * INTUITION_OPTIONS.length);
  return INTUITION_OPTIONS[i] ?? INTUITION_OPTIONS[0];
}
