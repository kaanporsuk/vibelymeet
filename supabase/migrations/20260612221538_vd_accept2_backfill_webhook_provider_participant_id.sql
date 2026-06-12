-- VD acceptance follow-up round 2 (item 2e): one-time backfill of
-- video_date_daily_webhook_events.provider_participant_id for historical rows
-- written before webhook fn v40 started materializing Daily's nested
-- payload.payload.session_id. Uses the same canonical extractor the readers
-- already COALESCE through, so the stored value is by construction identical
-- to what every consumer already derives — pure observability uniformity.
-- Scope check 2026-06-12: 347 of 6014 ledger rows NULL. Rows whose payloads
-- carry no participant id under any known key stay NULL (correct).

UPDATE public.video_date_daily_webhook_events
SET provider_participant_id = public.video_date_daily_provider_session_id_from_event_v1(
  provider_participant_id,
  payload
)
WHERE provider_participant_id IS NULL
  AND public.video_date_daily_provider_session_id_from_event_v1(provider_participant_id, payload) IS NOT NULL;
