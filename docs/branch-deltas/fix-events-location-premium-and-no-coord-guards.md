# Branch delta: `fix/events-location-premium-and-no-coord-guards`

**Date:** 2026-04-29
**Scope:** Events discovery location entitlement hardening for web and native via the shared `get_visible_events` RPC.

---

## Rebuild impact

| Area | Change |
|------|--------|
| **Database** | Adds migration `20260501150000_get_visible_events_location_entitlement_guards.sql`, replacing `get_visible_events` without changing its signature or returned columns. |
| **Web** | No client contract change. `src/hooks/useVisibleEvents.ts` may continue to pass `p_is_premium: false`; server entitlement is authoritative. |
| **Native** | No client contract change. `apps/mobile/lib/eventsApi.ts` continues to use the same RPC and parameters. |
| **Types** | No Supabase type regeneration required; function signature and result shape are unchanged. |
| **Environment** | No new env vars. |
| **Providers** | No new provider dependencies. |
| **Supabase deploy** | Required: yes, migration only. No Edge Function deploy required. |

---

## Behavior

- Non-service callers must call `get_visible_events` for their own `auth.uid()`; a caller cannot borrow another premium profile id.
- `p_is_premium` is ignored. Premium/city browse is derived from subscriptions, admin role, or profile premium grants in Postgres.
- Non-premium browse-coordinate attempts fall back to stored profile coordinates only.
- Local and location-specific rows need event latitude/longitude before they can match nearby/city radius filters.
- Explicit global and regional rows remain intentionally visible outside strict local radius semantics.

---

## Verification

- Rollback-only SQL validation: `supabase/validation/events_location_premium_no_coord_guards.sql`
- Suggested cloud smoke after deploy:

```bash
supabase db query --linked -o table -f supabase/validation/events_location_premium_no_coord_guards.sql
```

---

## Rollback

Redeploy the prior `get_visible_events` body from `20260429120000_get_visible_events_restore_six_hour_grace.sql`, or apply a forward migration that restores the previous predicate set. No data rollback is required because this branch does not backfill or mutate rows.
