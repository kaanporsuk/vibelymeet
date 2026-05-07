-- Tier Config override audit lockdown.
-- Migration classification: schema+policy.

DROP POLICY IF EXISTS "Admins can manage tier config" ON public.tier_config_overrides;

DROP POLICY IF EXISTS "Service role can manage tier config overrides" ON public.tier_config_overrides;
CREATE POLICY "Service role can manage tier config overrides"
  ON public.tier_config_overrides
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260507200000',
  'Tier Config override audit lockdown',
  'schema+policy',
  'Removes direct authenticated-admin writes to tier_config_overrides so normal override changes must flow through audited RPCs. Authenticated read access is preserved for admin display and realtime invalidation.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
