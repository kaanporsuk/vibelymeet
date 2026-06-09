-- Remove remaining legacy matching-era cleanup RPC surface.
-- The supported Event Lobby -> Video Date path is deck/swipe via swipe-actions,
-- reciprocal swipe or supported queue promotion, Ready Gate, then Video Date.
-- Keep drain_match_queue, promote_ready_gate_if_eligible, Ready Gate, Video Date
-- state-machine behavior, and video_sessions.session_source out of this pass.

DROP FUNCTION IF EXISTS public.leave_matching_queue(uuid);
