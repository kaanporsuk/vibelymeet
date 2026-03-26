import { SCAVENGER_PROMPTS } from '../../../shared/vibely-games/scavengerPrompts';

export { SCAVENGER_PROMPTS };

export function randomScavengerPrompt(): string {
  const i = Math.floor(Math.random() * SCAVENGER_PROMPTS.length);
  return SCAVENGER_PROMPTS[i] ?? SCAVENGER_PROMPTS[0];
}
