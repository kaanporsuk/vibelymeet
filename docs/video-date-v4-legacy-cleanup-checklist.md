# Video Date v4 Legacy Cleanup Checklist

After `video_date.deck_deal_v2` has been enabled at 100% for one full week and `public.vw_video_date_legacy_deck_cleanup_readiness` reports `deck_deal_100pct_baked=true`:

- Remove client-only `seenProfileIds` and swipe-ref deck filtering from web and native lobby paths.
- Keep `get_event_deck_v2` / `record_deck_deal_v2` as the only authoritative deck impression source.
- Remove production rollback playbooks that disable `video_date.deck_deal_v2` unless a server-dealt replacement remains active.
- Delete tests/docs that describe client memory as an acceptable duplicate-card prevention mechanism.
