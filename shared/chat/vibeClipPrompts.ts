/**
 * Lightweight, optional conversation sparks for Vibe Clips (capture + reply).
 * Rule-based only — no backend ranking or analytics in this layer.
 */

const CAPTURE_PROMPTS = [
  "Show your vibe in one sentence.",
  "What would our first date look like?",
  "What’s something unexpectedly you?",
  "Say hi like you actually mean it.",
  "Tell them what kind of energy you’re on today.",
] as const;

/** Newer / quieter threads — low-pressure reply ideas */
const REPLY_PROMPTS_EARLY = [
  "Reply with your vibe when it feels right.",
  "Match their energy.",
  "Answer with a voice note if that’s easier.",
  "Turn it into a date idea when you’re ready.",
  "Send a clip back — no rush.",
] as const;

/** More back-and-forth — momentum-focused */
const REPLY_PROMPTS_WARM = [
  "Keep it going with your vibe.",
  "Answer with a voice note or a clip.",
  "Match their energy.",
  "Suggest a date when it clicks.",
  "React, then say what landed.",
] as const;

/** Message count at or above this uses the “warmer” reply pool. */
export const VIBE_CLIP_THREAD_WARM_THRESHOLD = 24;

export function pickRotatingPrompt<T extends readonly string[]>(prompts: T, seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % prompts.length;
  return prompts[idx] as string;
}

export function capturePromptForSeed(seed: string): string {
  return pickRotatingPrompt(CAPTURE_PROMPTS, seed);
}

export function replyPromptForContext(threadMessageCount: number, messageId: string): string {
  const pool =
    threadMessageCount >= VIBE_CLIP_THREAD_WARM_THRESHOLD ? REPLY_PROMPTS_WARM : REPLY_PROMPTS_EARLY;
  return pickRotatingPrompt(pool, `${messageId}|reply`);
}
