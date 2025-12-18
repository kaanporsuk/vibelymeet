-- Add public read policies for demo mode (without auth)
-- These allow viewing matches and messages for demo users

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Users can view own matches" ON public.matches;
DROP POLICY IF EXISTS "Users can view messages in their matches" ON public.messages;
DROP POLICY IF EXISTS "Users can send messages in their matches" ON public.messages;

-- Create permissive demo policies for matches
CREATE POLICY "Public can view matches" ON public.matches
  FOR SELECT USING (true);

-- Create permissive demo policies for messages
CREATE POLICY "Public can view messages" ON public.messages
  FOR SELECT USING (true);

CREATE POLICY "Public can send messages" ON public.messages
  FOR INSERT WITH CHECK (true);