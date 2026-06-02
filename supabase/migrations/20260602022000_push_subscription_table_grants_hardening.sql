-- Keep push subscription ownership behind RPCs while preserving
-- authenticated self-read diagnostics for web/native health surfaces.

BEGIN;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.push_subscriptions
  FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.push_subscriptions
  FROM authenticated;

GRANT SELECT ON TABLE public.push_subscriptions
  TO authenticated;

GRANT ALL ON TABLE public.push_subscriptions
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
