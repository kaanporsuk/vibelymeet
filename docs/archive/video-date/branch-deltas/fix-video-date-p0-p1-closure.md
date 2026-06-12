# Branch delta: `fix/video-date-p0-p1-closure`

**Date:** 2026-04-28  
**Scope:** Video Dates P0/P1 closure — server timeouts, ready gate, participant status, beforeunload reconciliation, canonical reports, native post-date parity, **server-aligned paid date extensions**.

---

## Rebuild impact (what implementers must know)

| Area | Change |
|------|--------|
| **Database** | Two migrations (see below). New column `video_sessions.date_extra_seconds`; new RPC `spend_video_date_credit_extension`; `expire_stale_video_date_phases` replaced in migration 2 to use `300 + date_extra_seconds + 60` for date phase. |
| **Web** | `VideoDate` uses `spend_video_date_credit_extension` instead of separate `deduct_credit` + local-only timer bump. `useCredits().refetch` after spend. |
| **Native** | `date/[id].tsx` uses `spendVideoDateCreditExtension(sessionId, type)` instead of `deductCredit`. |
| **Shared** | `shared/safety/submitUserReportRpc.ts` — canonical report RPC helper. |
| **Types** | `src/integrations/supabase/types.ts` — `date_extra_seconds`, `spend_video_date_credit_extension`, `submit_user_report`. |
| **Edge Functions** | **Unchanged** (no new Edge deploy for this branch). |
| **Manifest** | `_cursor_context/vibely_migration_manifest.md` — section “Video Dates P0/P1 closure” + follow-on credit budget migration. |

---

## Migrations

| File | Risk | Notes |
|------|------|--------|
| `20260428120000_video_date_p0_p1_closure.sql` | **Medium** | Replaces several hot-path RPCs (`expire_stale_video_sessions`, `ready_gate_transition`, `video_date_transition`, `update_participant_status`) and adds `submit_user_report`. Rollback = redeploy prior function bodies from prior migrations (not automated). |
| `20260428120100_video_date_credit_extension_budget.sql` | **Low–medium** | **Additive** column + new RPC + replaces `expire_stale_video_date_phases` only. Safe default `date_extra_seconds = 0` preserves prior behaviour until clients call the new RPC. |

---

## Cloud / Supabase

- **Deploy required:** Yes — migrations must be applied to the target Supabase project before production behaviour matches this branch.
- **Suggested commands** (from repo root, with Supabase CLI linked to project):

```bash
supabase db push
```

Or CI/CD equivalent that applies pending `supabase/migrations/*.sql` to the remote database.

- **Edge:** No Edge deploy for this branch unless other concurrent work requires it.

---

## Verification (smoke)

1. **Ready gate:** Both tap ready → `ready_gate_expires_at` refreshed; stale `both_ready` ends via cron/drain path.
2. **Handshake / date timeout:** With no extensions, session ends after handshake/date windows + buffers (see SQL).
3. **beforeunload:** One participant `offline`, other `in_survey`.
4. **Reports:** `submit_user_report` from Safety Hub + post-date flow; rate limit returns error after threshold.
5. **Credits in date:** Spend +2 min / +5 min during **date** phase → `date_extra_seconds` increases; server expiry does not fire until `300 + date_extra_seconds + 60` seconds after `date_started_at` (with reconnect grace rule unchanged).
6. **Native post-date:** Verdict → highlights → safety → lobby (parity with web flow).

Static: `npm run typecheck` (already required for this repo).

---

## Verdict

With both migrations applied and smoke checks passing, Video Dates on this branch are aligned for **production-proud** server ownership including **paid extension budget**.
