import { resolveEventLifecycle } from '@clientShared/eventLifecycle';

export type NativeEventPhase = 'pre-live' | 'live' | 'ended';

export type EventPhaseInput = {
  eventDate: Date | string | number;
  eventDurationMinutes?: number | null;
  status?: string | null;
  endedAt?: Date | string | number | null;
  ended_at?: Date | string | number | null;
  nowMs?: number;
};

export type EventPhaseSnapshot = {
  phase: NativeEventPhase;
  startMs: number;
  endMs: number;
  nowMs: number;
  msUntilStart: number;
  msUntilEnd: number;
  isPreLive: boolean;
  isLive: boolean;
  isEnded: boolean;
  isLobbyOpen: boolean;
};

export type CountdownParts = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

function toTimestampMs(value: Date | string | number): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return new Date(value).getTime();
}

export function deriveEventPhase(input: EventPhaseInput): EventPhaseSnapshot {
  const lifecycle = resolveEventLifecycle({
    status: input.status,
    eventDate: input.eventDate,
    durationMinutes: input.eventDurationMinutes,
    endedAt: input.endedAt ?? input.ended_at,
    nowMs: input.nowMs,
  });
  const startMs = lifecycle.startsAt?.getTime() ?? toTimestampMs(input.eventDate);
  const durationMinutes = input.eventDurationMinutes ?? 60;
  const endMs = lifecycle.endsAt?.getTime() ?? startMs + Math.max(1, durationMinutes) * 60 * 1000;
  const nowMs = input.nowMs ?? Date.now();

  const isEnded = lifecycle.isEnded;
  const isLive = lifecycle.isLive;
  const isPreLive = lifecycle.lifecycle === 'upcoming' || lifecycle.lifecycle === 'draft' || lifecycle.lifecycle === 'cancelled';

  return {
    phase: isEnded ? 'ended' : isLive ? 'live' : 'pre-live',
    startMs,
    endMs,
    nowMs,
    msUntilStart: Math.max(0, startMs - nowMs),
    msUntilEnd: Math.max(0, endMs - nowMs),
    isPreLive,
    isLive,
    isEnded,
    isLobbyOpen: isLive,
  };
}

export function getCountdownParts(ms: number): CountdownParts {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

export function formatVenuePhaseLabel(phase: EventPhaseSnapshot): string {
  if (phase.isEnded) return 'Event ended';
  if (phase.isLive) {
    const remainingMinutes = Math.max(1, Math.ceil(phase.msUntilEnd / 60000));
    return `${remainingMinutes}m remaining`;
  }

  const totalMinutes = Math.max(0, Math.floor(phase.msUntilStart / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
