export const VIDEO_DATE_MICRO_VERDICT_SECONDS = 30;

export function getVideoDateMicroVerdictRemainingSeconds(
  openedAtMs: number,
  nowMs: number,
  timeoutSeconds = VIDEO_DATE_MICRO_VERDICT_SECONDS,
): number {
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - openedAtMs) / 1000));
  return Math.max(0, timeoutSeconds - elapsedSeconds);
}

export function getVideoDateMicroVerdictCopy(remainingSeconds: number): string {
  if (remainingSeconds > 0) {
    return `Choose when ready. We will keep this moving in ${remainingSeconds}s.`;
  }
  return "You can still answer. We will guide you back to the lobby after this check-in.";
}
