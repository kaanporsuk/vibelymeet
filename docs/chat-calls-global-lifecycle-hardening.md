# Chat Calls Global Lifecycle Hardening

Date: 2026-04-14  
Branch: `fix/chat-calls-global-lifecycle-hardening`

## Summary
This pass hardens in-chat voice/video calling without changing the underlying provider stack:

- Daily remains the media/call provider.
- `match_calls` remains the backend lifecycle table.
- `daily-room` remains the room/token surface.
- `match_call_transition` remains the lifecycle RPC.

The change is architectural rather than cosmetic: call state is now owned by app-level controllers on both web and native instead of living inside the chat thread screen.

## What Changed
- Added a global `MatchCallProvider` on web and native so incoming calls can be detected even when the chat thread is not open.
- Moved incoming/active call overlays to app scope while preserving the existing UI components.
- Updated both clients to listen to `match_calls` `INSERT` and `UPDATE` events and reconcile local UI from backend terminal states (`declined`, `missed`, `ended`) and activation (`active`).
- Removed the duplicate client-side answer transition; answering is now owned by `daily-room` + `match_call_transition`.
- Changed incoming overlay timeout semantics from auto-`decline` to auto-`missed`.
- Hardened `daily-room` so `answer_match_call` no longer returns a usable success path when the backend answer transition failed.
- `daily-room` now requires `SUPABASE_SERVICE_ROLE_KEY` so match-call row creation can bypass the removed authenticated `match_calls` INSERT path safely.
- Added a surgical migration to remove direct authenticated `messages` insert/update and `match_calls` insert/update paths, forcing first-party flows through canonical server-owned surfaces.

## Files
- Web:
  - `src/App.tsx`
  - `src/hooks/useMatchCall.tsx`
  - `src/pages/Chat.tsx`
  - `src/components/chat/IncomingCallOverlay.tsx`
  - `src/components/chat/ActiveCallOverlay.tsx`
- Native:
  - `apps/mobile/app/_layout.tsx`
  - `apps/mobile/lib/useMatchCall.tsx`
  - `apps/mobile/app/chat/[id].tsx`
  - `apps/mobile/components/chat/IncomingCallOverlay.tsx`
- Backend:
  - `supabase/functions/daily-room/index.ts`
  - `supabase/migrations/20260414171000_chat_call_contract_hardening.sql`
- Docs:
  - `docs/web-vs-native-comparative-audit.md`
  - `docs/native-complete-sitemap.md`
  - `_cursor_context/vibely_edge_function_manifest.md`
  - `_cursor_context/vibely_daily_provider_sheet.md`
  - `_cursor_context/vibely_migration_manifest.md`

## Validation
- `npm run typecheck:core`
- `cd apps/mobile && npm run typecheck`
- `npx tsc --noEmit -p tsconfig.app.json`
- `npm run lint`

Lint still reports the repo’s pre-existing warning backlog; this change set did not leave new lint errors behind.

## Wave 2 backend + notification policy (2026-04-18)

### `daily-room` — `create_match_call`
- Loads `matches.archived_at`; rejects **archived** threads (`ARCHIVED_MATCH`).
- Rejects if another `match_calls` row exists for the same `match_id` in **`ringing` or `active`** (`DUPLICATE_ACTIVE_CALL`, 409).
- Rejects if either direction exists in **`blocked_users`** (`USERS_BLOCKED`).
- Loads both **`profiles`** for caller and callee; rejects **`is_suspended`** (`PARTICIPANT_SUSPENDED`) or effective **pause** (`is_paused`/`paused_until` or `account_paused`/`account_paused_until`) (`PARTICIPANT_PAUSED`), aligned with `send-notification` pause semantics.
- **Not** gated on `match_notification_mutes` (per-match notification mute is push-only; in-app Realtime ringing remains intentional).
- Structured logs: `create_match_call_rejected` (with `code`), `create_match_call_ok`.

### `daily-room` — `answer_match_call`
- Order: **`match_call_transition('answer')` first**, then Daily token. Avoids returning a callee token while the row is still `ringing`.
- If token creation fails after a successful answer transition, best-effort **`end`** RPC + `TOKEN_ISSUE_FAILED` (503); logs `answer_match_call_token_failed_after_transition` and rollback outcome.

### Push — `match_call` category
- **`notification_preferences.notify_match_calls`** (migration `20260418200000_notify_match_calls_preference.sql`): seeded from `notify_messages` for existing rows so behavior is unchanged at rollout.
- **`send-notification`**: `match_call` maps to **`notify_match_calls`** (not `notify_messages`).
- **Web + native** settings: new toggle “Match calls” under Connections.

---

## Wave 1 client follow-up (2026-04-18, branch `fix/wave1-chat-call-hardening`)

- **Web incoming overlay:** one-shot auto-miss after 30s (no repeated `onTimeout`); countdown interval depends only on `incomingCall.callId`; stable timeout handler via `onTimeout={markIncomingCallMissed}`.
- **Callee answer failure:** web + native use `mark_missed` (RPC) instead of invalid `end` while the row is still `ringing`; early `answer_match_call` failure paths also mark missed and clean up.
- **Teardown / `cleanupLocalCall`:** optional `skipServerTransition` when the RPC was already applied or the row is already terminal; otherwise best-effort `match_call_transition` from current phase (incoming → `mark_missed`, outgoing ring or active → `end`) before Daily leave/delete.
- **Web:** `pagehide` / `beforeunload` post `match_call_transition` via `fetch` + `keepalive: true` (session token ref); coordinates with `documentUnloadRpcIssuedRef` to avoid duplicate RPC vs React cleanup.
- **Native:** `AppState` → `background` fires the same RPC best-effort (async IIFE).
- **Exports:** `apps/mobile/lib/supabase.ts` exports `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` for reuse (optional).

No Edge Function or migration changes in this wave.

## Wave 3 — duplicate-call DB guard + conflict UX (2026-04-18)

### Database
- Migration `20260418210000_match_calls_one_open_per_match.sql`: preflight closes legacy duplicate `ringing`/`active` rows per `match_id` (keeps newest by `created_at`, `id`; older ringing → `missed`, older active → `ended` with derived duration), then **`CREATE UNIQUE INDEX uniq_match_calls_match_id_open ON match_calls (match_id) WHERE status IN ('ringing','active')`**.

### `daily-room` — `create_match_call`
- On `match_calls` insert **`23505`** (unique violation), responds **409** with `{ code: 'DUPLICATE_ACTIVE_CALL' }`, deletes the orphaned Daily room, and does **not** throw (avoids generic 503 wrapper). Other insert failures return **500** `INSERT_FAILED` with structured log.

### Clients
- Shared codes/messages: `shared/chat/matchCallEdgeCodes.ts` (`DUPLICATE_ACTIVE_CALL`, `TOKEN_ISSUE_FAILED`).
- Web `useMatchCall`: **`TOKEN_ISSUE_FAILED`** on answer → specific toast + local cleanup only (no `mark_missed`; server may have already ended the row after token rollback). Duplicate create → specific toast. Native `matchCallApi` returns `{ ok, code }`; overlays use **`Alert`** for these cases.

### Stale active/ringing (review only)
- **Wave 3** does not add new cleanup: `expire_stale_match_calls` (cron), client abnormal teardown (Waves 1–2), and `match-call-room-cleanup` remain the chain; the partial unique index only prevents duplicate *open* rows and does not replace expiry.

---

## Wave 4 — operational trust (2026-04-18)

### Reconciliation chain (audit; no redesign)

| Layer | Role | Notes |
|-------|------|--------|
| Client abnormal teardown | `cleanupLocalCall` + `match_call_transition` when appropriate | Web: `pagehide`/`beforeunload` keepalive; native: `AppState` background. Dev-only `[match_call_diag]` breadcrumbs for RPC ok/fail and unload/background. |
| `expire_stale_match_calls` | pg_cron ~1 min; `ringing` older than **90s** → `missed` | Migration `20260418220000_expire_stale_match_calls_log.sql`: **RAISE LOG** when `expired_count > 0` (Postgres server logs). |
| `match-call-room-cleanup` | HTTP cron; terminal rows with `ended_at` older than **120s** → best-effort Daily DELETE | Structured log `match_call_room_cleanup_batch` with `cutoff_iso`, `candidates`, `daily_delete_attempts`. |
| Daily | Rooms private; client `delete_room` + worker | Orphan rooms possible if both paths miss; worker is safety net, not primary UX path. |

### Observability (Edge)

- `create_match_call_rejected`: `reject_layer: "precheck"` on gate failures; duplicate DB insert: `create_match_call_duplicate_db` + `reject_layer: "db_unique"`.
- `answer_match_call_not_found`, `answer_match_call_token_failed_after_transition` (includes `match_id`, `callee_id`).
- `daily_room_unhandled_exception` replaces bare string in top-level catch.
- Room cleanup batch JSON (see above).

### Client tiny runtime fix

- **Outbound ringing restore:** If the DB row is `ringing` and the current user is **caller**, `reconcileCallRow` now sets tracked ids + phase + partner **before** the previous `!isTrackedRow` early return; bootstrap query also loads the latest **caller** `ringing` row after callee, so refresh/reopen shows outgoing ring state.

### QA artifact

- **`docs/qa/chat-call-wave4-validation.md`** — scenario matrix + log grep table for humans and future sessions.

## Wave 5 — edge contract robustness + UX code coverage (2026-04-18)

### `daily-room` hardening
- **Input validation** (defensive 400s instead of falling through to the top-level 503 catch):
  - `create_match_call`: `MISSING_MATCH_ID` when `matchId` is not a UUID.
  - `answer_match_call`: `MISSING_CALL_ID` when `callId`/`sessionId` is not a UUID.
  - `delete_room`: `MISSING_ROOM_NAME` when `roomName` is missing or does not match `^[A-Za-z0-9_-]{1,128}$`.
- **Orphan Daily room safety**: `create_match_call` now wraps the caller-token mint in try/catch. If token creation fails after the Daily room is created but before the `match_calls` insert, the room is `deleteDailyRoom`'d synchronously and the response is `503 TOKEN_ISSUE_FAILED`. Previously this path threw through the generic catch, leaving a Daily room orphaned until its 2h `exp` elapsed (no `match_calls` row = no cleanup-worker coverage). New structured log: `create_match_call_token_failed_pre_insert`.
- **Env-fallback observability**: module-level `console.warn` with event `daily_domain_env_fallback` when `DAILY_DOMAIN` is unset and the function falls back to the hardcoded default tenant. Makes the silent drift risk detectable in Edge Function logs.

### Shared edge codes (`shared/chat/matchCallEdgeCodes.ts`)
- `MATCH_CALL_EDGE_CODES` extended from `{ DUPLICATE_ACTIVE_CALL, TOKEN_ISSUE_FAILED }` to cover every `daily-room` response code: `ARCHIVED_MATCH`, `USERS_BLOCKED`, `PARTICIPANT_SUSPENDED`, `PARTICIPANT_PAUSED`, `PROFILE_UNAVAILABLE`, `ACCESS_DENIED`, `CALL_NOT_RINGING`, `NOT_FOUND`, `MISSING_MATCH_ID`, `MISSING_CALL_ID`, `MISSING_ROOM_NAME`, `UNAUTHORIZED`, `DAILY_PROVIDER_ERROR`.
- `MATCH_CALL_EDGE_MESSAGES` now includes friendly copy for `ARCHIVED_MATCH`, `USERS_BLOCKED`, `PARTICIPANT_SUSPENDED`, `PARTICIPANT_PAUSED`, `CALL_NOT_RINGING` (in addition to the pre-existing duplicate/token entries). Unknown codes still fall through to the caller's generic copy, so this is additive and safe.

### Clients
- **Web `useMatchCall` (`src/hooks/useMatchCall.tsx`)**:
  - `startCall`: unconditionally prefers `messageForMatchCallEdgeCode(createEdgeCode)` over the generic "Couldn't start call" toast; previously only `DUPLICATE_ACTIVE_CALL` got specific copy.
  - `answerCall`: on non-token answer failures, prefers the friendly message; also skips the client `mark_missed` RPC when the server already reports `CALL_NOT_RINGING` (the row is already terminal — avoids an expected-to-fail transition race).
- **Native `useMatchCall` (`apps/mobile/lib/useMatchCall.tsx`)**: mirror of the web changes for `Alert.alert` surfaces.
- **Native `matchCallApi.ts`**: removed the dead `active → answer` mapping from `updateMatchCallStatus`; answer is server-owned via `daily-room/answer_match_call`, so the native helper now only covers `ended | declined | missed`.

### Files
- `supabase/functions/daily-room/index.ts`
- `shared/chat/matchCallEdgeCodes.ts`
- `src/hooks/useMatchCall.tsx`
- `apps/mobile/lib/useMatchCall.tsx`
- `apps/mobile/lib/matchCallApi.ts`

### Validation
- `npm run typecheck:core` — clean.
- `npx tsc --noEmit -p tsconfig.app.json` — clean.
- `cd apps/mobile && npm run typecheck` — clean.
- `npm run lint` — 0 errors (pre-existing warnings backlog unchanged).

No migration changes, no RLS changes, no API contract breakage. All new behavior is additive defense + better UX copy; callers of `daily-room` continue to parse the same JSON shape.

## Remaining Risks
- No automated E2E/device/browser proof was added in this pass; cross-platform caller/callee validation is still a manual smoke-test requirement.
- Global incoming handling is now app-scoped, but there is still no dedicated push-ringing path for a fully backgrounded app/browser.
- Room deletion remains best-effort client cleanup via `daily-room delete_room` backed by the `match-call-room-cleanup` cron (terminal rows only); truly orphaned Daily rooms with no matching `match_calls` row still rely on Daily's own 2h room `exp` — Wave 5 closes the main source of such orphans (token-failure after room create), leaving only extreme paths (unhandled exception between `createDailyRoom` and the try/catch) uncovered.
