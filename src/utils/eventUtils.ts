/**
 * Shared event visibility & expiry utilities.
 * Single source of truth for deciding whether an event is expired,
 * visible, or still in its grace period.
 */

/** Hours after an event ends before it disappears from feeds */
export const GRACE_HOURS = 6;

/** Compute the end time of an event given its start + duration. */
export const getEventEndTime = (event: {
  event_date: string;
  duration_minutes?: number | null;
}): Date => {
  const start = new Date(event.event_date);
  const duration = event.duration_minutes ?? 60; // default 1h
  return new Date(start.getTime() + duration * 60 * 1000);
};

/** True when the event's actual duration has elapsed. */
export const isEventExpired = (event: {
  event_date: string;
  duration_minutes?: number | null;
}): boolean => {
  return getEventEndTime(event) < new Date();
};

/** True when the event is currently live. */
export const isEventLive = (event: {
  event_date: string;
  duration_minutes?: number | null;
}): boolean => {
  const now = new Date();
  const start = new Date(event.event_date);
  return now >= start && now < getEventEndTime(event);
};

/**
 * True when the event should still appear in user-facing feeds.
 * Includes upcoming, live, and recently-ended events within the grace window.
 * Excludes cancelled/draft events.
 */
export const isEventVisible = (event: {
  event_date: string;
  duration_minutes?: number | null;
  status?: string | null;
}): boolean => {
  if (event.status === 'cancelled' || event.status === 'draft') return false;
  const graceEnd = new Date(
    getEventEndTime(event).getTime() + GRACE_HOURS * 60 * 60 * 1000
  );
  return graceEnd > new Date();
};
