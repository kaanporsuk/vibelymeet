# Session acceptance audit — 2026-04-22

**Branch:** `audit/session-acceptance-and-cleanup`  
**Scope:** PRs **#463–#472** (today’s Vibely stream: parity, analytics, observability, realtime refactor, evidence docs, event-loop normalization, watchdog wording).  
**Method:** `git` / `gh pr view`, repo grep/import tracing, `supabase migration list --linked`, `supabase db query --linked`. **No code or cloud mutations** as part of this audit.

---

## 1. Executive verdict

**Not “100% proud” yet.** The repo on **`main`** reflects the intended merges, but **production Supabase for the linked project (MVP_Vibe) has not applied migration `20260430123100`** — the operator views **`v_event_loop_mark_lobby_promotion_normalized`** and **`v_event_loop_observability_metric_streams`** **do not exist live**, while **`event-loop-dashboard-normalization.md` and Appendix C already document** that gap. Operators following the doc must use **inline SQL** until `supabase db push --linked` (or equivalent) runs.

Secondary debt: **`src/components/events/EmptyDeckFallback.tsx`** has **zero importers** in `src/` (only mentioned in older audit docs) — **dead surface** for the mounted web lobby path (**`LobbyEmptyState`** is what **`EventLobby`** uses). **Do not delete** without product confirm and replacement mapping — see cleanup table.

**What is in good shape:** Analytics taxonomy wiring for **Ready Gate overlays** (**`LobbyPostDateEvents` only**, no duplicate **`video_date_journey_*`** there); **`nextConvergenceDelayMs`** used in exactly three intended call sites; web **lobby realtime refetch dedupe** present in **`EventLobby`**.

---

## 2. PR landed-state table

| PR | Intended scope (short) | Merge status | Final `main` anchor | Cloud / deploy | Confidence | Notes |
|----|------------------------|-------------|----------------------|----------------|------------|-------|
| **#463** | Post-survey feedback, copy, empty-state, Mystery Match | **MERGED** | `4f774c3d0` | App: Vercel/native as per your pipeline (not verified here) | **High** | Title on `gh` matches “finish post-survey…” |
| **#464** | Lobby → post-date UX polish (toasts, layout, convergence min-height) | **MERGED** | `429d26c1b` | Same | **High** | |
| **#465** | CTA/conversion **`LobbyPostDateEvents`** instrumentation | **MERGED** | `28e6b9aea` | Same | **High** | Wired in **`LobbyEmptyState`**, **`VideoDate`**, **`KeepTheVibe`**, **`PostDateSurvey`**, native lobby, etc. |
| **#466** | Watchdog / no-remote query pack + runbook links | **MERGED** | `01b20de6b` | N/A (docs) | **High** | Later **#472** refreshed PostHog wording — **not redundant** |
| **#467** | **`convergenceScheduling`**, dedupe lobby refetches | **MERGED** | `d63c9f9c1` | N/A | **High** | Grep confirms three uses of **`nextConvergenceDelayMs`** |
| **#468** | Evidence-led checklist (docs, no tuning) | **MERGED** | `d6397c62f` | N/A | **High** | |
| **#469** | Evidence-backed Supabase snapshot | **MERGED** | `c16a279ae` | N/A | **High** | **Dashboard note** points to normalization — read with **#470** |
| **#470** | Event-loop normalization **doc** + **migration `20260430123100`** | **MERGED** | `cf8ea6479` | **DB: migration NOT on linked remote** — see §5 | **Medium (deploy)** | **Git has SQL**; **linked project out of sync** |
| **#471** | **mark_lobby** semantics correction + snapshot appendix | **MERGED** | `17229db15` | Docs only | **High** | **Separate and necessary** — clarifies double rows; does not replace **#470** |
| **#472** | Watchdog PostHog section stale phrasing after **#465** on `main` | **MERGED** | `c1a4a6781` | N/A | **High** | |

**Merge base:** all into **`main`**.

---

## 3. File classification (representative)

| File / area | Classification | Evidence |
|-------------|----------------|----------|
| **`shared/matching/convergenceScheduling.ts`** | **A. active and correct** | Imported **`useReconnection`**, native lobby, native **`date/[id]`** |
| **`src/pages/EventLobby.tsx`** | **A.** | **`LobbyEmptyState`**; **`lobby-video`** without duplicate **`refetchScopedSession`** on participant path |
| **`src/components/lobby/LobbyEmptyState.tsx`** | **A.** | Mounted from **`EventLobby`**; **`LobbyPostDateEvents`** impressions/taps |
| **`src/components/events/EmptyDeckFallback.tsx`** | **E. orphaned (no runtime import)** | Grep: only self + audit docs — **not** imported by **`EventLobby`** |
| **`src/pages/VideoLobby.tsx`** | **N/A — file does not exist** in repo (no `VideoLobby.tsx` under `src/`) | User checklist was **stale**; no dead file to remove for that path |
| **`apps/mobile/app/ready/[id].tsx`** | **A. supported fallback path** | **`_layout`** Stack screen; **`lobby.tsx`** **`router.replace(/ready/)`** stall fallback; **`activeSessionRoutes`** documents |
| **`shared/analytics/lobbyToPostDateJourney.ts`** | **A.** | Single canonical string table |
| **`docs/analytics-lobby-to-post-date-journey.md`** | **A.** (complements TS) | Human map; **not redundant** with source file |
| **`docs/observability/event-loop-dashboard-normalization.md`** | **A.** + **B. follow-up until DB push** | Appendix C states undelivered views; aligns with **#471** |
| **`docs/observability/evidence-backed-cadence-report-2026-04-22.md`** | **A.** | Snapshot; **superseded only in interpretation** by Appendix C arithmetic — **not** deleted |
| **`supabase/migrations/20260430123100_*.sql`** | **C. merged in git, not applied on linked DB** | **`migration list`** remote column blank; views missing — §5 |

---

## 4. Orphan / redundant / obsolete findings

| Item | Finding |
|------|---------|
| **`EmptyDeckFallback.tsx`** | **Unreachable** from current **`src/` import graph** for lobby — inventory docs list it as missing on native vs web; **risk if removed**: any future dynamic import or stale route — **manual decision** before delete |
| **`#468` vs `#469` vs `#470`** | **Not redundant** — checklist vs dated numbers vs normalization semantics |
| **`video_date_journey_*` vs `LobbyPostDateEvents`** | **Overlapping taxonomy by design** — **`video_date_journey`** still emitted from **`VideoDate`**, **`PostDateSurvey`** (diagnostics); Ready Gate overlays use **`LobbyPostDateEvents`** only — **matches intent** per analytics doc |
| **Stale docs** | **#472** fixed watchdog **§3** — **resolved**. Normalization doc **Appendix C** already admits undelivered migration — **not stale**, **honest** |

---

## 5. Deploy / cloud drift (commands)

```bash
cd /path/to/vibelymeet && supabase migration list --linked
```

**Observation:** **`20260430123100`** appears under **Local** with **Remote** column **empty** — remote DB has not recorded this migration version.

```bash
supabase db query --linked -o json "
SELECT table_name FROM information_schema.views
WHERE table_schema = 'public'
  AND table_name IN (
    'v_event_loop_mark_lobby_promotion_normalized',
    'v_event_loop_observability_metric_streams'
  );"
```

**Observation:** **Zero rows** — views from **`20260430123100`** **absent**.  
**Contrast:** Older **`v_event_loop_drain_events`**, **`v_event_loop_promotion_events`**, etc. **exist** (from prior migrations).

**Required action:** **`supabase db push --linked`** (or CI deploy pipeline that applies migrations) — **blast radius**: additive views + COMMENTs only per migration header.

---

## 6. Correctness vs today’s intent (short)

| Intent | Status |
|--------|--------|
| Post-survey / lobby feedback parity | **matches** (merged **#463** + downstream) |
| Ready-gate lobby polish | **matches** (**#464** + overlays use **`LobbyPostDateEvents`**) |
| Mystery Match native gating | **partial / verify in QA** — not re-audited line-by-line here |
| Shared analytics not duplicating RG emits | **matches** — RG overlays **`LobbyPostDateEvents` only** |
| Watchdog / no-remote expansion | **matches** (**#466**) |
| Convergence helper + deduped refetches | **matches** (**#467**) |
| Evidence docs | **matches** (**#468–#469**) |
| Normalization semantics (mark_lobby + inner promote) | **matches in git** (**#470–#471**); **live views** = **drift** until push |
| **`EmptyDeckFallback`** | **drift** — dead import graph |

---

## 7. Cleanup decision table

| Item | Category | Evidence | Risk if left | Recommended action | Type |
|------|----------|----------|--------------|-------------------|------|
| Migration **`20260430123100`** on linked Supabase | **undeployed** | `migration list` / view query | Operators cannot use **`metric_stream`** / normalized mark_lobby views; doc Appendix C workaround only | **`supabase db push --linked`** in controlled window | **D** |
| **`EmptyDeckFallback.tsx`** | **orphan** | No imports | Confusion, false “surface inventory” | **G** — product + web decide: wire, delete with audit update, or mark **`@deprecated`** in file header | **G / H** |
| Evidence + normalization docs | **none obsolete** | Cross-links | Low | **A** keep | **A** |
| **`apps/mobile/app/ready/[id].tsx`** | **active fallback** | Router + stall fallback | Removing would break stall path | **A** | **A** |
| Watchdog doc **§3** | **fixed** | **#472** | None | **A** | **A** |

---

## 8. Recommended next action order

1. **Deploy `20260430123100` to production Supabase** (same project CI uses) — **highest confidence / unblocks “proud” on observability**.  
2. Re-run **view existence** query + spot-check **`SELECT … LIMIT 1`** on **`v_event_loop_observability_metric_streams`**.  
3. **Product/web:** decide **`EmptyDeckFallback`** — delete vs wire vs explicit **legacy** comment (**H**).  
4. Optional: **`npm run typecheck`** after any future cleanup PR — **not required** for this read-only audit.

---

## 9. Validation

This audit: **no `npm run typecheck`** (no code changes). Supabase checks: **`supabase migration list --linked`**, **`supabase db query --linked`** as above.
