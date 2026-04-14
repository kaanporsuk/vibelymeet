# Vibely — Golden Path Regression Runbook

**Purpose:** Repeatable regression checklist for the hardened web baseline. Use after merges, before native planning, or when validating deploy readiness.

**Last mechanical alignment note:** 2026-04-14 — `src/integrations/supabase/types.ts` regenerated from linked project; machine inventory recounted (see `docs/audits/mechanical-trust-closure-2026-04-14.md`).

**Scope:** Golden-path flows only. Each step is PASS/failable with a concrete expected outcome.

**Web route reference (from `src/App.tsx`):** Ready Gate `/ready/:id`, Video date `/date/:id`, Chat `/chat/:id` (here `id` is session id or match id as appropriate). Dashboard `/dashboard`, Events `/events`, Event lobby `/event/:eventId/lobby`, Matches `/matches`, Admin `/kaan/dashboard`.

**Automation layer (static, repo-local):**

| Script | What it does |
|--------|----------------|
| `scripts/run_golden_path_smoke.sh` | `typecheck:core` + production `build` |
| `npm run typecheck` | Core + mobile + app TS (full monorepo) |
| `npm run regen:supabase-types` | Refresh `src/integrations/supabase/types.ts` from linked DB |
| `npm run audit:surfaces` | Static import-graph orphan report → `docs/audits/surface-inventory-candidates-2026-04-14.md` |
| `npm run test:e2e` | Playwright: landing + `/auth` shell (`e2e/web-smoke.spec.ts`); see `docs/audits/e2e-minimal-layer-2026-04-14.md` |

---

## 0. Preconditions

- [ ] Local env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` set; app builds and runs.
- [ ] Backend: Supabase project is reachable; migrations applied; Edge Functions deployed per `_cursor_context/vibely_edge_function_manifest.md`.
- [ ] **Static checks (run first):**  
  `npm run typecheck:core` → exit 0.  
  `npm run build` → exit 0.

**PASS:** Both commands succeed. **FAIL:** Fix type/build errors before proceeding.

---

## 1. Auth / onboarding gating

| Step | Action | Expected outcome | PASS/FAIL |
|------|--------|------------------|-----------|
| 1.1 | Open app unauthenticated; go to `/dashboard` | Redirect to auth or onboarding; no dashboard content. | |
| 1.2 | Sign in (or create account); complete onboarding if prompted | Land on dashboard or intended post-onboarding route. | |
| 1.3 | As non-admin, open `/kaan/dashboard` | 403 or redirect; no admin UI. | |
| 1.4 | As admin, open `/kaan/dashboard` with valid admin JWT | Admin dashboard loads (or verify-admin succeeds). | |

**PASS:** All four steps behave as above. **FAIL:** Note which step and fix gating/redirect.

---

## 2. Pause / resume effects

| Step | Action | Expected outcome | PASS/FAIL |
|------|--------|------------------|-----------|
| 2.1 | As authenticated user, open Settings (or Pause flow); trigger Pause (e.g. 1 day) | UI confirms pause; no error from `account-pause`. | |
| 2.2 | Reload app; check profile/entitlements | Profile shows paused state (e.g. pause until date). | |
| 2.3 | While paused: trigger event deck or daily drop fetch (if applicable) | Paused user excluded from deck/drops (backend). | |
| 2.4 | Trigger Resume via UI | UI confirms resume; profile no longer shows paused. | |
| 2.5 | After resume: deck/drops visible again for user (if eligible) | Behavior restored. | |

**PASS:** Pause/resume round-trip works; backend excludes paused users from deck/drops/notifications. **FAIL:** Note step and backend (Edge Function / RLS) or frontend (AuthContext) fix.

---

## 3. Ready Gate transitions

| Step | Action | Expected outcome | PASS/FAIL |
|------|--------|------------------|-----------|
| 3.1 | As user with a session in ready_gate, open `/ready/:sessionId` | Ready Gate UI loads; state from DB (ready_gate_status, timestamps). | |
| 3.2 | Click “I’m ready” (or equivalent) | Single request to `ready_gate_transition` RPC; UI updates (e.g. ready_a/ready_b/both_ready). | |
| 3.3 | As partner, also mark ready | Both ready → status `both_ready`; no duplicate DB writes from client. | |
| 3.4 | Snooze or Forfeit | RPC called; status updates; no direct client update to `video_sessions.ready_gate_status`. | |

**PASS:** All transitions go through `ready_gate_transition`; UI only reads state. **FAIL:** If client still writes ready_gate fields, remove and use RPC only.

---

## 4. Video-date flow

| Step | Action | Expected outcome | PASS/FAIL |
|------|--------|------------------|-----------|
| 4.1 | Open `/date/:sessionId` for a valid session | VideoDate page loads; state from DB (`state`, `ended_at`). | |
| 4.2 | Progress through handshake (e.g. start handshake, vibe, complete) | Each transition via `video_date_transition` RPC; realtime updates UI. | |
| 4.3 | End call or close tab (with unload handler) | `video_date_transition(..., end)` called (e.g. fetch keepalive or RPC); session ends in DB. | |
| 4.4 | Reopen same session | Deterministic state; no duplicate or stray client-only state. | |

**PASS:** All phase changes go through `video_date_transition`; no direct client writes to `video_sessions` state/phase. **FAIL:** Remove any remaining direct updates; use RPC only.

---

## 5. Daily Drop opener / reply flow

| Step | Action | Expected outcome | PASS/FAIL |
|------|--------|------------------|-----------|
| 5.1 | As user with an active drop, open Matches → Daily Drop tab | Drop loads; data from `daily_drops` (and optional RPC/Edge). | |
| 5.2 | Mark drop as viewed | `daily_drop_transition(..., view)` or equivalent; status moves to viewed. | |
| 5.3 | Send opener (first message) | Call to `daily-drop-actions` with `send_opener`; DB shows opener_sender_id, opener_text, status active_opener_sent. | |
| 5.4 | As partner, send reply | Call to `daily-drop-actions` with `send_reply`; match created; messages seeded; status matched; chat_unlocked. | |
| 5.5 | Pass drop | `daily_drop_transition(..., pass)`; status passed. | |

**PASS:** View/opener/reply/pass go through backend (RPC or daily-drop-actions); no client direct writes to `daily_drops` for these actions. **FAIL:** Ensure useDailyDrop uses only RPC/Edge, not direct updates.

---

## 6. Daily Drop notifications

| Step | Action | Expected outcome | PASS/FAIL |
|------|--------|------------------|-----------|
| 6.1 | After opener sent (step 5.3) | Partner receives push “Your Daily Drop sent you a message” (server-sent via daily-drop-actions → send-notification). | |
| 6.2 | After reply sent (step 5.4) | Opener receives “You’re connected!” with deep link to `/chat/:matchId` (server-sent). | |
| 6.3 | Idempotent retry: send opener again for same drop | No duplicate notification; backend returns idempotent/terminal. | |

**PASS:** Notifications tied to backend transition; no client `sendNotification` for opener/reply. **FAIL:** Confirm daily-drop-actions sends notifications; remove any client send for these.

---

## 7. Chat send + message notification flow

| Step | Action | Expected outcome | PASS/FAIL |
|------|--------|------------------|-----------|
| 7.1 | Open `/chat/:matchId`; send a text message | Request to `send-message` Edge Function; message appears in thread; recipient is other participant. | |
| 7.2 | As recipient (other device or user): check push | One “messages” notification with title = sender name; deep link `/chat/:matchId`. | |
| 7.3 | Retry same message (same content, within 5s) | Backend returns idempotent; no duplicate message row; no duplicate notification. | |

**PASS:** Send path is Edge Function only; notification and deep link correct. **FAIL:** Fix send-message or client to use Edge only; fix link to use match_id.

---

## 8. Swipe / match notification flow

| Step | Action | Expected outcome | PASS/FAIL |
|------|--------|------------------|-----------|
| 8.1 | In event lobby, perform vibe (or super_vibe) on a profile | Request to `swipe-actions`; `handle_swipe` runs; result returned (e.g. vibe_recorded / super_vibe_sent). | |
| 8.2 | Target user (other account): check push | One “Someone vibed you” (or equivalent) notification; no client-side send. | |
| 8.3 | Create mutual match (both users vibe); check both sides | Each receives exactly one “It’s a match!” (or “Video date ready!”) from backend. | |
| 8.4 | Retry same swipe (e.g. already_matched) | handle_swipe returns already_matched; no second notification. | |

**PASS:** All swipe/match notifications from swipe-actions + send-notification; no client sendNotification for these. **FAIL:** Ensure useSwipeAction only calls swipe-actions; no direct sendNotification.

---

## 9. Premium / credits sanity path

| Step | Action | Expected outcome | PASS/FAIL |
|------|--------|------------------|-----------|
| 9.1 | Open Credits page (or premium) | Page loads; balance/entitlement from backend (user_credits, subscriptions). | |
| 9.2 | Initiate credit purchase (checkout) | Edge Function create-credits-checkout (or equivalent) used; redirect to Stripe. | |
| 9.3 | After webhook: balance reflects purchase | No client-only balance; DB is source of truth. | |
| 9.4 | Use a credit (e.g. super vibe) | deduct_credit or equivalent RPC/backend; balance decrements. | |

**PASS:** Credits and premium flows use backend only for balance and checkout. **FAIL:** Remove any client-only entitlement assumptions; fix Stripe webhook or RPC.

---

## 10. Admin / moderation sanity (if reachable)

| Step | Action | Expected outcome | PASS/FAIL |
|------|--------|------------------|-----------|
| 10.1 | As admin, open admin dashboard and verification (or moderation) panel | Panel loads; verify-admin or role check passes. | |
| 10.2 | Perform one moderation action (e.g. approve/reject verification) | Edge Function or RPC used; DB updated; no direct client write to sensitive tables. | |
| 10.3 | Blocked user: ensure no notifications to/from blocked | send-notification and match paths respect blocks (backend). | |

**PASS:** Admin and block flows are backend-owned. **FAIL:** Note which path and harden.

---

## Summary

- **Fully automated in repo today:** None (no Playwright/Cypress). Static checks: `npm run typecheck:core`, `npm run build`.
- **Manual / scriptable:** Run the steps above in order; mark PASS/FAIL per section. Re-run after any change to auth, pause, Ready Gate, video-date, Daily Drop, chat, swipe, credits, or admin flows.
- **When to run:** Before release, after merging hardening PRs, and before starting native build planning.

**Sufficient to proceed into native planning:** Yes, if all sections above pass and static checks pass. For ongoing CI, consider adding Playwright (or similar) and automating a subset of these steps later.
