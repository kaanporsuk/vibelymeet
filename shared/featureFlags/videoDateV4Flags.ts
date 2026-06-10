// Client-read Video Date feature flags only. Server-side rollout flags that
// live in client_feature_flags but are read exclusively by DB functions
// (deck_deal_v2, broadcast_batched_v2, outbox_lease_refresh_v2,
// deadline_partial_unique_v2, orphan_safety_interlock_v2, circuit_breaker_v2,
// daily_webhooks_v2, daily_pool_v2) are intentionally not declared here.
// Legacy v1 alias keys were retired in favor of their canonical v2 flags.
export const VIDEO_DATE_V4_CLIENT_FEATURE_FLAGS = [
  "video_date.snapshot_v2",
  "video_date.readiness_v2",
  "video_date.micro_verdict_v2",
  "video_date.broadcast_v2",
  "video_date.timeline_v2",
  "video_date.deck_prefetch_polish_v2",
  "video_date.lobby_timeline_v2",
  "video_date.daily_call_singleton_v2",
  "video_date.resilience_v2",
  "video_date.daily_token_refresh_v2",
  "video_date.push_payload_v2",
  "video_date.multi_device_dedup_v2",
  "video_date.verdict_confirm_v2",
  "video_date.extension_mutual_v2",
  "video_date.safety_always_on_v2",
  "video_date.multi_device_v2",
  "video_date.outbox_v2.mark_ready",
  "video_date.outbox_v2.forfeit",
  "video_date.outbox_v2.continue_handshake",
  "video_date.outbox_v2.handshake_auto_promote",
  "video_date.outbox_v2.date_timeout",
  "video_date.outbox_v2.extension",
  "video_date.outbox_v2.safety",
] as const;

export type VideoDateV4ClientFeatureFlagKey = (typeof VIDEO_DATE_V4_CLIENT_FEATURE_FLAGS)[number];
