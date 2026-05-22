# Video Date Daily Room Pool Decision Log

## Current Decision - 2026-05-22

`video_date.daily_pool_v2` remains disabled. Vibely keeps deterministic per-session Daily rooms unless production measurements show that room create/verify is the bottleneck behind first-frame latency.

This is an explicit operational decision, not an unexamined default. Phase 7 now measures room create/verify, token mint, Daily join, first remote frame, reconnect, and extension refresh. The room pool is considered only when the service-role decision view recommends it.

## Decision Source

Check the decision before every 10%, 50%, and 100% rollout review:

```sql
select *
from public.get_video_date_daily_performance_decision('<event_uuid>')
order by window_id;
```

Escalate a Daily room-pool implementation only when the target event/window returns:

- `room_pool_recommended = true`
- `decision_reason = 'evaluate_daily_room_pool_room_create_is_bottleneck'`
- first-frame P95/P99 is over target with enough samples
- room create/verify P95/P99 is also over target

If the decision reason is `pool_not_recommended_investigate_join_client_or_network_segments`, investigate Daily join, first remote frame, client device/network, and reconnect paths instead of building a pool.

## Recording Future Decisions

Append a dated entry below whenever the operator checks the view during a rollout slice. Record only non-secret fields: event id, window, sample counts, P95/P99 values, `room_pool_recommended`, and `decision_reason`.

## Entries

- 2026-05-22: Initial decision log added. No Daily room pool is active; `video_date.daily_pool_v2` remains disabled pending measured recommendation from `get_video_date_daily_performance_decision()`.
