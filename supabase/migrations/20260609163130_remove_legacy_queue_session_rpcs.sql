-- Remove deprecated direct queue/session creation RPC surfaces.
-- The supported Event Lobby -> Video Date path is deck/swipe via swipe-actions,
-- reciprocal swipe or supported queue promotion, Ready Gate, then Video Date.
-- leave_matching_queue(uuid) is intentionally retained for separate cleanup proof.

DROP FUNCTION IF EXISTS public.find_video_date_match(uuid, uuid);
DROP FUNCTION IF EXISTS public.join_matching_queue(uuid, uuid);
