export type IntuitionOptionPair = readonly [string, string];

export const INTUITION_OPTIONS: readonly IntuitionOptionPair[] = [
  ['Staying In', 'Going Out'],
  ['Coffee', 'Tea'],
  ['Morning Person', 'Night Owl'],
  ['Sweet', 'Savory'],
  ['Beach', 'Mountains'],
  ['Cats', 'Dogs'],
  ['Books', 'Movies'],
  ['Plan Everything', 'Go With The Flow'],
] as const;
