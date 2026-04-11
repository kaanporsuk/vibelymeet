# Post-audit operational verification checklist

**Purpose:** Record what can be verified from the repo + tooling versus what still requires dashboard or manual QA after location-model and profile-update hardening.

**Repo source of truth for Supabase project:** `project_id` in [`supabase/config.toml`](../supabase/config.toml) (currently **`schdyxcunwcvddlcshwd`**). Before any `db push` or secrets change, confirm the CLI / dashboard session targets this ref.

---

## Verified from development environment (repeatable)

| Check | How | Notes |
|-------|------|------|
| Type safety | `npm run typecheck` | Required green before merge |
| Lint | `npm run lint` | Warnings-only baseline; no new errors |
| Migration files present | `ls supabase/migrations/20260416100000*.sql` and `20260416110000*.sql` | Canonical location + regional rules |
| Client location writes | Generic profile updaters reject `location` / `location_data` / `country` | See `assertNoDirectProfileLocationWrites` in [`supabase/functions/_shared/profileContracts.ts`](../supabase/functions/_shared/profileContracts.ts) and [`profileService.ts`](../src/services/profileService.ts) / [`profileApi.ts`](../apps/mobile/lib/profileApi.ts) |

---

## Supabase cloud (linked project) — use MCP, SQL, or dashboard

| Check | Status | How |
|-------|--------|-----|
| **`schema_migrations` includes `20260416100000` and `20260416110000`** | Run when connected to the correct project | Supabase MCP `list_migrations`, or SQL against `supabase_migrations.schema_migrations`, or `supabase migration list` with CLI |
| **`get_visible_events` comment matches product rules** | Optional spot-check | `SELECT obj_description('public.get_visible_events(uuid, double precision, double precision, boolean, double precision, double precision, double precision)'::regprocedure, 'pg_proc');` |
| **`update_profile_location` exists** | Spot-check | `\df+ update_profile_location` or MCP `execute_sql` on `pg_proc` |
| **Edge Functions `forward-geocode` and `push-webhook` deployed** | Dashboard or MCP `list_edge_functions` | Compare `verify_jwt` with [`supabase/config.toml`](../supabase/config.toml) |

**Placeholder migration row:** If `schema_migrations` shows **`20260411134909`** as well as **`20260416100000`**, see [§7.2 in vibely-canonical-project-reference.md](./vibely-canonical-project-reference.md) — history alignment, not necessarily duplicate DDL.

---

## Manual / dashboard only (cannot be asserted from repo alone)

| Item | What to verify |
|------|----------------|
| **Vercel production** | Deployed commit matches expected release; production env includes `VITE_ONESIGNAL_APP_ID` and Supabase URL/anon key for the project above |
| **OneSignal runtime** | Web: init succeeds on `vibelymeet.com`; push receipt end-to-end. Native: `EXPO_PUBLIC_ONESIGNAL_APP_ID` in EAS secrets matches dashboard; device receives a test push |
| **`PUSH_WEBHOOK_SECRET`** | Set in Supabase Edge secrets; matches what OneSignal (or other) webhook sends in `x-webhook-secret`; `push-webhook` returns 503 if unset |
| **Authenticated route smoke** | Re-run `npm run proof:browser-auth` (or equivalent) against the target URL when changing auth or shell routes |
| **Rebuild rehearsal** | Follow `docs/rebuild-rehearsal-log.md` / team process — not automated here |

---

## Quick reference: canonical location migrations

| File | Content |
|------|---------|
| `supabase/migrations/20260416100000_canonical_location_model.sql` | `update_profile_location`; `get_visible_events` local-scope without coords |
| `supabase/migrations/20260416110000_regional_events_require_location.sql` | `get_visible_events` regional requires usable coordinates |
