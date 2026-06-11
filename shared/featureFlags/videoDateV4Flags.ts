// PR 6 client single-path freeze (2026-06-12): every client-read Video Date
// flag was hard-coded to its live winner (all rows were enabled=true at
// rollout 10000 bps with no kill switch) and the branches were deleted, so no
// client-read video_date.* keys remain. Server-read rollout flags that live in
// client_feature_flags but are read exclusively by DB functions (deck_deal_v2,
// broadcast_batched_v2, outbox_lease_refresh_v2, deadline_partial_unique_v2,
// orphan_safety_interlock_v2, circuit_breaker_v2, daily_webhooks_v2,
// daily_pool_v2) stay in the database and are intentionally not declared here.
export const VIDEO_DATE_V4_CLIENT_FEATURE_FLAGS = [] as const;

export type VideoDateV4ClientFeatureFlagKey = (typeof VIDEO_DATE_V4_CLIENT_FEATURE_FLAGS)[number];
