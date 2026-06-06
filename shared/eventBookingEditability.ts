import { resolveEventLifecycle, type EventLifecycle, type EventLifecycleInput } from "./eventLifecycle";

export type EventSelfCancelClosedReason =
  | "missing_start"
  | "draft"
  | "cancelled"
  | "archived"
  | "completed"
  | "ended"
  | "started";

export type EventBookingEditabilityInput = EventLifecycleInput & {
  archivedAt?: Date | string | number | null;
  archived_at?: Date | string | number | null;
};

export type EventBookingEditabilitySnapshot = {
  canSelfCancel: boolean;
  closedReason: EventSelfCancelClosedReason | null;
  lifecycle: EventLifecycle;
  startsAt: Date | null;
  nowMs: number;
};

function hasValue(value: Date | string | number | null | undefined): boolean {
  return value !== null && value !== undefined && value !== "";
}

export function resolveEventBookingEditability(
  input: EventBookingEditabilityInput,
): EventBookingEditabilitySnapshot {
  const nowMs = input.nowMs ?? Date.now();
  const rawStatus = (input.status ?? "").trim().toLowerCase();
  const lifecycle = resolveEventLifecycle({ ...input, nowMs });

  let closedReason: EventSelfCancelClosedReason | null = null;

  if (!lifecycle.startsAt) {
    closedReason = "missing_start";
  } else if (rawStatus === "draft") {
    closedReason = "draft";
  } else if (rawStatus === "cancelled") {
    closedReason = "cancelled";
  } else if (rawStatus === "completed") {
    closedReason = "completed";
  } else if (rawStatus === "archived" || lifecycle.isArchived || hasValue(input.archivedAt ?? input.archived_at)) {
    closedReason = "archived";
  } else if (rawStatus === "ended" || hasValue(input.endedAt ?? input.ended_at) || lifecycle.isEnded) {
    closedReason = "ended";
  } else if (rawStatus === "live") {
    closedReason = "started";
  } else if (nowMs >= lifecycle.startsAt.getTime()) {
    closedReason = "started";
  }

  return {
    canSelfCancel: closedReason === null,
    closedReason,
    lifecycle: lifecycle.lifecycle,
    startsAt: lifecycle.startsAt,
    nowMs,
  };
}
