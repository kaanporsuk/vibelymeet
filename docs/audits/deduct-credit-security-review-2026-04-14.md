# `deduct_credit` security review — 2026-04-14

## Status: **CLOSED (safe)** — see `supabase/migrations/20260429100000_deduct_credit_auth_bind.sql`

### Previous issue (weak)

`SECURITY DEFINER` body did not bind `p_user_id` to `auth.uid()`, so a malicious **authenticated** client could pass another user’s UUID and burn their pool credits.

### Hardening applied

At the start of `deduct_credit`:

- If `auth.role()` is **not** `service_role`, require `auth.uid()` is not null and `auth.uid() IS NOT DISTINCT FROM p_user_id`.
- Otherwise **raise** `SQLSTATE 42501` with hint (not a silent `false`).

`service_role` may still call the RPC for any `p_user_id` (no current callers; reserved for maintenance).

### Verdict

| Before | After |
|--------|--------|
| weak | **safe** (for client JWTs) |

### Remaining edge cases

1. **Service role misuse** — anyone with the service key can still deduct for any user; protect keys as always (out of scope for RPC-level auth).
2. **`deductCredit` on mobile** — unused in imports today; if wired later, must pass the session user id (same contract as web).
3. **Anonymous role** — if `deduct_credit` were ever granted to `anon`, calls would fail at `auth.uid() IS NULL` (raise). Typical Supabase grants only expose this to `authenticated`.

Full caller enumeration: `docs/audits/deduct-credit-caller-map-2026-04-14.md`.
