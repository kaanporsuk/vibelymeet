-- Durable product-facing notification inbox for Vibely's Live Attention Center.
-- Keep this separate from notification_log (delivery audit) and push_notification_events (provider telemetry).

CREATE TABLE IF NOT EXISTS public.user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category text NOT NULL,
  title text NOT NULL,
  body text,
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  action jsonb NOT NULL DEFAULT '{"kind":"none"}'::jsonb,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  image_url text,
  group_key text,
  group_count integer NOT NULL DEFAULT 1 CHECK (group_count >= 1),
  dedupe_key text,
  seen_at timestamptz,
  read_at timestamptz,
  opened_at timestamptz,
  dismissed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS user_notifications_user_created_idx
  ON public.user_notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_notifications_user_unseen_idx
  ON public.user_notifications (user_id, seen_at)
  WHERE seen_at IS NULL AND dismissed_at IS NULL;

CREATE INDEX IF NOT EXISTS user_notifications_user_unread_idx
  ON public.user_notifications (user_id, read_at)
  WHERE read_at IS NULL AND dismissed_at IS NULL;

CREATE INDEX IF NOT EXISTS user_notifications_group_idx
  ON public.user_notifications (user_id, group_key, created_at DESC)
  WHERE dismissed_at IS NULL;

DROP TRIGGER IF EXISTS user_notifications_updated_at ON public.user_notifications;
CREATE TRIGGER user_notifications_updated_at
  BEFORE UPDATE ON public.user_notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own notifications" ON public.user_notifications;
CREATE POLICY "Users can view own notifications"
  ON public.user_notifications
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

REVOKE ALL ON public.user_notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_notifications TO authenticated;
GRANT ALL ON public.user_notifications TO service_role;

CREATE OR REPLACE FUNCTION public.mark_notifications_seen(notification_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  UPDATE public.user_notifications
  SET seen_at = COALESCE(seen_at, now())
  WHERE user_id = auth.uid()
    AND id = ANY(notification_ids)
    AND dismissed_at IS NULL
    AND seen_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_notification_read(notification_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.user_notifications
  SET
    seen_at = COALESCE(seen_at, now()),
    read_at = COALESCE(read_at, now())
  WHERE user_id = auth.uid()
    AND id = notification_id
    AND dismissed_at IS NULL;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_notification_opened(notification_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.user_notifications
  SET
    seen_at = COALESCE(seen_at, now()),
    read_at = COALESCE(read_at, now()),
    opened_at = COALESCE(opened_at, now())
  WHERE user_id = auth.uid()
    AND id = notification_id
    AND dismissed_at IS NULL;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.dismiss_notification(notification_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.user_notifications
  SET
    seen_at = COALESCE(seen_at, now()),
    read_at = COALESCE(read_at, now()),
    dismissed_at = COALESCE(dismissed_at, now())
  WHERE user_id = auth.uid()
    AND id = notification_id
    AND dismissed_at IS NULL;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  UPDATE public.user_notifications
  SET
    seen_at = COALESCE(seen_at, now()),
    read_at = COALESCE(read_at, now())
  WHERE user_id = auth.uid()
    AND dismissed_at IS NULL
    AND read_at IS NULL
    AND (expires_at IS NULL OR expires_at > now());

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_notifications_seen(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_notification_read(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_notification_opened(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dismiss_notification(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_all_notifications_read() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mark_notifications_seen(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notification_opened(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_notification(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'user_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications;
  END IF;
END $$;
