# Branch delta: last-mile closure (2026-04-14)

**Branch:** `audit/full-system-forensic-closure-and-cleanup`

## Summary

1. **Automated E2E proof** — Playwright smoke (`/` + `/auth`), config under `e2e/`, `npm run test:e2e`.
2. **Signed orphan triage** — Deleted **15** legacy video-date files (checkpoint + unused survey shell); kept safety/wizard/ui/marketing orphans per `docs/audits/orphan-triage-2026-04-14.md`.
3. **`deduct_credit` review** — Documented verdict **weak** + proposed SQL guard; **no migration applied** in this pass (`docs/audits/deduct-credit-security-review-2026-04-14.md`).

## Files added

- `e2e/playwright.config.ts`
- `e2e/web-smoke.spec.ts`
- `docs/audits/e2e-minimal-layer-2026-04-14.md`
- `docs/audits/orphan-triage-2026-04-14.md`
- `docs/audits/deduct-credit-security-review-2026-04-14.md`
- `docs/branch-deltas/last-mile-closure-2026-04-14.md` (this file)

## Files deleted (safe set)

See list in `docs/audits/orphan-triage-2026-04-14.md` section **A**.

## Files modified

- `package.json` — `@playwright/test`, `test:e2e` script (removed duplicate `playwright` top-level dep)
- `docs/golden-path-regression-runbook.md` — E2E row
- `docs/active-doc-map.md` — last-mile evidence row
- `docs/native-sprint4-audit.md` — stale `MutualMatchCelebration` reference removed
- `docs/audits/surface-inventory-candidates-2026-04-14.md` — regenerated via `npm run audit:surfaces`

## Validation

- `npm run test:e2e` — PASS (2 tests)
- `npm run typecheck` — PASS
