-- Create table for tracking failed verification attempts
CREATE TABLE public.verification_attempts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  attempt_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  ip_address TEXT
);

-- Enable RLS
ALTER TABLE public.verification_attempts ENABLE ROW LEVEL SECURITY;

-- No public access - only edge functions with service role can access
-- No policies needed as service role bypasses RLS

-- Create index for efficient querying
CREATE INDEX idx_verification_attempts_user_time ON public.verification_attempts (user_id, attempt_at DESC);

-- Add function to clean up old attempts (older than 1 hour)
CREATE OR REPLACE FUNCTION public.cleanup_old_verification_attempts()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM public.verification_attempts 
  WHERE attempt_at < NOW() - INTERVAL '1 hour';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger to cleanup on every insert
CREATE TRIGGER cleanup_verification_attempts_trigger
AFTER INSERT ON public.verification_attempts
FOR EACH STATEMENT
EXECUTE FUNCTION public.cleanup_old_verification_attempts();