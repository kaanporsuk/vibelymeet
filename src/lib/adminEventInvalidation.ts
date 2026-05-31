import type { QueryClient } from "@tanstack/react-query";

const ADMIN_EVENT_SURFACE_QUERY_KEYS = [
  ["admin-events"],
  ["events"],
  ["visible-events"],
  ["events-discover"],
  ["other-city-events"],
  ["next-event"],
  ["next-registered-event"],
  ["event-details"],
  ["registered-upcoming-events-invite"],
  ["event-deck"],
] as const;

export function invalidateAdminEventSurfaces(queryClient: QueryClient) {
  for (const queryKey of ADMIN_EVENT_SURFACE_QUERY_KEYS) {
    queryClient.invalidateQueries({ queryKey: [...queryKey] });
  }
}
