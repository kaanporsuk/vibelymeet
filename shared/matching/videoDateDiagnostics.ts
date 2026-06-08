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

export type VideoDateCertificationSurfaceOwner =
  | "lobby"
  | "ready_gate"
  | "date"
  | "survey"
  | "unknown";

export type VideoDateCertificationTokenState =
  | "not_requested"
  | "requested"
  | "ready"
  | "retryable_failure"
  | "terminal_failure"
  | "unknown";

export type VideoDateCertificationSurveyState =
  | "not_started"
  | "required"
  | "opened"
  | "persisted"
  | "completed"
  | "unknown";

export type VideoDateCertificationParticipantRole =
  | "participant_1"
  | "participant_2";

export type VideoDateCertificationDiagnostic = VideoDateJourneyBasePayload & {
  surface_owner: VideoDateCertificationSurfaceOwner;
  ready_gate_status: string | null;
  daily_room_name: string | null;
  daily_room_url_present: boolean | null;
  token_fetch_state: VideoDateCertificationTokenState;
  joined_roles: VideoDateCertificationParticipantRole[];
  provider_joined_roles: VideoDateCertificationParticipantRole[];
  remote_seen_roles: VideoDateCertificationParticipantRole[];
  survey_state: VideoDateCertificationSurveyState;
  next_surface: string | null;
  terminal: boolean | null;
  code: string | null;
  retryable: boolean | null;
  timestamp_ms: number;
};

export type VideoDateCertificationDiagnosticInput = Partial<
  Omit<VideoDateCertificationDiagnostic, "timestamp_ms">
> & {
  timestamp_ms?: number | null;
};

const CERTIFICATION_ROLES = new Set<VideoDateCertificationParticipantRole>([
  "participant_1",
  "participant_2",
]);

const CERTIFICATION_SURFACE_OWNERS = new Set<VideoDateCertificationSurfaceOwner>([
  "lobby",
  "ready_gate",
  "date",
  "survey",
  "unknown",
]);

const CERTIFICATION_TOKEN_STATES = new Set<VideoDateCertificationTokenState>([
  "not_requested",
  "requested",
  "ready",
  "retryable_failure",
  "terminal_failure",
  "unknown",
]);

const CERTIFICATION_SURVEY_STATES = new Set<VideoDateCertificationSurveyState>([
  "not_started",
  "required",
  "opened",
  "persisted",
  "completed",
  "unknown",
]);

function safeCertificationText(value: unknown, maxLength = 140): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function safeCertificationBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function safeCertificationRoles(
  value: unknown,
): VideoDateCertificationParticipantRole[] {
  if (!Array.isArray(value)) return [];
  const roles = value.filter((role): role is VideoDateCertificationParticipantRole =>
    CERTIFICATION_ROLES.has(role as VideoDateCertificationParticipantRole),
  );
  return Array.from(new Set(roles)).sort();
}

function safeCertificationEnum<T extends string>(
  value: unknown,
  allowed: Set<T>,
  fallback: T,
): T {
  return allowed.has(value as T) ? (value as T) : fallback;
}

export function buildVideoDateCertificationDiagnostic(
  input: VideoDateCertificationDiagnosticInput,
): VideoDateCertificationDiagnostic {
  return {
    platform: input.platform === "web" || input.platform === "native" ? input.platform : "web",
    session_id: safeCertificationText(input.session_id),
    event_id: safeCertificationText(input.event_id),
    surface_owner: safeCertificationEnum(
      input.surface_owner,
      CERTIFICATION_SURFACE_OWNERS,
      "unknown",
    ),
    ready_gate_status: safeCertificationText(input.ready_gate_status, 40),
    daily_room_name: safeCertificationText(input.daily_room_name, 160),
    daily_room_url_present: safeCertificationBoolean(input.daily_room_url_present),
    token_fetch_state: safeCertificationEnum(
      input.token_fetch_state,
      CERTIFICATION_TOKEN_STATES,
      "unknown",
    ),
    joined_roles: safeCertificationRoles(input.joined_roles),
    provider_joined_roles: safeCertificationRoles(input.provider_joined_roles),
    remote_seen_roles: safeCertificationRoles(input.remote_seen_roles),
    survey_state: safeCertificationEnum(
      input.survey_state,
      CERTIFICATION_SURVEY_STATES,
      "unknown",
    ),
    next_surface: safeCertificationText(input.next_surface, 80),
    terminal: safeCertificationBoolean(input.terminal),
    code: safeCertificationText(input.code, 80),
    retryable: safeCertificationBoolean(input.retryable),
    timestamp_ms:
      typeof input.timestamp_ms === "number" && Number.isFinite(input.timestamp_ms)
        ? Math.max(0, Math.floor(input.timestamp_ms))
        : Date.now(),
  };
}
