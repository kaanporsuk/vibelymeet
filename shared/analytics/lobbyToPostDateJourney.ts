/**
 * Canonical PostHog event names and helpers for the Event Lobby → Ready Gate
 * → Video Date → Post-Date Survey journey (web + native).
 *
 * Rules: no PII, no freeform user text, stable cross-platform names.
 */

export type LobbyPostDatePlatform = 'web' | 'native';

/** Bucketed credit signal for funnels without exposing balances. */
export type CreditsBucket = 'none' | 'low' | 'medium' | 'high';

export const LobbyPostDateEvents = {
  // --- Lobby / empty deck / convergence ---
  LOBBY_EMPTY_STATE_IMPRESSION: 'lobby_empty_state_impression',
  LOBBY_EMPTY_STATE_REFRESH_TAP: 'lobby_empty_state_refresh_tap',
  LOBBY_CONVERGENCE_IMPRESSION: 'lobby_convergence_impression',
  MYSTERY_MATCH_CTA_IMPRESSION: 'mystery_match_cta_impression',
  MYSTERY_MATCH_CTA_TAP: 'mystery_match_cta_tap',
  MYSTERY_MATCH_OUTCOME: 'mystery_match_outcome',
  MYSTERY_MATCH_CANCEL: 'mystery_match_cancel',

  // --- Ready Gate ---
  READY_GATE_IMPRESSION: 'ready_gate_impression',
  READY_GATE_OPENING_WAIT_IMPRESSION: 'ready_gate_opening_wait_impression',
  READY_GATE_PERMISSION_BLOCKED: 'ready_gate_permission_blocked',
  READY_GATE_READY_TAP: 'ready_gate_ready_tap',
  VIDEO_DATE_READY_GATE_READY: 'video_date_ready_gate_ready',
  READY_GATE_SNOOZE_TAP: 'ready_gate_snooze_tap',
  READY_GATE_NOT_NOW_TAP: 'ready_gate_not_now_tap',
  READY_GATE_TIMEOUT: 'ready_gate_timeout',
  READY_GATE_STALE_CLOSE: 'ready_gate_stale_close',
  READY_GATE_BOTH_READY: 'ready_gate_both_ready',
  READY_GATE_BOTH_READY_OBSERVED: 'ready_gate_both_ready_observed',
  VIDEO_DATE_BOTH_READY: 'video_date_both_ready',

  // --- Ready Gate → date join latency envelope ---
  READY_GATE_TO_DATE_LATENCY_STARTED: 'ready_gate_to_date_latency_started',
  READY_GATE_TO_DATE_LATENCY_CHECKPOINT: 'ready_gate_to_date_latency_checkpoint',
  READY_GATE_TO_DATE_LATENCY_COMPLETED: 'ready_gate_to_date_latency_completed',

  // --- Video date join / peer-missing ---
  VIDEO_DATE_ROUTE_ENTERED: 'video_date_route_entered',
  VIDEO_DATE_PREPARE_ENTRY_STARTED: 'video_date_prepare_entry_started',
  VIDEO_DATE_PREPARE_ENTRY_SUCCESS: 'video_date_prepare_entry_success',
  VIDEO_DATE_PREPARE_ENTRY_FAILURE: 'video_date_prepare_entry_failure',
  VIDEO_DATE_PREWARMED_TOKEN_CACHED: 'video_date_prewarmed_token_cached',
  VIDEO_DATE_PREWARMED_TOKEN_USED: 'video_date_prewarmed_token_used',
  VIDEO_DATE_PREWARMED_TOKEN_REJECTED: 'video_date_prewarmed_token_rejected',
  VIDEO_DATE_ENTER_HANDSHAKE_SUCCESS: 'video_date_enter_handshake_success',
  VIDEO_DATE_ENTER_HANDSHAKE_FAILURE: 'video_date_enter_handshake_failure',
  VIDEO_DATE_DAILY_TOKEN_SUCCESS: 'video_date_daily_token_success',
  VIDEO_DATE_DAILY_TOKEN_FAILURE: 'video_date_daily_token_failure',
  VIDEO_DATE_DAILY_JOIN_STARTED: 'video_date_daily_join_started',
  VIDEO_DATE_DAILY_JOIN_SUCCESS: 'video_date_daily_join_success',
  VIDEO_DATE_DAILY_JOIN_FAILURE: 'video_date_daily_join_failure',
  VIDEO_DATE_DAILY_JOINED: 'video_date_daily_joined',
  VIDEO_DATE_FIRST_REMOTE_FRAME: 'video_date_first_remote_frame',
  VIDEO_DATE_REMOTE_SEEN: 'video_date_remote_seen',
  VIDEO_DATE_JOIN_ATTEMPT: 'video_date_join_attempt',
  VIDEO_DATE_JOIN_SUCCESS: 'video_date_join_success',
  VIDEO_DATE_JOIN_FAILURE: 'video_date_join_failure',
  VIDEO_DATE_PEER_MISSING_TERMINAL_IMPRESSION: 'video_date_peer_missing_terminal_impression',
  VIDEO_DATE_PEER_MISSING_RETRY_TAP: 'video_date_peer_missing_retry_tap',
  VIDEO_DATE_PEER_MISSING_KEEP_WAITING_TAP: 'video_date_peer_missing_keep_waiting_tap',
  VIDEO_DATE_PEER_MISSING_BACK_TO_LOBBY_TAP: 'video_date_peer_missing_back_to_lobby_tap',

  // --- Simultaneous swipe active-session recovery ---
  SIMULTANEOUS_SWIPE_CONFLICT_DETECTED: 'simultaneous_swipe_conflict_detected',
  SIMULTANEOUS_SWIPE_RECOVERY_ATTEMPTED: 'simultaneous_swipe_recovery_attempted',
  SIMULTANEOUS_SWIPE_RECOVERY_SUCCEEDED: 'simultaneous_swipe_recovery_succeeded',
  SIMULTANEOUS_SWIPE_RECOVERY_FAILED: 'simultaneous_swipe_recovery_failed',

  // --- In-date extension credits (KeepTheVibe UI during date phase) ---
  EXTEND_DATE_CTA_IMPRESSION: 'extend_date_cta_impression',
  /** Single extension button (+2 min / +5 min / get credits row). */
  EXTEND_DATE_CTA_TAP: 'extend_date_cta_tap',
  VIDEO_DATE_EXTENSION_ATTEMPTED: 'video_date_extension_attempted',
  VIDEO_DATE_EXTENSION_SUCCEEDED: 'video_date_extension_succeeded',
  VIDEO_DATE_EXTENSION_FAILED: 'video_date_extension_failed',
  VIDEO_DATE_TIMER_DRIFT_DETECTED: 'video_date_timer_drift_detected',
  // Canonical recovered event uses the legacy stable PostHog name to avoid metric splits.
  VIDEO_DATE_TIMER_DRIFT_RECOVERED: 'video_date_timer_drift_recovered_by_server_truth',
  VIDEO_DATE_TIMER_DRIFT_RECOVERY_FAILED: 'video_date_timer_drift_recovery_failed',
  VIDEO_DATE_TIMER_DRIFT_RECOVERED_BY_SERVER_TRUTH: 'video_date_timer_drift_recovered_by_server_truth',
  EXTEND_DATE_SUCCESS: 'extend_date_success',
  EXTEND_DATE_FAILURE: 'extend_date_failure',
  EXTEND_DATE_NO_CREDITS_IMPRESSION: 'extend_date_no_credits_impression',
  EXTEND_DATE_GET_CREDITS_TAP: 'extend_date_get_credits_tap',

  // --- Post-date verdict (“keep the vibe” yes/no on survey step 1) ---
  KEEP_THE_VIBE_IMPRESSION: 'keep_the_vibe_impression',
  KEEP_THE_VIBE_YES_TAP: 'keep_the_vibe_yes_tap',
  KEEP_THE_VIBE_NO_TAP: 'keep_the_vibe_no_tap',
  VIDEO_DATE_HANDSHAKE_GRACE_STARTED: 'video_date_handshake_grace_started',
  VIDEO_DATE_HANDSHAKE_COMPLETED_MUTUAL: 'video_date_handshake_completed_mutual',
  VIDEO_DATE_HANDSHAKE_NOT_MUTUAL: 'video_date_handshake_not_mutual',
  VIDEO_DATE_RECONNECT_GRACE_STARTED: 'video_date_reconnect_grace_started',
  VIDEO_DATE_RECONNECT_RETURNED: 'video_date_reconnect_returned',
  VIDEO_DATE_RECONNECT_EXPIRED: 'video_date_reconnect_expired',
  MUTUAL_VIBE_OUTCOME: 'mutual_vibe_outcome',

  // --- Post-date survey shell ---
  POST_DATE_SURVEY_IMPRESSION: 'post_date_survey_impression',
  POST_DATE_SURVEY_SUBMIT: 'post_date_survey_submit',
  VIDEO_DATE_SURVEY_OPENED: 'video_date_survey_opened',
  VIDEO_DATE_SURVEY_SUBMITTED: 'video_date_survey_submitted',
  VIDEO_DATE_SURVEY_ABANDONED: 'video_date_survey_abandoned',
  VIDEO_DATE_QUEUE_DRAIN_FOUND: 'video_date_queue_drain_found',
  VIDEO_DATE_QUEUE_DRAIN_NOT_FOUND: 'video_date_queue_drain_not_found',
  VIDEO_DATE_QUEUE_DRAIN_BLOCKED: 'video_date_queue_drain_blocked',
  POST_DATE_SURVEY_SKIP: 'post_date_survey_skip',
  POST_DATE_SURVEY_COMPLETE_RETURN: 'post_date_survey_complete_return',
  SURVEY_NEXT_GATE_CHECK_STARTED: 'survey_next_gate_check_started',
  SURVEY_NEXT_GATE_CHECK_RESULT: 'survey_next_gate_check_result',
  SURVEY_NEXT_GATE_CONVERSION: 'survey_next_gate_conversion',
  POST_DATE_CONTINUITY_SURVEY_COMPLETE: 'post_date_continuity_survey_complete',
  POST_DATE_CONTINUITY_NEXT_ACTION_DECIDED: 'post_date_continuity_next_action_decided',
  POST_DATE_CONTINUITY_ROUTE_TAKEN: 'post_date_continuity_route_taken',
} as const;

export type LobbyPostDateEventName =
  (typeof LobbyPostDateEvents)[keyof typeof LobbyPostDateEvents];

export function bucketCreditsRemaining(count: number): CreditsBucket {
  if (count <= 0) return 'none';
  if (count <= 1) return 'low';
  if (count <= 3) return 'medium';
  return 'high';
}
