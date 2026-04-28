import { LobbyPostDateEvents } from "../analytics/lobbyToPostDateJourney";

export type VideoDateJourneyTraceStage =
  | "swipe_result"
  | "ready_gate_opened"
  | "ready_gate_ready_tap"
  | "ready_gate_terminal_action"
  | "both_ready_observed"
  | "prepare_entry_started"
  | "prepare_entry_success"
  | "prepare_entry_failure"
  | "daily_join_started"
  | "daily_join_success"
  | "daily_join_failure"
  | "remote_participant_seen"
  | "survey_shown"
  | "survey_recovered"
  | "verdict_submitted"
  | "mutual_result"
  | "cleanup_deferred_or_deleted";

export type VideoDateJourneyTracePoint = {
  stage: VideoDateJourneyTraceStage;
  primarySignals: string[];
  correlationKeys: string[];
  notes: string;
};

const basePayloadKeys = ["session_id", "event_id", "source_surface", "source_action", "outcome"] as const;

export const VIDEO_DATE_JOURNEY_TRACE_MAP: readonly VideoDateJourneyTracePoint[] = [
  {
    stage: "swipe_result",
    primarySignals: ["swipe-actions:video_session_created", "useSwipeAction:onVideoSessionReady"],
    correlationKeys: ["session_id", "event_id", "outcome"],
    notes: "Swipe RPC returns the video session id; web and native should open the returned Ready Gate session.",
  },
  {
    stage: "ready_gate_opened",
    primarySignals: [LobbyPostDateEvents.READY_GATE_IMPRESSION],
    correlationKeys: ["session_id", "event_id", "source_surface", "source_action"],
    notes: "Ready Gate surface was shown to the participant.",
  },
  {
    stage: "ready_gate_ready_tap",
    primarySignals: [LobbyPostDateEvents.READY_GATE_READY_TAP, LobbyPostDateEvents.VIDEO_DATE_READY_GATE_READY],
    correlationKeys: ["session_id", "event_id", "source_surface", "source_action"],
    notes: "Participant attempted the backend-owned ready transition.",
  },
  {
    stage: "ready_gate_terminal_action",
    primarySignals: [
      LobbyPostDateEvents.READY_GATE_TERMINAL_ACTION_SUCCESS,
      LobbyPostDateEvents.READY_GATE_TERMINAL_ACTION_FAILURE,
    ],
    correlationKeys: [...basePayloadKeys, "reason", "reason_code", "retryable"],
    notes: "Skip, back, or leave completed or failed after the backend-owned forfeit transition; failure events carry retryability and a safe reason code.",
  },
  {
    stage: "both_ready_observed",
    primarySignals: [
      LobbyPostDateEvents.READY_GATE_BOTH_READY_OBSERVED,
      LobbyPostDateEvents.READY_GATE_HANDOFF_RECOVERY,
    ],
    correlationKeys: [...basePayloadKeys],
    notes: "Client observed both-ready and either started handoff or recovered back into the Ready Gate surface.",
  },
  {
    stage: "prepare_entry_started",
    primarySignals: [LobbyPostDateEvents.VIDEO_DATE_PREPARE_ENTRY_STARTED],
    correlationKeys: [...basePayloadKeys, "entry_attempt_id"],
    notes: "Daily preparation request started before route navigation or date bootstrap.",
  },
  {
    stage: "prepare_entry_success",
    primarySignals: [LobbyPostDateEvents.VIDEO_DATE_PREPARE_ENTRY_SUCCESS, "prepare_date_entry_ok"],
    correlationKeys: [...basePayloadKeys, "entry_attempt_id"],
    notes: "Daily provider room was verified or recovered and a date entry was prepared.",
  },
  {
    stage: "prepare_entry_failure",
    primarySignals: [
      LobbyPostDateEvents.VIDEO_DATE_PREPARE_ENTRY_FAILURE,
      LobbyPostDateEvents.VIDEO_DATE_PREPARE_ENTRY_FAILED_NO_NAV,
    ],
    correlationKeys: [...basePayloadKeys, "reason_code", "retryable"],
    notes: "Daily preparation failed before navigation or during date bootstrap.",
  },
  {
    stage: "daily_join_started",
    primarySignals: [LobbyPostDateEvents.VIDEO_DATE_DAILY_JOIN_STARTED],
    correlationKeys: [...basePayloadKeys, "entry_attempt_id"],
    notes: "Client started joining the verified Daily room.",
  },
  {
    stage: "daily_join_success",
    primarySignals: [LobbyPostDateEvents.VIDEO_DATE_DAILY_JOIN_SUCCESS, LobbyPostDateEvents.VIDEO_DATE_DAILY_JOINED],
    correlationKeys: [...basePayloadKeys, "entry_attempt_id"],
    notes: "Client joined Daily and attempted to persist joined evidence.",
  },
  {
    stage: "daily_join_failure",
    primarySignals: [LobbyPostDateEvents.VIDEO_DATE_DAILY_JOIN_FAILURE, LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_FAILURE],
    correlationKeys: [...basePayloadKeys, "reason_code", "retryable"],
    notes: "Daily token or join failed without logging tokens or provider secrets.",
  },
  {
    stage: "remote_participant_seen",
    primarySignals: [LobbyPostDateEvents.VIDEO_DATE_REMOTE_SEEN, LobbyPostDateEvents.VIDEO_DATE_FIRST_REMOTE_FRAME],
    correlationKeys: ["session_id", "event_id", "source_surface", "outcome"],
    notes: "Peer presence became visible in the room.",
  },
  {
    stage: "survey_shown",
    primarySignals: [LobbyPostDateEvents.VIDEO_DATE_SURVEY_OPENED, LobbyPostDateEvents.POST_DATE_SURVEY_IMPRESSION],
    correlationKeys: ["session_id", "event_id", "source_surface", "source_action"],
    notes: "Post-date survey was shown after normal end or route hydration.",
  },
  {
    stage: "survey_recovered",
    primarySignals: [LobbyPostDateEvents.VIDEO_DATE_SURVEY_RECOVERED, "journey_survey_recovered"],
    correlationKeys: [...basePayloadKeys, "reason_code"],
    notes: "A pending survey was recovered after refresh, close, or route hydration.",
  },
  {
    stage: "verdict_submitted",
    primarySignals: [LobbyPostDateEvents.POST_DATE_SURVEY_SUBMIT, LobbyPostDateEvents.VIDEO_DATE_SURVEY_SUBMITTED],
    correlationKeys: ["session_id", "event_id", "source_surface", "source_action", "outcome"],
    notes: "Participant submitted post-date verdict through the existing verdict flow.",
  },
  {
    stage: "mutual_result",
    primarySignals: [LobbyPostDateEvents.MUTUAL_VIBE_OUTCOME],
    correlationKeys: ["session_id", "event_id", "outcome"],
    notes: "Mutual result was computed without exposing the partner decision to unrelated users.",
  },
  {
    stage: "cleanup_deferred_or_deleted",
    primarySignals: [
      LobbyPostDateEvents.CLEANUP_DEFERRED_ACTIVE_PARTICIPANTS,
      LobbyPostDateEvents.CLEANUP_DEFERRED_PROVIDER_CHECK_FAILED,
      "cleanup_deferred_active_participants",
      "cleanup_room_not_found",
      "cleanup_delete_failed",
      "video-date-room-cleanup",
    ],
    correlationKeys: ["session_id", "room_name", "provider_status", "reason", "ended_reason"],
    notes: "Cleanup signals are structured Edge logs, not PostHog events; variant-specific fields distinguish deferral, provider-missing cleanup, delete failure, and summary counters.",
  },
] as const;
