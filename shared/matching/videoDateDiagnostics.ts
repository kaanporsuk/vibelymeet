export const VIDEO_DATE_JOURNEY_EVENT_PREFIX = "video_date_journey_";

export const VIDEO_DATE_JOURNEY_EVENTS = {
  READY_GATE_OPENED: "ready_gate_opened",
  READY_GATE_DISMISSED: "ready_gate_dismissed",
  READY_GATE_FORFEITED: "ready_gate_forfeited",
  READY_GATE_INVALIDATED: "ready_gate_invalidated",
  READY_GATE_BOTH_READY_HANDOFF_STARTED: "ready_gate_both_ready_handoff_started",
  DATE_ROUTE_ENTERED: "date_route_entered",
  DATE_ROUTE_BOUNCED: "date_route_bounced",
  DATE_ROUTE_RECOVERED: "date_route_recovered",
  SURVEY_OPENED: "survey_opened",
  SURVEY_RECOVERED: "survey_recovered",
  SURVEY_LOST_PREVENTED: "survey_lost_prevented",
  SURVEY_COMPLETED: "survey_completed",
  MUTUAL_MATCH_DETECTED: "mutual_match_detected",
  CHAT_CTA_PRESSED: "chat_cta_pressed",
} as const;

export type VideoDateJourneyEvent =
  (typeof VIDEO_DATE_JOURNEY_EVENTS)[keyof typeof VIDEO_DATE_JOURNEY_EVENTS];

export type VideoDateJourneyPlatform = "web" | "native";

export type VideoDateJourneyBasePayload = {
  platform: VideoDateJourneyPlatform;
  session_id: string | null | undefined;
  event_id: string | null | undefined;
};

export function getVideoDateJourneyEventName(event: VideoDateJourneyEvent): string {
  return `${VIDEO_DATE_JOURNEY_EVENT_PREFIX}${event}`;
}

export const VIDEO_DATE_RECONNECT_SYNC_OUTCOMES = {
  OK: "ok",
  ENDED: "ended",
  RPC_ERROR: "rpc_error",
} as const;

export type VideoDateReconnectSyncOutcome =
  (typeof VIDEO_DATE_RECONNECT_SYNC_OUTCOMES)[keyof typeof VIDEO_DATE_RECONNECT_SYNC_OUTCOMES];

