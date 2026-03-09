-- FIX 1: Drop overly broad Daily Drop SELECT policy that exposes ALL columns
-- (including phone_number, verified_email) to any authenticated user.
-- The app uses the get_daily_drop_candidates() SECURITY DEFINER RPC instead,
-- which returns only safe columns and bypasses RLS entirely.
DROP POLICY IF EXISTS "Users can view potential matches for Daily Drop" ON public.profiles;