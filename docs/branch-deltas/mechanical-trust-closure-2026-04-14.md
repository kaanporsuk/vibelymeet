# Branch delta: mechanical trust closure (2026-04-14)

**Base branch context:** `audit/full-system-forensic-closure-and-cleanup`

## Summary

Closes forensic-audit blockers: **Supabase type regeneration**, **machine-readable inventory recount**, **surface orphan evidence script**, **golden-path runbook cross-links**, and **parity gap classification** — without mass deleting files or changing product logic.

## Files touched

- `src/integrations/supabase/types.ts` — regenerated from linked project + header
- `scripts/regen-supabase-types.sh` — **new**
- `scripts/surface-inventory-audit.mjs` — **new** (replaces earlier heuristic; uses alias-aware graph)
- `package.json` — `regen:supabase-types`, `audit:surfaces`
- `_cursor_context/vibely_machine_readable_inventory.json` — current counts + `mechanical_trust_closure_2026_04_14`
- `docs/audits/supabase-types-regen-summary-2026-04-14.md` — **new**
- `docs/audits/mechanical-trust-closure-2026-04-14.md` — **new** (main report)
- `docs/audits/surface-inventory-candidates-2026-04-14.md` — **generated** by `audit:surfaces`
- `docs/golden-path-regression-runbook.md` — automation table + date note
- `docs/entitlements-migration-guide.md` — regen command points to npm script
- `docs/active-doc-map.md` — row for mechanical trust doc

## Validation

- `npm run typecheck` — pass after type regen
- `npm run audit:surfaces` — generates markdown + JSON stdout
