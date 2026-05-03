export type StartedAtCountdownArgs = {
  startedAtIso: string | null | undefined;
  durationSeconds: number;
  nowMs?: number;
};

export function remainingStartedAtCountdownSeconds({
  startedAtIso,
  durationSeconds,
  nowMs,
}: StartedAtCountdownArgs): number | null {
  if (!startedAtIso || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;

  const startedAtMs = Date.parse(startedAtIso);
  if (!Number.isFinite(startedAtMs)) return null;

  const elapsedSeconds = ((nowMs ?? Date.now()) - startedAtMs) / 1000;
  return Math.max(0, Math.ceil(durationSeconds - elapsedSeconds));
}

export function startedAtCountdownDeadlineMs({
  startedAtIso,
  durationSeconds,
}: StartedAtCountdownArgs): number | null {
  if (!startedAtIso || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;

  const startedAtMs = Date.parse(startedAtIso);
  if (!Number.isFinite(startedAtMs)) return null;

  return startedAtMs + durationSeconds * 1000;
}
