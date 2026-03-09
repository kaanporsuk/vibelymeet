
-- Notification preferences (Vibely-owned source of truth)
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  push_enabled BOOLEAN DEFAULT true,
  paused_until TIMESTAMPTZ,
  notify_new_match BOOLEAN DEFAULT true,
  notify_messages BOOLEAN DEFAULT true,
  notify_someone_vibed_you BOOLEAN DEFAULT true,
  notify_ready_gate BOOLEAN DEFAULT true,
  notify_event_live BOOLEAN DEFAULT true,
  notify_event_reminder BOOLEAN DEFAULT true,
  notify_date_reminder BOOLEAN DEFAULT true,
  notify_daily_drop BOOLEAN DEFAULT false,
  notify_recommendations BOOLEAN DEFAULT false,
  notify_product_updates BOOLEAN DEFAULT false,
  notify_credits_subscription BOOLEAN DEFAULT true,
  sound_enabled BOOLEAN DEFAULT true,
  quiet_hours_enabled BOOLEAN DEFAULT false,
  quiet_hours_start TIME DEFAULT '22:00',
  quiet_hours_end TIME DEFAULT '08:00',
  quiet_hours_timezone TEXT DEFAULT 'UTC',
  message_bundle_enabled BOOLEAN DEFAULT true,
  onesignal_player_id TEXT,
  onesignal_subscribed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notification preferences"
ON public.notification_preferences FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notification preferences"
ON public.notification_preferences FOR UPDATE TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own notification preferences"
ON public.notification_preferences FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all notification preferences"
ON public.notification_preferences FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- Per-match notification mutes
CREATE TABLE IF NOT EXISTS public.match_notification_mutes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  muted_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, match_id)
);

ALTER TABLE public.match_notification_mutes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own match mutes"
ON public.match_notification_mutes FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Auto-create preferences on profile creation
CREATE OR REPLACE FUNCTION public.create_notification_preferences()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.notification_preferences (user_id, quiet_hours_timezone)
  VALUES (NEW.id, 'UTC')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_created_create_notif_prefs ON public.profiles;
CREATE TRIGGER on_profile_created_create_notif_prefs
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.create_notification_preferences();

-- Notification log
CREATE TABLE IF NOT EXISTS public.notification_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB,
  delivered BOOLEAN DEFAULT false,
  suppressed_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all notification logs"
ON public.notification_log FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY "Service role can insert notification logs"
ON public.notification_log FOR INSERT TO authenticated
WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_notification_log_user_category 
ON public.notification_log(user_id, category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_log_created
ON public.notification_log(created_at DESC);
