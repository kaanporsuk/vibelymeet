-- Production-safe read-only validation for Stream 9 premium/credits observability.
-- Catalog checks only; do not insert/update/delete production payment data.

DO $$
DECLARE
  v_missing text[];
  v_client_write boolean;
BEGIN
  IF to_regclass('public.stripe_webhook_events') IS NULL THEN
    RAISE EXCEPTION 'missing public.stripe_webhook_events';
  END IF;

  IF to_regclass('public.payment_observability_events') IS NULL THEN
    RAISE EXCEPTION 'missing public.payment_observability_events';
  END IF;

  SELECT array_agg(col)
  INTO v_missing
  FROM (
    VALUES
      ('stripe_event_id'),
      ('event_type'),
      ('status'),
      ('checkout_session_id'),
      ('stripe_customer_id'),
      ('stripe_subscription_id'),
      ('user_id'),
      ('paid_event_id'),
      ('pack_id'),
      ('plan'),
      ('result'),
      ('error_code'),
      ('received_at'),
      ('processing_started_at'),
      ('processed_at'),
      ('updated_at'),
      ('metadata_summary')
  ) AS expected(col)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'stripe_webhook_events'
      AND c.column_name = expected.col
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'stripe_webhook_events missing columns: %', v_missing;
  END IF;

  SELECT array_agg(col)
  INTO v_missing
  FROM (
    VALUES
      ('category'),
      ('status'),
      ('result'),
      ('error_code'),
      ('stripe_event_id'),
      ('event_type'),
      ('checkout_session_id'),
      ('stripe_customer_id'),
      ('stripe_subscription_id'),
      ('user_id'),
      ('paid_event_id'),
      ('pack_id'),
      ('plan'),
      ('amount'),
      ('currency'),
      ('metadata_summary'),
      ('created_at')
  ) AS expected(col)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'payment_observability_events'
      AND c.column_name = expected.col
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'payment_observability_events missing columns: %', v_missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'stripe_webhook_events'
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'stripe_webhook_events RLS is not enabled';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'payment_observability_events'
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'payment_observability_events RLS is not enabled';
  END IF;

  SELECT bool_or(
    has_table_privilege(role_name, 'public.stripe_webhook_events', 'INSERT')
    OR has_table_privilege(role_name, 'public.stripe_webhook_events', 'UPDATE')
    OR has_table_privilege(role_name, 'public.stripe_webhook_events', 'DELETE')
    OR has_table_privilege(role_name, 'public.payment_observability_events', 'INSERT')
    OR has_table_privilege(role_name, 'public.payment_observability_events', 'UPDATE')
    OR has_table_privilege(role_name, 'public.payment_observability_events', 'DELETE')
  )
  INTO v_client_write
  FROM (VALUES ('PUBLIC'), ('anon'), ('authenticated')) AS roles(role_name);

  IF COALESCE(v_client_write, false) THEN
    RAISE EXCEPTION 'client role has write access to payment observability tables';
  END IF;

  IF NOT (
    has_table_privilege('service_role', 'public.stripe_webhook_events', 'SELECT')
    AND has_table_privilege('service_role', 'public.stripe_webhook_events', 'INSERT')
    AND has_table_privilege('service_role', 'public.stripe_webhook_events', 'UPDATE')
  ) THEN
    RAISE EXCEPTION 'service_role lacks expected stripe_webhook_events privileges';
  END IF;

  IF NOT (
    has_table_privilege('service_role', 'public.payment_observability_events', 'SELECT')
    AND has_table_privilege('service_role', 'public.payment_observability_events', 'INSERT')
  ) THEN
    RAISE EXCEPTION 'service_role lacks expected payment_observability_events privileges';
  END IF;
END $$;

SELECT
  'premium_credits_observability_validation_passed' AS result,
  now() AS checked_at;
