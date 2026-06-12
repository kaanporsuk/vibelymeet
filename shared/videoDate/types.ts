import type {
  VideoDateCanonicalRouteDecision,
  VideoDateRouteRegistrationTruth,
  VideoDateRouteSessionTruth,
} from "../matching/videoDateRouteDecision";

/**
 * Platform-agnostic Video Date session controller vocabulary.
 *
 * Pure TS: no React, no supabase-js, no DOM globals. Web (src/) and native
 * (apps/mobile/) bind these types through their own adapters.
 */

/** Explicit controller states. Reconnect/parking and terminal-survey recovery are states, not flags. */
export type VideoDateSessionControllerPhase =
  | "hydrate"
  | "ready_gate"
  | "preparing_entry"
  | "joining"
  | "entry"
  | "date"
  | "reconnecting"
  | "parked_remount"
  | "ending"
  | "survey_required"
  | "done";

export type VideoDateControllerRouteTarget =
  | "lobby"
  | "ready"
  | "date"
  | "survey"
  | "ended";

export type VideoDateControllerSessionSnapshot = VideoDateRouteSessionTruth & {
  id?: string | null;
  /** Monotonic session sequence when the snapshot source carries one. */
  seq?: number | null;
  survey_required?: boolean | null;
};

export type VideoDateControllerRegistrationSnapshot =
  VideoDateRouteRegistrationTruth;

/** Daily adapter events, normalized away from the provider SDK shape. */
export type VideoDateControllerDailyEvent =
  | { kind: "join_started" }
  | { kind: "joined"; callInstanceId: string | null; providerSessionId: string | null }
  | { kind: "remote_participant_joined" }
  | { kind: "remote_media_playable" }
  | { kind: "remote_participant_left" }
  | { kind: "local_left" }
  | { kind: "transport_interrupted" }
  | { kind: "transport_recovered" }
  | { kind: "parked_for_remount" }
  | { kind: "park_consumed" }
  | { kind: "fatal_error"; code: string | null };

export type VideoDateControllerTimerEvent =
  | { kind: "entry_deadline_elapsed" }
  | { kind: "date_deadline_elapsed" }
  | { kind: "reconnect_grace_elapsed" };

export type VideoDateControllerRouteIntent =
  | { kind: "mount"; forceSurvey?: boolean }
  | { kind: "unmount" }
  | { kind: "manual_exit_requested" }
  | { kind: "end_date_requested" }
  | { kind: "survey_submitted" }
  | { kind: "survey_own_row_confirmed" };

export type VideoDateBroadcastInput = {
  kind: "broadcast";
  /** Event sequence used for seq-gap recovery decisions. */
  seq: number | null;
  eventKind: string;
  phase?: string | null;
  surveyRequired?: boolean | null;
};

export type VideoDateControllerInput =
  | { kind: "session_snapshot"; snapshot: VideoDateControllerSessionSnapshot | null }
  | {
      kind: "registration_snapshot";
      registration: VideoDateControllerRegistrationSnapshot | null;
    }
  | VideoDateBroadcastInput
  | { kind: "daily"; event: VideoDateControllerDailyEvent }
  | { kind: "timer"; event: VideoDateControllerTimerEvent }
  | { kind: "route_intent"; intent: VideoDateControllerRouteIntent }
  | {
      kind: "command_result";
      command: VideoDateControllerCommandKind;
      ok: boolean;
      terminalSurvey?: boolean;
      retryable?: boolean;
      code?: string | null;
    };

/**
 * Commands are explicit instructions for the platform adapter. The controller
 * never performs IO; it tells the adapter which canonical RPC / Edge call /
 * Daily operation to issue, with the idempotency key when one is required.
 */
export type VideoDateControllerCommandKind =
  | "prepare_entry"
  | "mint_daily_token"
  | "daily_join"
  | "daily_leave"
  | "daily_park"
  | "mark_daily_joined"
  | "mark_remote_seen"
  | "start_daily_alive_heartbeat"
  | "stop_daily_alive_heartbeat"
  | "complete_entry"
  | "end_date"
  | "refetch_snapshot"
  | "confirm_survey_own_row";

export type VideoDateControllerCommand = {
  kind: VideoDateControllerCommandKind;
  sessionId: string;
  /** Idempotency key for command kinds that mutate backend state. */
  idempotencyKey?: string;
  reason?: string;
};

export type VideoDateControllerRouteDecision = {
  target: VideoDateControllerRouteTarget;
  /** True when the platform router should actively navigate to `target`. */
  navigate: boolean;
  forceSurvey: boolean;
  reason: string;
  suppressedBy: VideoDateRouteSuppression | null;
  canonical: VideoDateCanonicalRouteDecision | null;
};

export type VideoDateRouteSuppression =
  | "route_ownership"
  | "entry_latch"
  | "manual_exit"
  | "duplicate_navigation"
  | "same_route";

export type VideoDateControllerViewState = {
  phase: VideoDateSessionControllerPhase;
  surveyRequired: boolean;
  reconnecting: boolean;
  terminalSurveyRecovery: boolean;
};

export type VideoDateControllerEffects = {
  state: VideoDateSessionControllerPhase;
  commands: VideoDateControllerCommand[];
  route: VideoDateControllerRouteDecision;
  view: VideoDateControllerViewState;
};
