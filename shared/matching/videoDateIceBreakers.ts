export const VIDEO_DATE_ICE_BREAKER_ROTATION_MS = 8_000;
export const VIDEO_DATE_ICE_BREAKER_MANUAL_PAUSE_MS = 10_000;
export const VIDEO_DATE_ICE_BREAKER_MAX_QUESTIONS = 8;
export const VIDEO_DATE_ICE_BREAKER_MAX_LENGTH = 240;

export const VIDEO_DATE_ICE_BREAKER_PROMPTS = [
  "What's a weird talent you have? 🎭",
  "Dream travel destination? ✈️",
  "What's your go-to karaoke song? 🎤",
  "Best date you've ever been on? 💫",
  "What's something that instantly makes you smile? 😊",
  "If you could have dinner with anyone, who? 🍽️",
  "What's your love language? 💕",
  "Describe your perfect lazy Sunday ☀️",
  "What's on your bucket list? ✨",
  "What makes you feel most alive? 🔥",
  "Early bird or night owl? 🦉",
  "What's your comfort movie? 🎬",
  "Beach vacation or mountain adventure? 🏔️",
  "What are you passionate about? 💜",
  "What's your hidden gem restaurant? 🍜",
] as const;

export type VideoDateIceBreakerState = {
  questions: string[];
  questionIndex: number;
  questionAnchorAt: string | null;
};

export function normalizeVideoDateIceBreakerQuestions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const question = value.trim();
    if (!question || question.length > VIDEO_DATE_ICE_BREAKER_MAX_LENGTH) continue;
    const dedupeKey = question.toLocaleLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(question);
    if (out.length >= VIDEO_DATE_ICE_BREAKER_MAX_QUESTIONS) break;
  }
  return out;
}

export function shuffleVideoDateIceBreakerQuestions(
  questions: readonly string[] = VIDEO_DATE_ICE_BREAKER_PROMPTS,
  random: () => number = Math.random,
): string[] {
  const result = [...questions];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result.slice(0, VIDEO_DATE_ICE_BREAKER_MAX_QUESTIONS);
}

export function normalizeVideoDateIceBreakerIndex(index: unknown, questionCount: number): number {
  if (questionCount <= 0) return 0;
  const raw = typeof index === "number" && Number.isFinite(index) ? Math.floor(index) : 0;
  return ((raw % questionCount) + questionCount) % questionCount;
}

export function resolveVideoDateIceBreakerIndex(
  questionCount: number,
  questionIndex: unknown,
  questionAnchorAt: string | null | undefined,
  nowMs: number = Date.now(),
  rotationMs: number = VIDEO_DATE_ICE_BREAKER_ROTATION_MS,
): number {
  if (questionCount <= 0) return 0;

  const baseIndex = normalizeVideoDateIceBreakerIndex(questionIndex, questionCount);
  const anchorMs = questionAnchorAt ? Date.parse(questionAnchorAt) : Number.NaN;
  if (!Number.isFinite(anchorMs) || !Number.isFinite(nowMs) || rotationMs <= 0) {
    return baseIndex;
  }

  const elapsedSteps = Math.max(0, Math.floor((nowMs - anchorMs) / rotationMs));
  return normalizeVideoDateIceBreakerIndex(baseIndex + elapsedSteps, questionCount);
}

export function fallbackVideoDateIceBreakerState(): VideoDateIceBreakerState {
  return {
    questions: shuffleVideoDateIceBreakerQuestions(),
    questionIndex: 0,
    questionAnchorAt: new Date().toISOString(),
  };
}
