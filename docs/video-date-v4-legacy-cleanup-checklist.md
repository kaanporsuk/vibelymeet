# Video Date v4 Legacy Cleanup Closure

Active web and native lobby paths now use `get_event_deck_v2` / `record_deck_deal_v2` as the only authoritative deck impression source.

Closure still requires operations proof:

- `public.vw_video_date_legacy_deck_cleanup_readiness` reports `deck_deal_100pct_baked=true`.
- `public.record_video_date_phase8_legacy_cleanup_v2(...)` records the cleanup pass.
- `public.get_video_date_phase8_release_closure()` reports no `legacy_cleanup_not_certified` blocker.

Do not restore client-only seen-card memory as a production rollback. A rollback must keep server-dealt deck truth active or replace it with another server-owned impression source.
