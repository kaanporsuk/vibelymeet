# Full-system forensic closure audit

**Date:** 2026-04-14  
**Branch:** `audit/full-system-forensic-closure-and-cleanup`  
**Method:** Repo-grounded review of code, migrations, configs, manifests, and docs referenced in the audit brief. No production runtime profiling; evidence = filesystem + targeted searches + `npm run typecheck`.

---

## Executive verdict by domain

| Domain | Verdict | Confidence | Notes |
|--------|---------|------------|--------|
| **Web** | **Strong** | Medium–high | Routes centralized in `src/App.tsx`; Video Dates / reports use server RPCs as designed in recent closure work. Residual risk: hand-maintained Supabase types vs DB. |
| **Native** | **Strong with gaps** | Medium | Same backend contracts for video date credit spend and reports; post-date flow extended for parity. **Not** full behavioural parity with every web-only affordance (e.g. queue-drain during post-date survey not audited as identical). |
| **Backend (Edge)** | **Coherent** | High | 46 deployable function entrypoints under `supabase/functions/*/index.ts`; `config.toml` lists verify_jwt and critical paths. Inventory JSON still says **45** deployable — **stale** (see drift). |
| **DB / migrations** | **Heavy but aligned** | Medium | **268** SQL files in `supabase/migrations/` (verified 2026-04-14). Latest include video-date P0/P1 + credit budget. Manifest previously claimed **262** — **corrected in cleanup pass**. |
| **Providers** | **Documented** | Medium | Canonical reference (`docs/vibely-canonical-project-reference.md`) locks Daily, Bunny, OneSignal, Stripe, RevenueCat, Sentry, PostHog. Env secrets not in repo (correct). |
| **Docs / manifests** | **Improving** | Medium | Several historical docs; `_cursor_context/vibely-source-of-truth-consolidated-2026-03-24.md` was **missing** — **redirect stub added**. Machine-readable inventory counts were stale. |
| **Cleanup status** | **Partial** | — | Safe doc/manifest updates applied; broad dead-code deletion **not** performed repo-wide (high blast radius). |

---

## A. Change-landing audit (“did the work land?”)

Evidence sources: `docs/branch-deltas/fix-video-date-p0-p1-closure.md`, migrations `20260428120000_*` / `20260428120100_*`, grep on `src/` and `apps/mobile/`, `src/integrations/supabase/types.ts`.

| Stream | Intended | Landed in tree | Gaps / drift |
|--------|----------|----------------|--------------|
| **Video date P0/P1 + credit budget** | Server timeouts, `both_ready` refresh, `update_participant_status` allowlist, beforeunload partner state, `submit_user_report`, `date_extra_seconds` + `spend_video_date_credit_extension` | **Yes** — migrations present; types include `date_extra_seconds`, `spend_video_date_credit_extension`, `submit_user_report`; web `VideoDate` and native `videoDateApi` call spend RPC | **Docs:** branch delta still says “deploy required” — true until cloud applied (already done on linked project per prior ops, not re-verified here). |
| **Ready Gate** | `ready_gate_transition`, expiry, drain | **Yes** — layered migrations + manifest section | **Native** Ready Gate uses same RPC; fine. |
| **Chat / call hardening** | Server-owned messaging, match-call cleanup, outbox | **Partially verified** — Edge `send-message`, `match-call-room-cleanup`, web outbox providers present; **no** line-by-line regression proof in this pass. |
| **Media lifecycle** | Tables/RPCs migrations through 20260426* | **Yes** in migration chain; **inventory JSON** understates migration count | Treat **inventory** as stale until refreshed. |
| **Reporting / safety** | `submit_user_report` + shared helper | **Yes** — `shared/safety/submitUserReportRpc.ts`, web + native consumers | None blocking. |
| **OneSignal / notifications** | `send-notification`, prefs | **Partially verified** — functions exist; **no** full notification matrix re-run. |
| **April 2026 merges** | Video date closure on `main` | **Yes** — closure migrations in repo on `main` baseline for this branch | — |

---

## B. Dead code / obsolete surface (sampled)

| Class | Finding | Depth |
|-------|---------|--------|
| **Unrouted pages** | `src/App.tsx` imports a finite set of pages; no automated diff vs `src/pages/**` in this pass | **Follow-up:** script to list `pages/*.tsx` not referenced from `App.tsx`. |
| **Legacy `deduct_credit` for in-date extension** | Video date path should use `spend_video_date_credit_extension`; **other** surfaces may still use `deduct_credit` — **intentional** for non-session spends | **Safe** if only date-phase uses new RPC (spot-check: web `useCredits` still exposes deduct for non-video contexts — OK). |
| **Duplicate logic** | Report submission centralized in `submitUserReportRpc` | Good. |
| **Stale audit docs** | `docs/audits/events-video-date-*.md` dated 2026-04-11; still valid directionally; not superseded by closure delta | **Keep**; cross-link from branch delta recommended only (optional). |

---

## C. Folder / organization

- **`shared/`** (root) vs **`supabase/functions/_shared/`** (`@shared/*`): **documented** in `docs/vibely-canonical-project-reference.md` — **no change**; risk is developer confusion, not structure bug.
- **Branch deltas** live under `docs/branch-deltas/` — only one file before this audit; **this audit adds** forensic branch delta.

---

## D. Contract / schema / types

- **`src/integrations/supabase/types.ts`** is **committed** and **not** auto-generated from Supabase CLI in CI (inferred). **Drift risk:** new columns/RPCs can be missed if types not updated. **Mitigation:** recent closure added RPCs/columns to types — **spot-checked present**.
- **`deduct_credit`**: still accepts `p_user_id` — **historical** pattern; **not** re-audited for auth binding (listed as **risky** in cleanup matrix).

---

## E. Config / deploy

- **`supabase/config.toml`**: `project_id = schdyxcunwcvddlcshwd` — single source for link target (per canonical doc).
- **Deploy:** DB push + Edge deploy scripts documented elsewhere; **no** change required for audit conclusion.

---

## F. Web / native parity (behavioural sample)

| Topic | Parity |
|-------|--------|
| Video date credit extension | **Yes** — both call `spend_video_date_credit_extension`. |
| Post-date report | **Yes** — shared RPC helper. |
| Post-date survey steps | **Largely yes** — native expanded; **queue promotion during survey** may still differ (web `useMatchQueue`). |
| Ready gate | Same RPC | **Yes**. |

---

## G. Code quality (sampled)

- Broad **TODO** / **FIXME** sweep **not** executed repo-wide (time); recommend **follow-up** with `rg 'TODO|FIXME' src apps/mobile`.
- **Swallowed errors:** known pattern in some `catch {}` blocks — **do not mass-change** without product review.

---

## Stale / redundant / obsolete inventory (high signal)

1. **`_cursor_context/vibely_migration_manifest.md`** — migration count line **262 → 268** (fixed in cleanup).
2. **`_cursor_context/vibely_machine_readable_inventory.json`** — `migrations: 262` under `current_repo_state` **stale** (fixed to **268**).
3. **`_cursor_context/vibely-source-of-truth-consolidated-2026-03-24.md`** — **was absent**; **redirect stub** added pointing to canonical docs.
4. **Edge function count** in inventory (45 vs 46 file-based) — **noted**; recommend recount script or manual refresh.

---

## Risky cleanup **not** auto-applied

- Mass deletion of unused components without bundle analysis.
- Rewriting `deduct_credit` auth semantics.
- Large-scale eslint-driven import removal without review.
- Archiving `docs/audits/*` without owner sign-off.

---

## Architecture drift

- **Monorepo** discipline is **good**; **long migration chain** increases cognitive load — operational truth is `supabase migration list` on linked project, not narrative docs alone.
- **Two “shared” roots** (`shared/` vs `@shared`) — **documented**; drift risk when new code picks wrong root.

---

## Docs / manifests drift

| Item | Status after cleanup pass |
|------|---------------------------|
| Migration count in manifest | **Updated** |
| Machine-readable inventory migration count | **Updated** |
| Missing consolidated source-of-truth filename | **Stub added** |
| Active doc map | **Row added** for forensic audit |

---

## Release confidence verdict

**Production-ready for core flows that were explicitly hardened** (video date, ready gate, reports path, credit budget RPC), **assuming** migrations are applied to the target Supabase project and web/native builds ship from `main`.

**Not** claiming zero unknowns: full dead-route scan, full parity matrix, and automated typegen-from-DB are **not** in place.

---

## Answer: “Are we genuinely proud from every important angle?”

**Almost, blocked by:** (1) **inventory/manifest automation** — counts and Edge totals drift without periodic refresh; (2) **hand-maintained `types.ts`** vs live schema — contract drift risk; (3) **incomplete automated regression** for chat/call/media across web+native; (4) **residual native–web behavioural differences** in secondary flows (e.g. survey-time queue) not fully enumerated.

**Not “no”** — the repo shows **intentional** backend ownership and recent closure work **landed in source**; pride is **qualified** by operational hygiene and test depth, not by fundamental incoherence.
