# Full-system cleanup matrix — 2026-04-14

**Scope:** Items identified during forensic audit; **risk** gates what was auto-applied vs deferred.

| # | Item | Type | Risk | Action taken or recommended | Exact files |
|---|------|------|------|-----------------------------|-------------|
| 1 | Migration count stale (262 vs 268) | **doc drift** / **stale config** | **safe now** | **Updated** manifest line to 268 and latest migration ref | `_cursor_context/vibely_migration_manifest.md` |
| 2 | `repo_inventory_counts.migrations` stale | **stale config** | **safe now** | **Updated** to 268; bumped `generated_at` | `_cursor_context/vibely_machine_readable_inventory.json` |
| 3 | Missing `_cursor_context/vibely-source-of-truth-consolidated-2026-03-24.md` | **doc drift** | **safe now** | **Added** redirect stub to canonical docs | `_cursor_context/vibely-source-of-truth-consolidated-2026-03-24.md` |
| 4 | Active doc map missing forensic audit | **doc drift** | **safe now** | **Added** row | `docs/active-doc-map.md` |
| 5 | Edge function deployable count (45 vs 46 files) | **stale config** | **needs follow-up** | **Recommended:** recount `supabase/functions/*/index.ts` and align JSON + manifest note | `_cursor_context/vibely_machine_readable_inventory.json` |
| 6 | Unreferenced `src/pages` vs `App.tsx` routes | **dead code** | **needs follow-up** | **Recommended:** script or manual audit; **do not** delete without route proof | `src/App.tsx`, `src/pages/**` |
| 7 | `deduct_credit` auth pattern (historical) | **contract drift** | **do not touch yet** | **Recommended:** security review + optional migration to session-bound RPC only where appropriate | `supabase/migrations/**`, callers |
| 8 | Hand-maintained `types.ts` vs DB | **contract drift** | **needs follow-up** | **Recommended:** CI `supabase gen types` diff or scheduled refresh | `src/integrations/supabase/types.ts` |
| 9 | Mass unused-import / dead-component removal | **dead code** | **needs follow-up** | **Deferred** — use knip/ts-prune or incremental ESLint with review | repo-wide |
| 10 | Native vs web queue during post-date survey | **parity** | **needs follow-up** | **Document** intended behaviour; align if product wants parity | `apps/mobile/**`, `src/hooks/useMatchQueue.ts` (etc.) |

---

## Legend

- **safe now** — applied in this cleanup pass (low blast radius).
- **needs follow-up** — evidence supports work; not auto-applied or only partially documented.
- **do not touch yet** — product/security implications; requires explicit ticket.
