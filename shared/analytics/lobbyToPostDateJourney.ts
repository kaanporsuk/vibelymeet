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
  READY_GATE_SNOOZE_TAP: 'ready_gate_snooze_tap',
  READY_GATE_NOT_NOW_TAP: 'ready_gate_not_now_tap',
  READY_GATE_TIMEOUT: 'ready_gate_timeout',
  READY_GATE_STALE_CLOSE: 'ready_gate_stale_close',
  READY_GATE_BOTH_READY: 'ready_gate_both_ready',

  // --- Video date join / peer-missing ---
  VIDEO_DATE_JOIN_ATTEMPT: 'video_date_join_attempt',
  VIDEO_DATE_JOIN_SUCCESS: 'video_date_join_success',
  VIDEO_DATE_JOIN_FAILURE: 'video_date_join_failure',
  VIDEO_DATE_PEER_MISSING_TERMINAL_IMPRESSION: 'video_date_peer_missing_terminal_impression',
  VIDEO_DATE_PEER_MISSING_RETRY_TAP: 'video_date_peer_missing_retry_tap',
  VIDEO_DATE_PEER_MISSING_KEEP_WAITING_TAP: 'video_date_peer_missing_keep_waiting_tap',
  VIDEO_DATE_PEER_MISSING_BACK_TO_LOBBY_TAP: 'video_date_peer_missing_back_to_lobby_tap',

  // --- In-date extension credits (KeepTheVibe UI during date phase) ---
  EXTEND_DATE_CTA_IMPRESSION: 'extend_date_cta_impression',
  /** Single extension button (+2 min / +5 min / get credits row). */
  EXTEND_DATE_CTA_TAP: 'extend_date_cta_tap',
  EXTEND_DATE_SUCCESS: 'extend_date_success',
  EXTEND_DATE_FAILURE: 'extend_date_failure',
  EXTEND_DATE_NO_CREDITS_IMPRESSION: 'extend_date_no_credits_impression',
  EXTEND_DATE_GET_CREDITS_TAP: 'extend_date_get_credits_tap',

  // --- Post-date verdict (“keep the vibe” yes/no on survey step 1) ---
  KEEP_THE_VIBE_IMPRESSION: 'keep_the_vibe_impression',
  KEEP_THE_VIBE_YES_TAP: 'keep_the_vibe_yes_tap',
  KEEP_THE_VIBE_NO_TAP: 'keep_the_vibe_no_tap',
  MUTUAL_VIBE_OUTCOME: 'mutual_vibe_outcome',

  // --- Post-date survey shell ---
  POST_DATE_SURVEY_IMPRESSION: 'post_date_survey_impression',
  POST_DATE_SURVEY_SUBMIT: 'post_date_survey_submit',
  POST_DATE_SURVEY_SKIP: 'post_date_survey_skip',
  POST_DATE_SURVEY_COMPLETE_RETURN: 'post_date_survey_complete_return',
} as const;

export type LobbyPostDateEventName =
  (typeof LobbyPostDateEvents)[keyof typeof LobbyPostDateEvents];

export function bucketCreditsRemaining(count: number): CreditsBucket {
  if (count <= 0) return 'none';
  if (count <= 1) return 'low';
  if (count <= 3) return 'medium';
  return 'high';
}
