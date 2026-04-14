# Mechanical trust closure — 2026-04-14

**Branch:** `audit/full-system-forensic-closure-and-cleanup`  
**Goal:** Close the specific blockers the forensic audit flagged: type truth, machine inventory truth, dead-surface **evidence** (no mass delete), regression pointers, and parity classification — without speculative refactors.

---

## 1. Type truth — **CLOSED**

| Check | Result |
|-------|--------|
| Regenerate `public` types from linked project `schdyxcunwcvddlcshwd` | **Done** via `./scripts/regen-supabase-types.sh` |
| `npm run typecheck` (full monorepo) | **PASS** |
| App references to removed `graphql_public` | **None** (grep) |

**Exact diff narrative:** `docs/audits/supabase-types-regen-summary-2026-04-14.md`  
**Canonical regen:** `npm run regen:supabase-types`

---

## 2. Machine inventory truth — **CLOSED**

Recounted from tree + linked DB types generation (2026-04-14):

| Metric | Value | How counted |
|--------|-------|-------------|
| SQL migrations | **268** | `supabase/migrations/*.sql` |
| Edge Functions (deployable `index.ts`) | **46** | `supabase/functions/*/index.ts` |
| `src/pages` root `*.ts`/`*.tsx` | **33** | `find src/pages -maxdepth 1` |
| `src/pages` all `*.tsx` (incl. onboarding steps) | **55** | recursive |
| `src/components` `*.tsx` | **267** | recursive |
| `src/hooks` `.ts`/`.tsx` | **57** | recursive |
| `src/services` files | **7** | recursive |
| `public/` static files | **24** | `find public -type f` |
| Linked DB `public` tables / views / RPCs / enum groups | **67 / 11 / 127 / 4** | Parsed from regenerated `Database` type |

**Updated artifact:** `_cursor_context/vibely_machine_readable_inventory.json` → `repo_inventory_counts` + `mechanical_trust_closure_2026_04_14`.

**Note:** Historical `inventory_counts` at the top of the same JSON remains a **frozen baseline** label; do not confuse with current numbers.

---

## 3. Dead / unreferenced surface proof — **EVIDENCE DELIVERED (no deletions)**

| Deliverable | Location |
|-------------|----------|
| Repeatable script | `scripts/surface-inventory-audit.mjs` |
| npm alias | `npm run audit:surfaces` |
| Latest report | `docs/audits/surface-inventory-candidates-2026-04-14.md` |

**Method:** Static import graph from `src/App.tsx` including `@/`, `@shared/`, `@clientShared/`.

**Results (high level):**

- **Orphan pages:** 0  
- **Orphan hooks:** 0  
- **Orphan components:** 56 — mix of (a) unused shadcn `ui/*` installs, (b) legacy video-date checkpoint subtree not linked from current `VideoDate` / `PostDateSurvey`, (c) older marketing/wizard/safety shells never wired.

**Deletion policy:** No files removed in this pass. Treat the 56 list as **candidates**; removing shadcn extras or legacy checkpoint trees is **medium blast radius** — product/design sign-off first.

---

## 4. Regression proof — **DOCUMENTED + LINKED**

| Layer | Status |
|-------|--------|
| `scripts/run_golden_path_smoke.sh` | **Present** — `typecheck:core` + `build` |
| `docs/golden-path-regression-runbook.md` | **Updated** — links regen + surface audit + mechanical note |
| Full monorepo `typecheck` | **Documented** in runbook table (`npm run typecheck`) |

**Still not automated:** Browser E2E or native Detox — out of scope for this mechanical pass.

---

## 5. Residual parity drift (audit callouts) — **RE-CLASSIFIED**

| Gap | Classification | Rationale |
|-----|----------------|-----------|
| **Post-date survey + match-queue promotion** — web `PostDateSurvey` uses `useMatchQueue` while mobile `PostDateSurvey` does not | **Acceptable for now** | Different navigation model; native can return via app shell without mid-survey lobby redirect. **Must-close** only if product mandates identical “queue broke into survey” behavior. |
| **`deduct_credit` legacy auth pattern** | **Must-close** (security backlog) | Not changed here — requires dedicated RPC/auth review, not a types sweep. |
| **Dynamic imports / lazy routes** | **Intentional blind spot** | Surface script does not analyze `import()` strings — acceptable for v1 of the tool. |

---

## Blockers closed vs open

### Closed in this pass

1. Hand-maintained `types.ts` drift vs linked DB → **regenerated + scripted**.  
2. Migration / Edge count / stale `repo_inventory_counts` edge **45→46** and schema counts → **reconciled**.  
3. No repeatable surface orphan method → **`audit:surfaces`**.  
4. Golden-path doc missing mechanical hooks → **runbook updated**.  

### Still open (honest)

1. Automated E2E (Playwright / Detox) for hardened flows — **not added**.  
2. Mass deletion of 56 component candidates — **not done** (needs triage).  
3. `deduct_credit` authorization hardening — **security follow-up**.  
4. Native parity for mid-survey queue promotion — **product decision**.

---

## Pride verdict (post-mechanical pass)

**Almost, blocked by:** lack of automated E2E, intentional non-deletion of orphan UI subgraphs until triage, and security backlog on legacy credit RPC — **not** by raw type or inventory drift anymore.

**Not** “100% proud” — that would require green E2E and explicit cleanup of legacy surfaces with sign-off.

**Not** “no” — the repo now has **mechanical** alignment between linked DB types, migration/edge counts, and documented regression entrypoints.
