-- Close any inherited PUBLIC access on push subscription ownership rows.
-- This must live after 20260602022000 because that version was already
-- applied in cloud before the PUBLIC revokes were identified.

BEGIN;

REVOKE ALL ON TABLE public.push_subscriptions
  FROM PUBLIC, anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.push_subscriptions
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.push_subscriptions
  TO authenticated;

GRANT ALL ON TABLE public.push_subscriptions
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
