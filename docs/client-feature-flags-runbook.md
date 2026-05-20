# Client Feature Flags Runbook

Use `/kaan/dashboard?panel=feature-flags` for normal operations. `/admin/feature-flags` redirects there for a short, protected alias.

## Ramp

1. Keep `enabled=true` and `kill_switch_active=false`.
2. Move `rollout_bps` in basis points: `1000` is 10%, `5000` is 50%, `10000` is 100%.
3. Enter a reason for every change. Flag and override changes are written to history tables and admin audit logs.

## Staff Testing

Set the flag to `enabled=true`, `kill_switch_active=false`, and `rollout_bps=0`, then add user overrides with `enabled=true`.

## Emergency Kill

Use the kill switch first. It returns `false` before overrides and before rollout bucketing.

SQL fallback:

```sql
UPDATE public.client_feature_flags
SET kill_switch_active = true,
    enabled = false,
    rollout_bps = 0,
    updated_at = now(),
    updated_by = auth.uid()
WHERE flag_key = 'media_v2_video';
```

To restore a controlled ramp:

```sql
UPDATE public.client_feature_flags
SET kill_switch_active = false,
    enabled = true,
    rollout_bps = 1000,
    updated_at = now(),
    updated_by = auth.uid()
WHERE flag_key = 'media_v2_video';
```

## Debug

Use the dev/debug RPC for the current user:

```sql
SELECT public.evaluate_all_client_feature_flags(auth.uid());
```

Use detail evaluation for one flag:

```sql
SELECT public.evaluate_client_feature_flag_detail('media_v2_video', auth.uid());
```
