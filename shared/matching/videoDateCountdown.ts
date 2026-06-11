export type StartedAtCountdownArgs = {
  startedAtIso: string | null | undefined;
  durationSeconds: number;
  nowMs?: number;
};

export type VideoDateCountdownPhase = "entry" | "date" | "ended";

export type VideoDatePhaseCountdownArgs = {
  phase: VideoDateCountdownPhase;
  entryStartedAtIso?: string | null;
  dateStartedAtIso?: string | null;
  entryDurationSeconds: number;
  dateDurationSeconds: number;
  dateExtraSeconds?: number | null;
  nowMs?: number;
};

export type VideoDatePhaseCountdown = {
  remainingMs: number | null;
  remainingSeconds: number | null;
  durationMs: number;
  progress: number;
  isFinalTenSeconds: boolean;
  formattedTime: string;
  deadlineMs: number | null;
  hasAuthoritativeStart: boolean;
};

export function formatVideoDateCountdown(seconds: number | null | undefined): string {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? Number(seconds) : 0));
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

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

function normalizedExtraSeconds(raw: number | null | undefined): number {
  return typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
}

function normalizedDurationSeconds(raw: number): number {
  return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
}

export function resolveVideoDatePhaseCountdown({
  phase,
  entryStartedAtIso,
  dateStartedAtIso,
  entryDurationSeconds,
  dateDurationSeconds,
  dateExtraSeconds,
  nowMs,
}: VideoDatePhaseCountdownArgs): VideoDatePhaseCountdown {
  const durationSeconds =
    phase === "date"
      ? normalizedDurationSeconds(dateDurationSeconds) + normalizedExtraSeconds(dateExtraSeconds)
      : phase === "entry"
        ? normalizedDurationSeconds(entryDurationSeconds)
        : 0;
  const durationMs = durationSeconds * 1000;
  const startedAtIso = phase === "date" ? dateStartedAtIso : phase === "entry" ? entryStartedAtIso : null;
  const deadlineMs =
    phase === "ended"
      ? null
      : startedAtCountdownDeadlineMs({
          startedAtIso,
          durationSeconds,
        });

  if (!deadlineMs || durationMs <= 0) {
    const fallbackSeconds = phase === "ended" ? 0 : durationSeconds;
    return {
      remainingMs: phase === "ended" ? 0 : null,
      remainingSeconds: phase === "ended" ? 0 : null,
      durationMs,
      progress: phase === "ended" ? 0 : 1,
      isFinalTenSeconds: false,
      formattedTime: formatVideoDateCountdown(fallbackSeconds),
      deadlineMs: null,
      hasAuthoritativeStart: false,
    };
  }

  const remainingMs = Math.max(0, deadlineMs - (nowMs ?? Date.now()));
  const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const progress = durationMs > 0 ? Math.max(0, Math.min(1, remainingMs / durationMs)) : 0;

  return {
    remainingMs,
    remainingSeconds,
    durationMs,
    progress,
    isFinalTenSeconds: remainingSeconds <= 10,
    formattedTime: formatVideoDateCountdown(remainingSeconds),
    deadlineMs,
    hasAuthoritativeStart: true,
  };
}
