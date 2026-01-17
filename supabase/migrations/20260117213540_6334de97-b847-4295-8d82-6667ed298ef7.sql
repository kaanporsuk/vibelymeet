-- Drop the overly permissive insert policy
DROP POLICY IF EXISTS "System can insert notifications" ON public.admin_notifications;

-- Instead, inserts are done via SECURITY DEFINER functions (triggers) which bypass RLS