export const EVENT_ATTENDANCE_VISIBILITIES = [
  "attendees",
  "matches_only",
  "hidden",
] as const;

export type EventAttendanceVisibility = (typeof EVENT_ATTENDANCE_VISIBILITIES)[number];

export function isEventAttendanceVisibility(value: unknown): value is EventAttendanceVisibility {
  return (
    typeof value === "string" &&
    EVENT_ATTENDANCE_VISIBILITIES.includes(value as EventAttendanceVisibility)
  );
}
