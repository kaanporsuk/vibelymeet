-- Create user_reports table for Safety Hub reports
CREATE TABLE IF NOT EXISTS public.user_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  reporter_id UUID NOT NULL,
  reported_id UUID NOT NULL,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  reviewed_by UUID,
  action_taken TEXT,
  also_blocked BOOLEAN DEFAULT false
);

-- Enable RLS
ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;

-- Users can create reports
CREATE POLICY "Users can create reports"
  ON public.user_reports
  FOR INSERT
  WITH CHECK (auth.uid() = reporter_id);

-- Users can view their own reports
CREATE POLICY "Users can view own reports"
  ON public.user_reports
  FOR SELECT
  USING (auth.uid() = reporter_id);

-- Admins can view all reports
CREATE POLICY "Admins can view all reports"
  ON public.user_reports
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

-- Admins can update reports
CREATE POLICY "Admins can update reports"
  ON public.user_reports
  FOR UPDATE
  USING (has_role(auth.uid(), 'admin'));

-- Create trigger to notify admin of new reports
CREATE OR REPLACE FUNCTION notify_admin_new_report()
RETURNS TRIGGER AS $$
DECLARE
  reporter_name TEXT;
  reported_name TEXT;
BEGIN
  SELECT name INTO reporter_name FROM public.profiles WHERE id = NEW.reporter_id;
  SELECT name INTO reported_name FROM public.profiles WHERE id = NEW.reported_id;
  
  INSERT INTO public.admin_notifications (
    type,
    title,
    message,
    data
  ) VALUES (
    'user_report',
    'New User Report',
    reporter_name || ' reported ' || reported_name || ' for ' || NEW.reason,
    jsonb_build_object(
      'report_id', NEW.id,
      'reporter_id', NEW.reporter_id,
      'reported_id', NEW.reported_id,
      'reason', NEW.reason
    )
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_new_report
  AFTER INSERT ON public.user_reports
  FOR EACH ROW
  EXECUTE FUNCTION notify_admin_new_report();