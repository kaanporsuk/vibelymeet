-- Create enum for notification platforms
CREATE TYPE public.notification_platform AS ENUM ('web', 'ios', 'android', 'pwa');

-- Create enum for notification delivery status
CREATE TYPE public.notification_status AS ENUM ('queued', 'sending', 'sent', 'delivered', 'opened', 'clicked', 'failed', 'bounced');

-- Create table for push notification campaigns
CREATE TABLE public.push_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target_segment TEXT DEFAULT 'all',
  scheduled_at TIMESTAMP WITH TIME ZONE,
  sent_at TIMESTAMP WITH TIME ZONE,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  status TEXT DEFAULT 'draft'
);

-- Create table for individual notification deliveries
CREATE TABLE public.push_notification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES public.push_campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  device_token TEXT,
  platform notification_platform NOT NULL,
  status notification_status NOT NULL DEFAULT 'queued',
  fcm_message_id TEXT,
  apns_message_id TEXT,
  error_code TEXT,
  error_message TEXT,
  queued_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  sent_at TIMESTAMP WITH TIME ZONE,
  delivered_at TIMESTAMP WITH TIME ZONE,
  opened_at TIMESTAMP WITH TIME ZONE,
  clicked_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes for efficient querying
CREATE INDEX idx_push_events_campaign ON public.push_notification_events(campaign_id);
CREATE INDEX idx_push_events_user ON public.push_notification_events(user_id);
CREATE INDEX idx_push_events_status ON public.push_notification_events(status);
CREATE INDEX idx_push_events_platform ON public.push_notification_events(platform);
CREATE INDEX idx_push_events_created ON public.push_notification_events(created_at DESC);

-- Enable RLS
ALTER TABLE public.push_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_notification_events ENABLE ROW LEVEL SECURITY;

-- RLS policies for push_campaigns
CREATE POLICY "Admins can manage campaigns"
ON public.push_campaigns
FOR ALL
USING (has_role(auth.uid(), 'admin'))
WITH CHECK (has_role(auth.uid(), 'admin'));

-- RLS policies for push_notification_events
CREATE POLICY "Admins can view all notification events"
ON public.push_notification_events
FOR SELECT
USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role can insert notification events"
ON public.push_notification_events
FOR INSERT
WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can update notification events"
ON public.push_notification_events
FOR UPDATE
USING (auth.role() = 'service_role');

-- Enable realtime for live monitoring
ALTER PUBLICATION supabase_realtime ADD TABLE public.push_notification_events;