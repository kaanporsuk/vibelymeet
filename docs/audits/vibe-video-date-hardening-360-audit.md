# Vibe Video Date Hardening 360 Audit

Audit date: 2026-04-22. **Revision 2026-04-23:** Dashboard active-banner video end path corrected in repo (PR #476); related audit rows in §1, §4, and §14 updated below.

Scope: local repo at `Git/vibelymeet`, focused only on the hardened Vibe Video Date flow from Event Lobby / Ready Gate through handshake, Daily join, live date, reconnect, extension, end, survey, and finalization.

Authority note: this is a code and migration audit, not a live Supabase runtime proof. The local repo includes migrations dated `20260428` through `20260430`, which are after the environment date (`2026-04-22`). Current code treats those migrations as canonical, but deployed runtime must be verified before assuming production has them.

## 1. Executive summary

The hardened architecture is real: the core Ready Gate and Vibe Video Date lifecycle has moved into server-owned RPCs and Edge Functions. The canonical surfaces are present in current code:

- `ready_gate_transition(...)`
- `video_date_transition(...)`
- `daily-room`
- `mark_video_date_daily_joined(...)`
- reconnect/resume actions inside `video_date_transition(...)`
- `spend_video_date_credit_extension(...)`
- `post-date-verdict` -> `submit_post_date_verdict(...)`

The strongest hardening is in the database and Daily token gate. `video_sessions.state`, `video_sessions.phase`, `ended_at`, `ended_reason`, reconnect columns, handshake grace, Daily join stamps, and `date_extra_seconds` are now the durable record. Current web and native mostly call those surfaces instead of directly owning date transitions.

The remaining risk is not "move state back to the client." It is adoption drift and runtime fragility:

- **Resolved (2026-04-23, PR #476):** `ActiveCallBanner` video end calls `video_date_transition('end', p_reason: 'dashboard_active_banner')` (no direct `ended_at` write from this path).
- web and native date timers ignore `date_extra_seconds` during hydration/realtime;
- native session realtime can regress from `date` back to `handshake` because it checks `date_started_at` and then still applies `handshake_started_at`;
- vibe UI can indicate success without understanding `success:false` RPC payloads such as `GRACE_EXPIRED`;
- survey entry is not consistently tied to server-confirmed terminal state;
- Ready Gate polling uses direct selects rather than the `ready_gate_transition('sync')` action that exists for server-side reconciliation;
- reconnect sync is no longer every second forever, but it can still create noisy VDBG/Sentry breadcrumbs and does not recover cases where no client ever marks partner away.

## 2. Hardened architecture summary

### Current source-of-truth order

1. `video_sessions` is the single durable source of truth for video-date phase:
   - `state`: enum `ready_gate | handshake | date | post_date | ended`
   - `phase`: legacy/string mirror used by current clients
   - `ended_at`, `ended_reason`
   - `handshake_started_at`, `handshake_grace_expires_at`, `date_started_at`
   - reconnect fields: `reconnect_grace_ends_at`, `participant_1_away_at`, `participant_2_away_at`
   - Daily evidence: `participant_1_joined_at`, `participant_2_joined_at`
   - extension budget: `date_extra_seconds`
2. `event_registrations.queue_status` remains a routing/admission hint:
   - `in_ready_gate`, `in_handshake`, `in_date`, `in_survey`, `browsing`, `idle`, `offline`
   - it is not reliable enough to override a live `video_sessions` row.
3. Daily provider presence is runtime evidence only:
   - Daily participants/events can drive reconnect signals and track mounting.
   - Daily does not decide the backend date phase.
4. Client latches are bounce-prevention aids only:
   - web: `src/lib/dateEntryTransitionLatch.ts`
   - native: `apps/mobile/lib/dateEntryTransitionLatch.ts`
   - both use a `VIDEO_DATE_ENTRY_PIPELINE_TTL_MS` of `180000`.

### Completed hardening streams

| Stream | What changed | Source of truth now | Replaced behavior | Risk removed |
| --- | --- | --- | --- | --- |
| Server state machine | `video_date_state`, `video_date_transition(...)` added and later expanded | `video_sessions.state/phase` via RPC | client-owned phase changes | double-end, stale local phase, non-atomic match/date transitions |
| Ready Gate RPC | `ready_gate_transition(...)` owns mark ready, snooze, forfeit, sync | `video_sessions.ready_gate_*` via RPC | client mutating ready state/status | split-brain ready status and terminal races |
| Ready Gate expiry and TTL | `expire_stale_video_sessions()` and cron-oriented cleanup | DB cleanup function | UI timers as only expiry source | stale ready/queued rows |
| Reconnect grace | `sync_reconnect`, `mark_reconnect_partner_away`, `mark_reconnect_return`, cron expiry | DB reconnect columns | UI-only partner-away state | recoverable disconnects becoming silent local state |
| Handshake grace | `handshake_grace_expires_at`, NULL vs PASS semantics, observability | DB RPC | immediate no-match on missing late response | false early no-match on last-second taps |
| Daily token gate | `daily-room` checks non-ended handshake/date or valid `both_ready` | Edge Function + `video_sessions` | clients creating rooms from local route state | unauthorized room/token issuance |
| Join evidence | `participant_1_joined_at`, `participant_2_joined_at`, `mark_video_date_daily_joined` | DB RPC after Daily join | no durable proof of actual join | wrong expiry/end classification after join |
| Room cleanup | video-date `delete_room` skips provider delete; cron-owned cleanup | `video-date-room-cleanup` | browser unload deleting rooms | delete races against reconnect/trailing partner |
| Credit extension | `spend_video_date_credit_extension` + `date_extra_seconds` | DB RPC | client-only time extension | paid credit spend without server duration budget |
| Post-date verdict | `post-date-verdict` Edge -> `submit_post_date_verdict` | DB RPC + Edge | client creating matches/verdicts | inconsistent match/no-match resolution |

## 3. Backend hardening inventory

### Migrations and functions

| Area | Current migration(s) | Function/table surface | Backend/client/mixed | Both platforms adopted? |
| --- | --- | --- | --- | --- |
| Base video state machine | `20260311133000_video_date_state_machine.sql` | `video_date_state`, `video_date_transition` | backend | yes, but client compatibility gaps remain |
| Base Ready Gate transition | `20260311153000_ready_gate_transition.sql` | `ready_gate_transition` | backend | yes |
| Enter-handshake Ready Gate guard | `20260404140000_video_date_enter_handshake_ready_gate_guard.sql` | `video_date_transition('enter_handshake')` | backend | yes |
| Phase 2 queue/TTL/ready sync | `20260404195500_phase2_queue_ttl_ready_gate_sync_daily_gate.sql` | `queued_expires_at`, `expire_stale_video_sessions`, `ready_gate_transition('sync')` | backend | partial, clients do not call ready `sync` in polling |
| Reconnect grace | `20260409100000_video_date_reconnect_grace_queue_sync.sql`, `20260409110000_expire_video_date_reconnect_grace_cron.sql` | reconnect columns, reconnect actions, cron | backend + clients | yes |
| Event-loop observability | `20260423120000_event_loop_observability.sql`, `20260425120000_event_loop_observability_retention_prune.sql` | `event_loop_observability_events`, `record_event_loop_observability`, prune RPC | backend | partial coverage |
| P0/P1 closure | `20260428120000_video_date_p0_p1_closure.sql` | phase expiry, latest `ready_gate_transition`, `update_participant_status` allowlist | backend | yes |
| Credit extension budget | `20260428120100_video_date_credit_extension_budget.sql` | `date_extra_seconds`, `spend_video_date_credit_extension` | backend + clients | yes, timer adoption incomplete |
| Room cleanup | `20260429101000_schedule_video_date_room_cleanup_cron.sql`, `20260429102000_video_date_transition_preserve_daily_room_until_cleanup.sql` | `video-date-room-cleanup`, room retention | backend + Edge | yes |
| Daily join stamps | `20260429131000_video_date_participant_joined_at.sql` | `mark_video_date_daily_joined` | backend + clients | yes |
| Join guard cleanup | `20260429133000_ready_gate_expiry_join_guard.sql` | expiry/update status guards using joined/start evidence | backend | yes |
| Handshake hardening | `20260430090000_video_date_handshake_hardening.sql` | `handshake_grace_expires_at`, richer return shapes, observability | backend | partial client understanding |
| Handshake grace cleanup | `20260430100000_video_date_handshake_grace_expiry_cleanup.sql` | `expire_stale_video_date_phases` handles grace expiry | backend | yes |
| Complete-handshake observability | `20260430091000...`, `20260430113000...` | trigger enrichment for `complete_handshake` observability | backend | yes |
| Legacy leave consistency | `20260430123000_leave_matching_queue_terminal_state_consistency.sql` | deprecated `leave_matching_queue` sets state/phase ended | backend compatibility | client calls not found |

### `video_date_transition(...)` actions supported today

Latest definition: `supabase/migrations/20260430090000_video_date_handshake_hardening.sql`.

| Action | Main return shape | Notes |
| --- | --- | --- |
| `sync_reconnect` | `{ success, reconnect_grace_ends_at, participant_1_away_at, participant_2_away_at, ended, ended_reason, state, phase, partner_marked_away }` | also lazily expires elapsed reconnect grace before returning |
| `mark_reconnect_partner_away` | success with reconnect/away fields, or `SESSION_ENDED` / `INVALID_PHASE` | sets the partner-away slot and 30s grace |
| `mark_reconnect_return` | success with reconnect/away fields, or `SESSION_ENDED` | clears caller's away slot and clears grace when both are present |
| `enter_handshake` | success `state:'handshake'`, or false `SESSION_ENDED`, `READY_GATE_NOT_READY` | idempotent once handshake/date is already active |
| `vibe` | success `state:'handshake'|'date'|'ended'`, or false `SESSION_ENDED` / `GRACE_EXPIRED` | records actor's pre-date vibe; no explicit client `pass` action exists |
| `complete_handshake` | success `state:'date'|'handshake'|'ended'`, optional `waiting_for_partner`, `grace_expires_at`, `seconds_remaining`, `already_ended`, `reason` | starts/observes/expires 15s handshake grace |
| `end` | success `state:'ended'`, optional `already_ended` | server-owned terminal path; reason changes event-registration status behavior |

Global false/error returns also include `UNAUTHORIZED`, `SESSION_NOT_FOUND`, `ACCESS_DENIED`, and `UNKNOWN_ACTION`.

### `ready_gate_transition(...)` actions supported today

Latest definition: `supabase/migrations/20260428120000_video_date_p0_p1_closure.sql`.

| Action | Main return shape | Notes |
| --- | --- | --- |
| `sync` | `{ success:true, status, ready_participant_1_at, ready_participant_2_at, ready_gate_expires_at, snooze_expires_at }` | calls `expire_stale_video_sessions()` first |
| terminal short-circuit | `{ success:true, status }` | for `forfeited`, `expired`, `both_ready` |
| `mark_ready` | `{ success:true, status:new_status }` | row-locked, idempotent-ish via timestamp coalescing; refreshes `both_ready` window to now + 30s |
| `snooze` | `{ success:true, status:'snoozed', snooze_expires_at }` | stores actor and 2 minute snooze |
| `forfeit` | `{ success:true, status:'forfeited' }` | ends session and clears both registrations |
| unknown | `{ success:false, error:'Invalid action' }` | no mutation |

### Generated/shared types

`src/integrations/supabase/types.ts` includes current DB columns and functions:

- `video_sessions.Row` includes `daily_room_name`, `daily_room_url`, `date_extra_seconds`, `handshake_grace_expires_at`, `participant_*_joined_at`, reconnect fields, `state`, and `phase`.
- Functions include `mark_video_date_daily_joined`, `ready_gate_transition`, `spend_video_date_credit_extension`, `submit_post_date_verdict`, and `video_date_transition`.
- Return shapes are typed only as `Json`, so web/native manually cast payloads. That is a compatibility risk for richer hardened returns.

## 4. Web adoption inventory

### Adopted correctly

| File | Hardened behavior |
| --- | --- |
| `src/pages/VideoDate.tsx` | route guard fetches `video_sessions`, ignores stale `in_ready_gate` when session is handshake/date-capable, enters handshake via RPC, subscribes to `video_sessions`, calls `video_date_transition('vibe'|'complete_handshake'|'end')`, calls credit RPC, shows survey through `PostDateSurvey` |
| `src/hooks/useVideoCall.ts` | prejoin truth fetch, `sync_reconnect`, idempotent `enter_handshake`, `daily-room create_date_room`, Daily join, `mark_video_date_daily_joined`, no client provider delete |
| `src/hooks/useReconnection.ts` | uses `sync_reconnect`, `mark_reconnect_partner_away`, `mark_reconnect_return`; backoff is 1s/3s/7s, not fixed 1s forever |
| `src/components/lobby/ReadyGateOverlay.tsx` | uses `useReadyGate`, date-entry latch, video-session truth reconciliation, navigates date only after server readiness |
| `src/lib/dateEntryTransitionLatch.ts` | 180s route latch, explicitly non-business state |
| `src/components/video-date/KeepTheVibe.tsx` | phase-gated by parent; calls server credit spend via parent |
| `src/components/video-date/PostDateSurvey.tsx` | mandatory verdict through `post-date-verdict`, optional feedback updates to `date_feedback` |

### Web gaps

| File | Gap | Risk |
| --- | --- | --- |
| `src/pages/Dashboard.tsx` | ~~Previously bypassed RPC.~~ **2026-04-23:** video-mode `onEnd` calls `video_date_transition('end')` with reason `dashboard_active_banner` (no direct `ended_at` write). | resolved in code; verify prod telemetry |
| `src/hooks/useActiveSession.ts` | uses registration as first-class route authority and only confirms `ended_at`, not `state/phase/handshake_started_at` | route drift, stale ready gate can still steer UI |
| `src/hooks/useReadyGate.ts` | 2s polling reads `video_sessions` directly, does not call `ready_gate_transition('sync')` | fallback does not execute server expiry/reconciliation |
| `src/pages/VideoDate.tsx` | date timer hydration/realtime ignores `date_extra_seconds` | paid extension can disappear after reload/realtime and client can end early |
| `src/pages/VideoDate.tsx` | realtime ended path sets `phase='ended'` but does not open survey | users can land on ended surface instead of survey |
| `src/components/video-date/VibeCheckButton.tsx` | marks `hasVibed=true` before backend result | UI can imply state change before backend confirmation |
| `src/pages/VideoDate.tsx` | `handleUserVibe` logs payload but ignores `success:false` | `GRACE_EXPIRED` / `SESSION_ENDED` can look like a successful tap |
| `src/pages/VideoDate.tsx` | `handleCallEnd` opens survey before `end` RPC confirms | survey can imply terminal state if RPC/network fails |
| `src/pages/ReadyRedirect.tsx` | `/ready/:id` only accepts `queue_status='in_ready_gate'`; if backend already says handshake/date, it redirects to lobby instead of date | route parity/UX gap |
| `src/pages/VideoDate.tsx` | `handleMutualToastComplete` fires `video_date_extended` when date starts | observability false signal |

## 5. Native adoption inventory

### Adopted correctly

| File | Hardened behavior |
| --- | --- |
| `apps/mobile/app/date/[id].tsx` | date-entry latch, route truth check, `enter_handshake` before Daily token, `create_date_room`, Daily join, join stamp, reconnect sync, grace handling, survey end path |
| `apps/mobile/lib/videoDateApi.ts` | wrappers for `video_date_transition`, `daily-room`, `mark_video_date_daily_joined`, post-date verdict, credit extension |
| `apps/mobile/lib/useActiveSession.ts` | improves on web by checking `videoSessionIndicatesHandshakeOrDate` and ready-gate eligibility before returning active session |
| `apps/mobile/components/NativeSessionRouteHydration.tsx` | blocks `/date` -> `/ready` bounce when server row is already handshake/date-capable or latch is active |
| `apps/mobile/app/ready/[id].tsx` | standalone Ready Gate uses `useReadyGate`, date-entry latch, media permission precheck, route decision after both-ready |
| `apps/mobile/components/lobby/ReadyGateOverlay.tsx` | lobby overlay uses same ready RPC hook and date-entry latch |
| `apps/mobile/components/video-date/KeepTheVibe.tsx` | native now has Extra Time / Extended Vibe parity controls |
| `apps/mobile/components/video-date/PostDateSurvey.tsx` | native survey uses same `post-date-verdict` backend and persists optional feedback |

### Native gaps

| File | Gap | Risk |
| --- | --- | --- |
| `apps/mobile/lib/videoDateApi.ts` | realtime handler sets `date` when `date_started_at` is present, then immediately sets `handshake` when `handshake_started_at` is also present | correctness-critical native phase regression |
| `apps/mobile/lib/videoDateApi.ts` | timer hydration/realtime ignores `date_extra_seconds` | paid extension can disappear after reload/realtime |
| `apps/mobile/lib/videoDateApi.ts` | `recordVibe` returns `!error`, ignoring payload `success:false` | UI can mark Vibed on `GRACE_EXPIRED` / `SESSION_ENDED` |
| `apps/mobile/app/date/[id].tsx` | server-reported end from `sync_reconnect` opens survey only if `partnerEverJoinedRef.current` is true | ended date can show "Date ended" with no survey |
| `apps/mobile/app/date/[id].tsx` | `handleCallEnd` opens feedback before server end confirmation | same confirmation gap as web |
| `apps/mobile/app/ready/[id].tsx` | standalone ready screen treats non-`in_ready_gate` registration as stale, even if video session is already startable | route parity/UX gap |
| `apps/mobile/lib/videoDateApi.ts` | `deleteDailyRoom` helper/comment is stale for video dates; Edge now skips video-date deletion | stale assumption only if reintroduced |

## 6. Authoritative state machine

### States

| Layer | State | Owner | Notes |
| --- | --- | --- | --- |
| Ready Gate | `queued`, `ready`, `ready_a`, `ready_b`, `snoozed`, `both_ready`, `forfeited`, `expired` | `ready_gate_transition`, `drain_match_queue`, `expire_stale_video_sessions` | `both_ready` is terminal for Ready Gate but not terminal for video session |
| Handshake | `video_sessions.state/phase='handshake'`, `handshake_started_at` | `video_date_transition('enter_handshake')` | clients may join Daily only after server permits token |
| Handshake grace | `handshake_grace_expires_at` | `video_date_transition('complete_handshake')`, `expire_stale_video_date_phases` | 15s window for NULL response preservation |
| Live date | `state/phase='date'`, `date_started_at` | `video_date_transition('vibe'|'complete_handshake')` | current clients do not write phase directly |
| Reconnect | `reconnect_grace_ends_at`, `participant_*_away_at` | reconnect actions and cron/lazy expiry | Daily events trigger RPCs, DB owns result |
| End | `state/phase='ended'`, `ended_at`, `ended_reason` | `video_date_transition('end')`, expiry functions, reconnect cron | direct client writes should not exist |
| Survey | `event_registrations.queue_status='in_survey'` plus ended video session | `video_date_transition('end')`, survey clients | verdict persistence is separate |
| Verdict/finalization | `date_feedback`, `matches`, overwritten participant liked flags | `post-date-verdict` -> `submit_post_date_verdict` | only one user can submit; mutual match happens when both verdicts are positive |

### Transition properties

| Transition | Trigger | Authority | Validation | Idempotency / duplicate behavior |
| --- | --- | --- | --- | --- |
| queued -> ready | queue drain / foreground | DB RPCs | live event, both participants present/eligible | `SKIP LOCKED`, row locks |
| ready -> both_ready | both users mark ready | `ready_gate_transition('mark_ready')` | participant auth, non-terminal row | duplicate ready uses existing timestamp and terminal short-circuit |
| ready -> forfeited/expired | user skip/timer/cleanup | `ready_gate_transition('forfeit')`, `expire_stale_video_sessions` | row lock, terminal guards | terminal short-circuit |
| both_ready -> handshake | `/date` bootstrap | `video_date_transition('enter_handshake')` | participant, not ended, `both_ready` or already handshake/date | idempotent when already active |
| handshake -> date | mutual pre-date vibe | `video_date_transition('vibe')` or `complete_handshake` | both liked true, not ended | duplicate returns date state |
| handshake -> grace | handshake timer with NULL response | `complete_handshake` | one or both liked fields NULL | first call starts grace, later calls return grace active |
| grace -> ended | grace elapsed | `complete_handshake` or `expire_stale_video_date_phases` | elapsed `handshake_grace_expires_at` | terminal afterwards |
| date -> ended | timer, leave, beforeunload, expiry | `video_date_transition('end')`, expiry functions | participant or cron | already-ended returns success with `already_ended` |
| date -> reconnect limbo | Daily partner left/interrupted | `mark_reconnect_partner_away` | state handshake/date, not ended | duplicate preserves existing grace |
| reconnect -> active | Daily/local return | `mark_reconnect_return` | not ended | clears own away slot; clears grace if both slots null |
| ended -> survey | client render after end | client rendering from server terminal | should require joined/live date evidence | adoption differs |
| survey -> verdict final | user taps vibe/pass | `post-date-verdict` Edge + RPC | auth, participant, session row | per-user upsert feedback, mutual match check |

### Explicit answers

- Single source of truth for handshake vs live date vs ended: `video_sessions.state`, `video_sessions.phase`, and `ended_at`; `handshake_started_at` and `date_started_at` are timing evidence.
- Truly server-authoritative transitions: Ready Gate readiness/snooze/forfeit, handshake entry, vibe/mutual advance, complete-handshake/grace, reconnect away/return/sync expiry, date end, stale phase expiry, Daily room token permission, credit spend, verdict/match finalization.
- Client heuristics still present: route latches, timer countdowns, Daily participant presence, `event_registrations` active-session hydration, first-connect watchdog, peer-missing UI, local survey opening.
- Silent success/no-mutation branches: expected `sync`, Ready Gate terminal short-circuit, `complete_handshake` grace active/already ended, `end` already ended, reconnect return when no slot was set. These are safe only when clients inspect payload state.
- UI-before-backend confirmation exists in web/native vibe buttons, reconnect overlay start, and end/survey opening.

## 7. Handshake hardening audit

### Current contract

`enter_handshake` starts the server timer after both-ready. `vibe` persists the actor's pre-date positive consent. `complete_handshake` resolves mutual/non-mutual outcomes and owns the 15s grace window. Post-date survey does not use `complete_handshake`; it uses `post-date-verdict` and `submit_post_date_verdict`.

Important distinction: the backend now distinguishes `NULL` from `false`. `NULL` means no pre-date response yet. `false` means pass/non-vibe. Current clients do not expose an explicit pre-date pass action, so `false` is mostly produced by grace expiry or by later post-date verdict writes to the same columns.

### Handshake table

| Action | Preconditions | Mutation | Possible return outcomes | Observability | Edge cases | Client compatibility risks |
| --- | --- | --- | --- | --- | --- | --- |
| `enter_handshake` | auth, participant, not ended, `both_ready` or already handshake/date | sets `state/phase='handshake'`, `handshake_started_at`, clears reconnect fields, regs `in_handshake` | success handshake; false `SESSION_ENDED`; false `READY_GATE_NOT_READY`; access errors | records ended, not-ready, already-active/entered | duplicate call is safe | clients must not fall back to local phase; current clients mostly comply |
| `vibe` | auth, participant, not ended | sets participant liked true; if mutual advances to date; if partner false ends; if grace elapsed coerces NULLs false and ends | success `state:'handshake'` waiting; success `state:'date'`; success `state:'ended'`; false `SESSION_ENDED`; false `GRACE_EXPIRED` | records mutual advance, partner passed, awaiting partner, grace-expired | late tap after grace is blocked/ended by RPC | web/native mostly ignore payload false; UI can show Vibed incorrectly |
| `complete_handshake` | auth, participant/session access | mutual -> date; both non-null non-mutual -> ended; NULL -> start/maintain/expire grace | success date; success handshake waiting; success ended; success already_ended | enriched complete-handshake details include actor, liked flags, grace status | already-ended returns `success:true` with `already_ended` | richer shape is only partially understood; generic success can mislead |
| `expire_stale_video_date_phases` | cron/manual server call | expires elapsed handshake grace, handshake timeout, date timeout | count JSON with `handshake_timeout`, `handshake_grace_expired`, `date_timeout`, `total` | not per-session rich event rows | server can end without client realtime | clients must open survey/terminal correctly on realtime/poll |
| `end` while handshake/date | participant or client unload/leave | terminal state, reason, duration, registration status | success ended, success already_ended | not as complete as handshake paths | beforeunload after join sends both to survey, prejoin beforeunload only actor offline | direct client bypass exists in Dashboard |

### Verification answers

- False early no-match on last-second taps: mostly fixed at backend by 15s grace. Late `vibe` after grace expiry cannot advance an ended session; it returns `GRACE_EXPIRED` or terminal.
- Late taps after grace expiry creating inconsistent state: backend prevents inconsistent mutation. Client UI may still mark "Vibed" if it ignores `success:false`.
- Already-ended sessions returning misleading success: `complete_handshake` and `end` return success with `already_ended`; this is intentionally idempotent but risky for clients that treat any success as an active mutation.
- Web/native return-shape support: both understand `complete_handshake` grace enough for the main timer path. Neither fully handles `vibe` false payloads. Native `recordVibe` explicitly returns `!error`, so false JSON success is lost.

## 8. Realtime / polling / hydration audit

### Mechanism table

| Platform | File | Mechanism | Target/cadence | Start/stop | Purpose | Correctness dependency | Dup/noise/limbo risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Web | `src/hooks/useActiveSession.ts` | active-session reg realtime | `event_registrations` `*` by `profile_id` | auth mount/unmount | active ready/date banner/hydration | medium | event_reg first can route stale state |
| Web | `src/hooks/useActiveSession.ts` | active-session video realtime | `video_sessions` `*` by `event_id` | event-scoped | refetch active session | medium | only event-scoped; global dashboard can miss video row context |
| Web | `src/hooks/useActiveSession.ts` | active-session polling | 8s | auth mount/unmount | missed realtime fallback | low/medium | cost noise, no phase-aware truth |
| Web | `src/pages/EventLobby.tsx` | own reg realtime | `event_registrations` UPDATE by profile | lobby mount | open ready gate or navigate date | high for UX | duplicates `useActiveSession` |
| Web | `src/pages/EventLobby.tsx` | video_sessions realtime | UPDATE/INSERT by event | lobby mount | open ready gate or navigate date from video truth | high for UX | duplicates active-session hook |
| Web | `src/pages/EventLobby.tsx` | lobby foreground RPC | `mark_lobby_foreground` every 30s when visible/browsing/idle | visible lobby | queue eligibility | backend correctness for queue promotion | expected cost |
| Web | `src/hooks/useMatchQueue.ts` | queue drain | `drain_match_queue` on status browsing/idle; no interval | when status changes | promote queued matches | medium | not continuous on web |
| Web | `src/hooks/useMatchQueue.ts` | queue realtime | `video_sessions` UPDATE/INSERT by event | hook mount | ready gate from queued sessions | medium | duplicates lobby video subscription |
| Web | `src/hooks/useReadyGate.ts` | ready realtime | `video_sessions` UPDATE by id | overlay mount | ready state | high for UI | fine |
| Web | `src/hooks/useReadyGate.ts` | ready polling | direct select every 2s until terminal | overlay mount | missed realtime fallback | medium | does not call `ready_gate_transition('sync')` |
| Web | `src/pages/VideoDate.tsx` | date realtime | `video_sessions` UPDATE by id | date mount | phase/timer/grace | high for UI | ended path does not open survey |
| Web | `src/pages/VideoDate.tsx` | countdown | 1s | connected, phase active | timer UI, triggers complete/end | medium | ignores server extension budget after hydration |
| Web | `src/hooks/useVideoCall.ts` | Daily events | participant joined/updated/left, network, camera | call object | tracks/presence | high for media/reconnect | no server phase authority |
| Web | `src/hooks/useReconnection.ts` | reconnect sync | immediate + 1s for 5s, 3s until 20s, 7s after | mount/phase/events/grace | lazy expiry and limbo fallback | medium/high | VDBG/Sentry spam; not every second forever |
| Web | `src/pages/VideoDate.tsx` | beforeunload keepalive | REST RPC end | unload | terminal cleanup | medium | keepalive not guaranteed |
| Native | `apps/mobile/lib/useActiveSession.ts` | active-session reg realtime | `event_registrations` `*` by profile | auth mount | route active session | medium | better phase checking than web |
| Native | `apps/mobile/lib/useActiveSession.ts` | active-session video realtime | `video_sessions` `*` by event | event-scoped | route active session | medium | duplicates lobby subscriptions |
| Native | `apps/mobile/lib/useActiveSession.ts` | active-session polling | 8s | auth mount | missed realtime fallback | low/medium | cost noise |
| Native | `apps/mobile/app/event/[eventId]/lobby.tsx` | queue drain interval | `drain_match_queue` every 10s while queued/focused | focused active lobby | queued convergence | medium | backend RPC cost |
| Native | `apps/mobile/app/event/[eventId]/lobby.tsx` | mark foreground | every 30s | focused active lobby | queue eligibility | medium | expected |
| Native | `apps/mobile/lib/readyGateApi.ts` | ready realtime | `video_sessions` UPDATE by id | ready screen/overlay | ready state | high for UI | fine |
| Native | `apps/mobile/lib/readyGateApi.ts` | ready polling | direct select every 2s until terminal | ready screen/overlay | missed realtime fallback | medium | same `sync` adoption gap |
| Native | `apps/mobile/lib/videoDateApi.ts` | session realtime | `video_sessions` UPDATE by id | date hook mount | phase/timer/grace/join stamps | high | date->handshake regression bug |
| Native | `apps/mobile/app/date/[id].tsx` | AppState refetch/sync | foreground/background | app lifecycle | resume truth | medium/high | duplicates reconnect sync |
| Native | `apps/mobile/app/date/[id].tsx` | reconnect sync | immediate + 1s/3s/7s backoff | mount/phase/events/grace | lazy expiry and limbo fallback | medium/high | VDBG/Sentry spam |
| Native | `apps/mobile/app/date/[id].tsx` | first-connect watchdog | 25s + one auto rejoin | local joined, no remote | Daily runtime recovery | UX-critical | can show peer-missing without backend terminal |
| Native | `apps/mobile/app/date/[id].tsx` | countdown | 1s | joined/remote present | timer UI/end/complete | medium | ignores server extension budget after hydration |

### Required answers

1. `sync_reconnect` is not still every second indefinitely. Web and native use immediate calls plus backoff: 1s for the first 5s, 3s until 20s, then 7s.
2. Reconnect polling is correctness-critical as a fallback for lazy reconnect expiry and missing realtime, but it is not sufficient if no client ever calls `mark_reconnect_partner_away`.
3. Missing realtime can still strand users if Daily events are also missed and no away/return RPC is fired. Polling can discover existing server grace/end, not invent it.
4. Active-session hydration can fight current route state. Latches and date-page guards reduce this; web `useActiveSession` is less phase-aware than native.
5. Web and native stop conditions differ mostly around server-ended survey behavior and peer joined evidence. Native only opens survey from realtime ended when `partnerEverJoinedRef.current` is true.
6. Observability is not flooded in `event_loop_observability_events` by normal `sync_reconnect`, but VDBG/Sentry breadcrumbs can be noisy.

## 9. Daily lifecycle audit

### Current backend Daily contract

`supabase/functions/daily-room/index.ts`:

- `canIssueVideoDateRoomToken` allows tokens only when:
  - session is not ended, and
  - `state` is `handshake` or `date`, or `handshake_started_at` exists, or
  - `ready_gate_status='both_ready'` and `ready_gate_expires_at` is in the future.
- `create_date_room`:
  - verifies auth and participant;
  - rejects ended session;
  - gates by `canIssueVideoDateRoomToken`;
  - uses room name `session.daily_room_name || date-${sessionIdWithoutHyphens}`;
  - creates or reuses provider room;
  - if stored room is missing/expired at Daily, recreates it and rewrites row;
  - issues a 7200s token;
  - returns `room_name`, `room_url`, `token`, `reused_room`, `provider_room_recreated`.
- `join_date_room` exists, requires an existing `daily_room_name`, and returns a token. Current web and native audited paths call `create_date_room`, not `join_date_room`.
- `delete_room` verifies participant authorization but skips provider deletion for `roomType='video_date'` and returns `VIDEO_DATE_CLEANUP_OWNED_BY_CRON`.

`supabase/functions/video-date-room-cleanup/index.ts`:

- CRON secret protected.
- selects ended sessions with `daily_room_name IS NOT NULL` and `ended_at <= now - 120s`, limit 40.
- deletes provider room, 404 counts as OK.
- clears `daily_room_name` and `daily_room_url`.
- scheduled every 5 minutes by `20260429101000_schedule_video_date_room_cleanup_cron.sql`.

### Web Daily runtime

`src/hooks/useVideoCall.ts`:

- does prejoin `video_sessions` truth fetch;
- calls `sync_reconnect`;
- calls `enter_handshake` only if not already handshake/date;
- calls `daily-room create_date_room`;
- creates Daily iframe call object with audio/video sources;
- attaches local/remote tracks from Daily participant `persistentTrack`;
- after `join`, calls `mark_video_date_daily_joined`;
- skips provider delete on end/unload.

Track-mounting observations:

- `attachTracks` always creates a new `MediaStream` and assigns `videoEl.srcObject`.
- track-id optimization avoids rebuilding some streams on unchanged keys.
- `lastRemoteStreamRef` is set to null but not used as a cache.
- if a video element loses `srcObject` while track IDs remain unchanged, the remote `participant-updated` branch may not reattach.

### Native Daily runtime

`apps/mobile/app/date/[id].tsx`:

- requests camera/mic before token fetch;
- fetches session truth and calls `enterHandshakeWithTimeout`;
- calls `daily-room create_date_room`;
- creates a singleton Daily call object per session;
- joins via `call.join`;
- calls `markVideoDateDailyJoined` and refetches session on success;
- renders `DailyMediaView` with `persistentTrack` from `getTrack`;
- uses Daily participant events to promote remote participant into UI;
- runs a 25s first-connect watchdog with one automatic leave/rejoin before peer-missing UI.

### Required Daily answers

1. Architecture and join order are mostly aligned. Current clients call `enter_handshake` before `create_date_room`; the Edge Function is more permissive and still allows valid nonexpired `both_ready`.
2. Web and native do not mount tracks the same way. Web builds `MediaStream` and assigns `<video>.srcObject`; native passes `persistentTrack` directly to `DailyMediaView`.
3. Frozen-first-frame / blank-tile issues are primarily client track mounting/runtime issues, not backend phase assumptions. Backend could contribute only indirectly through premature end/room cleanup or token denial.
4. Recent track-id optimization reduces rebuilds but can surface stale-stream risk if element attachment disappears without track ID change.
5. Web rebuilds streams on track changes and join snapshots. Native stores DailyParticipant and lets `DailyMediaView` render tracks. Rebuilds are not excessive on native; web has some redundant attach paths but not catastrophic.
6. `delete_room` no longer races video-date reconnect because it skips video-date deletion. Cron cleanup can only delete after `ended_at` plus 120s.
7. Current cleanup should not end a recoverable session, except where another bug sets `ended_at` directly. The Dashboard direct `ended_at` update can make cron delete a room without canonical terminal semantics.

## 10. Route truth / bounce-prevention audit

### Web

Route flow:

1. Event Lobby detects queued/ready session through `useMatchQueue`, registration realtime, video-session realtime, and scoped `useActiveSession`.
2. Ready Gate overlay calls `ready_gate_transition`.
3. On `both_ready`, overlay marks date-entry latch and navigates `/date/:sessionId`.
4. `SessionRouteHydration` may bounce `/date` back to lobby if active session says ready gate, but blocks the bounce when:
   - date-entry latch is active,
   - `video_sessions` row is unavailable,
   - row is ended,
   - row already indicates handshake/date.
5. `VideoDate` independently checks `video_sessions` and registration before allowing entry.

Drift:

- `shared/matching/activeSession.ts` says registration queue status is authoritative for routing. That is stale for hardened video phase; `video_sessions` is more authoritative for handshake/date/ended.
- `src/hooks/useActiveSession.ts` only checks `ended_at`, not `state/phase/handshake_started_at`, before returning a ready/video active session.

### Native

Route flow:

1. Native lobby uses `useActiveSession`, registration realtime, video-session realtime, and route-decision helper.
2. Native `useActiveSession` checks `videoSessionIndicatesHandshakeOrDate` and ready-gate eligibility before choosing ready vs date.
3. `NativeSessionRouteHydration` blocks `/date` -> `/ready` if latch is active or `video_sessions` says handshake/date.
4. `app/date/[id].tsx` runs an additional date-entry truth guard.

Native is more phase-aware than web in `useActiveSession`, but standalone `/ready/[id]` can still treat an already-startable date as stale if registration is not `in_ready_gate`.

## 11. Credits / extension audit

### Current contract

Backend:

- `spend_video_date_credit_extension(p_session_id, p_credit_type)`:
  - `extra_time` adds 120s;
  - `extended_vibe` adds 300s;
  - requires auth, participant, non-ended, `state='date'`;
  - deducts credit atomically from `user_credits`;
  - increments `video_sessions.date_extra_seconds`;
  - returns `success`, `added_seconds`, and `date_extra_seconds`.
- `expire_stale_video_date_phases` honors `300 + date_extra_seconds + 60` for date timeout.

Web:

- `VideoDate.handleExtend` calls the correct RPC and adds local minutes.
- `KeepTheVibe` shows +2/+5 controls when phase is `date` and credits exist.
- Reload/realtime hydration ignores `date_extra_seconds`.

Native:

- `apps/mobile/app/date/[id].tsx` calls `spendVideoDateCreditExtension`.
- `KeepTheVibe` has controls and "Get Credits" parity.
- `apps/mobile/lib/videoDateApi.ts` still has legacy `deductCredit`, but audited date screen uses the canonical spend RPC.
- Reload/realtime hydration ignores `date_extra_seconds`.

Classification:

- Correctness-critical: client timers ignoring `date_extra_seconds` can end a paid extended date early.
- Parity-only: web has no `onAddTime` shortcut in `VideoDateControls`; native has an add-time shortcut. This is UX parity, not lifecycle correctness.
- Copy/guidance-only: native "Get Credits" opens settings and says date continues; web opens `/credits` in a new tab. Product copy differs but server ownership is intact.

## 12. Survey / finalization audit

### Current flow

- The date becomes terminal through `video_date_transition('end')`, reconnect expiry, handshake grace expiry, handshake timeout, or date timeout.
- Event registrations are moved to `in_survey` for normal joined/date endings.
- Web renders `PostDateSurvey` when `showFeedback` is true.
- Native returns `PostDateSurvey` when `phase==='ended' && showFeedback`.
- Mandatory verdict goes through `post-date-verdict` Edge and `submit_post_date_verdict`.
- Optional highlights/safety update `date_feedback` directly from clients.

### Finalization semantics

`submit_post_date_verdict`:

- requires auth and participant;
- writes the caller's `participant_X_liked`;
- upserts `date_feedback`;
- calls `check_mutual_vibe_and_match`;
- creates/reports persistent match when both users submit positive verdicts.

Match/no-match finalization happens because of survey verdict, not because the video session ended. If only one user submits, verdict is recorded and match waits. If user abandons survey, no post-date verdict is recorded for that user, so no mutual post-date match can be created from that user.

### Survey gaps

- Web realtime-ended path can set `phase='ended'` without `showFeedback`, causing "ended" UI instead of survey.
- Native realtime-ended path only opens survey if `partnerEverJoinedRef.current`; otherwise it can show "Date ended".
- Both clients open survey before confirming `end` RPC in the explicit local end path.
- Pre-date no-match and actual post-date verdict both use `participant_1_liked` / `participant_2_liked`; after survey those fields no longer purely represent handshake consent. Any code/docs reading them as pre-date-only is stale.

## 13. Observability coverage and gaps

### Existing coverage

Backend:

- `event_loop_observability_events` records queue/drain/expiry/swipe/foreground style operations.
- latest `video_date_transition` records observability for many handshake, access, grace, and terminal paths.
- trigger enrichment adds `complete_handshake_grace_status`, actor, liked flags, and grace booleans.
- retention prune RPC exists but is not automatically scheduled in the migration.

Client/Edge:

- Web and native VDBG/Sentry breadcrumbs for route decisions, Daily creation/join, reconnect sync, join stamps, and survey.
- Daily room Edge logs create/delete/recreate events to console.
- post-date Edge logs lifecycle events to console.

### Required gap list

| Event | Coverage today | Gap |
| --- | --- | --- |
| ready gate entered | client VDBG/breadcrumbs, event_loop promotion rows | no dedicated `ready_gate_entered` DB row |
| `ready_gate_transition` called | client logs only; latest RPC has no structured observability | add DB observability for action/outcome |
| `enter_handshake` called | DB observability + client logs | good |
| `create_date_room` called | client VDBG/Sentry + Edge console | no DB observability row |
| room join success/failure | client VDBG/Sentry | no DB observability row |
| local track attached | web `daily_local_tracks_changed`, native participant updated | not consistently tied to actual rendered pixels |
| remote track attached | web `daily_remote_tracks_changed`/first remote; native promoted into UI | no explicit "track attached to renderer" success/failure |
| `mark_video_date_daily_joined` success/failure | client VDBG | no DB observability beyond timestamp mutation |
| `sync_reconnect` enter/exit | client VDBG/Sentry | no DB observability for normal sync, which is probably good for volume |
| partner away/return | client VDBG and RPC effects | limited DB observability |
| extension attempt/success/failure | analytics + Sentry breadcrumbs | no structured DB row |
| end transition | client VDBG, `video_date_transition` observability rows when RPC used | Dashboard banner end now uses RPC (#476) |
| survey opened/submitted/skipped | submitted has analytics/Edge logs; opened/skipped weak | no durable survey-open/abandon signal |
| cleanup success/failure | room cleanup Edge console | no event_loop row, no retry health summary |

Noise callout: reconnect polling is not DB-spammy, but VDBG/Sentry breadcrumbs can be high-volume because both platforms log every sync fire/schedule/stop.

## 14. Remaining risks by severity

### P0 / correctness-critical

1. ~~`src/pages/Dashboard.tsx` directly updates `video_sessions.ended_at`~~ **Resolved (#476):** Dashboard video end uses `video_date_transition('end')`.
2. `apps/mobile/lib/videoDateApi.ts` realtime can regress native phase from date to handshake.
3. Web/native timers ignore `date_extra_seconds` on hydration/realtime, risking early end after paid extension.
4. Web/native vibe actions ignore `success:false` JSON payloads, especially `GRACE_EXPIRED`.
5. Survey can open before backend end confirmation; conversely server-ended realtime can fail to open survey.

### P1 / high UX or data-integrity risk

6. Web `useActiveSession` remains registration-first and phase-unaware.
7. Ready Gate polling does not call `ready_gate_transition('sync')`.
8. Standalone ready routes on web/native can send startable sessions to lobby instead of date.
9. `complete_handshake` transient RPC errors can trigger local end/survey in web.
10. Direct terminal/compatibility surfaces (`leave_matching_queue`, and any future dashboard shortcuts) need a no-bypass audit lock; dashboard active banner end is on the RPC path as of #476.

### P2 / runtime fragility

11. Web track-id optimization can miss reattachment if element `srcObject` is lost without track ID change.
12. Native first-connect watchdog is UX-helpful but not tied to backend terminal truth.
13. Room cleanup relies on cron/env configuration and console logs only.
14. Normal reconnect VDBG/Sentry volume can obscure higher-signal failures.
15. Shared docs and comments still describe older client-owned or delete-room assumptions.

## 15. Drift / stale-doc findings

| Source | Drift |
| --- | --- |
| `shared/matching/activeSession.ts` | says registration queue_status is authoritative for routing; hardened video phase truth now requires `video_sessions` to win on handshake/date/ended |
| `apps/mobile/README.md` | says mobile Sprint 5 end/leave uses `delete_room`; video-date delete is now cron-owned and skipped in Edge |
| `docs/native-video-date-hardening-deploy.md` | older deploy note talks about remaining client-owned writes; current code fixed some but Dashboard still has one direct video write |
| `docs/events-hardening-phase2-release-audit.md` | documents `ready_gate_transition('sync')`, but current web/native polling does not call it |
| `docs/web-vs-native-comparative-audit.md` / older parity docs | describe native video date as minimal/no survey/reconnect; current native has those features |
| `src/hooks/useCredits.ts`, `apps/mobile/lib/videoDateApi.ts` | legacy deduct helpers still exist; date screens use canonical spend RPC but helper names can mislead |
| `src/pages/VideoDate.tsx` | analytics labels `video_date_extended` when mutual toast completes, not only when extension is used |

## 16. Prioritized implementation plan

### Stream A - state-machine correctness and RPC adoption gaps

Goal: remove client-owned terminal writes and make clients inspect RPC payloads.

Likely files: `src/pages/Dashboard.tsx`, `src/pages/VideoDate.tsx`, `apps/mobile/lib/videoDateApi.ts`, `apps/mobile/app/date/[id].tsx`, tests around active banner/end.

Likely backend: no new migration required unless adding observability.

Type: mixed, mostly clients.

Risk: high.

Deploy requirements: web/native release; no DB deploy unless adding logs.

QA: active banner end, local leave, partner leave, duplicate end, already-ended rejoin.

Real device: native leave/end and background/foreground.

### Stream B - handshake hardening compatibility / grace / observability cleanup

Goal: make `vibe` and `complete_handshake` return handling fully compatible with `GRACE_EXPIRED`, `SESSION_ENDED`, waiting, already-ended, and RPC errors.

Likely files: `src/components/video-date/VibeCheckButton.tsx`, `src/pages/VideoDate.tsx`, `apps/mobile/components/video-date/VibeCheckButton.tsx`, `apps/mobile/lib/videoDateApi.ts`, `apps/mobile/app/date/[id].tsx`.

Likely backend: optional `record_event_loop_observability` additions for `vibe`/already-ended if not enough.

Type: mixed.

Risk: high.

Deploy requirements: client releases; optional DB migration.

QA: last-second mutual tap, one late tap after grace, one no-response, duplicate taps, network error during complete.

Real device: yes for native handshake timer and app background during grace.

### Stream C - realtime + sync_reconnect reduction + limbo recovery

Goal: keep server authority but reduce redundant sync and add deterministic limbo recovery.

Likely files: `src/hooks/useReconnection.ts`, `apps/mobile/app/date/[id].tsx`, `apps/mobile/lib/videoDateApi.ts`.

Likely backend: optional lightweight observability/rate guard for reconnect state changes only.

Type: mixed.

Risk: medium/high.

Deploy requirements: client releases; optional DB migration.

QA: partner leaves/returns, missed realtime, offline/online, app background/foreground, no Daily participant event.

Real device: required for native background/foreground and Daily SDK behavior.

### Stream D - Daily track mounting / stream lifecycle / cleanup

Goal: eliminate stale/frozen/blank track surfaces without changing backend phase authority.

Likely files: `src/hooks/useVideoCall.ts`, `src/pages/VideoDate.tsx`, `apps/mobile/app/date/[id].tsx`.

Likely backend: none unless adding cleanup observability.

Type: web/native.

Risk: medium/high.

Deploy requirements: client releases.

QA: camera toggle, track stopped, partner reconnect, reload/rejoin, duplicate tab.

Real device: required for native; browser with Playwright/manual Daily for web.

### Stream E - route hydration / bounce prevention / resume truth

Goal: make web active-session hydration as phase-aware as native and fix standalone ready redirects.

Likely files: `src/hooks/useActiveSession.ts`, `src/pages/ReadyRedirect.tsx`, `src/components/session/SessionRouteHydration.tsx`, `apps/mobile/app/ready/[id].tsx`, `apps/mobile/components/lobby/ReadyGateOverlay.tsx`.

Likely backend: none.

Type: web/native.

Risk: medium.

Deploy requirements: client releases.

QA: stale `in_ready_gate` with handshake/date row, direct `/ready/:id`, direct `/date/:id`, refresh during both-ready window.

Real device: native deep links and app cold start.

### Stream F - native UX parity for date states, guidance, and extension controls

Goal: align native behavior with web while respecting backend authority.

Likely files: `apps/mobile/app/date/[id].tsx`, `apps/mobile/components/video-date/*`, `apps/mobile/app/ready/[id].tsx`.

Likely backend: none.

Type: native-only.

Risk: medium.

Deploy requirements: native release.

QA: no-remote wait, reconnect overlay, ended-with-survey, extension affordances.

Real device: required.

### Stream G - credits / extension correctness and product parity

Goal: use `date_extra_seconds` in all timers and use returned `date_extra_seconds` after spend.

Likely files: `src/pages/VideoDate.tsx`, `apps/mobile/lib/videoDateApi.ts`, `apps/mobile/app/date/[id].tsx`, generated/shared local timer helpers if added.

Likely backend: none unless adding RPC shape type docs.

Type: web/native.

Risk: high because monetized.

Deploy requirements: client releases.

QA: +2, +5, reload after extension, partner end after extension, server timeout after extension.

Real device: native spend + background/reopen.

### Stream H - post-date survey / finalization hardening

Goal: tie survey entry to server terminal truth and prevent survey loss/phantom survey.

Likely files: `src/pages/VideoDate.tsx`, `src/components/video-date/PostDateSurvey.tsx`, `apps/mobile/app/date/[id].tsx`, `apps/mobile/components/video-date/PostDateSurvey.tsx`.

Likely backend: optional survey-open/abandon observability.

Type: mixed.

Risk: high.

Deploy requirements: client releases; optional DB migration.

QA: local end, partner end, reconnect expiry, date timeout, one user abandons survey, one submits no, both submit yes.

Real device: native app kill/reopen after end.

### Stream I - observability and diagnostics

Goal: close high-signal gaps without flooding.

Likely files/migrations: new migration for `ready_gate_transition` observability, optional room cleanup event rows, client breadcrumb throttling in `useReconnection` and native date screen.

Type: mixed.

Risk: medium.

Deploy requirements: DB migration + client releases if throttling.

QA: inspect `event_loop_observability_events`, Sentry breadcrumb volume, cleanup logs.

Real device: optional for breadcrumb volume, but useful.

## 17. Recommended PR slicing

1. PR 1 - no-bypass correctness:
   - replace Dashboard direct video end write with `video_date_transition('end')`;
   - fix native date->handshake realtime regression;
   - make `recordVibe`/web vibe handler respect `success:false`.
2. PR 2 - monetized extension correctness:
   - select/use `date_extra_seconds` in web/native session hydration and realtime;
   - use returned `date_extra_seconds` after credit spend.
3. PR 3 - survey terminal consistency:
   - open survey from server-ended realtime when joined/date evidence exists;
   - avoid showing survey before end RPC confirmation except with explicit offline fallback UI.
4. PR 4 - route truth parity:
   - make web `useActiveSession` phase-aware like native;
   - fix web/native `/ready/:id` startable-session routing;
   - wire Ready Gate polling to `ready_gate_transition('sync')` or remove stale docs/contract.
5. PR 5 - Daily runtime reliability:
   - harden web remote reattachment when `srcObject` is missing;
   - add track-attached diagnostics;
   - validate native DailyMediaView remount behavior on reconnect.
6. PR 6 - reconnect noise and limbo:
   - throttle breadcrumbs;
   - separate state-changing away/return logs from sync logs;
   - add deterministic fallback for missed partner-away events if feasible without client-owned phase transitions.
7. PR 7 - observability cleanup:
   - add structured Ready Gate transition logs;
   - add cleanup batch observability;
   - add survey-open/submitted/skipped breadcrumbs/events.

Recommendation: do not spend a full investigation PR unless the team wants audit history in the branch. The audit doc is enough to go straight into small implementation PRs, starting with PR 1 and PR 2.
