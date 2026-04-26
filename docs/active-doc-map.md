# Active doc map

Date: 2026-04-14  
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
| **Branch delta (Video Dates P0/P1 closure)** | `docs/branch-deltas/fix-video-date-p0-p1-closure.md` |
| **Full-system forensic closure audit + cleanup matrix (2026-04-14)** | `docs/audits/full-system-forensic-closure-audit-2026-04-14.md` and `docs/audits/full-system-cleanup-matrix-2026-04-14.md` |
| **Branch delta (forensic audit pass)** | `docs/branch-deltas/audit-full-system-forensic-closure-and-cleanup.md` |
| **Mechanical trust closure (types + inventory + surface audit)** | `docs/audits/mechanical-trust-closure-2026-04-14.md` |
| **Last-mile closure (E2E + orphan triage + deduct_credit review)** | `docs/audits/e2e-minimal-layer-2026-04-14.md`, `docs/audits/orphan-triage-2026-04-14.md`, `docs/audits/deduct-credit-security-review-2026-04-14.md` |
| **`deduct_credit` auth closure (caller map + migration)** | `docs/audits/deduct-credit-caller-map-2026-04-14.md`, `docs/branch-deltas/deduct-credit-security-closure-2026-04-14.md`, migration `20260429100000_deduct_credit_auth_bind.sql` |
| **Deleted video-date components (reverse audit, PR #399)** | `docs/audits/deleted-files-reverse-audit-2026-04-14.md`, `docs/audits/deleted-files-restore-matrix-2026-04-14.md` |
| **SelfViewPIP follow-ups (match-call PIP mount + feedback takeover)** | Closure: `docs/branch-deltas/selfview-pip-followups-closure-2026-04-14.md`. Audits: `docs/audits/selfview-pip-followups-audit-2026-04-14.md`, `docs/audits/selfview-pip-drag-snap-investigation-2026-04-14.md` (snap deferred). Background: deleted-file reverse audit row above (`docs/audits/deleted-files-reverse-audit-2026-04-14.md`) |
| Launch blocker status, build ids, pass/fail updates | `docs/native-final-blocker-matrix.md` |
| Browser/runtime proof results | `docs/browser-auth-runtime-proof-results.md` |
| Post-audit ops checklist (Supabase vs Vercel vs manual QA) | `docs/post-audit-operational-verification-checklist.md` |
| Distance Visibility Stage 1 rollout and Stage 2 final enforcement | `docs/distance-visibility-stage1-rollout.md`, `docs/distance-visibility-stage2-final-enforcement.md` |
| Activity Status privacy boundary rebuild delta | `docs/branch-deltas/fix-activity-status-privacy-boundary.md`, `docs/activity-status-privacy-verification.sql` |
| Fresh smoke bootstrap method and proof boundaries | `docs/fresh-smoke-proof-bootstrap.md` |
| Proof policy and rebuild-proof context | `docs/authenticated-proof-and-rebuild-plan.md` |
| Clean rebuild rehearsal log | `docs/rebuild-rehearsal-log.md` |

---

## Canonical docs

| Role | File |
|---|---|
| Preflight | `npm run launch:preflight` + `npm run typecheck` |
| **Architecture, providers, import boundaries (`@shared/*` vs root `shared/`)** | `docs/vibely-canonical-project-reference.md` |
| **Native v1 architecture lock (routes, backend contracts, providers, gap list)** | `docs/native-sprint0-architecture-lock.md` |
| **Sprint 5 launch-polish triage (static matrix + implemented handoff fixes)** | `docs/native-sprint5-launch-polish-triage.md` |
| Operator execution sheet | `docs/kaan-launch-closure-execution-sheet.md` |
| Canonical launch-closure runbook | `docs/native-launch-closure-master-runbook.md` |
| Active launch backlog and blocker matrix | `docs/native-final-blocker-matrix.md` |
| Strict release-readiness decision | `docs/phase7-stage5-release-readiness-and-go-nogo.md` |
| Provider and store setup depth | `docs/native-external-setup-checklist.md` |
| Phased operator detail | `docs/native-sprint6-launch-closure-runbook.md` |
| **Web regression harness (static + manual checklist)** | `scripts/run_golden_path_smoke.sh` → `docs/golden-path-regression-runbook.md` |
| **Web push / OneSignal production verification** | `docs/web-push-production-checklist.md` |
| **Native runtime provider hardening (push boundary + iOS React source-build fix)** | `docs/native-runtime-provider-hardening.md` |
| **Authenticated proof / rebuild policy** | `docs/authenticated-proof-and-rebuild-plan.md` |
| **Rebuild rehearsal evidence log** | `docs/rebuild-rehearsal-log.md` |
| **Repo hardening / dead-surface closure (dated)** | `docs/repo-hardening-closure-2026-04-11.md` |
| **Final closure sprint report (branch isolation + ESLint + proof boundaries)** | `docs/hardening-final-closure-sprint-2026-04-11.md` |
| **Current-email OTP (Edge + web/native parity + secret/HMAC semantics)** | `docs/email-verification-settlement-2026-04-11.md` |

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
- `_cursor_context/vibely_rebuild_runbook.md` — canonical for frozen web rebuild only, not native launch closure (banner at top notes 2026-04-11 removals)
- `_cursor_context/vibely_discrepancy_report.md` — historical rebuild audit
- **`_cursor_context/vibely_golden_snapshot_audited.md`** and **`_cursor_context/vibely_rebuild_runbook.md`** — include a **2026-04-11** alignment note for `/ready/:readyId` → `ReadyRedirect` and removed unrouted surfaces; still **verify** against `src/App.tsx` for any older § inventory counts. **Other `_cursor_context/*.md` files** — audit/snapshot provenance; some may still name Lovable-era hosting or pre-removal paths. Do not treat them as current route or deploy truth without cross-checking `docs/repo-hardening-closure-2026-04-11.md` and the live `src/App.tsx` route table.
- `docs/_archive/historical/vibely_golden_snapshot_audited_duplicate_2026-04-11.md` — archived duplicate copy; use `_cursor_context/vibely_golden_snapshot_audited.md`

---

## Branch and source-of-truth note

- Branch names shown inside older phase docs are provenance only; do not treat them as the required current working branch or branch base.
- For legacy parity/planning docs, "web as source of truth" now means historical design-reference context only. Current launch-closure truth is the shared backend/runtime state plus the canonical docs listed above.
