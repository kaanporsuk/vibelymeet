-- Production-safe placeholder backfill operation:
-- - keeps the Edge Function as the execution primitive
-- - schedules a small hourly cron using Vault-backed project_url + cron_secret
-- - exposes a service-role dry-run/manual trigger through pg_net

CREATE OR REPLACE FUNCTION public.trigger_media_placeholder_backfill_now(
  p_dry_run boolean DEFAULT true,
  p_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_project_url text;
  v_cron_secret text;
  v_url text;
  v_request_id bigint;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pg_net_not_available');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.views
    WHERE table_schema = 'vault'
      AND table_name = 'decrypted_secrets'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'vault_not_available');
  END IF;

  SELECT btrim(decrypted_secret, E' \t\n\r')
  INTO v_project_url
  FROM vault.decrypted_secrets
  WHERE name = 'project_url'
  LIMIT 1;

  SELECT btrim(decrypted_secret, E' \t\n\r')
  INTO v_cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret'
  LIMIT 1;

  IF NULLIF(v_project_url, '') IS NULL OR NULLIF(v_cron_secret, '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_vault_project_url_or_cron_secret');
  END IF;

  v_url := rtrim(v_project_url, '/') || '/functions/v1/backfill-media-placeholders';

  EXECUTE 'SELECT net.http_post(url := $1, headers := $2::jsonb, body := $3::jsonb)'
  INTO v_request_id
  USING
    v_url,
    jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_cron_secret
    ),
    jsonb_build_object(
      'source', 'manual_rpc',
      'dryRun', COALESCE(p_dry_run, true),
      'limit', v_limit
    );

  RETURN jsonb_build_object(
    'ok', true,
    'requestId', v_request_id,
    'dryRun', COALESCE(p_dry_run, true),
    'limit', v_limit
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.trigger_media_placeholder_backfill_now(boolean, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_media_placeholder_backfill_now(boolean, integer)
  TO service_role;

COMMENT ON FUNCTION public.trigger_media_placeholder_backfill_now(boolean, integer) IS
  'Service-role ops RPC that invokes backfill-media-placeholders through pg_net. Defaults to dry-run and caps limit at 50.';

DO $$
DECLARE
  v_project_url text;
  v_cron_secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'media placeholder backfill cron not scheduled: pg_cron or pg_net missing';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.views
    WHERE table_schema = 'vault'
      AND table_name = 'decrypted_secrets'
  ) THEN
    RAISE NOTICE 'media placeholder backfill cron not scheduled: Vault secrets table missing';
    RETURN;
  END IF;

  SELECT btrim(decrypted_secret, E' \t\n\r')
  INTO v_project_url
  FROM vault.decrypted_secrets
  WHERE name = 'project_url'
  LIMIT 1;

  SELECT btrim(decrypted_secret, E' \t\n\r')
  INTO v_cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret'
  LIMIT 1;

  IF NULLIF(v_project_url, '') IS NULL OR NULLIF(v_cron_secret, '') IS NULL THEN
    RAISE NOTICE 'media placeholder backfill cron not scheduled: project_url or cron_secret Vault secret missing';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'media-placeholder-backfill-hourly';

  PERFORM cron.schedule(
    'media-placeholder-backfill-hourly',
    '17 * * * *',
    $cron$
    SELECT net.http_post(
      url := rtrim(btrim((select decrypted_secret from vault.decrypted_secrets where name = 'project_url' limit 1), E' \t\n\r'), '/')
        || '/functions/v1/backfill-media-placeholders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || btrim((select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1), E' \t\n\r')
      ),
      body := jsonb_build_object('source', 'pg_cron', 'limit', 25, 'dryRun', false)
    );
    $cron$
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'media placeholder backfill cron not scheduled: %', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';
