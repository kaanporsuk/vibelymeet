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

## Remaining Risks
- No automated E2E/device/browser proof was added in this pass; cross-platform caller/callee validation is still a manual smoke-test requirement.
- Global incoming handling is now app-scoped, but there is still no dedicated push-ringing path for a fully backgrounded app/browser.
- Room deletion remains best-effort client cleanup via `daily-room delete_room`; there is still no server-side Daily teardown worker tied directly to terminal `match_calls` transitions.
