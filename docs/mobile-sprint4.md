# Mobile — Sprint 4: Daily Drop + Ready Gate Parity

Sprint 4 implements Daily Drop and Ready Gate on mobile using the same backend-owned contracts as web. No video-date room logic (Sprint 5); navigation into the existing date placeholder only.

## Repo contracts used

### Daily Drop
- **Data:** `daily_drops` table. Web `useDailyDrop` loads current drop: `or(user_a_id.eq.${userId}, user_b_id.eq.${userId})`, `gt('expires_at', now)`, order `drop_date` desc, limit 1. Partner from `profiles` (+ optional vibes). Mobile `lib/dailyDropApi.ts` mirrors this.
- **View:** RPC `daily_drop_transition(p_drop_id, p_action: 'view')` — backend marks viewed. Mobile calls it on first view (idempotent).
- **Opener / reply:** Edge Function `daily-drop-actions` with body `{ drop_id, action: 'send_opener' | 'send_reply', text }`. It calls RPC `daily_drop_transition` and sends notifications via `send-notification`. Mobile uses the same Edge Function; no direct `daily_drops` or `messages` writes.
- **Pass:** RPC `daily_drop_transition(p_drop_id, p_action: 'pass')`. Mobile uses same RPC.
- **Expiry:** Backend `expires_at`; client shows countdown and refetches when expired. No client-invented “today” logic.

### Ready Gate
- **Data:** `video_sessions` by session id. Web `useReadyGate` selects `ready_gate_status`, `ready_participant_1_at`, `ready_participant_2_at`, `snoozed_by`, `snooze_expires_at`; partner name from `profiles`. Mobile `lib/readyGateApi.ts` does the same and subscribes to realtime on `video_sessions`.
- **Transitions:** RPC `ready_gate_transition(p_session_id, p_action, p_reason)` with actions `mark_ready`, `snooze`, `forfeit`. Web and mobile use only this RPC; no direct updates to `video_sessions` for these states.
- **Navigation:** On `both_ready`, web goes to `/date/${id}` (session id). Mobile navigates to `/date/[id]` (existing placeholder). On `forfeit`, web returns to event lobby or home; mobile goes to event lobby if `event_id` is known, else tabs.

## Implemented in Sprint 4

1. **Daily Drop screen** (`app/daily-drop.tsx`): Loads current drop via `useDailyDrop`; shows partner card, expiry countdown, opener/reply UI; sends opener/reply via `daily-drop-actions`; pass via `daily_drop_transition` RPC; marks viewed via RPC on first view; when `chat_unlocked` and `match_id` exist, links to `/chat/[partnerId]`. Empty and expired states with refresh.
2. **Ready Gate screen** (`app/ready/[id].tsx`): Loads session and partner via `useReadyGate` + `video_sessions`/`profiles`; shows partner avatar/name, status (waiting / both ready / snoozed), countdown; actions: I'm ready, Snooze, Step away (forfeit) via `ready_gate_transition` RPC; on both_ready navigates to `/date/[id]`; on forfeit navigates to event lobby or tabs.

## Backend / shared changes

None. All behavior uses existing `daily_drops`, `video_sessions`, `daily_drop_transition`, `daily-drop-actions`, and `ready_gate_transition`.

## Web impact

None. No backend or web code changed.

## Remaining gaps after Sprint 4

- **Video date room:** Only navigation to `/date/[id]` placeholder; full live date (Sprint 5) not implemented.
- **Daily Drop past drops:** Web shows past drops list; mobile does not in this sprint.
- **Ready Gate countdown:** Web uses a fixed 30s gate timeout; mobile uses the same 30s countdown locally; actual expiry is backend-owned where applicable.

## What Sprint 5 covers

- Live video date: join room, state machine, end-of-call behavior using same backend/contracts as web. See `docs/mobile-sprint5.md`.

## Checks

- **Web:** `npm run typecheck:core`, `npm run build`, `./scripts/run_golden_path_smoke.sh` (from repo root).
- **Mobile:** `cd apps/mobile && npm run typecheck`.
