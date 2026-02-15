-- Add unique constraint on matches to prevent duplicate pairs
-- Using LEAST/GREATEST to normalize the pair order
CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_unique_pair 
ON public.matches (LEAST(profile_id_1, profile_id_2), GREATEST(profile_id_1, profile_id_2));