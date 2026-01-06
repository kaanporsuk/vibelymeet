-- Add archived_at column to matches table for archive functionality
ALTER TABLE public.matches ADD COLUMN archived_at timestamp with time zone DEFAULT NULL;
ALTER TABLE public.matches ADD COLUMN archived_by uuid DEFAULT NULL;

-- Create match_mutes table for mute/snooze functionality
CREATE TABLE public.match_mutes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  muted_until timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on match_mutes
ALTER TABLE public.match_mutes ENABLE ROW LEVEL SECURITY;

-- RLS policies for match_mutes
CREATE POLICY "Users can view own mutes"
  ON public.match_mutes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own mutes"
  ON public.match_mutes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own mutes"
  ON public.match_mutes FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own mutes"
  ON public.match_mutes FOR DELETE
  USING (auth.uid() = user_id);

-- Create blocked_users table
CREATE TABLE public.blocked_users (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  blocker_id uuid NOT NULL,
  blocked_id uuid NOT NULL,
  reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(blocker_id, blocked_id)
);

-- Enable RLS on blocked_users
ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;

-- RLS policies for blocked_users
CREATE POLICY "Users can view own blocks"
  ON public.blocked_users FOR SELECT
  USING (auth.uid() = blocker_id);

CREATE POLICY "Users can create own blocks"
  ON public.blocked_users FOR INSERT
  WITH CHECK (auth.uid() = blocker_id);

CREATE POLICY "Users can delete own blocks"
  ON public.blocked_users FOR DELETE
  USING (auth.uid() = blocker_id);

-- Add RLS policy for matches to allow archiving
CREATE POLICY "Users can archive own matches"
  ON public.matches FOR UPDATE
  USING ((auth.uid() = profile_id_1) OR (auth.uid() = profile_id_2))
  WITH CHECK ((auth.uid() = profile_id_1) OR (auth.uid() = profile_id_2));