-- Fix 1: Drop the public access policies on vibe-videos storage bucket
-- These were incorrectly added in migration 20260106020103
DROP POLICY IF EXISTS "Vibe videos are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view vibe videos" ON storage.objects;

-- Fix 2: Create is_blocked() helper function for enforcing blocks at database level
CREATE OR REPLACE FUNCTION public.is_blocked(user1_id uuid, user2_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM blocked_users
    WHERE (blocker_id = user1_id AND blocked_id = user2_id)
       OR (blocker_id = user2_id AND blocked_id = user1_id)
  );
$$;

-- Fix 3: Update messages INSERT policy to block messages from blocked users
DROP POLICY IF EXISTS "Users can send valid messages in own matches" ON public.messages;
CREATE POLICY "Users can send valid messages in own matches"
ON public.messages
FOR INSERT
WITH CHECK (
  (auth.uid() = sender_id)
  AND (length(content) > 0)
  AND (length(content) <= 5000)
  AND (EXISTS (
    SELECT 1 FROM matches
    WHERE matches.id = messages.match_id
      AND (auth.uid() = matches.profile_id_1 OR auth.uid() = matches.profile_id_2)
  ))
  AND NOT is_blocked(
    auth.uid(),
    (SELECT CASE 
      WHEN auth.uid() = matches.profile_id_1 THEN matches.profile_id_2
      ELSE matches.profile_id_1
    END FROM matches WHERE matches.id = messages.match_id)
  )
);

-- Fix 4: Update date_proposals INSERT policy to prevent blocked users from proposing dates
DROP POLICY IF EXISTS "Users can create proposals" ON public.date_proposals;
CREATE POLICY "Users can create proposals"
ON public.date_proposals
FOR INSERT
WITH CHECK (
  (auth.uid() = proposer_id)
  AND NOT is_blocked(proposer_id, recipient_id)
);

-- Fix 5: Update video_sessions INSERT policy to prevent blocked users from joining sessions
DROP POLICY IF EXISTS "Participants can create video sessions" ON public.video_sessions;
CREATE POLICY "Participants can create video sessions"
ON public.video_sessions
FOR INSERT
WITH CHECK (
  ((auth.uid() = participant_1_id) OR (auth.uid() = participant_2_id))
  AND NOT is_blocked(participant_1_id, participant_2_id)
);

-- Fix 6: Add policy restrictions on matches to filter out blocked users from SELECT
DROP POLICY IF EXISTS "Users can view own matches" ON public.matches;
CREATE POLICY "Users can view own matches"
ON public.matches
FOR SELECT
USING (
  ((auth.uid() = profile_id_1) OR (auth.uid() = profile_id_2))
  AND NOT is_blocked(profile_id_1, profile_id_2)
);

-- Fix 7: Update matched users schedule view policy to respect blocks
DROP POLICY IF EXISTS "Matched users can view each other schedules" ON public.user_schedules;
CREATE POLICY "Matched users can view each other schedules"
ON public.user_schedules
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM matches
    WHERE (
      (matches.profile_id_1 = auth.uid() AND matches.profile_id_2 = user_schedules.user_id)
      OR (matches.profile_id_2 = auth.uid() AND matches.profile_id_1 = user_schedules.user_id)
    )
    AND NOT is_blocked(auth.uid(), user_schedules.user_id)
  )
);