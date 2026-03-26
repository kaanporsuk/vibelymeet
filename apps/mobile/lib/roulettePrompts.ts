import { ROULETTE_QUESTIONS } from '../../../shared/vibely-games/roulettePrompts';

export { ROULETTE_QUESTIONS };

export function randomRouletteQuestion(): string {
  const i = Math.floor(Math.random() * ROULETTE_QUESTIONS.length);
  return ROULETTE_QUESTIONS[i] ?? ROULETTE_QUESTIONS[0];
}
