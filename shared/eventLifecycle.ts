export type EventLifecycle = "draft" | "cancelled" | "upcoming" | "live" | "ended";

export type EventLifecycleInput = {
  status?: string | null;
  eventDate?: Date | string | number | null;
  event_date?: Date | string | number | null;
  durationMinutes?: number | null;
  duration_minutes?: number | null;
  endedAt?: Date | string | number | null;
  ended_at?: Date | string | number | null;
  nowMs?: number;
};

export type EventLifecycleSnapshot = {
  lifecycle: EventLifecycle;
  isLive: boolean;
  isEnded: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  timeRemainingMs: number | null;
};

const DEFAULT_EVENT_DURATION_MINUTES = 60;

function toTimestampMs(value: Date | string | number | null | undefined): number {
  if (value == null) return Number.NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return new Date(value).getTime();
}

function toDate(value: number): Date | null {
  return Number.isFinite(value) ? new Date(value) : null;
}

function normalizeDurationMinutes(input: EventLifecycleInput): number {
  const duration = input.durationMinutes ?? input.duration_minutes ?? DEFAULT_EVENT_DURATION_MINUTES;
  return Number.isFinite(duration) ? duration : DEFAULT_EVENT_DURATION_MINUTES;
}

export function resolveEventLifecycle(input: EventLifecycleInput): EventLifecycleSnapshot {
  const nowMs = input.nowMs ?? Date.now();
  const rawStatus = (input.status ?? "").toLowerCase();
  const startsAtMs = toTimestampMs(input.eventDate ?? input.event_date);
  const durationMinutes = normalizeDurationMinutes(input);
  const endsAtMs = Number.isFinite(startsAtMs)
    ? startsAtMs + durationMinutes * 60_000
    : Number.NaN;
  const endedAtMs = toTimestampMs(input.endedAt ?? input.ended_at);
  const startsAt = toDate(startsAtMs);
  const endsAt = toDate(endsAtMs);

  let lifecycle: EventLifecycle;
  if (rawStatus === "draft") {
    lifecycle = "draft";
  } else if (rawStatus === "cancelled") {
    lifecycle = "cancelled";
  } else if (Number.isFinite(endedAtMs)) {
    lifecycle = "ended";
  } else if (Number.isFinite(startsAtMs) && Number.isFinite(endsAtMs) && nowMs >= startsAtMs && nowMs < endsAtMs) {
    lifecycle = "live";
  } else if (Number.isFinite(endsAtMs) && nowMs >= endsAtMs) {
    lifecycle = "ended";
  } else {
    lifecycle = "upcoming";
  }

  const timeRemainingMs =
    lifecycle === "live" && Number.isFinite(endsAtMs)
      ? Math.max(0, endsAtMs - nowMs)
      : lifecycle === "upcoming" && Number.isFinite(startsAtMs)
        ? Math.max(0, startsAtMs - nowMs)
        : lifecycle === "ended"
          ? 0
          : null;

  return {
    lifecycle,
    isLive: lifecycle === "live",
    isEnded: lifecycle === "ended",
    startsAt,
    endsAt,
    timeRemainingMs,
  };
}

