export const READY_GATE_DEFAULT_TIMEOUT_SECONDS = 30;

export type ReadyGateExpiry = string | number | null | undefined;

export type ReadyGateRemainingSecondsInput = {
  expiresAt: ReadyGateExpiry;
  fallbackDeadlineMs?: number | null;
  fallbackSeconds?: number;
  nowMs?: number;
};

export function parseReadyGateExpiryMs(rawExpiry: ReadyGateExpiry): number | null {
  if (rawExpiry == null || rawExpiry === "") return null;
  const expiresMs = typeof rawExpiry === "number" ? rawExpiry : Date.parse(String(rawExpiry));
  return Number.isFinite(expiresMs) ? expiresMs : null;
}

export function getReadyGateRemainingSeconds({
  expiresAt,
  fallbackDeadlineMs,
  fallbackSeconds = READY_GATE_DEFAULT_TIMEOUT_SECONDS,
  nowMs = Date.now(),
}: ReadyGateRemainingSecondsInput): number {
  const expiresMs = parseReadyGateExpiryMs(expiresAt);
  const fallbackMs = Number.isFinite(fallbackDeadlineMs) ? Number(fallbackDeadlineMs) : null;
  const deadlineMs = expiresMs ?? fallbackMs;

  if (deadlineMs == null) {
    return Math.max(0, Math.ceil(fallbackSeconds));
  }

  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

export function getReadyGateCountdownProgress(
  remainingSeconds: number,
  timeoutSeconds = READY_GATE_DEFAULT_TIMEOUT_SECONDS,
): number {
  if (!Number.isFinite(remainingSeconds) || !Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, remainingSeconds / timeoutSeconds));
}
