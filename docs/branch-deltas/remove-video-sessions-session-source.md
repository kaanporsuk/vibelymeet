# Remove Video Session Source Discriminator

Date: 2026-06-09

## Summary

Removes the temporary `video_sessions.session_source` marker from the active Event Lobby / Video Date contract. Mystery Match and the direct legacy queue/session RPCs were already removed, so the field only represented one allowed value and no longer carried product value.

## Changes

- Added forward migration `supabase/migrations/20260609171950_remove_video_sessions_session_source.sql`.
- Replaced `handle_swipe_20260601183000_deck_authority_base(...)` so it preserves `super_vibe_consumed` without reading, writing, or returning source metadata.
- Dropped `video_sessions_session_source_rec_swipe_only`.
- Dropped `video_sessions.session_source`.
- Regenerated Supabase types from the linked project.
- Removed `session_source` from active Edge/shared swipe payload types.
- Updated validation, Event Lobby regression coverage, and current docs.

## Current Contract

Supported session creation remains:

`/event/:eventId/lobby` -> deck/swipe via `swipe-actions` -> `handle_swipe_v2` -> reciprocal mutual swipe or supported queue promotion -> Ready Gate -> Video Date.

No active source, generated type, Edge/shared payload, or validation contract should expose `session_source`. Historical migrations and historical docs may still mention it as past behavior.

## Boundaries

This pass does not remove `drain_match_queue`, `promote_ready_gate_if_eligible`, Ready Gate, the Video Date state machine, or post-date survey behavior. It is schema/API cleanup, not Video Date product acceptance.
