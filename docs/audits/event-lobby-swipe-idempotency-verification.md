# Event Lobby Swipe Idempotency Verification

Date: 2026-05-01  
Branch: `fix/event-lobby-swipe-idempotency`  
Supabase project ref: `schdyxcunwcvddlcshwd`

## Dependency Verification

Prompt 1 active-event contract is merged and deployed.

- Main/merge commit verified before branching: `22d30191e634a41d83288d01a5da8a0209426dfb`
- Local latest migration before this stream: `20260501223000_event_lobby_canonical_active_state.sql`
- Remote latest migration before this stream: `20260501223000`
- Remote migration parity before this stream: local and remote matched through `20260501223000`
- `supabase db push --linked --dry-run`: remote database up to date
- Remote `handle_swipe` had `get_event_lobby_active_state(...)` guards and delegated to `handle_swipe_20260501210000_idempotency_base`
- Deployed `swipe-actions` matched repo source before patch

Remote pre-patch definition checks:

- `handle_swipe` had canonical active-state guard: yes
- `handle_swipe` had Stream 7 duplicate replay guard: yes
- `handle_swipe` returned `already_swiped` for same-type duplicate: no
- `handle_swipe` still returned original-looking duplicate outcomes: yes
- `swipe-actions` deployment status: active, repo-matching source

## Pre-Audit Summary

Inspected:

- `handle_swipe`
- `swipe-actions`
- notification call paths to `send-notification`
- shared outcome adapters in `supabase/functions/_shared/matching/videoSessionFlow.ts`
- web `useSwipeAction`
- native lobby swipe handling
- existing Stream 7 retry tests and validation SQL

The Stream 7 wrapper already serialized the natural swipe key and returned before delegated mutation for duplicate rows. It suppressed notifications via `idempotent`, `replay`, `notification_suppressed`, and `dedupe_reason`.

The remaining contract gap was response truth: same-type retries without an existing active session still returned fresh-looking outcomes (`pass_recorded`, `vibe_recorded`, or `super_vibe_sent`). That was safe for mutation, but ambiguous for clients and notification side effects.

## Implemented Contract

Migration:

- `supabase/migrations/20260501224000_event_lobby_swipe_already_swiped.sql`

`handle_swipe(uuid, uuid, uuid, text)` now keeps:

- `SECURITY DEFINER`
- fixed `search_path`
- authenticated actor guard
- confirmed actor/target registration checks
- canonical active-event checks before replay/mutation
- block/report/hidden/discoverability checks
- existing delegated first-time mutation engine

Duplicate/no-op outcomes:

- same type, no active mutual session: `success: true`, `result: "already_swiped"`, `outcome: "already_swiped"`
- same type after existing mutual session: `already_matched` with existing `video_session_id`
- different type for same natural key: `success: false`, `result/error/outcome: "swipe_already_recorded"`
- duplicate after event becomes inactive: `success: false`, `result/error/outcome: "event_not_active"`

All duplicate paths include additive replay markers:

- `duplicate: true`
- `idempotent: true`
- `replay: true`
- `notification_suppressed: true`
- `dedupe_reason`

## Edge Function Delta

Changed:

- `supabase/functions/swipe-actions/index.ts`

`swipe-actions` now treats these as explicit no-notification outcomes:

- `already_swiped`
- `swipe_already_recorded`
- `event_not_active`
- `blocked`
- `reported`
- `account_paused`
- `target_unavailable`
- `participant_has_active_session_conflict`

It also suppresses when `duplicate`, `idempotent`, `replay`, or `notification_suppressed` is true, and logs safe structured dedupe context.

Fresh first-time notification behavior remains:

- `match`
- `match_queued`
- `super_vibe_sent`
- `vibe_recorded`

## Client Contract Delta

Changed:

- `supabase/functions/_shared/matching/videoSessionFlow.ts`
- `src/hooks/useSwipeAction.ts`
- `apps/mobile/app/event/[eventId]/lobby.tsx`

`already_swiped` is a quiet no-advance retry/no-op result. Web and native tolerate it without a noisy toast. Shared deck advancement treats it like `already_matched` / `swipe_already_recorded`: do not burn the current card.

## Rebuild Delta

Public contract surfaces changed:

- SQL/RPC: `handle_swipe` adds `already_swiped`, `outcome`, and `duplicate` on duplicate/no-op retry paths.
- Edge Function: `swipe-actions` returns the additive SQL fields and suppresses duplicate/no-op notifications.
- Shared client contract: `SwipeSessionStageResult` now includes optional `outcome` and `duplicate`.

Cloud artifacts to deploy after merge:

- Supabase migration: `20260501224000_event_lobby_swipe_already_swiped.sql`
- Edge Function: `swipe-actions`

No env vars, providers, RLS broadening, or destructive data changes.

## Validation Results

- `npx tsx shared/matching/swipeRetryIdempotencyNotificationDedupe.test.ts`: passed
- `npx tsx supabase/functions/_shared/matching/videoSessionFlow.test.ts`: passed
- `npx tsx shared/matching/eventLobbyCanonicalActiveState.test.ts`: passed
- `npm run test:hardening-contracts`: passed
- `npm run lint`: passed with existing warnings
- `npm run typecheck`: passed
- `npm run build`: passed with existing Vite chunk warnings
- `supabase db push --linked --dry-run`: clean; would apply only `20260501224000_event_lobby_swipe_already_swiped.sql`
- `deno check supabase/functions/swipe-actions/index.ts`: not run; `deno` is not installed in this workspace
- Post-deploy read-only catalog validation target: `supabase/validation/swipe_retry_idempotency_notification_dedupe.sql`

## Risks

- `already_swiped` is an additive result code, so stale clients that default unknown success results should remain safe. The shared web/native adapters were updated anyway.
- The first-time mutation engine is still delegated to the existing base function; this stream does not redesign super-vibe limits, queueing, or match creation.
- No production smoke data mutation is planned unless safe fixtures are explicitly available.
