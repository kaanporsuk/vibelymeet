-- ============================================
-- SECURITY FIX 1: Make vibe-videos bucket private
-- ============================================
UPDATE storage.buckets 
SET public = false 
WHERE id = 'vibe-videos';

-- ============================================
-- SECURITY FIX 2: Add RLS policies for storage.objects
-- ============================================
-- Allow users to view their own files and files from their matches
CREATE POLICY "Users can view their own files"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'vibe-videos' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow users to view files from users they are matched with
CREATE POLICY "Users can view matched users files"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'vibe-videos' 
  AND EXISTS (
    SELECT 1 FROM public.matches 
    WHERE (
      (profile_id_1 = auth.uid() AND profile_id_2::text = (storage.foldername(name))[1])
      OR 
      (profile_id_2 = auth.uid() AND profile_id_1::text = (storage.foldername(name))[1])
    )
  )
);

-- Allow users to upload to their own folder
CREATE POLICY "Users can upload their own files"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'vibe-videos' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow users to update their own files
CREATE POLICY "Users can update their own files"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'vibe-videos' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow users to delete their own files
CREATE POLICY "Users can delete their own files"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'vibe-videos' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- ============================================
-- SECURITY FIX 3: Add explicit SECURITY INVOKER to trigger functions
-- ============================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

CREATE OR REPLACE FUNCTION public.update_match_last_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.matches 
  SET last_message_at = NEW.created_at 
  WHERE id = NEW.match_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

CREATE OR REPLACE FUNCTION public.update_event_attendees()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.events 
    SET current_attendees = current_attendees + 1 
    WHERE id = NEW.event_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.events 
    SET current_attendees = current_attendees - 1 
    WHERE id = OLD.event_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

-- ============================================
-- SECURITY FIX 4: Add message content length constraint
-- ============================================
ALTER TABLE public.messages
ADD CONSTRAINT messages_content_length 
CHECK (length(content) > 0 AND length(content) <= 5000);

-- ============================================
-- SECURITY FIX 5: Enhanced RLS policy for messages with content validation
-- ============================================
DROP POLICY IF EXISTS "Users can send messages in own matches" ON public.messages;

CREATE POLICY "Users can send valid messages in own matches"
ON public.messages
FOR INSERT
WITH CHECK (
  auth.uid() = sender_id 
  AND length(content) > 0 
  AND length(content) <= 5000
  AND EXISTS (
    SELECT 1 FROM public.matches 
    WHERE id = match_id 
    AND (auth.uid() = profile_id_1 OR auth.uid() = profile_id_2)
  )
);

-- ============================================
-- SECURITY FIX 6: Simple rate limiting table and function
-- ============================================
CREATE TABLE IF NOT EXISTS public.rate_limits (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  messages_count int DEFAULT 0,
  messages_window_start timestamptz DEFAULT now(),
  uploads_count int DEFAULT 0,
  uploads_window_start timestamptz DEFAULT now()
);

-- Enable RLS on rate_limits
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- Users can only see their own rate limit records
CREATE POLICY "Users can view own rate limits"
ON public.rate_limits FOR SELECT
USING (auth.uid() = user_id);

-- Users can insert their own rate limit record
CREATE POLICY "Users can create own rate limits"
ON public.rate_limits FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own rate limit record
CREATE POLICY "Users can update own rate limits"
ON public.rate_limits FOR UPDATE
USING (auth.uid() = user_id);

-- Create rate limit check function
CREATE OR REPLACE FUNCTION public.check_message_rate_limit()
RETURNS TRIGGER AS $$
DECLARE
  msg_count int;
  window_start timestamptz;
  max_messages_per_hour int := 60;
BEGIN
  -- Get current rate limit data
  SELECT messages_count, messages_window_start 
  INTO msg_count, window_start
  FROM public.rate_limits 
  WHERE user_id = NEW.sender_id;
  
  -- If no record exists, create one
  IF msg_count IS NULL THEN
    INSERT INTO public.rate_limits (user_id, messages_count, messages_window_start)
    VALUES (NEW.sender_id, 1, now());
    RETURN NEW;
  END IF;
  
  -- Reset if window expired (1 hour)
  IF window_start < now() - interval '1 hour' THEN
    UPDATE public.rate_limits 
    SET messages_count = 1, messages_window_start = now()
    WHERE user_id = NEW.sender_id;
    RETURN NEW;
  END IF;
  
  -- Check limit
  IF msg_count >= max_messages_per_hour THEN
    RAISE EXCEPTION 'Rate limit exceeded: too many messages. Please wait before sending more.';
  END IF;
  
  -- Update counter
  UPDATE public.rate_limits 
  SET messages_count = msg_count + 1
  WHERE user_id = NEW.sender_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger for message rate limiting
CREATE TRIGGER message_rate_limit_trigger
  BEFORE INSERT ON public.messages
  FOR EACH ROW 
  EXECUTE FUNCTION public.check_message_rate_limit();