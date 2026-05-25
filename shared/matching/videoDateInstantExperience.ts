export const VIDEO_DATE_DECK_BUFFER_LIMIT = 5;
export const VIDEO_DATE_DECK_TOP_UP_THRESHOLD = 2;
export const VIDEO_DATE_PREMIUM_MIN_TOUCH_TARGET_PX = 44;
export const VIDEO_DATE_PREMIUM_READY_GATE_MIN_CARD_HEIGHT_PX = 420;
export const VIDEO_DATE_PREMIUM_EMPTY_STATE_MIN_HEIGHT_PX = 320;

export const VIDEO_DATE_SPRINT6_LATENCY_CHECKPOINTS = [
  "swipe_result",
  "ready_gate_impression",
  "both_ready_observed",
  "date_route_entered",
  "daily_join_success",
  "remote_seen",
  "first_remote_frame",
  "remote_readable",
] as const;

export const VIDEO_DATE_SPRINT6_MANUAL_QA_CHECKS = [
  "web_desktop",
  "mobile_web",
  "ios_native",
  "android_native",
  "slow_network",
  "denied_permissions",
  "no_candidates",
  "queued_users",
] as const;

export function shouldTopUpVideoDateDeck(remainingVisibleCount: number): boolean {
  return remainingVisibleCount <= VIDEO_DATE_DECK_TOP_UP_THRESHOLD;
}
