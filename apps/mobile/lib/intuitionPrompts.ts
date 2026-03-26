import {
  INTUITION_OPTIONS,
  type IntuitionOptionPair,
} from '../../../shared/vibely-games/intuitionPrompts';

export { INTUITION_OPTIONS, type IntuitionOptionPair };

export function randomIntuitionOptions(): IntuitionOptionPair {
  const i = Math.floor(Math.random() * INTUITION_OPTIONS.length);
  return INTUITION_OPTIONS[i] ?? INTUITION_OPTIONS[0];
}
