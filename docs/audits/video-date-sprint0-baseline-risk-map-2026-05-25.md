# Video Date Sprint 0 Baseline And Risk Map

Date: 2026-05-25
Reviewed source baseline before Sprint 0 additions: `main` at `903eaf389` (`Address review comments 1051-1058`)
Scope: Vibely Video Date across web, native/mobile, Supabase, shared contracts, and Daily.

This is the Sprint 0 implementation artifact. It freezes the current operational contract for the intended Video Date product, records the highest-risk seams, and defines the verification gates every later sprint must keep green. It does not add a new feature. Its job is to make the current experience auditable and hard to regress.

## Sprint 0 Deliverables

| Deliverable | Status | Owner Surface |
| --- | --- | --- |
| Current journey/state map for event registration through post-date continuity | Implemented in this document | Product, web, native, backend |
| State ownership matrix for Supabase rows, Daily rooms, client caches, and routing | Implemented in this document | Backend, shared, clients |
| Web/native parity matrix for all critical Video Date surfaces | Implemented in this document | Web, native/mobile |
| Feature flag and kill-switch baseline for the current intended behavior | Implemented in this document | Backend, release |
| Ranked risk map for speed, reliability, safety, and premium UX | Implemented in this document | All |
| Contract test requiring this baseline to stay discoverable, complete, and tied to existing critical surface files | Implemented in `shared/matching/videoDateSprint0BaselineContracts.test.ts` | Shared QA |
| Active documentation map entry | Implemented in `docs/active-doc-map.md` | Docs |

## Journey Map

| Stage | Intended User Experience | Current Primary Implementation | Must Never Break |
| --- | --- | --- | --- |
| Event discovery and registration | User sees event status, registers once, and can enter the event at the correct time on web and mobile. | Web `src/pages/EventLobby.tsx`; native `apps/mobile/lib/eventsApi.ts`; Supabase `event_registrations`; event contracts in shared tests. | Idempotent registration, no duplicate attendance rows, clear errors for full/closed events, same eligibility rules across platforms. |
| Event lobby | User lands in a stable lobby with event status, timeline, queue/deck state, and no route thrash. | Web `src/pages/EventLobby.tsx`, `src/hooks/useVideoDateReadiness.ts`, `src/lib/videoDateQueueHint.ts`; native `apps/mobile/app/event/[eventId]/lobby.tsx`; shared timeline and readiness helpers. | Lobby must recover from refresh, background/foreground, reconnect, and stale realtime messages. |
| Vibe video swipe deck | Deck loads quickly, prefetches upcoming candidates, and keeps decisions responsive without letting the client author match truth. | Web `src/hooks/useEventDeck.ts`, `src/hooks/useSwipeAction.ts`; native events API/deck consumers; shared `videoDateDeckPrefetch`, `videoDatePhase4Ux`; Supabase `swipe-actions`. | Optimistic UI must reconcile with server state, never duplicate swipes, and never leak blocked/reported/ineligible candidates. |
| Swipe persistence and queueing | Swipes settle into queue state with clear waiting feedback and no duplicate match attempts. | Supabase `event_swipes`; queue helpers `useMatchQueue`, `videoDateQueueHint`; Edge/RPC path through `swipe-actions`, `video-date-outbox-drainer`, and queue-drain contracts. | Queue state must be backend-authoritative and resilient to retries, lost broadcasts, and multi-device activity. |
| Ready Gate trigger | Both users are moved to an explicit ready surface and can confirm, snooze, or forfeit without ambiguity. | Web `src/components/lobby/ReadyGateOverlay.tsx`, `src/pages/ReadyRedirect.tsx`, `src/hooks/useReadyGate.ts`; native `apps/mobile/app/ready/[id].tsx`, `apps/mobile/lib/readyGateApi.ts`; shared `readyGateReadiness`. | Ready statuses must be interpreted consistently: `pending`, `ready_a`, `ready_b`, `both_ready`, `snoozed`, `expired`, `forfeited`, and terminal states must not conflict across clients. |
| Daily room preparation | The app prepares the room/token before the date and tells users what is happening without trapping them. | Supabase `daily-room`; shared `videoDatePrepareEntry`, `videoDateDailyPrewarm`, token refresh helpers; web/native date entry routes. | No user should enter a broken room because of a missing Daily secret/domain, stale token, or timed-out prewarm path hidden as success. |
| Warm-up period | Users get a short, reassuring transition into video, with camera/mic readiness and clear failure copy. | Web `src/pages/VideoDate.tsx`, `useVideoCall`, warmup helpers; native `apps/mobile/app/date/[id].tsx`; Daily room metadata. | Warmup must avoid double Daily instances, frozen countdowns, permission dead ends, and mismatched session status. |
| Active video date | Users join the correct Daily room, have safety/report access, and reach the expected deadline/extension/verdict path. | Daily JS/native clients; Supabase `video_sessions`; Daily webhook `video-date-daily-webhook`; `video-date-deadline-finalizer`; `video-date-room-cleanup`; `video-date-orphan-room-cleanup`; outbox jobs. | Daily events must reconcile with server session status, deadline finalization, safety actions, and multi-device conflicts. |
| Post-date survey and verdict | Users submit the post-date decision once, recover if interrupted, and get the next best surface immediately. | Web `src/components/video-date/PostDateSurvey.tsx`; native `apps/mobile/components/video-date/PostDateSurvey.tsx`; shared `postDateContinuity`; Supabase `date_feedback`, `matches`. | Verdict submission must be exactly-once from the user perspective and must not lose match formation or next-route continuity. |
| Continue to next date or deck | User smoothly continues to another ready/date flow when available, or returns to the deck/queue with accurate copy. | Shared `postDateContinuity`, `activeSession`, route hydration; web/native lobby/date consumers. | The next route must be server-resolved, platform-parity checked, and protected against stale local cache. |
| Nudges, reminders, and safety | Users receive useful nudges without spam, and reporting/blocking remains available and authoritative. | Shared push payload/dedup helpers, safety flags, report/block tables and policies, admin ops. | Safety and reminder paths must degrade safely, dedupe across devices, and never hide critical moderation/reporting actions. |

## State Ownership Matrix

| State | System Of Record | Client Cache/Subscriber | Recovery Contract |
| --- | --- | --- | --- |
| Event eligibility and capacity | Supabase `events`, `event_registrations`, RLS/RPC contracts | Web lobby, native lobby, local query caches | Re-read on lobby entry, refresh after foreground, and display deterministic blocked/full/closed states. |
| Deck candidates | Supabase deck RPC/results and shared deck prefetch contract | `useEventDeck`, native deck APIs | Client may prefetch and optimistically advance, but server response is authoritative. |
| Swipe decision | Supabase `event_swipes` through `swipe-actions` | Web/native optimistic swipe state | Idempotency keys and reconciliation must prevent duplicate or contradictory swipes. |
| Match queue and queue hints | Supabase queue/match tables and outbox jobs | `useMatchQueue`, queue hint helpers, realtime channels | Poll fallback must repair missed broadcasts. Queue UI should distinguish waiting, matched, ready, expired, and error states. |
| Ready Gate status | Supabase `video_sessions.ready_gate_status` plus deadline metadata | `useReadyGate`, ready redirect, native ready route | All clients must share the same active/terminal status taxonomy and clock skew handling. |
| Daily room and token | Supabase `video_sessions` room fields, Daily API via `daily-room` and `video-date-token-refresh` | Web/native Daily entry and token refresh helpers | Token refresh, room prepare, and prewarm telemetry must separate true success from timeout continuation. |
| Active date lifecycle | Supabase `video_sessions`, `video-date-daily-webhook`, `video-date-deadline-finalizer`, room cleanup workers | `useVideoCall`, native date route, realtime/broadcast | Backend finalizers must win over client timers; clients must recover by session re-read. |
| Verdict and feedback | Supabase `date_feedback`, `matches`, verdict RPC/outbox | Web/native survey components | Submission must be idempotent, recoverable, and server-resolved for next route. |
| Safety reports and blocks | Supabase reporting/blocking tables, moderation/admin ops | Safety buttons on date/post-date/lobby where applicable | Report/block must be reachable during and after a problematic date and must cleanse future deck/match eligibility. |
| Notifications and nudges | Push payload helpers, scheduled jobs, realtime broadcasts | Web/native notification handlers and route hydration | Dedupe keys and latest-session reads must prevent stale opens and repeated nudges. |

## Surface Parity Matrix

| Capability | Web Surface | Native/Mobile Surface | Backend/Shared Contract | Sprint 0 Parity Expectation |
| --- | --- | --- | --- | --- |
| Registration and lobby entry | `src/pages/EventLobby.tsx` | `apps/mobile/app/event/[eventId]/lobby.tsx` | `event_registrations`, event contracts | Same eligibility, same event status copy class, same recovery after refresh or app resume. |
| Deck loading and swiping | `src/hooks/useEventDeck.ts`, `src/hooks/useSwipeAction.ts` | Native events/deck API consumers | `swipe-actions`, deck prefetch shared helpers | Same candidate filtering, retry behavior, and terminal empty-deck handling. |
| Queue and ready trigger | `src/hooks/useMatchQueue.ts`, `src/lib/videoDateQueueHint.ts` | Native lobby and ready APIs | Queue outbox, active session helpers | Same active-session detection across all ready statuses. |
| Ready Gate | `src/components/lobby/ReadyGateOverlay.tsx`, `src/pages/ReadyRedirect.tsx` | `apps/mobile/app/ready/[id].tsx` | `readyGateReadiness`, mark-ready/forfeit/snooze contracts | Same CTA state, countdown behavior, snooze/forfeit semantics, and expired handling. |
| Daily preparation | `src/lib/videoDatePrepareEntry.ts`, `src/lib/videoDateDailyPrewarm.ts` | `apps/mobile/lib/videoDateApi.ts` | Supabase `daily-room`, token refresh helpers | Same prepare response shape and fallback route behavior. |
| Video date | `src/pages/VideoDate.tsx`, `src/hooks/useVideoCall.ts` | `apps/mobile/app/date/[id].tsx` | Daily webhook, deadline finalizer, room cleanup | Same session validation, token refresh, leave/end/extension behavior, and safety access. |
| Post-date survey | `src/components/video-date/PostDateSurvey.tsx` | `apps/mobile/components/video-date/PostDateSurvey.tsx` | `postDateContinuity`, verdict outbox | Same verdict options, idempotent submit, recovery, and next-route resolution. |
| Route hydration and push opens | `src/components/session/SessionRouteHydration.tsx`, ready/date redirects | Native deep link/push open handlers | active session and push dedupe helpers | Same stale-link handling and latest-session recovery. |
| Reporting and blocking | Web safety/report UI paths | Native safety/report UI paths | Reporting/blocking policies and admin ops | Same ability to report/block during/after a date and immediate future exclusion. |
| Observability | Browser console, telemetry, docs/runbooks | Native logs/telemetry | Supabase logs, Daily webhooks, `video-date-snapshot`, `synthetic-video-date-monitor`, `admin-video-date-ops`, monitoring runbooks | Same correlation keys: event, session, pair, user, room, request id. |

## Feature Flag Matrix

Sprint 0 records the source-declared flags and aliases that shape the current Video Date experience. The exact production values must be captured from `client_feature_flags` or the release admin tool before every staged rollout. Absence of that environment snapshot is a release blocker, not a reason to infer production state from local code.

| Flag Or Alias | Area | Expected Sprint 0 Handling |
| --- | --- | --- |
| `video_date.snapshot_v2` | Session/deck snapshot | Keep backend-authoritative; verify refresh and reconnect recovery. |
| `video_date.deck_deal_v2` | Deck candidate dealing | Verify no cross-platform candidate filtering drift. |
| `video_date.readiness_v2` | Readiness and ready gate | Verify every active/terminal status is shared by web, native, and backend. |
| `video_date.micro_verdict_v2` | Lightweight verdict UX | Verify survey fallback and exact-once submit semantics. |
| `video_date.broadcast_v2` | Realtime/broadcast recovery | Verify missed broadcast repair by polling or session re-read. |
| `video_date.timeline_v2` | Lobby/date timeline | Verify timer copy does not diverge from backend deadlines. |
| `video_date.daily_webhooks_v2` | Daily lifecycle | Verify webhook reconciliation and room cleanup. |
| `video_date.extension_mutual_v2` | Date extension | Verify mutual-only extension, expiry, and fallback finalizer. |
| `video_date.safety_always_on_v2` | Safety/report access | Verify safety remains reachable in warmup/date/post-date. |
| `video_date.multi_device_v2` | Multi-device handling | Verify latest session wins and duplicate clients are deduped. |
| `video_date.outbox_v2.mark_ready` | Ready action durability | Verify retry and idempotent ready actions. |
| `video_date.outbox_v2.forfeit` | Ready/date forfeit durability | Verify terminal state and queue recovery. |
| `video_date.outbox_v2.continue_handshake` | Continue flow | Verify post-date continuation does not stall. |
| `video_date.outbox_v2.handshake_auto_promote` | Automatic promotion | Verify server promotion cannot strand one client. |
| `video_date.outbox_v2.date_timeout` | Deadline finalization | Verify backend finalizer wins over client timers. |
| `video_date.outbox_v2.submit_verdict` | Verdict durability | Verify idempotent feedback and match formation. |
| `video_date.outbox_v2.extension` | Extension durability | Verify extension decisions reconcile after reconnect. |
| `video_date.outbox_v2.safety` | Safety durability | Verify reporting/blocking actions are persisted and cleanse eligibility. |
| `video_date.outbox_v2.drain_match_queue` | Queue durability | Verify queue drain cannot double-create sessions. |
| `video_date.deck_prefetch_polish_v2` | Deck speed | Verify perceived speed without stale/ineligible cards. |
| `video_date.lobby_timeline_v2` | Lobby clarity | Verify timeline status is consistent on web/native. |
| `video_date.post_date_instant_next_v2` | Post-date speed | Verify next route is server-resolved and smooth. |
| `video_date.broadcast_batched_v2` | Broadcast efficiency | Verify batching does not hide critical transitions. |
| `video_date.resilience_v2` | Failure recovery | Verify reconnect, stale broadcast, and retry flows. |
| `video_date.daily_call_singleton_v2` | Daily client lifecycle | Verify one active Daily call instance per session/device. |
| `video_date.daily_token_refresh_v2` | Daily token recovery | Verify refresh before expiry and after foreground. |
| `video_date.push_payload_v2` | Push payload routing | Verify route payloads contain enough context and dedupe keys. |
| `video_date.multi_device_dedup_v2` | Multi-device dedupe | Verify duplicate devices do not duplicate ready/verdict/notification actions. |
| `video_date.push_open_dedupe_v1` | Push alias | Treat as alias/legacy compatibility; verify with push payload v2. |
| `video_date.deck_optimistic_v1` | Deck alias | Treat as alias/legacy compatibility; verify with deck prefetch/polish. |
| `video_date.ready_gate_resilient_clock_v1` | Ready Gate alias | Treat as alias/legacy compatibility; verify with readiness v2. |
| `video_date.verdict_confirm_v2` | Verdict confirmation | Verify current intended confirmation behavior. |
| `video_date.verdict_confirm_v1` | Verdict alias | Treat as alias/legacy compatibility; verify with verdict confirm v2. |
| `video_date.outbox_lease_refresh_v2` | Worker safety | Verify leases refresh and stuck work is reclaimed. |
| `video_date.deadline_partial_unique_v2` | Deadline safety | Verify partial unique deadline behavior prevents duplicates. |
| `video_date.orphan_safety_interlock_v2` | Room cleanup safety | Verify cleanup does not remove live/valid rooms. |
| `video_date.circuit_breaker_v2` | Operational safety | Verify degraded dependencies fail closed with clear UX. |

## Baseline Verification Commands

Run these from the repository root before starting Sprint 1 and after every Video Date hardening sprint.

```bash
npx tsx shared/matching/videoDateSprint0BaselineContracts.test.ts
npm run test:daily-room-contract
npm run test:video-date-v4
npm run typecheck
```

Manual and staged checks must use the active runbooks:

| Check | Canonical Evidence |
| --- | --- |
| Two-user web E2E | `docs/video-date-v4-phase8-certification-rollout.md` |
| Native smoke test | `docs/video-date-v4-phase8-certification-rollout.md` |
| Daily webhook and cleanup monitoring | `docs/video-date-post-release-monitoring-runbook.md` |
| Hardening/debug playbook | `docs/video-date-end-to-end-hardening-runbook.md` |
| Branch-level implementation notes | `docs/branch-deltas/video-date-sprint0-baseline-risk-map.md` |

## Ranked Risk Map

| Rank | Risk | Why It Matters | Definitive Improvement Target |
| --- | --- | --- | --- |
| 1 | Multiple navigation and convergence owners | Lobby, queue hooks, ready redirect, route hydration, date page, and survey can all move the user. Drift creates loops or stalls. | Sprint 1 must define a single shared state machine/route resolver contract and test web/native parity around it. |
| 2 | Ready status taxonomy drift | Some code paths treat only `ready` as active while others use `ready_a`, `ready_b`, `both_ready`, and `snoozed`. | Sprint 1 must normalize active/terminal status helpers and replace local ad hoc checks. |
| 3 | Daily configuration fallback | `daily-room` has a visible fallback domain. A missing production secret/domain can look configured until users hit a bad room path. | Sprint 1 must fail closed for live environments and expose a clear operational health check. |
| 4 | Prewarm timeout ambiguity | A timed-out prewarm path can continue optimistically and be read as success. | Sprint 2 must classify prewarm as `ready`, `continued_after_timeout`, or `failed` and show correct UX/metrics. |
| 5 | Post-date exact-once and next-route continuity | Survey interruption or duplicate submit can block match formation or strand users before the next date/deck. | Sprint 2 must prove idempotent submit, recovery, and server-resolved next route on web/native. |
| 6 | Broadcast and polling gaps | Realtime delivery is not guaranteed across app backgrounding, flaky mobile networks, or tab sleeps. | Sprint 2 must require authoritative re-read on visibility/resume and on stale transition timers. |
| 7 | Multi-device conflicts | A user can open the same event/session on multiple devices and duplicate ready/verdict/leave actions. | Sprint 3 must enforce dedupe and latest-intent handling at the shared/backend boundary. |
| 8 | Safety/report reachability | Premium UX still fails if a user cannot report/block during the exact moment they need it. | Sprint 3 must certify safety access during warmup/date/post-date and immediate deck/match cleansing. |
| 9 | Queue and match duplicate creation | Queue drain, outbox retries, and swipe retries can create duplicate sessions if idempotency weakens. | Sprint 3 must assert uniqueness and idempotency under retry/load tests. |
| 10 | Observability not tied to user journey | Logs without journey correlation make live event support slow. | Sprint 4 must standardize event/session/pair/user/room/request correlation in web, native, Supabase, and Daily paths. |

## Sprint 0 Exit Criteria

Sprint 0 is complete only when all of the following are true:

| Criterion | Required Evidence |
| --- | --- |
| Baseline map is tracked in-repo and dated | This document exists under `docs/audits/` with date and commit baseline. |
| Active doc map points to the baseline | `docs/active-doc-map.md` links this audit. |
| Contract test protects the baseline | `shared/matching/videoDateSprint0BaselineContracts.test.ts` passes and is included in `npm run test:video-date-v4`. |
| Web/native/backend/Daily are explicitly covered | Journey, state, parity, and flag matrices name all four surfaces. |
| Known imperfections are ranked for execution | Ranked risk map lists Sprint 1+ improvement targets without pretending they are already fixed. |

## Sprint 1 Handoff

Sprint 1 should start with the two highest leverage reliability fixes:

1. Normalize Video Date state and route resolution into shared helpers used by web, native, and backend-facing clients.
2. Replace ad hoc Ready Gate active/terminal checks with one shared readiness taxonomy and contract tests that cover `pending`, `ready_a`, `ready_b`, `both_ready`, `snoozed`, `expired`, `forfeited`, date-active, survey, and terminal paths.

These are not new product features. They make the existing intended Video Date process definitive, predictable, and supportable for all web, native, and mobile users.
