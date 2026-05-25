-- Public interface compatibility aliases for the closure reliability plan.
-- Canonical rollout remains on the v2 flags; these v1 names are default-off
-- compatibility switches for older planning/docs references.

INSERT INTO public.client_feature_flags (flag_key, enabled, rollout_bps, description, kill_switch_active)
VALUES
  (
    'video_date.push_open_dedupe_v1',
    false,
    0,
    'Compatibility alias for video-date push open dedupe. Prefer video_date.multi_device_dedup_v2.',
    false
  ),
  (
    'video_date.deck_optimistic_v1',
    false,
    0,
    'Compatibility alias for optimistic deck polish. Prefer video_date.deck_prefetch_polish_v2.',
    false
  )
ON CONFLICT (flag_key) DO UPDATE
SET
  description = EXCLUDED.description,
  updated_at = now();
