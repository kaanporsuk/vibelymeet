-- Compatibility alias only. Canonical Ready Gate resilience rollout stays on
-- video_date.timeline_v2 and video_date.broadcast_v2.

INSERT INTO public.client_feature_flags (flag_key, enabled, rollout_bps, description, kill_switch_active)
VALUES
  (
    'video_date.ready_gate_resilient_clock_v1',
    false,
    0,
    'Compatibility alias for Ready Gate resilient server-clock/realtime behavior. Prefer video_date.timeline_v2 and video_date.broadcast_v2.',
    false
  )
ON CONFLICT (flag_key) DO UPDATE
SET
  description = EXCLUDED.description,
  updated_at = now();
