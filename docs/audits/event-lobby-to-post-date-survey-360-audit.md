# Event Lobby to Post-Date Survey 360 Audit

Date: 2026-04-22  
Scope: read-only repo-grounded audit from Event Lobby entry through Ready Gate, Handshake, Date, extension/reconnect/end branches, and Post Date Survey completion or dismissal.  
Primary parity rule for this audit: web is the product/UX source of truth unless the current backend contract proves otherwise.  
Backend guardrail: keep the hardened backend-authoritative model. Core transitions stay owned by RPCs and Edge Functions.

## 1. Executive summary

The current flow is mostly backend-authoritative for high-risk business transitions. The strongest backend-owned surfaces are:

- `ready_gate_transition`
- `video_date_transition`
- `swipe-actions` Edge Function backed by `handle_swipe`
- `daily-room` Edge Function backed by `video_sessions`
- `post-date-verdict` Edge Function backed by `submit_post_date_verdict`
- `send-message` Edge Function after a persistent `matches` row exists

The largest remaining risks are not that the client owns core business logic. They are client recovery, UI routing, parity drift, and observability blind spots around server-owned transitions.

Top highest-risk findings:

1. Web can receive a server/partner-ended `video_sessions` update and set `phase = "ended"` without opening `PostDateSurvey`. The survey is only opened by local `handleCallEnd`. File: `src/pages/VideoDate.tsx`.
2. Native realtime date-state hydration can repaint a promoted `date` session back to `handshake` because the handler applies `date_started_at` and then later overwrites with `handshake_started_at`. File: `apps/mobile/lib/videoDateApi.ts`.
3. Post-date "Start chatting" is broken on both platforms. Web navigates to `/chat`, but only `/chat/:id` exists. Native navigates to `/chat/${matchId}`, while chat hooks expect the other user's profile id. Files: `src/components/video-date/PostDateSurvey.tsx`, `apps/mobile/app/date/[id].tsx`, `apps/mobile/lib/chatApi.ts`, `src/hooks/useMessages.ts`.
4. Native pre-connect or waiting-peer abort calls the same cleanup path that invokes `endVideoDate(sessionId)`, which can end the server session without survey and can race with a partner who is joining. File: `apps/mobile/app/date/[id].tsx`.
5. Survey visibility is local UI state, not recoverable state. `event_registrations.queue_status = in_survey` is written, but active-session hydration ignores it and neither platform has a durable route or hydration path to reopen the survey after refresh, background, force-quit, or route loss.
6. Web `useVideoCall` and `VideoDate` both call `video_date_transition('enter_handshake')`. The RPC is designed to be idempotent, but the duplicate call adds provider-entry noise and can surface avoidable `READY_GATE_NOT_READY` timing.
7. Native lobby adds a 10 second `drain_match_queue` loop while queued/syncing. It is bounded and useful for recovery, but it differs from web and increases RPC/log volume in active events.
8. Ready Gate UX is split. Web lobby overlay has no visible Snooze action, while native standalone Ready Gate has Snooze. The backend supports `snooze`; product parity needs a canonical decision.
9. Lobby live-window gating still uses client-side event date/duration checks in both clients. Backend `events.status = 'live'` and current RPC guards are stricter and should remain canonical.
10. Critical observability is missing for survey opened/lost, local/remote track mounted, route handoffs, and chat-unlock navigation. Existing server logs are strong for state transitions, but client media and post-survey branches are still mostly console/Sentry breadcrumbs.

Top user-facing issues:

1. Web users can finish a date due to partner/backend end and never see the survey.
2. Native users can get visually pulled back to handshake after the date has already started.
3. Start Chatting after a mutual post-date match routes incorrectly on both web and native.
4. Native abort from waiting/connecting can end the date instead of cleanly returning to lobby.
5. Ready Gate controls and guidance diverge between web overlay and native standalone screen, especially Snooze.

Top correctness and data-integrity issues:

1. Post-date verdict completion is atomic server-side, but client chat routing uses the returned `match_id` incorrectly.
2. `video_sessions.participant_1_liked` and `participant_2_liked` are overloaded for handshake vibe and post-date verdict semantics.
3. Survey completion is not durable in client navigation; users can lose the survey after refresh/quit.
4. Native realtime state overwrite can make the UI state disagree with server `phase = date`.
5. Reconnect-grace expiry sets registrations to `idle`, not `in_survey`; clients decide whether survey appears based on local history.

Top cost and scale issues:

1. Native queued/syncing `drain_match_queue` every 10 seconds can become expensive during large events.
2. Web/native active-session hydration poll every 8 seconds per active lobby/date context.
3. Ready Gate uses 2 second polling on both platforms, plus realtime subscriptions.
4. Web `useVideoCall` duplicate `enter_handshake` adds redundant transition RPCs.
5. Event-scoped `video_sessions` realtime subscriptions filter participants client-side, so busy events can deliver more payloads than each client needs.

Top fastest high-impact fixes:

1. Open web `PostDateSurvey` whenever `video_sessions` realtime/hydration observes `ended_at` after the call/date was entered.
2. Fix native `useVideoDateSession` realtime precedence: `ended` > `date` > `handshake`, with no later overwrite.
3. Fix post-date chat routing to pass the matched partner profile id, or add a match-id route resolver.
4. Split native "abort pre-connect" from "end established date" so abandoning a failed join does not always end the server session.
5. Add one shared client event envelope for `survey_opened`, `survey_completed`, `match_created`, `chat_cta_pressed`, `local_track_mounted`, and `remote_track_mounted`.

## 2. Current canonical journey map

Legend:

- SOT = source of truth.
- DB = database row state.
- RPC = Supabase RPC.
- EF = Supabase Edge Function.
- RT = realtime payload.
- Poll = polling or manual refetch.
- UI = local client state only.

| Step | Web current path | Native current path | Backend / DB / Edge | SOT |
|---|---|---|---|---|
| 1. Entry into Event Lobby | Route `/event/:eventId/lobby` -> `src/pages/EventLobby.tsx`; global `SessionRouteHydration` is mounted in `src/App.tsx`. | Route `event/[eventId]/lobby` -> `apps/mobile/app/event/[eventId]/lobby.tsx`; global `NativeSessionRouteHydration` is mounted in `apps/mobile/app/_layout.tsx`. | `events`, `event_registrations`, `video_sessions`. | DB + hydration hooks. |
| 2. Event eligibility | `useEventDetails`, `useIsRegisteredForEvent`; client live-window guard from `event_date` + `duration_minutes`; cancelled and non-confirmed users are bounced. | Same shape via mobile `eventsApi`; client live-window guard. | RPCs still enforce event live/current registration in `handle_swipe`, `promote_ready_gate_if_eligible`, `ready_gate_transition`, `video_date_transition`. | Backend should be canonical; clients still have heuristic gates. |
| 3. Deck loading | `useEventDeck(eventId, userId)` calls `get_event_deck({ p_event_id, p_user_id, p_limit: 50 })`, refetches every 15s, adapts through `shared/matching/videoSessionFlow.ts`. | `apps/mobile/lib/eventsApi.ts` calls same RPC, same 15s query interval. | `profiles`, event filters, prior swipes, hidden/reported/blocked exclusions through RPC. | RPC response. |
| 4. Swipe action | `useSwipeAction` invokes `swipe-actions` EF with `{ event_id, target_id, swipe_type }`; UI advances via `shouldAdvanceLobbyDeckAfterSwipe`. | `swipe` in `apps/mobile/lib/eventsApi.ts` invokes same EF. | EF calls `handle_swipe`; writes `event_swipes`; may insert/update `video_sessions`; may update `event_registrations`. | EF/RPC response and DB. |
| 5. Mutual vibe immediate | Result `match`; `match_id` is treated as `video_sessions.id` through `videoSessionIdFromSwipePayload`; Event Lobby opens Ready Gate overlay. | Same result. Native can open lobby overlay or navigate later to standalone `/ready/:id` if overlay stalls. | `handle_swipe` creates `video_sessions.ready_gate_status = ready`, `state = ready_gate`, sets both `event_registrations.queue_status = in_ready_gate`, `current_room_id`, `current_partner_id`. | DB + EF response. |
| 6. Mutual vibe queued | Result `match_queued`; UI stays lobby; web uses `useMatchQueue`, native uses `useMatchQueue` plus active-session `syncing`. | Same, plus native has a 10s drain loop while queued/syncing. | `video_sessions.ready_gate_status = queued`, `queued_expires_at`, `event_registrations.current_room_id/current_partner_id` but status remains browsing/idle. | DB + `drain_match_queue`/foreground promotion. |
| 7. No-match branch | Result `vibe_recorded`/pass; deck advances; errors can toast. | Same. | `event_swipes` only, plus notification for non-mutual vibe. | EF response. |
| 8. Queue promotion | `useMatchQueue` calls `drain_match_queue(p_event_id)` on browsing/idle mount and on foreground; Event Lobby also calls `mark_lobby_foreground` every 30s. | Initial drain and 10s bounded loop while queued/syncing; `mark_lobby_foreground` every 30s while focused/active. | `promote_ready_gate_if_eligible` requires live event, both confirmed, no active session conflict, and presence windows. | RPC/DB. |
| 9. Ready Gate surfacing | `ReadyGateOverlay` inside Event Lobby; `/ready/:readyId` only redirects back to lobby after validation. | Lobby `ReadyGateOverlay` and standalone `apps/mobile/app/ready/[id].tsx`. | `video_sessions.ready_gate_status in ready/ready_a/ready_b/both_ready/snoozed`; own `event_registrations.queue_status = in_ready_gate`. | DB. |
| 10. Ready Gate actions | `useReadyGate` calls `ready_gate_transition(mark_ready/forfeit/snooze)`; web overlay exposes Ready and Skip, not Snooze. | `readyGateApi` calls same RPC; overlay exposes Ready/Skip; standalone exposes Ready/Snooze/Step away. | `ready_gate_transition` owns all status changes and clears sessions on forfeit/expiry. | RPC/DB. |
| 11. Both ready -> date | Web overlay waits ~1200ms, marks date-entry latch, navigates `/date/:sessionId`. | Native overlay waits ~1200ms; standalone waits ~1500ms and fetches date-entry truth before route. | Backend sets `ready_gate_status = both_ready`; `video_date_transition('enter_handshake')` later promotes to handshake. | DB first, client route second. |
| 12. Navigation guard | `VideoDate` access guard fetches `video_sessions` and own `event_registrations`; stale `in_ready_gate` is ignored if session is handshake/date or latch is active. | `date/[id].tsx` uses `fetchVideoSessionDateEntryTruth` and own reg; if not startable but ready-eligible returns `/ready/:id`. | `video_sessions.ended_at`, `state`, `phase`, `handshake_started_at`, `date_started_at`, `ready_gate_status`, `event_registrations.queue_status/current_room_id`. | DB. |
| 13. Date hydration | `VideoDate` timing effect fetches session timers, then calls `video_date_transition('enter_handshake')` if no timing exists. | `useVideoDateSession` fetches session and derives `phase`/timers; screen may call `enterHandshakeWithTimeout`. | `video_date_transition('enter_handshake')` stamps `handshake_started_at` and sets both registrations `in_handshake`. | RPC/DB. |
| 14. Daily room create/join | `useVideoCall` calls `daily-room` EF action `create_date_room`, creates Daily call object, joins, then RPC `mark_video_date_daily_joined`. | `getDailyRoomToken` calls same EF; `Daily.createCallObject` joins; then `mark_video_date_daily_joined`. | `daily-room` creates/reuses Daily room and token; writes `daily_room_name`, `daily_room_url`; `mark_video_date_daily_joined` writes participant join timestamp. | EF/provider + DB. |
| 15. Handshake phase | Web shows handshake UI, blur/reveal, timer, Vibe CTA. `checkMutualVibe` calls `video_date_transition('complete_handshake')`. | Native shows equivalent phase, animated blur, rotating prompts, Vibe CTA. | `video_date_transition('vibe')` records per-participant vibe; `complete_handshake` handles mutual, waiting, no-mutual, grace expiry. | RPC/DB. |
| 16. Waiting for partner | Web local `phase = waiting_for_partner`; timer uses `handshake_grace_expires_at`; RT can repaint. | Native can enter waiting path; current realtime handler has date->handshake overwrite risk. | `handshake_grace_expires_at` in `video_sessions`; expiry cleanup handles stale grace. | DB + RT/Poll. |
| 17. Promotion handshake -> date | On both vibes, RPC sets `state/phase = date`, `date_started_at`, registrations `in_date`; RT updates UI. | Same, but native realtime precedence bug can undo local date UI. | `video_date_transition('vibe'/'complete_handshake')`. | RPC/DB. |
| 18. Reconnect / away / return | `useReconnection` calls `sync_reconnect`, `mark_reconnect_partner_away`, `mark_reconnect_return`; Daily participant-left drives grace UI. | Similar loop in `date/[id].tsx`, with AppState foreground sync and Daily participant events. | `video_date_transition` stores away stamps and `reconnect_grace_ends_at`; cron expires stale reconnects. | RPC/DB + Daily events. |
| 19. Credits / extension | Web `KeepTheVibe` + `useCredits`; `handleExtend` calls `spend_video_date_credit_extension`. | Native `KeepTheVibe` + controls add-time shortcut; calls `spendVideoDateCreditExtension`. | RPC atomically decrements `user_credits` and increments `video_sessions.date_extra_seconds`. | RPC/DB. |
| 20. Date end | Web local end button calls `handleCallEnd`, then `video_date_transition('end')`, then `setStatus('in_survey')`; backend or partner end RT currently does not open survey. | Native `handleCallEnd` sets `showFeedback`, then cleanup calls `endVideoDate`; reconnect-ended path can call survey if partner ever joined. | `video_date_transition('end')`, `expire_stale_video_date_phases`, `expire_video_date_reconnect_graces`. | RPC/DB; UI survey flag is local. |
| 21. Survey open | Web `PostDateSurvey` modal branch controlled by `showFeedback`. | Native full-screen `PostDateSurvey` branch controlled by `showFeedback`. | `event_registrations.queue_status = in_survey` is written but not used to hydrate survey route. | UI local plus weak DB status. |
| 22. Survey verdict | Web calls `post-date-verdict` EF with `{ session_id, liked }`; match celebration if mutual. | Native calls same EF through `submitVerdictAndCheckMutual`. | EF calls `submit_post_date_verdict`; writes `date_feedback`; invokes `check_mutual_vibe_and_match`; creates `matches` row if both liked. | RPC/DB. |
| 23. Survey optional steps | Highlights/safety update `date_feedback` best effort; report uses `submitUserReportRpc`. | Same shape. | `date_feedback`; reports RPC/table. | DB best effort. |
| 24. Exit routing | Web active event -> `setStatus('browsing')`, navigate `/event/:eventId/lobby`; event ended -> offline and EventEndedModal. Celebration Start Chatting incorrectly routes `/chat`. | Native active event -> browsing and route lobby; celebration Start Chatting routes `/chat/${matchId}` incorrectly. | `matches` row unlocks chat; `send-message` uses match existence later. | Client route + DB match. |

## 3. Web file map

### Routes

- `src/App.tsx`
  - `/event/:eventId/lobby` -> `EventLobby`
  - `/ready/:readyId` -> `ReadyRedirect`
  - `/date/:id` -> `VideoDate`
  - `/chat/:id` -> `Chat`
  - `SessionRouteHydration` is globally mounted.

### Event Lobby and matching

- `src/pages/EventLobby.tsx`
  - Main web lobby surface.
  - Uses `useEventDetails`, `useIsRegisteredForEvent`, `useEventDeck`, `useSwipeAction`, `useEventStatus`, `useMatchQueue`, `useActiveSession`.
  - Reads active session truth and yields to `/date/:id` or `ReadyGateOverlay`.
  - Subscribes to own `event_registrations` updates and event-scoped `video_sessions` insert/update events.
  - Calls `mark_lobby_foreground` every 30s when focused/visible/current route.
  - Uses local live-window gating from `event.eventDate` + `durationMinutes`.
  - `READY_GATE_ACTIVE_STATUSES = ready, ready_a, ready_b, both_ready, snoozed`.

- `src/hooks/useEventDeck.ts`
  - Calls RPC `get_event_deck({ p_event_id, p_user_id, p_limit: 50 })`.
  - Refetches every 15s while enabled.
  - Uses shared deck adapter from `shared/matching/videoSessionFlow.ts`.

- `src/hooks/useSwipeAction.ts`
  - Calls EF `swipe-actions`.
  - Normalizes `match_id`/`video_session_id` through `videoSessionIdFromSwipePayload`.
  - Treats `match` and `match_queued` as video session outcomes, not persistent match outcomes.

- `shared/matching/videoSessionFlow.ts`
  - Canonical shared helpers for swipe outcomes.
  - Important drift guard: `match_id` in swipe responses is a legacy alias for `video_sessions.id`, not `matches.id`.

- `src/hooks/useMatchQueue.ts`
  - Counts queued `video_sessions` rows for the participant where `ready_gate_status = queued`.
  - Calls `drain_match_queue(p_event_id)` when status is `browsing` or `idle`.
  - Subscribes to event-scoped `video_sessions` changes and filters participant membership client-side.
  - No interval polling.

- `src/hooks/useEventStatus.ts`
  - Client-writable statuses: `browsing`, `in_ready_gate`, `in_survey`, `offline`, `idle`.
  - Calls `update_participant_status`.
  - Sends heartbeat updates to `event_registrations.last_active_at`.
  - Server-owned statuses `in_handshake` and `in_date` are intentionally not client-writable.

- `src/hooks/useActiveSession.ts`
  - Queries own `event_registrations` where `queue_status in (in_handshake, in_date, in_ready_gate)` and `current_room_id is not null`.
  - Confirms the referenced `video_sessions` row is not ended.
  - Picks video session over Ready Gate through `shared/matching/activeSession.ts`.
  - Subscribes to own registration and event-scoped video sessions.
  - Polls every 8s and refetches on visibility.

- `shared/matching/activeSession.ts`
  - `event_registrations.queue_status` is used as the route-level truth.
  - `video_sessions` confirms live/ended status.

### Ready Gate

- `src/components/lobby/ReadyGateOverlay.tsx`
  - Web canonical Ready Gate UI, rendered over Event Lobby.
  - Uses `useReadyGate`.
  - Reconciles own registration + session every 2s and through realtime.
  - Navigates to `/date/:sessionId` after `both_ready`.
  - Exposes Ready and Skip. It calls backend `snooze` through the hook but has no visible Snooze UI.
  - Skip calls `forfeit`, then immediately writes `browsing` and closes.

- `src/hooks/useReadyGate.ts`
  - Fetches `video_sessions` ready gate fields and partner profile.
  - Polls every 2s while non-terminal.
  - Subscribes to `video_sessions` updates by session id.
  - Calls `ready_gate_transition(mark_ready/forfeit/snooze)`.

- `src/pages/ReadyRedirect.tsx`
  - `/ready/:readyId` is not a web Ready Gate screen.
  - It validates session + own registration and redirects back to Event Lobby.

### Date

- `src/pages/VideoDate.tsx`
  - Web date screen and state owner.
  - Access guard fetches `video_sessions` and own `event_registrations`.
  - Timing effect fetches session timers and calls `video_date_transition('enter_handshake')` if needed.
  - Realtime subscription to `video_sessions` by id updates timer/phase.
  - Calls `video_date_transition('vibe')`, `complete_handshake`, `end`.
  - Calls `spend_video_date_credit_extension`.
  - Renders `PostDateSurvey` when local `showFeedback` is true.
  - Critical issue: `video_sessions.ended_at` observed through realtime sets phase ended but does not set `showFeedback = true`.

- `src/hooks/useVideoCall.ts`
  - Daily web integration.
  - Prejoin truth fetches `video_sessions`.
  - Calls `video_date_transition('sync_reconnect')`.
  - If needed, calls `video_date_transition('enter_handshake')`, duplicating a call also made by `VideoDate`.
  - Calls EF `daily-room` action `create_date_room`.
  - Creates Daily call object, joins, attaches local/remote tracks, and calls `mark_video_date_daily_joined`.
  - Cleanup leaves/destroys Daily call object and clears streams; it does not call room delete.

- `src/hooks/useReconnection.ts`
  - Reconnect sync loop.
  - Calls `video_date_transition('sync_reconnect')`.
  - Backoff cadence is 1s initially, then 3s, then 7s.
  - Calls `mark_reconnect_partner_away` and `mark_reconnect_return`.
  - Shows grace UI only after the local side had a connected partner.

- `src/hooks/useCredits.ts`
  - Fetches `user_credits`.
  - Contains legacy `deduct_credit` helpers, but current date extension path uses `spend_video_date_credit_extension`.

- `src/components/video-date/PostDateSurvey.tsx`
  - Modal controlled by `isOpen`.
  - Steps: mandatory verdict, celebration if mutual, optional highlights, optional safety.
  - Calls EF `post-date-verdict`.
  - Updates `date_feedback` for optional answers.
  - Uses `useEventStatus` and `useEventLifecycle`.
  - Uses `useMatchQueue` during survey, so web can be interrupted by a Ready Gate promotion while survey is open.
  - Critical route issue: celebration `onStartChatting` navigates to `/chat`, but only `/chat/:id` exists.

### Route hydration

- `src/components/session/SessionRouteHydration.tsx`
  - Global web route owner for stale `/date/:id` or stale active sessions.
  - If active session is Ready Gate for the same date id, it fetches `video_sessions` before bouncing.
  - Blocks bounce when the row has already moved to handshake/date or when the local date-entry latch is active.

- `src/lib/dateEntryTransitionLatch.ts`
  - Prevents route hydration from bouncing during Ready Gate -> Date handoff.
  - Default latch TTL is 25s; date-entry pipeline TTL is 180s.

## 4. Native file map

### Routes

- `apps/mobile/app/_layout.tsx`
  - Registers `event/[eventId]/lobby`, `ready/[id]`, `date/[id]`, `chat/[id]`.
  - Mounts `NativeSessionRouteHydration`.

### Event Lobby and matching

- `apps/mobile/app/event/[eventId]/lobby.tsx`
  - Native lobby surface.
  - Uses native `useEventDeck`, swipe helpers, `useActiveSession`, `useMatchQueue`, `useEventStatus`, and `useMysteryMatch`.
  - Subscribes to own `event_registrations` and event-scoped `video_sessions`.
  - Calls `mark_lobby_foreground` every 30s.
  - Calls `drainMatchQueue` at mount/foreground and every 10s while queued/syncing.
  - Can show `ReadyGateOverlay` or navigate to standalone `/ready/:id`.
  - Contains native-specific "Mystery Match" empty-deck branch and implementation-flavored copy.

- `apps/mobile/lib/eventsApi.ts`
  - Deck RPC `get_event_deck`.
  - Swipe EF `swipe-actions`.
  - `drainMatchQueue`, queued count, super vibe cap, registration checks.

- `apps/mobile/lib/useActiveSession.ts`
  - Queries own active `event_registrations` plus referenced `video_sessions`.
  - Returns `video`, `ready_gate`, or `syncing`.
  - `syncing` covers queued sessions scoped to the current event.
  - Subscribes to own registration and event-scoped video sessions.
  - Polls every 8s and refetches on AppState active.

### Ready Gate

- `apps/mobile/components/lobby/ReadyGateOverlay.tsx`
  - In-lobby native Ready Gate modal.
  - Requests camera/mic permission before Ready.
  - Uses `readyGateApi.useReadyGate`.
  - Ready and Skip are visible. Snooze is not visible here.

- `apps/mobile/app/ready/[id].tsx`
  - Standalone native Ready Gate route.
  - Validates session and own registration.
  - Has richer UI than web overlay: Ready, Snooze/give me 2 min, Step away, partner ready/snoozed cues, countdown.
  - Before navigating to `/date/:id`, fetches date-entry truth and registration.

- `apps/mobile/lib/readyGateApi.ts`
  - Mirrors web `useReadyGate`.
  - Polls every 2s and subscribes to `video_sessions` by id.
  - Calls `ready_gate_transition(mark_ready/forfeit/snooze)`.

### Date

- `apps/mobile/app/date/[id].tsx`
  - Native date screen and Daily RN integration.
  - Uses `DailyMediaView`, singleton call-object handling, expo/react-native permissions, AppState recovery, first-remote watchdog, reconnect sync, credits, post-date survey.
  - Calls `fetchVideoSessionDateEntryTruth`, `enterHandshake`, `getDailyRoomToken`, `mark_video_date_daily_joined`, `endVideoDate`, `spendVideoDateCreditExtension`.
  - Critical issue: waiting/connecting abort routes through `leaveAndCleanup`, which calls `endVideoDate`.
  - Celebration routes `matchId` into `/chat/${matchId}`, but chat route currently expects the other profile id.

- `apps/mobile/lib/videoDateApi.ts`
  - `useVideoDateSession`: fetches session row, partner profile, and realtime updates.
  - `getDailyRoomToken`: EF `daily-room` action `create_date_room`.
  - `join_date_room` is not used by current screen.
  - `syncVideoDateReconnect`, `markReconnectPartnerAway`, `markReconnectReturn`, `endVideoDate`.
  - `spendVideoDateCreditExtension`.
  - Critical issue: realtime state precedence can set `date`, then overwrite back to `handshake` because `handshake_started_at` remains set.

- `apps/mobile/components/video-date/ConnectionOverlay.tsx`
  - Joining/waiting peer overlay.
  - Simpler than web but functional.

- `apps/mobile/components/video-date/KeepTheVibe.tsx`
  - Native date extension UI exists in the current workspace.
  - Uses extra-time and extended-vibe credits.
  - This contradicts older docs that claimed native was missing credits extension.

- `apps/mobile/components/video-date/VideoDateControls.tsx`
  - Native controls include mute, camera, profile, safety, end, and add-time shortcut.
  - Uses text/emoji-style symbols rather than the more polished icon hierarchy on web.

- `apps/mobile/components/video-date/PostDateSurvey.tsx`
  - Full-screen post-date survey.
  - Same broad steps as web.
  - Calls `post-date-verdict` through `onSubmitVerdict`.
  - Optional `date_feedback` updates.
  - Calls `onStartChatting(matchId)` on celebration, which currently feeds the wrong id shape to the chat route.

## 5. Backend / DB / Edge Function map

### Core tables and columns

- `event_registrations`
  - Flow columns: `event_id`, `profile_id`, `admission_status`, `queue_status`, `current_room_id`, `current_partner_id`, `last_active_at`, `last_lobby_foregrounded_at`.
  - Key statuses used by this journey: `browsing`, `idle`, `in_ready_gate`, `in_handshake`, `in_date`, `in_survey`, `offline`.

- `video_sessions`
  - Participant columns: `participant_1_id`, `participant_2_id`, `event_id`.
  - Ready Gate: `ready_gate_status`, `ready_gate_expires_at`, `ready_participant_1_at`, `ready_participant_2_at`, `queued_expires_at`, `snoozed_by`, `snooze_expires_at`.
  - Date state: `state`, `phase`, `state_updated_at`, `handshake_started_at`, `handshake_grace_expires_at`, `date_started_at`, `ended_at`, `ended_reason`.
  - Daily: `daily_room_name`, `daily_room_url`, `participant_1_joined_at`, `participant_2_joined_at`.
  - Reconnect: `participant_1_away_at`, `participant_2_away_at`, `reconnect_grace_ends_at`.
  - Credits and prompts: `date_extra_seconds`, `vibe_questions`.
  - Vibe/verdict: `participant_1_liked`, `participant_2_liked`.

- `date_feedback`
  - Flow columns: `session_id`, `user_id`, `target_id`, `liked`, `tags`, `energy`, `conversation_flow`, `photo_accurate`, `honest_representation`.
  - Unique constraint on `(session_id, user_id)`.
  - `comfortable` is collected by clients but not persisted in the current implementation.

- `matches`
  - Flow columns: `id`, `profile_id_1`, `profile_id_2`, `event_id`, `matched_at`, `last_message_at`, `archived_at`, `archived_by`.
  - Persistent chat unlock depends on this table.

- `user_credits`
  - Flow columns: `profile_id`, `extra_time_credits`, `extended_vibe_credits`.

- `event_loop_observability_events`
  - Flow columns: `operation`, `outcome`, `reason`, `latency_ms`, `event_id`, `actor_id`, `session_id`, `detail`, `created_at`.

### Current checked-in migrations that matter

Important caveat: this repo contains migrations dated after the environment date of 2026-04-22, including files dated 2026-04-23 through 2026-04-30. This audit treats latest checked-in migration order as the intended runtime contract, but production deployment status should be verified before implementation.

- `supabase/migrations/20260311133000_video_date_state_machine.sql`
  - Introduced `video_date_state` and early `video_date_transition`.

- `supabase/migrations/20260403120000_submit_post_date_verdict.sql`
  - Defines `submit_post_date_verdict`.
  - Calls `check_mutual_vibe_and_match`.

- `supabase/migrations/20260409110000_expire_video_date_reconnect_grace_cron.sql`
  - Defines/schedules reconnect grace expiry.

- `supabase/migrations/20260421120000_event_loop_harden_queue.sql`
  - Hardens queued match promotion and drain behavior.

- `supabase/migrations/20260423120000_event_loop_observability.sql`
  - Adds `event_loop_observability_events`.
  - Instruments foreground/drain/promotion paths.

- `supabase/migrations/20260428120000_video_date_p0_p1_closure.sql`
  - Current important implementation for `ready_gate_transition`.
  - Adds broader event-loop hardening.

- `supabase/migrations/20260428120100_video_date_credit_extension_budget.sql`
  - Defines `spend_video_date_credit_extension`.

- `supabase/migrations/20260429130000_same_match_convergence_closure.sql`
  - Current important implementation for `handle_swipe` and queued/immediate match convergence.

- `supabase/migrations/20260429131000_video_date_participant_joined_at.sql`
  - Adds/uses Daily joined stamps.

- `supabase/migrations/20260429133000_ready_gate_expiry_join_guard.sql`
  - Current important guard for stale Ready Gate expiry and `update_participant_status`.

- `supabase/migrations/20260430090000_video_date_handshake_hardening.sql`
  - Current important implementation for `video_date_transition`.

- `supabase/migrations/20260430091000_video_date_observability_trigger.sql`
  - Adds transition observability.

- `supabase/migrations/20260430100000_video_date_handshake_grace_expiry_cleanup.sql`
  - Current cleanup for stale handshake/date phases.

- `supabase/migrations/20260430113000_video_date_transition_event_id_fix.sql`
  - Follow-up observability/event id correction.

### RPCs

- `handle_swipe(p_event_id, p_target_id, p_swipe_type)`
  - Called only by EF `swipe-actions`.
  - Creates `event_swipes`.
  - Creates or reuses `video_sessions`.
  - Returns `match`, `match_queued`, or non-match outcomes.

- `promote_ready_gate_if_eligible(p_user_id, p_event_id)`
  - Promotes queued sessions when both sides are present and conflict-free.
  - Writes both registrations to `in_ready_gate`.

- `drain_match_queue(p_event_id)`
  - Expires stale sessions, then calls promotion helper.

- `mark_lobby_foreground(p_event_id)`
  - Updates `last_lobby_foregrounded_at` and can promote a queued match.

- `ready_gate_transition(p_session_id, p_action, p_reason default null)`
  - Backend-authoritative Ready Gate state machine.
  - Actions used: `sync`, `mark_ready`, `snooze`, `forfeit`.

- `video_date_transition(p_session_id, p_action, p_reason default null)`
  - Backend-authoritative date state machine.
  - Actions used: `sync_reconnect`, `mark_reconnect_partner_away`, `mark_reconnect_return`, `enter_handshake`, `vibe`, `complete_handshake`, `end`.

- `mark_video_date_daily_joined(p_session_id)`
  - Stamps participant join time after Daily join.

- `spend_video_date_credit_extension(p_session_id, p_credit_type)`
  - Atomic credit decrement + `video_sessions.date_extra_seconds` increment.

- `submit_post_date_verdict(p_session_id, p_liked)`
  - Auth participant-only verdict write.
  - Upserts `date_feedback`.
  - Calls `check_mutual_vibe_and_match`.

- `check_mutual_vibe_and_match(p_session_id)`
  - Despite older naming, it is still used by current post-date finalization.
  - Creates persistent `matches` row when both `date_feedback.liked` values are true.

- `update_participant_status(p_event_id, p_status)`
  - Client-writable status update with guards.
  - Latest implementation ignores attempts to write server-owned `in_handshake`/`in_date`.

### Edge Functions

- `supabase/functions/swipe-actions/index.ts`
  - Auth wrapper for `handle_swipe`.
  - Sends ready-gate and vibe notifications.
  - Canonicalizes swipe response shape.

- `supabase/functions/daily-room/index.ts`
  - Actions: `create_date_room`, `join_date_room`, `delete_room`.
  - Current clients use `create_date_room`; `join_date_room` exists but is not used by the active web/native date paths.
  - For video-date sessions, `delete_room` returns a skipped-success shape because cleanup is cron-owned.

- `supabase/functions/video-date-room-cleanup/index.ts`
  - Cron/service function.
  - Deletes Daily rooms only for ended `video_sessions` older than the cleanup buffer.

- `supabase/functions/post-date-verdict/index.ts`
  - Auth wrapper for `submit_post_date_verdict`.
  - Sends `new_match` notifications when a persistent match is newly created.

- `supabase/functions/send-message/index.ts`
  - Not part of survey submission.
  - Relevant only after `matches` exists and chat is unlocked.

## 6. Authoritative state machine

### Event Lobby state model

| State | Trigger | Enforced where | Idempotent | Refresh/background/switch-device behavior | Risk |
|---|---|---|---|---|---|
| Browsing | User enters live event lobby; status set to browsing. | Client calls `update_participant_status`; RPC guards active server-owned sessions. | Mostly. Active sessions block unsafe status write. | `useActiveSession` and route hydration recover active sessions. | Client live-window gate can disagree with backend event status. |
| Queued | Mutual vibe exists but partner not present/busy. | `handle_swipe` inserts `video_sessions.ready_gate_status = queued`; registrations get current room/partner. | Reuse/lock logic prevents duplicate same-match sessions. | Web drains on status/foreground; native drains more aggressively. | Missed promotion may wait until foreground/poll; native cost higher. |
| Ready Gate visible | Both present and no conflict. | `handle_swipe` immediate or `promote_ready_gate_if_eligible`. | Yes, session id stable. | Active-session hydration should reopen Ready Gate on both devices. | Web standalone `/ready/:id` is only redirect; native has standalone screen. |
| Both ready | Both participants mark Ready. | `ready_gate_transition('mark_ready')` sets `both_ready`. | Yes. | Clients navigate to Date; latch prevents bounce. | If client misses both-ready RT, 2s Ready Gate polling recovers. |
| Pushed to date | Client navigates `/date/:id`. | Route guard verifies DB; `enter_handshake` RPC owns phase. | Route latch is local but backend transition is idempotent. | Refresh on `/date/:id` revalidates session. | Duplicate `enter_handshake` web calls add noise. |
| Bounced back to lobby | Invalid/ended/not participant/not live/stale ready gate. | Route guards and hydration. | Mostly. | Global hydration can redirect stale sessions. | Survey state is not recovered this way. |
| Empty deck/no candidates | `get_event_deck` returns none after filters and seen ids. | RPC + client seen-profile set. | N/A. | 15s refetch and foreground refetch. | Client "seen" set can hide returned candidates until reset. |
| Event ended/not registered/paused/premium gate | Event/registration checks fail. | Client UI and backend RPC guards. | N/A. | Rechecks on fetch/focus. | Client and backend live status can drift. |

### Video session / date state model

| State | Trigger | Enforced where | Idempotent | Refresh/background/switch-device behavior | Risk |
|---|---|---|---|---|---|
| Initial session creation | Mutual swipe. | `handle_swipe` via `swipe-actions`. | Same pair/session convergence is guarded. | Active-session hooks find current room. | `match_id` alias can be confused with persistent match id. |
| Ready Gate pending | Immediate or queued promotion. | `ready_gate_transition` and promotion RPCs. | Yes. | 2s Ready Gate polling and active-session hydration recover. | Web lacks Snooze UI. |
| Handshake | Date route enters; `enter_handshake`. | `video_date_transition('enter_handshake')`. | Yes if already handshake/date. | Date screen re-fetches; RT updates. | Web duplicate calls; Daily token allowed only after both_ready/handshake/date. |
| Waiting for partner | One side completed handshake; other side has not. | `video_date_transition('complete_handshake')` sets/reads `handshake_grace_expires_at`. | Mostly. | Realtime or sync should repaint. | Native date->handshake overwrite can strand UI. |
| Date | Both vibe true. | `video_date_transition('vibe'/'complete_handshake')`. | Yes. | `date_started_at` is durable; refetch can recover. | Native realtime precedence bug. |
| Reconnect grace / partner away | Daily participant-left or background/offline. | Client detects provider event; `video_date_transition('mark_reconnect_partner_away')` stores away/grace. | Mostly. | `sync_reconnect` loop recovers; cron expires stale grace. | If the local client never saw partner connected, survey may be skipped. |
| Ended | Timer, leave button, handshake fail, reconnect expiry, cron cleanup. | `video_date_transition('end')` and cleanup RPCs. | Yes, ended rows return stable ended state. | RT and sync observe ended. | Web backend-ended branch does not open survey. |
| Survey visible | Client local `showFeedback = true`. | Client only; `event_registrations` may be `in_survey`. | Not durable. | Refresh/force-quit can lose it. | Major recovery gap. |
| Survey submitted | Verdict EF/RPC. | `post-date-verdict` -> `submit_post_date_verdict`. | Verdict upsert is idempotent per user/session. | One-sided submissions persist; second user can complete later. | Client route after mutual is wrong. |

### Major transition truth table

| Transition | Authoritative truth | Depends on realtime | Polling fallback | Client-owned risky assumption |
|---|---|---:|---:|---|
| Swipe -> queued/ready | `swipe-actions`/`handle_swipe` result and `video_sessions` row | No | Deck/queue refetch | UI optimism must not infer match outside EF result. |
| Queued -> Ready Gate | `promote_ready_gate_if_eligible` writes DB | Helpful | Web foreground/drain; native 10s drain; active-session 8s | Native extra polling assumes recovery needs more cadence than web. |
| Ready -> both_ready | `ready_gate_transition` | Helpful | Ready Gate 2s poll | Countdown expiry is local UI; backend expiry is canonical. |
| both_ready -> handshake | `video_date_transition('enter_handshake')` | No | Date route fetch | Web calls enter in two places. |
| handshake -> waiting/date/end | `video_date_transition('vibe'/'complete_handshake')` | Helpful | Date fetch/reconnect sync | Native current RT precedence can mispaint date as handshake. |
| reconnect away/return | `video_date_transition` away/return/sync | Helpful | `sync_reconnect` backoff loop | Local `hadConnectedOnce` decides whether grace UI/survey appears. |
| date -> ended | `video_date_transition('end')`, cleanup cron, or RT ended row | Helpful | `sync_reconnect` and route fetch | Web only opens survey from local end path. |
| ended -> survey | No durable backend transition beyond `in_survey` registration | No | None | `showFeedback` is local and lossy. |
| survey verdict -> match | `post-date-verdict` -> `submit_post_date_verdict` -> `check_mutual_vibe_and_match` | No | Retry by resubmit | Client chat route uses wrong id. |

## 7. Realtime / polling / hydration analysis

### Realtime and polling table

| Platform | File | Subscription / polling name | Cadence | Trigger | Stop condition | Purpose | Risk | Recommendation |
|---|---|---|---:|---|---|---|---|---|
| Web | `src/pages/EventLobby.tsx` | `mark_lobby_foreground` RPC loop | 30s | Focused, visible, current lobby route | Route change/unmount/not visible | Presence for queued promotion | Moderate RPC/log volume | Keep, but instrument cadence and suppress during active Ready/Date yield. |
| Web | `src/hooks/useEventDeck.ts` | Deck refetch | 15s | Query enabled and live | Unmount/disabled | Deck freshness | Duplicate with foreground refetch | Keep but consider stale-time tuning in large events. |
| Web | `src/pages/EventLobby.tsx` | own `event_registrations` RT | RT | Update for `profile_id = user.id` | Unmount | Route to Ready/Date or refetch active session | Missed RT can delay handoff | Covered by `useActiveSession` 8s poll. |
| Web | `src/pages/EventLobby.tsx` | event-scoped `video_sessions` RT | RT | Insert/update for `event_id` | Unmount | Detect participant session changes | Busy events deliver broad payloads | Prefer exact session filters once session known; keep event-scope for queued discovery. |
| Web | `src/hooks/useMatchQueue.ts` | event-scoped `video_sessions` RT | RT | Insert/update for event | Unmount | Queue count/promotion notification | Only active when hook mounted | OK; add metrics for queue wait time. |
| Web | `src/hooks/useActiveSession.ts` | active-session poll | 8s | Mounted with user | Unmount | Recovery from missed RT | Cost across many lobbies | Keep as correctness fallback; avoid extra duplicate global instances. |
| Web | `src/hooks/useActiveSession.ts` | own reg + event video RT | RT | Own reg update or event video change | Unmount | Active session hydration | Broad video subscription | Same as above. |
| Web | `src/components/lobby/ReadyGateOverlay.tsx` | reconcile poll | 2s | Overlay open | Overlay close/unmount/date nav | Stale Ready Gate cleanup and route handoff | Duplicates `useReadyGate` poll | Consolidate with hook or gate one poll. |
| Web | `src/hooks/useReadyGate.ts` | Ready Gate poll | 2s | Non-terminal Ready Gate | Terminal/unmount | Countdown/status recovery | Combined 2s + overlay reconcile is noisy | Merge reconcile needs into hook. |
| Web | `src/pages/VideoDate.tsx` | `video_sessions` timer RT | RT | Update by `id = sessionId` | Unmount | Timer/phase/end updates | Ended update does not open survey | Fix survey-open branch. |
| Web | `src/hooks/useReconnection.ts` | `sync_reconnect` loop | 1s -> 3s -> 7s | Grace/uncertain reconnect state | Stable/ended/unmount | Server truth for away/return/end | Not every-second spam long-term; still logs during outages | Keep; add reasoned metrics and cap visible duplicate calls. |
| Native | `apps/mobile/app/event/[eventId]/lobby.tsx` | `mark_lobby_foreground` RPC loop | 30s | Focused + AppState active | Blur/background/unmount | Presence for queued promotion | Same as web | Keep. |
| Native | `apps/mobile/app/event/[eventId]/lobby.tsx` | queued drain loop | 10s | `queuedCount > 0` or `activeSession.kind = syncing` | Not queued/syncing/blur/background | Queued promotion recovery | Cost and behavior drift from web | Reduce to foreground/RT-triggered or adaptive backoff after validation. |
| Native | `apps/mobile/app/event/[eventId]/lobby.tsx` | own reg RT | RT | Own registration update | Unmount | Route/open Ready/Date | Missed RT delayed by active session poll | OK. |
| Native | `apps/mobile/app/event/[eventId]/lobby.tsx` | event video RT | RT | Insert/update for event | Unmount | Ready/date/queue TTL | Broad payloads | Same recommendation as web. |
| Native | `apps/mobile/lib/useActiveSession.ts` | active-session poll | 8s | Mounted with user | Unmount | Recovery and syncing | Cost | Keep as fallback. |
| Native | `apps/mobile/lib/useActiveSession.ts` | own reg + event video RT | RT | Own reg or event session changes | Unmount | Active session hydration | Broad payloads | Same as web. |
| Native | `apps/mobile/lib/readyGateApi.ts` | Ready Gate poll | 2s | Non-terminal Ready Gate | Terminal/unmount | Ready status recovery | Expected but frequent | Keep until RT reliability proven. |
| Native | `apps/mobile/app/ready/[id].tsx` | standalone validation/refetch | Manual + hook | Screen focus and hook changes | Route away | Guard stale ready state | More robust than web but divergent | Decide canonical web/native behavior. |
| Native | `apps/mobile/lib/videoDateApi.ts` | `video_sessions` RT | RT | Update by session id | Unmount | Phase/timer/end updates | Date can be overwritten by handshake | Fix precedence. |
| Native | `apps/mobile/app/date/[id].tsx` | reconnect sync loop | 1s -> 3s -> 7s | Partner away/reconnect uncertainty | Stable/ended/unmount | Server truth for reconnect | Similar to web | Keep with metrics. |
| Native | `apps/mobile/app/date/[id].tsx` | first remote watchdog | 25s once | Joined Daily but no remote | Remote appears or one rejoin attempted | Recover from missed Daily remote tracks | Can cause one extra provider join | Keep; add provider outcome telemetry. |

### Required explicit investigations

#### 1. `sync_reconnect` polling volume

Current volume is bounded. Both web and native start aggressively at about 1s while the reconnect state is uncertain, then back off to about 3s and 7s. This is not permanent every-second spam. The cost risk is real during provider/network incidents, but it is acceptable for correctness if observability can separate normal recovery from storm conditions.

Recommended action: keep backend-authoritative `sync_reconnect`, add client-side metrics for loop start/stop/reason, and verify only one reconnect loop is active per screen.

#### 2. `waiting_for_partner` -> `date` / `ended` repaint behavior

Web can repaint from RT if `date_started_at` or `ended_at` is delivered. The ended repaint currently fails to open survey. Native has a stronger correctness bug: its RT handler can set date and then set handshake because `handshake_started_at` remains present after promotion.

Recommended action: enforce a shared precedence order in both clients: `ended_at` first, then `date_started_at/state=date`, then active handshake/waiting.

#### 3. Handshake limbo risk if realtime is delayed or missed

Ready Gate has 2s polling fallback. Date screen has direct timer fetch and reconnect sync, but handshake `complete_handshake` outcomes rely on the local caller and RT updates. If one client misses RT, polling is indirect. Native has a known repaint bug; web has survey-ended bug.

Recommended action: add a date-phase sync poll with adaptive cadence only during `handshake`/`waiting_for_partner`, or reuse `sync_reconnect` response to include phase repaint authority. Keep the RPC authoritative.

#### 4. Active-session hydration fighting current screen

Web has `SessionRouteHydration` and date-entry latch to avoid bouncing `/date/:id` during Ready Gate handoff. Native has a similar hydration path and richer date-entry truth fetch. Both are broadly aligned for Ready -> Date. Survey is the gap: `in_survey` is not hydrated into survey UI, so recovery loses the survey rather than fighting it.

Recommended action: add durable post-date survey hydration keyed by `event_registrations.queue_status = in_survey` plus last ended `video_sessions` id, or a dedicated survey route/state table.

#### 5. Web/native subscription and recovery differences

The biggest differences are:

- Native has `syncing` active-session state for queued sessions; web does not expose this state as strongly.
- Native drains queued sessions every 10s while queued/syncing; web drains on status/foreground.
- Native has standalone Ready Gate route with Snooze; web `/ready/:id` redirects to lobby overlay.
- Native has a first-remote Daily watchdog/rejoin; web relies on Daily events plus post-join snapshot.
- Web survey can be interrupted by `useMatchQueue` during `in_survey`; native survey does not drain queue during survey.

## 8. Daily / media lifecycle analysis

### Room creation and token issuance

- Room creation happens through `supabase/functions/daily-room/index.ts`, action `create_date_room`.
- Web caller: `src/hooks/useVideoCall.ts`.
- Native caller: `apps/mobile/lib/videoDateApi.ts` via `getDailyRoomToken`.
- `join_date_room` exists in the Edge Function but is not used by the current active web or native date path.
- The EF authorizes the actor as a session participant, checks `ended_at`, and checks that the session is in `handshake`/`date` or `ready_gate_status = both_ready`.
- Room name semantics:
  - If `video_sessions.daily_room_name` exists, it is reused.
  - Otherwise room name is generated from the session id.
  - `daily_room_url` is `https://${DAILY_DOMAIN}/${roomName}`.
- Token semantics:
  - Meeting token expires after 7200s.
  - Token is generated per caller and returned with `room_name`, `room_url`, `reused_room`, and provider recreation flags.

### Room reuse vs creation

The EF reuses `daily_room_name` when present. If the provider room is missing/expired, it recreates provider state and keeps DB room identity stable. This is the right backend-authoritative behavior.

### Track mounting

Web:

- `useVideoCall` creates a Daily call object and subscribes to participant events.
- Local media is assembled from Daily persistent tracks and assigned to local stream state and refs.
- Remote media is attached from participant tracks to `remoteVideoRef`, including audio tracks where available.
- A post-join participant snapshot attaches tracks even if event delivery was missed.

Native:

- `date/[id].tsx` uses `DailyMediaView`.
- Track selectors prefer on/playable tracks and persistent tracks.
- Daily participant events update remote/local state.
- A 25s first-remote watchdog leaves/destroys/rejoins once if no remote appears.

### Self-view and remote-view logic

- Web self-view: local `MediaStream` from Daily local participant tracks, rendered as picture-in-picture.
- Web remote-view: remote `MediaStream` assigned to `<video ref={remoteVideoRef}>`.
- Native self-view: local `DailyMediaView`.
- Native remote-view: remote `DailyMediaView` from remote participant/session id.

### Cleanup

- Web `useVideoCall` cleanup leaves and destroys the Daily call object, clears streams and `srcObject`, and does not delete the provider room.
- Web `beforeunload` calls `video_date_transition('end', 'beforeunload')` and stops local tracks.
- Native `leaveAndCleanup` leaves/destroys Daily, logs room-delete skipped, and calls `endVideoDate`.
- EF `delete_room` is intentionally skipped for video-date sessions.
- `video-date-room-cleanup` deletes provider rooms only after sessions are ended and aged past the cleanup buffer.

### Why web previously had "neither self-view nor remote video" failures

Repo evidence indicates the current web hook is designed to address exactly that class of failure:

- It builds local streams from Daily persistent tracks instead of relying only on one event shape.
- It attaches tracks after participant updates and after the join snapshot.
- It clears and reattaches refs defensively.

The remaining race is not fully eliminated:

- Web does not have a provider-level first-remote rejoin watchdog like native.
- Permission acquisition is not preflighted as explicitly as native; camera/mic failures are handled after Daily events/errors.
- If Daily join succeeds but remote participant events never provide playable tracks, web can remain in waiting/connection UI without a single forced rejoin.

### Permission vs Daily join race evidence

Native explicitly requests camera/mic before join. Web relies on Daily `join({ audio: true, video: true })` and handles camera errors after they occur. This makes native more deterministic before token/join. No code evidence shows backend room creation racing permissions, because token creation is independent of camera permission. The race is UI/provider readiness: token/room can succeed while local tracks fail to start.

### Premature room teardown risk

Provider room deletion is currently cron-owned and skipped by client `delete_room`, which is good. The more realistic premature-teardown risk is not room deletion; it is session ending:

- Web `beforeunload` can call `video_date_transition('end')`.
- Native `leaveAndCleanup` calls `endVideoDate` even for some abort paths.

`video_date_transition` is backend-authoritative and idempotent, but end semantics need to distinguish failed pre-connect abort from ending an established date.

## 9. UX parity defects (web vs native)

Severity definitions: P0 blocks trust-critical flow or loses data; P1 major user-facing failure; P2 parity/product polish; P3 minor inconsistency.

| Severity | Web behavior | Native behavior | Likely files | Likely cause | Fix type |
|---|---|---|---|---|---|
| P0 | Backend/partner-ended date can show ended state without opening survey. | Reconnect-ended path can open survey if partner ever joined. | `src/pages/VideoDate.tsx` | Survey open is tied to local end handler only. | Client state/recovery. |
| P0 | Start Chatting routes to `/chat`, which does not exist. | Start Chatting routes to `/chat/${matchId}`, but chat expects other profile id. | `PostDateSurvey.tsx`, `date/[id].tsx`, chat hooks/routes | Confusion between persistent match id and profile id route. | Shared contract/routing. |
| P1 | Date phase realtime precedence is mostly correct but survey-ended branch is not. | RT handler can repaint date back to handshake. | `apps/mobile/lib/videoDateApi.ts` | Branch order bug. | Client correctness. |
| P1 | Ready Gate is lobby overlay only; no visible Snooze. | Standalone Ready Gate has Snooze and richer copy. | `ReadyGateOverlay.tsx`, `ready/[id].tsx` | Product surface drift. | UI plus product decision. |
| P1 | Web has no first-remote forced rejoin watchdog. | Native has 25s watchdog and one rejoin. | `useVideoCall.ts`, `date/[id].tsx` | Provider recovery parity drift. | Media/provider. |
| P1 | Survey can be interrupted by Ready Gate queue promotion through `useMatchQueue`. | Survey does not drain/promo during survey. | `PostDateSurvey.tsx`, native survey | Different queue behavior during survey. | State policy. |
| P2 | Web visual hierarchy uses richer web controls/icons and overlay polish. | Native controls use simpler symbols/text and weaker hierarchy. | native video-date components | Native-specific wrapper/polish gap. | UI only. |
| P2 | Web lobby guidance and swipe affordances are richer. | Native has implementation-flavored empty state copy around "native" Mystery Match. | native lobby | Native-only feature/copy drift. | UI copy. |
| P2 | Web Ready Gate CTA hierarchy is simple Ready/Skip. | Native standalone includes Snooze/Step away. | Ready Gate files | Contract supports all, UI differs. | UI/product. |
| P2 | Web date extension surface is present through `KeepTheVibe`. | Native extension now exists; older docs are stale. | `KeepTheVibe.tsx` both | Documentation drift. | Docs/QA. |
| P3 | Web survey is modal. | Native survey is full-screen branch. | survey components | Platform convention difference. | Likely acceptable if recovery fixed. |

Important correction to older assumptions: current native code does include credits extension surfaces (`apps/mobile/components/video-date/KeepTheVibe.tsx` and add-time control). Native missing credits extension is stale for this workspace.

## 10. Survey / match-finalization analysis

### What opens the survey?

Web:

- Local `showFeedback` state in `src/pages/VideoDate.tsx`.
- Set by local `handleCallEnd`.
- Not set by generic `video_sessions.ended_at` realtime observation.

Native:

- Local `showFeedback` state in `apps/mobile/app/date/[id].tsx`.
- Set by `handleCallEnd`.
- Some reconnect-ended paths call `handleCallEnd` if the partner had ever joined.

### What suppresses or skips it?

- Web suppresses it whenever the date ends through a path that only updates `phase = ended` without calling `handleCallEnd`, such as partner/backend end RT.
- Native can skip it on connection abort paths that route back to lobby.
- Both platforms lose it on refresh/force-quit because it is not durable.

### Modal, full-screen, route, or nested branch?

- Web: modal branch inside `/date/:id`.
- Native: full-screen branch inside `date/[id]`.
- Neither uses a durable survey route.

### Persisted data

- Verdict: `date_feedback.liked`.
- Optional highlights: `date_feedback.tags`, `energy`, `conversation_flow`.
- Optional safety: `date_feedback.photo_accurate`, `honest_representation`.
- Not persisted: `comfortable`.

### Mandatory vs optional questions

- Verdict is mandatory to proceed.
- Highlights are optional.
- Safety answers are optional/skippable.
- Report flow is optional.

### RPC / mutation finalization

- Client calls EF `post-date-verdict`.
- EF calls RPC `submit_post_date_verdict(p_session_id, p_liked)`.
- RPC updates `video_sessions.participant_1_liked` or `participant_2_liked`, upserts `date_feedback`, then calls `check_mutual_vibe_and_match`.

### Persistent match creation and chat unlock

- Persistent match is created when both participants have `date_feedback.liked = true`.
- `check_mutual_vibe_and_match` normalizes pair order, avoids duplicate matches, and inserts `matches`.
- Chat is unlocked by the `matches` row.
- Current clients mishandle the post-celebration route:
  - Web ignores returned `match_id` and navigates `/chat`.
  - Native passes `match_id` to `/chat/:id`, but current chat hooks treat route id as other profile id.

### One-sided submission behavior

- First user submission persists.
- If the other user has not liked/submitted yet, response is non-mutual.
- Later second submission can create the match atomically.

### Dismiss/background/force-quit behavior

- There is no durable survey reopen path.
- A user can lose the survey by refreshing/quitting after `in_survey` is written.
- A repeated survey loop is less likely than survey loss, because verdict upsert is idempotent, but the local route has no memory of completion.

### Race with reconnect/end cleanup

- Date end and survey open are local-client driven.
- Backend cleanup can end the session and update registrations without guaranteeing the client opens survey.
- Reconnect grace expiry sets registrations to `idle` in the expiry function, which can further bypass survey recovery if the client misses it.

### Older `check_mutual_vibe_and_match` semantics

The function name is older and potentially misleading, but current `submit_post_date_verdict` intentionally still calls it. Current match finalization is not using old swipe semantics; it reads `date_feedback`.

### Atomicity

The database path for a submitted verdict and match creation is reasonably atomic inside `submit_post_date_verdict` plus `check_mutual_vibe_and_match`. The weaker part is client handling of returned match identity and durable survey recovery.

## 11. Failure-mode matrix

| Failure mode | Symptom seen by user | Likely root-cause layer | Files / functions involved | Self-recovers? | Stranded? | Severity | Recommended fix approach |
|---|---|---|---|---:|---:|---|---|
| Event not live | Lobby blocked or swipe rejected. | UI + RPC | Lobby files, `handle_swipe`, `promote_ready_gate_if_eligible` | Mostly | No | P2 | Keep backend canonical; reduce client live-window drift. |
| User not registered/confirmed | Redirect or denied lobby/deck/swipe. | UI + DB/RPC | `useIsRegisteredForEvent`, native event API, `handle_swipe` | Yes | No | P2 | Align error copy across platforms. |
| Deck empty | Empty state; native may show Mystery Match. | RPC/UI | `useEventDeck`, native lobby | Partly | No | P2 | Add deck-empty telemetry and remove implementation copy. |
| Duplicate profiles/deck refetch weirdness | Same profile repeats or disappears. | RPC/client seen set | `useEventDeck`, lobby seen-profile logic | Partly | No | P2 | Add deck result ids telemetry; verify RPC exclusions. |
| Mutual vibe while partner busy | Queued state, delayed Ready Gate. | RPC/presence | `handle_swipe`, `promote_ready_gate_if_eligible` | Yes | Possible delay | P1 | Keep backend conflict guard; improve queue wait UI. |
| Queue drain bug | User never sees Ready Gate. | RPC/poll/RT | `drain_match_queue`, lobbies, `useMatchQueue` | Web by foreground/RT, native by loop | Possible | P1 | Add queue-age alerting and adaptive drain. |
| Ready Gate status mismatch | Overlay disappears or bounces. | DB/client hydration | `ReadyGateOverlay`, `useReadyGate`, `ready_gate_transition` | Usually | Low | P1 | Consolidate reconcile and hook poll. |
| Stale active-session truth | Wrong route bounce or stale overlay. | Hydration/DB | `useActiveSession`, `SessionRouteHydration`, native hydration | Mostly | Possible | P1 | Add survey state hydration and more explicit route reasons. |
| Double navigation route bounce | Ready -> Date -> Lobby flicker. | Client hydration | date-entry latch files | Mostly | Possible | P1 | Keep latch; add transition telemetry. |
| Handshake grace timing edge | Waiting UI sticks or ends unexpectedly. | RPC/RT/client | `video_date_transition`, `VideoDate`, `videoDateApi` | Partly | Yes | P1 | Shared phase precedence and adaptive sync. |
| Missed realtime | Delayed Ready/Date/End repaint. | Realtime | subscriptions listed above | Poll mostly covers | Sometimes | P1 | Keep polling only as targeted fallback; add missed-RT metrics. |
| Supabase 5xx / Cloudflare failure | Swipe/ready/date action fails or spinner. | Network/provider | all EF/RPC callers | Sometimes via retry/manual | Possible | P1 | Standard retry affordances and error copy. |
| Daily token/room create failure | Cannot join call. | EF/provider | `daily-room`, `useVideoCall`, native token call | User can retry by remount sometimes | Yes | P1 | Add explicit retry CTA and provider error telemetry. |
| Camera/mic denied | Cannot ready/join or black/self missing. | Permissions | native permissions, web Daily errors | Native better | Yes | P1 | Web preflight permissions; aligned remediation UI. |
| Remote track never mounts | Waiting/blank remote. | Daily/client | `useVideoCall`, native Daily handlers | Native one rejoin; web less | Yes | P1 | Add web remote watchdog and track-mounted telemetry. |
| Reconnect grace expiry | Partner gone; session ends. | RPC/cron/client | `video_date_transition`, expiry cron, `useReconnection` | If client observes | Possible | P1 | Ensure ended -> survey/exit policy is deterministic. |
| Extension mutation fails | Button appears to do nothing or toast error. | RPC/credits | `spend_video_date_credit_extension`, KeepTheVibe | User can retry | No | P2 | Disable while pending; reconcile server extra seconds. |
| Survey submit partially succeeds | Verdict saved but optional answers fail. | EF/RPC/client optional update | `post-date-verdict`, survey components | Verdict persists | No | P2 | Distinguish verdict success from optional feedback failures. |
| Match created one side but not other | One user sees celebration; other not yet. | Expected async one-sided submission | `submit_post_date_verdict`, `check_mutual_vibe_and_match` | Second submit creates/returns | No | P2 | Add copy/notification for delayed mutual match. |
| Duplicate match | Duplicate persistent matches. | DB constraint/RPC | `matches` unique index, `check_mutual_vibe_and_match` | DB prevents | No | P1 | Keep DB unique; add idempotency tests. |
| Duplicate end actions | Multiple end calls. | Client/RPC | `handleCallEnd`, `leaveAndCleanup`, `video_date_transition` | RPC idempotent | Low | P2 | Split cleanup from end; guard local handler. |
| Orphaned session | User stuck queued/ready/date. | DB/cron/recovery | expiry functions, hydration hooks | Cron should recover | Possible | P1 | Add orphan dashboards by status age. |
| Zombie Daily room | Provider room remains after ended session. | Provider cleanup | `video-date-room-cleanup` | Cron should recover | No user usually | P2 | Monitor cleanup failures. |
| Zombie overlay | Ready Gate modal stays after invalid session. | UI/poll | `ReadyGateOverlay`, `useReadyGate` | 2s reconcile usually | Possible | P2 | Consolidate poll/reconcile; show recover CTA. |
| Observability missing | Support cannot diagnose. | Telemetry | many client files | No | Indirect | P1 | Add event envelope for critical branches. |

## 12. Observability coverage and gaps

| Branch | Current coverage | Gap | Recommendation |
|---|---|---|---|
| Lobby enter | Web PostHog `lobby_entered`; console/Sentry breadcrumbs in places | Native parity less clear; no backend correlation id | Add shared event with event_id/profile_id/session route. |
| Deck fetch | Query/RPC only; some errors logged | No deck size/result ids telemetry | Track deck count, empty reason, latency. |
| Swipe outcome | EF lifecycle logs; PostHog swipe events | Need clearer distinction `video_session_id` vs persistent `match_id` | Rename analytics fields or add aliases with meaning. |
| Session creation | `event_loop_observability_events` from swipe/promotion | Good server coverage | Add client route-open correlation. |
| Ready Gate open | Some breadcrumbs/logs | No canonical `ready_gate_opened` client event | Add on both platforms. |
| Ready Gate transition | `ready_gate_transition` logs through observability | Good server coverage | Add client CTA pressed/outcome. |
| Date enter | PostHog `video_date_started`; route logs | Need route guard reason codes | Add guard result telemetry. |
| Room create/join | EF logs and Daily errors | Missing structured client provider-state metrics | Track token request, join start/success/fail, reused/recreated. |
| Local track mounted | Console/Sentry-ish diagnostics | Missing product telemetry | Add once-per-session event. |
| Remote track mounted | Console/Sentry-ish diagnostics | Missing product telemetry | Add once-per-session event and first-remote latency. |
| Reconnect enter/leave | Some PostHog/Sentry breadcrumbs; RPC logs | Need reason and loop volume metrics | Add reconnect loop start/stop and grace outcome. |
| Extension attempt/success/failure | Web tracks extension; RPC logs limited | Native parity and failure reason consistency | Add shared extension event shape. |
| Date ended | PostHog local end; RPC logs | Backend-ended client survey-open gap invisible | Track ended observed vs survey opened. |
| Survey opened | Not canonical | Major gap | Add required event. |
| Survey completed | PostHog completion | No durable survey lost/dismissed metric | Add opened/completed/skipped/dismissed/lost. |
| Match created | EF notification branch; RPC return | Client does not track match id route correctness | Track match created and CTA route target. |
| Route back to lobby/matches/chat | Local navigation only | No route outcome/failure telemetry | Add navigation intent/result. |

## 13. Drift / stale-doc findings

- `docs/mobile-sprint5.md` describes older mobile behavior with no post-date survey/in-call extras and room deletion assumptions. Current native code has post-date survey, reconnection, credits extension, and skips video-date room deletion.
- `docs/native-build-architecture-plan.md` says native Chat `[id]` is match id everywhere. Current chat hooks on both platforms use the route id as the other user's profile id. This conflicts directly with native post-date celebration passing `matchId`.
- Older audit/doc references to native missing credits extension are stale. Current native `KeepTheVibe` and add-time controls exist.
- Native `apps/mobile/lib/eventStatus.ts` comments/types still mention `in_handshake`/`in_date` as updateable flow states. Latest `update_participant_status` treats those as server-owned and ignores client writes.
- Swipe response `match_id` is legacy naming for `video_sessions.id`; post-date verdict `match_id` is persistent `matches.id`. This is a real naming drift and directly contributes to routing bugs.
- Checked-in migrations after the environment date are being treated as intended current contract. Production deployment should be verified before assuming every guard is live.

## 14. Prioritized fix plan

This is a plan only. No implementation is included in this audit.

### Stream A - correctness / state-machine

Goal: make client-visible state transitions follow backend truth deterministically.

Likely files:

- `src/pages/VideoDate.tsx`
- `apps/mobile/lib/videoDateApi.ts`
- `apps/mobile/app/date/[id].tsx`
- shared phase/transition helper if introduced

Backend surfaces:

- No migration required for first fixes.
- Validate `video_date_transition` return shape only.

Risk level: high impact, moderate blast radius.

Deploy requirements: web deploy and native build; no function deploy expected.

QA matrix:

- Partner ends date, other side sees survey.
- Cron/timeout ended date, foreground client sees deterministic exit/survey.
- Handshake mutual vibe promotes native to date and stays date.
- Refresh during handshake/date recovers correct phase.

Recommended PR split:

- PR A1: web ended-observed -> survey/exit policy.
- PR A2: native phase precedence and abort/end split.

### Stream B - realtime / polling / limbo recovery

Goal: remove limbo without adding broad polling spam.

Likely files:

- `src/hooks/useActiveSession.ts`
- `src/components/lobby/ReadyGateOverlay.tsx`
- `src/hooks/useReadyGate.ts`
- `apps/mobile/app/event/[eventId]/lobby.tsx`
- `apps/mobile/lib/useActiveSession.ts`
- `apps/mobile/lib/readyGateApi.ts`

Backend surfaces:

- Optional: extend `video_date_transition('sync_reconnect')` response if using it as phase sync.

Risk level: medium.

Deploy requirements: possible RPC migration only if response changes; otherwise client-only.

QA matrix:

- Missed Ready Gate RT still recovers.
- Missed both-ready RT still routes to date.
- Handshake waiting partner transitions after delayed RT.
- Large event simulated with many event-scoped session updates.

Recommended PR split:

- PR B1: consolidate duplicate Ready Gate polling/reconcile.
- PR B2: adaptive queued drain and phase-sync recovery.

### Stream C - Daily video / track mounting / room lifecycle

Goal: align provider recovery and track-mount diagnostics across web/native.

Likely files:

- `src/hooks/useVideoCall.ts`
- `apps/mobile/app/date/[id].tsx`
- `supabase/functions/daily-room/index.ts` only if return diagnostics need expansion

Backend surfaces:

- Daily provider function only if adding structured provider-state response.
- No DB migration expected.

Risk level: medium-high because media behavior is user-visible.

Deploy requirements: web deploy, native build, maybe Edge Function deploy.

QA matrix:

- Camera denied before join.
- Token success but local track failure.
- Remote joins late.
- Remote track event missed; snapshot/watchdog recovers.
- Leave/end does not delete room prematurely.

Recommended PR split:

- PR C1: web permission/rejoin/watchdog parity.
- PR C2: structured Daily diagnostics.

### Stream D - native UX parity

Goal: bring native guidance, controls, animations, and copy closer to web product behavior while preserving platform conventions.

Likely files:

- `apps/mobile/app/event/[eventId]/lobby.tsx`
- `apps/mobile/components/lobby/ReadyGateOverlay.tsx`
- `apps/mobile/app/ready/[id].tsx`
- `apps/mobile/components/video-date/*`

Backend surfaces:

- None.

Risk level: low-medium.

Deploy requirements: native build.

QA matrix:

- Lobby empty/deck states.
- Ready Gate CTA hierarchy and copy.
- Handshake guidance.
- Reconnect overlay.
- End-to-survey transition.

Recommended PR split:

- PR D1: copy/hierarchy cleanup.
- PR D2: animation/guidance polish.

### Stream E - credits / extension parity

Goal: keep extension behavior and feedback consistent across platforms.

Likely files:

- `src/components/video-date/KeepTheVibe.tsx`
- `src/hooks/useCredits.ts`
- `apps/mobile/components/video-date/KeepTheVibe.tsx`
- `apps/mobile/components/video-date/VideoDateControls.tsx`
- `apps/mobile/lib/videoDateApi.ts`

Backend surfaces:

- `spend_video_date_credit_extension` validation only; no change expected.

Risk level: low-medium.

Deploy requirements: web deploy, native build.

QA matrix:

- No credits.
- Extra-time credit success.
- Extended-vibe credit success.
- Concurrent tap/double spend.
- Server extra seconds reflected after refresh.

Recommended PR split:

- PR E1: pending/disabled/retry UX.
- PR E2: shared extension telemetry.

### Stream F - survey / match-finalization hardening

Goal: make survey durable, route chat correctly, and preserve atomic backend finalization.

Likely files:

- `src/components/video-date/PostDateSurvey.tsx`
- `src/pages/VideoDate.tsx`
- `apps/mobile/components/video-date/PostDateSurvey.tsx`
- `apps/mobile/app/date/[id].tsx`
- `src/hooks/useMessages.ts`
- `apps/mobile/lib/chatApi.ts`
- chat route helpers

Backend surfaces:

- Optional migration/function to expose matched partner id in `post-date-verdict` response.
- Optional durable survey recovery RPC/query if current DB shape is insufficient.

Risk level: high.

Deploy requirements: likely web/native; possibly Edge Function/RPC deploy if response shape changes.

QA matrix:

- One user likes, one skips.
- Both like, persistent match created once.
- Celebration Start Chatting routes to correct conversation.
- Refresh during survey reopens or cleanly resolves survey state.
- Force-quit and return after date end.

Recommended PR split:

- PR F1: chat route/id fix.
- PR F2: durable survey hydration/recovery.
- PR F3: optional feedback persistence cleanup.

### Stream G - observability / telemetry

Goal: make every trust-critical branch diagnosable.

Likely files:

- shared analytics/event helpers
- `src/pages/EventLobby.tsx`
- `src/pages/VideoDate.tsx`
- `src/hooks/useVideoCall.ts`
- web/native survey files
- native date/lobby files
- Edge Functions for lifecycle logs if needed

Backend surfaces:

- Existing `event_loop_observability_events`.
- Optional new operation names only; no schema change expected.

Risk level: low.

Deploy requirements: web/native; optional function deploy.

QA matrix:

- Verify events emitted exactly once per session branch.
- Verify no PII in payloads.
- Verify route and media event correlation.

Recommended PR split:

- PR G1: client event envelope and core branches.
- PR G2: media/provider diagnostics.

### Stream H - lower-priority provider noise

Goal: reduce non-flow background noise that can obscure date-flow diagnostics.

Likely files:

- `apps/mobile/components/PushRegistration.tsx`
- `apps/mobile/lib/onesignal.ts`
- related notification diagnostics

Backend surfaces:

- None unless notification payloads change.

Risk level: low.

Deploy requirements: native build.

QA matrix:

- Push registration still succeeds.
- Tag-limit or background warnings no longer pollute critical date logs.

Recommended PR split:

- PR H1: provider-noise cleanup after A/F/C are underway.

## 15. Recommended implementation slicing

Recommended order:

1. Stream F1 plus A1: fix post-date chat route/id and web ended-observed survey open. These are the fastest trust-critical user fixes.
2. Stream A2: native phase precedence and abort/end split.
3. Stream F2: durable survey hydration/recovery.
4. Stream B: polling/limbo recovery consolidation.
5. Stream C: Daily web watchdog and provider diagnostics.
6. Stream D/E: UX and credits parity polish.
7. Stream G: observability can start in parallel, but should at least land before broad rollout of behavior changes.
8. Stream H: provider-noise cleanup after critical flow issues.

Recommended PR strategy:

- Use one documentation/investigation PR for this audit if traceability is desired.
- Then move directly into implementation PRs by stream; do not combine state-machine fixes with UI polish.
- Keep backend-authoritative semantics intact. Client PRs should consume RPC truth, not reimplement transition decisions.
- If adding durable survey recovery needs new backend shape, ship backend migration/function first, then web/native consumers.

