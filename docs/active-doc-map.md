# Active doc map

Date: 2026-04-08  
Purpose: Keep one current execution path visible for native launch closure and make older planning/runbook references explicitly historical.

---

## Start here

1. **Preflight:** from repo root run `npm run launch:preflight`, then `npm run typecheck`.
2. **Operator execution sheet:** `docs/kaan-launch-closure-execution-sheet.md`
3. **Canonical runbook:** `docs/native-launch-closure-master-runbook.md`
4. **Active blocker matrix and evidence log:** `docs/native-final-blocker-matrix.md`
5. **Strict go/no-go:** `docs/phase7-stage5-release-readiness-and-go-nogo.md`

Use `docs/native-external-setup-checklist.md` for provider/store depth and `docs/native-sprint6-launch-closure-runbook.md` for the phase-by-phase narrative only after starting from the chain above.

---

## Where evidence is recorded

| Evidence type | Canonical file |
|---|---|
| Launch blocker status, build ids, pass/fail updates | `docs/native-final-blocker-matrix.md` |
| Browser/runtime proof results | `docs/browser-auth-runtime-proof-results.md` |
| Fresh smoke bootstrap method and proof boundaries | `docs/fresh-smoke-proof-bootstrap.md` |
| Proof policy and rebuild-proof context | `docs/authenticated-proof-and-rebuild-plan.md` |
| Clean rebuild rehearsal log | `docs/rebuild-rehearsal-log.md` |

---

## Canonical docs

| Role | File |
|---|---|
| Preflight | `npm run launch:preflight` + `npm run typecheck` |
| Operator execution sheet | `docs/kaan-launch-closure-execution-sheet.md` |
| Canonical launch-closure runbook | `docs/native-launch-closure-master-runbook.md` |
| Active launch backlog and blocker matrix | `docs/native-final-blocker-matrix.md` |
| Strict release-readiness decision | `docs/phase7-stage5-release-readiness-and-go-nogo.md` |
| Provider and store setup depth | `docs/native-external-setup-checklist.md` |
| Phased operator detail | `docs/native-sprint6-launch-closure-runbook.md` |

**Singular backlog framing:** for launch closure, the only active backlog/evidence log is `docs/native-final-blocker-matrix.md`. Older sprint boards, deferred backlogs, and parity plans are historical context only unless this map or a canonical doc explicitly promotes them again.

---

## Historical or superseded docs

These remain in-repo for audit history, provenance, or deep context, but they are **not** active entrypoints for launch closure:

- `docs/native-launch-readiness.md` — historical pre-consolidation readiness summary
- `docs/native-deployment-validation-sequence.md` — superseded by the current execution-sheet/runbook chain; contains stale branch naming
- `docs/native-v1-rc-operator-runbook.md` — supplemental RC validation workflow, not the launch-closure entrypoint
- `docs/native-sprint-board.md` — historical implementation backlog
- `docs/native-deferred-runtime-bugs-backlog.md` — historical deferred backlog, not the active launch backlog
- `docs/native-web-handoff-burndown.md` — historical scope/handoff reference, still cited only for accepted web handoffs
- `_cursor_context/vibely_rebuild_runbook.md` — canonical for frozen web rebuild only, not native launch closure
- `_cursor_context/vibely_discrepancy_report.md` — historical rebuild audit
- `_cursor_context/vibely_golden_snapshot_audited (1).md` — archived duplicate copy; use `_cursor_context/vibely_golden_snapshot_audited.md`

---

## Branch and source-of-truth note

- Branch names shown inside older phase docs are provenance only; do not treat them as the required current working branch or branch base.
- For legacy parity/planning docs, "web as source of truth" now means historical design-reference context only. Current launch-closure truth is the shared backend/runtime state plus the canonical docs listed above.
