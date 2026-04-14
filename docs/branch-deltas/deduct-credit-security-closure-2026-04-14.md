# Branch delta: `deduct_credit` security closure

**Branch:** `audit/full-system-forensic-closure-and-cleanup`

## Migration

- `supabase/migrations/20260429100000_deduct_credit_auth_bind.sql` — `auth.uid()` bind + `service_role` bypass; `COMMENT ON FUNCTION`.

## Docs

- `docs/audits/deduct-credit-caller-map-2026-04-14.md` — **new** (caller map).
- `docs/audits/deduct-credit-security-review-2026-04-14.md` — **rewritten** (safe verdict).

## Manifest / inventory

- `_cursor_context/vibely_migration_manifest.md` — count **269**, addendum line for this migration.
- `_cursor_context/vibely_machine_readable_inventory.json` — `migrations`: **269**.

## Code changes

- **None** — `useCredits` and `videoDateApi.deductCredit` already pass the session user id.

## Apply to cloud

Run `supabase db push` (or your deploy pipeline) so the linked project matches repo migrations.
