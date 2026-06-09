export const VIDEO_DATE_V4_CLIENT_FEATURE_FLAGS = [
  "video_date.snapshot_v2",
  "video_date.deck_deal_v2",
  "video_date.readiness_v2",
  "video_date.micro_verdict_v2",
  "video_date.broadcast_v2",
  "video_date.timeline_v2",
  "video_date.deck_prefetch_polish_v2",
  "video_date.lobby_timeline_v2",
  "video_date.daily_call_singleton_v2",
  "video_date.broadcast_batched_v2",
  "video_date.resilience_v2",
  "video_date.daily_token_refresh_v2",
  "video_date.push_payload_v2",
  "video_date.multi_device_dedup_v2",
  "video_date.push_open_dedupe_v1",
  "video_date.verdict_confirm_v2",
  "video_date.verdict_confirm_v1",
  "video_date.ready_gate_resilient_clock_v1",
  "video_date.deck_optimistic_v1",
  "video_date.outbox_lease_refresh_v2",
  "video_date.deadline_partial_unique_v2",
  "video_date.orphan_safety_interlock_v2",
  "video_date.circuit_breaker_v2",
  "video_date.daily_webhooks_v2",
  "video_date.extension_mutual_v2",
  "video_date.safety_always_on_v2",
  "video_date.daily_pool_v2",
  "video_date.multi_device_v2",
  "video_date.outbox_v2.mark_ready",
  "video_date.outbox_v2.forfeit",
  "video_date.outbox_v2.continue_handshake",
  "video_date.outbox_v2.handshake_auto_promote",
  "video_date.outbox_v2.date_timeout",
  "video_date.outbox_v2.submit_verdict",
  "video_date.outbox_v2.extension",
  "video_date.outbox_v2.safety",
] as const;

export type VideoDateV4ClientFeatureFlagKey = (typeof VIDEO_DATE_V4_CLIENT_FEATURE_FLAGS)[number];

export const VIDEO_DATE_FEATURE_FLAG_ALIAS_GROUPS = {
  readyGateResilientClock: {
    canonical: ["video_date.timeline_v2", "video_date.broadcast_v2"],
    aliases: ["video_date.ready_gate_resilient_clock_v1"],
    description: "Ready Gate server-clock countdown and realtime resilience.",
  },
  pushOpenDedupe: {
    canonical: ["video_date.multi_device_dedup_v2"],
    aliases: ["video_date.push_open_dedupe_v1"],
    description: "Video-date push open dedupe and canonical deep-link handling.",
  },
  verdictConfirmation: {
    canonical: ["video_date.verdict_confirm_v2"],
    aliases: ["video_date.verdict_confirm_v1"],
    description: "Post-date verdict confirmation before permanent UI advancement.",
  },
  deckOptimisticPolish: {
    canonical: ["video_date.deck_prefetch_polish_v2"],
    aliases: ["video_date.deck_optimistic_v1"],
    description: "Optimistic deck polish, prefetch, and retry-state UI.",
  },
} as const;

export type VideoDateFeatureFlagAliasGroupKey = keyof typeof VIDEO_DATE_FEATURE_FLAG_ALIAS_GROUPS;
