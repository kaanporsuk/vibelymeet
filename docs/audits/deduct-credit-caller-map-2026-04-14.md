# `deduct_credit` caller map — 2026-04-14 (closure)

Enumeration before `20260429100000_deduct_credit_auth_bind.sql`.

## RPC signature (unchanged)

`public.deduct_credit(p_user_id uuid, p_credit_type text) → boolean`  
`p_credit_type ∈ { extra_time, extended_vibe }` (super_vibe removed in `20260331180000`).

---

## Web (TypeScript)

| File | Usage |
|------|--------|
| `src/hooks/useCredits.ts` | `supabase.rpc("deduct_credit", { p_user_id: user.id, p_credit_type: "extra_time" \| "extended_vibe" })` — `user.id` from `AuthContext`. |

**Legitimacy:** `auth.uid()` matches `p_user_id` for normal sessions.

---

## Native (TypeScript)

| File | Usage |
|------|--------|
| `apps/mobile/lib/videoDateApi.ts` | `deductCredit(userId, creditType)` wraps `supabase.rpc('deduct_credit', { p_user_id: userId, ... })`. |

**Imports:** No other module imports `deductCredit` in-repo (grep 2026-04-14); function remains for parity with web / future call sites. Callers must pass the authenticated user id — same as web.

---

## Edge Functions

**None** — `grep supabase/functions` for `deduct_credit` → no matches.

---

## SQL / other migrations (live chain)

| Note | Detail |
|------|--------|
| Historical | Older `handle_swipe` bodies (`20260219035638`, `20260329160200`) called `deduct_credit(..., 'super_vibe')`. |
| Current | `20260331180000_drop_super_vibe_credits.sql` replaced `handle_swipe` and **removed** all `deduct_credit` calls from `handle_swipe`. |
| Later `handle_swipe` revisions | `grep deduct_credit` on `supabase/migrations/*.sql` after that — **no** references outside the `CREATE FUNCTION deduct_credit` definitions. |

**Conclusion:** No PL/pgSQL caller today needs cross-user `deduct_credit`. Internal server paths using **service role** remain authorized by the migration’s `service_role` bypass.

---

## Related (not `deduct_credit`)

| RPC | Purpose |
|-----|---------|
| `spend_video_date_credit_extension` | In-date **+Time / Keep the Vibe** — session-bound budget; **does not** use `deduct_credit` for the atomic spend (see video-date migrations). |

Web `VideoDate` / native `app/date/[id].tsx` use `spendVideoDateCreditExtension` / `spend_video_date_credit_extension` for in-date extensions — unchanged by this hardening.

---

## Cross-user deduction

| Path | Needed? |
|------|---------|
| **Authenticated JWT** | **No** — must be `auth.uid() = p_user_id`. |
| **Service role** | **Allowed** — for hypothetical admin/maintenance; **no** current Edge/SQL callers. |

No split into a second RPC was required: there are no legitimate non–service-role cross-user callers.
