-- Admin Activity Logging Table
CREATE TABLE public.admin_activity_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_id UUID NOT NULL,
  action_type TEXT NOT NULL, -- 'suspend_user', 'warn_user', 'ban_user', 'review_report', 'create_event', 'edit_event', 'delete_event', 'lift_suspension'
  target_type TEXT NOT NULL, -- 'user', 'report', 'event'
  target_id UUID,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.admin_activity_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can insert logs
CREATE POLICY "Admins can insert activity logs"
  ON public.admin_activity_logs
  FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role) OR
    public.has_role(auth.uid(), 'moderator'::public.app_role)
  );

-- Only admins can view logs
CREATE POLICY "Admins can view activity logs"
  ON public.admin_activity_logs
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role) OR
    public.has_role(auth.uid(), 'moderator'::public.app_role)
  );

-- Create index for faster lookups
CREATE INDEX idx_admin_activity_logs_created_at ON public.admin_activity_logs(created_at DESC);
CREATE INDEX idx_admin_activity_logs_admin_id ON public.admin_activity_logs(admin_id);
CREATE INDEX idx_admin_activity_logs_target ON public.admin_activity_logs(target_type, target_id);