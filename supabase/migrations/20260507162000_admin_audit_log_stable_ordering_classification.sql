-- Backfill migration metadata for the already-applied audit-log ordering fix.

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES
  (
    '20260507155000',
    'Admin audit log stable ordering',
    'schema-only',
    'Replaced admin_search_admin_audit_logs with deterministic pagination ordering. It did not mutate audit log rows or user-facing data.',
    false
  ),
  (
    '20260507162000',
    'Admin audit log stable ordering classification backfill',
    'schema-only',
    'Backfills migration classification metadata only. No admin RPC behavior, audit log rows, or user-facing data are changed.',
    false
  )
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
