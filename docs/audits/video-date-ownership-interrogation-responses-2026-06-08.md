# Video Date Ownership Interrogation Responses

Date: 2026-06-08

Scope: full response to the 714-question Video Date ownership interrogation pack, covering the flow from live event lobby through persisted `date_feedback`.

Evidence class: source-backed audit and implementation assessment. This is not a fresh two-user production success proof.

Target reader: someone with no access to the codebase, backend, Supabase project, Daily dashboard, or runtime logs.

## 0. Executive Ownership Verdict

The intended ownership model is implemented as a layered ownership ladder in the current source:

1. The live event lobby owns browsing only while server truth does not show an active Video Date session or pending survey.
2. Ready Gate owns readiness only until the canonical session reaches `both_ready`.
3. Once a non-ended session is `both_ready`, `/date/:sessionId` on web, or native `/date/[id]`, becomes the owner of the flow.
4. Daily owns transport facts: room join, participant events, provider sessions, media and leave signals.
5. Supabase owns canonical app truth: session creation, ready commits, routeable entry, join evidence acceptance, remote-seen acceptance, promotion to date, terminalization, survey eligibility, feedback persistence, and next-surface resolution.
6. The client can submit evidence but cannot decide canonical truth alone.
7. The flow is not complete at `both_ready`, room creation, token issuance, route entry, remote media, promotion, date end, or survey-required truth.
8. The only real user-level finish line is persisted `date_feedback` for the required post-date survey.

My assessment: the ownership model is conceptually clear and heavily hardened in source. The fragile parts are still runtime sequencing boundaries: route churn, same-session Daily remounts, delayed provider webhooks, stale provider evidence, and pending-survey dominance. These are now addressed in code paths and migrations, but the feature remains uncertified until a fresh disposable two-user production run completes match -> Ready Gate -> same Daily room -> bilateral provider-backed date -> date end -> PostDateSurvey -> persisted `date_feedback`.

## 1. Proof Standard Used In This Report

This report uses five proof classes:

| Class | Meaning |
| --- | --- |
| CODE | Current source, migration, Edge Function, or generated type proves the implementation exists. |
| TEST | Static, contract, unit, SQL, or runtime-probe test covers the contract. |
| CLOUD | Linked Supabase migration/function state has been verified elsewhere in active docs. |
| LIVE | A fresh real two-user production run has proven the behavior through `date_feedback`. |
| UNKNOWN | Code alone cannot prove the behavior, or provider/runtime evidence is needed. |

This document mostly provides CODE and assessment. Existing docs mention TEST and CLOUD evidence for several patches. This document does not provide LIVE proof.

## 2. Owner Glossary

| Owner type | Meaning in plain English |
| --- | --- |
| Surface owner | The screen allowed to control what the user sees and what user action is possible. |
| Canonical state owner | The backend writer that decides the durable truth in database state. |
| Route owner | The shared routing decision that decides which surface wins when lobby, ready, date, survey, chat, ended, or home compete. |
| Evidence owner | A component, hook, Edge Function, webhook, or RPC that submits proof, but does not necessarily decide final truth. |
| Provider owner | Daily.co as the owner of transport-level room, call, provider session, participant join/leave, and media facts. |
| Persistence owner | The writer of durable records such as `video_sessions`, `event_registrations`, `video_date_daily_webhook_events`, `video_date_presence_events`, and `date_feedback`. |
| Recovery owner | The code path that takes over when a stale route, refresh, delayed webhook, missing feedback, or terminal truth appears. |

## 3. Current Implementation Map

Web routes:

- `/event/:eventId/lobby` renders `EventLobby`.
- `/ready/:readyId` renders `ReadyRedirect`.
- `/date/:id` renders `VideoDate`.
- Source anchor: `src/App.tsx` route table around lines 745, 753, and 754.

Native/mobile routes:

- Event lobby: `apps/mobile/app/event/[eventId]/lobby.tsx`.
- Ready Gate route: `apps/mobile/app/ready/[id].tsx`.
- Date route: `apps/mobile/app/date/[id].tsx`.
- Native Ready Gate API: `apps/mobile/lib/readyGateApi.ts`.
- Native PostDateSurvey: `apps/mobile/components/video-date/PostDateSurvey.tsx`.

Shared route and session truth:

- `shared/matching/videoDateRouteDecision.ts` decides canonical targets such as survey, date, ready gate, lobby, chat, ended, and home.
- `shared/matching/activeSession.ts` detects active session, both-ready date ownership, and post-date survey truth.

Main Edge Functions:

- `swipe-actions`: validates lobby swipe request and delegates to `handle_swipe_v2`.
- `daily-room`: owns Daily room prepare, verify/recreate, token issuance, and provider room metadata repair.
- `video-date-daily-webhook`: receives Daily provider join/leave events.
- `post-date-verdict`: receives required survey verdict and calls the SQL verdict writer.

Main SQL/RPC owners:

- `handle_swipe_v2`: actor-bound lobby swipe and mutual-match handoff.
- `video_session_mark_ready_v2`: current public mark-ready owner for `ready_a`, `ready_b`, and `both_ready`.
- `ready_gate_transition`: older/compatibility Ready Gate action surface still used for non-mark-ready actions and legacy compatibility.
- `video_date_transition`: lifecycle transition surface for prepare entry, reconnect, end, and related date lifecycle commands.
- `mark_video_date_daily_joined`: accepted Daily join evidence.
- `mark_video_date_daily_alive`: provider-backed alive heartbeat and co-presence evidence.
- `mark_video_date_remote_seen`: provider-bound remote media evidence.
- `video_date_stable_copresence_v1`: stable active co-presence calculator.
- `video_date_promote_provider_overlap_v1`: shared server promotion authority to actual date.
- `resolve_post_date_next_surface`: post-feedback next-surface resolver.
- `submit_post_date_verdict_v3` / `v2` / base: single writer for required verdict and `date_feedback`.
- `update_post_date_feedback_details`: detail-field patcher after the mandatory feedback row exists.

Main tables/columns:

- `video_sessions`: participants, event id, ready status/timestamps, Daily room metadata, state, phase, handshake/date timestamps, provider/join/remote-seen fields, reconnect/away fields, terminal fields, liked fields, ended fields.
- `event_registrations`: `queue_status`, `current_room_id`, `current_partner_id`, `admission_status`, `last_active_at`.
- `date_feedback`: required post-date verdict row and optional detail fields.
- `video_session_commands`: idempotency and command replay.
- `video_session_events`: append-only session lifecycle events.
- `video_date_daily_webhook_events`: Daily provider join/leave event ledger.
- `video_date_presence_events`: service-owned presence/heartbeat/provider evidence ledger.
- `video_date_surface_claims` / claim events: surface-owner lease/audit rows.

My assessment: the current implementation is multi-surface but not conceptually ownerless. Each critical step now has an intended single canonical backend owner. The main risk for readers is confusing old wrapper names with current ownership; this report calls that out in each stage.

## 4. Coverage Index For The Attached Pack

| Attachment section | Response section in this file | Covered |
| --- | --- | --- |
| Master Codex prompt | Sections 0-3, 8-26 | Yes |
| Global questions: current implementation | Sections 3, 5, 21 | Yes |
| Evidence standard | Section 1 and Section 6 | Yes |
| A. Live Event Lobby | Section 8.A | Yes |
| B. Mutual match | Section 8.B | Yes |
| C. Video session creation | Section 8.C | Yes |
| D. Ready Gate opens | Section 8.D | Yes |
| E-G. Ready tap / partial ready / second ready | Section 8.EG | Yes |
| H. `both_ready` + canonical Daily room | Section 8.H | Yes |
| I. `/date/:sessionId` owner | Section 8.I and Section 10 | Yes |
| J. Daily call starts once | Section 8.J and Section 17 | Yes |
| K. Both users join same Daily room | Section 8.K and Section 17 | Yes |
| L. Active co-presence | Section 8.L | Yes |
| M. Remote media observed | Section 8.M | Yes |
| N. Promotion to actual date | Section 8.N | Yes |
| O. Live video date runs | Section 8.O | Yes |
| P. Date ends / survey truth | Section 8.P | Yes |
| Q. PostDateSurvey opens | Section 8.Q | Yes |
| R. `date_feedback` persists | Section 8.R | Yes |
| S. Return to next state | Section 8.S | Yes |
| State model | Section 9 | Yes |
| Ownership conflicts | Section 11 | Yes |
| Race conditions | Section 12 | Yes |
| False finish lines | Section 13 | Yes |
| Web/native parity | Section 14 | Yes |
| Observability and proof | Section 15 | Yes |
| Database and migration questions | Section 16 | Yes |
| Daily/provider questions | Section 17 | Yes |
| Security and authorization | Section 18 | Yes |
| Acceptance tests | Section 19 | Yes |
| Final deliverable format | Entire file | Yes |
| Strongest prompt to run first | Sections 0, 8, 12, 13, 19 | Yes |

## 5. Current vs Legacy Answer

The current implementation uses both newer and older names, but they do not all have equal authority.

| Surface/function | Current role | Legacy/conflict assessment |
| --- | --- | --- |
| `video_session_mark_ready_v2` | Current public owner for mark-ready and `both_ready` decisive commit. | It supersedes older mark-ready-through-`ready_gate_transition` behavior for the hot path. |
| `ready_gate_transition` | Still exists for compatibility and non-mark-ready Ready Gate actions such as older transition paths, forfeit/snooze/expiry wrappers depending on feature path. | Do not treat it as the primary `both_ready` owner in current source. |
| `video_date_transition` | Current lifecycle transition owner for `prepare_entry`, reconnect, end, and lifecycle commands. | It does not own the initial `both_ready` commit. |
| `video_date_promote_provider_overlap_v1` | Shared promotion authority when provider-backed co-presence/remote-seen evidence is sufficient. | Promotion may be invoked from multiple hot paths, but the predicate is centralized server-side. |
| `prepare_date_entry` | Current Date route entry action that prepares route state, verifies/recreates room, and returns token. | `create_date_room`, `join_date_room`, and `ensure_date_room` exist as older/admin/warmup/provider actions, not the Date route owner. |
| Web `/date/:sessionId` | Current web flow owner after `both_ready` and during pending survey. | Older lobby/Ready Gate surfaces must yield. |
| Native `/date/[id]` | Native parity owner after `both_ready` and pending survey truth. | Native has parallel code, so parity must be watched. |

My assessment: naming is the biggest ambiguity for a new reader. The safe interpretation is: Ready Gate readiness is owned by `video_session_mark_ready_v2`; date lifecycle after ownership is owned by `/date` plus `daily-room` and `video_date_transition`; promotion is owned by provider-overlap SQL; survey finish is owned by `post-date-verdict` and verdict SQL.

## 6. Evidence Standard Answers

Files that prove route ownership:

- `src/App.tsx`
- `apps/mobile/app/...` routes
- `shared/matching/videoDateRouteDecision.ts`
- `shared/matching/activeSession.ts`
- `src/components/session/SessionRouteHydration.tsx`

Files that prove UI/surface ownership:

- Web lobby, Ready Gate, ReadyRedirect, VideoDate, PostDateSurvey, and `useVideoCall`.
- Native event lobby, ready route, date route, native Ready Gate API, and native PostDateSurvey.

Files that prove canonical state ownership:

- SQL migrations defining public RPCs and wrappers.
- Supabase generated types for current callable RPC signatures.
- Edge Functions that call service-role or user-authenticated RPCs.

Files that prove provider ownership:

- `supabase/functions/daily-room/index.ts`
- `supabase/functions/daily-room/dailyRoomContracts.ts`
- `supabase/functions/video-date-daily-webhook/index.ts`
- `src/hooks/useVideoCall.ts`
- native date route and native video date API files.

Files that prove terminal/survey ownership:

- `shared/matching/activeSession.ts`
- `shared/matching/videoDateRouteDecision.ts`
- `src/pages/VideoDate.tsx`
- `src/components/video-date/PostDateSurvey.tsx`
- native PostDateSurvey
- `supabase/functions/post-date-verdict/index.ts`
- verdict and next-surface SQL migrations.

Important authentication patterns:

- `swipe-actions` uses user JWT and delegates to `handle_swipe_v2`.
- `daily-room` uses user authentication and service role internally, so it must enforce participant/actionability checks before token issuance.
- `post-date-verdict` uses user JWT and calls user-authenticated SQL verdict RPCs.
- Public SQL RPCs are generally `SECURITY DEFINER`, use `auth.uid()`, validate participant authority, and grant execute only to appropriate roles.
- Daily webhook is provider-public by nature and must verify Daily signature and map provider facts to session truth.

My assessment: repository evidence is strong enough to explain ownership, but not enough to prove runtime success. Runtime proof requires correlated logs, provider evidence, and final SQL rows.

## 7. Plain-English Flow Summary

Two users in the same event mutually match. The backend creates one video session and moves both users into Ready Gate. Each user taps Ready. The first tap produces `ready_a` or `ready_b`; the second produces `both_ready` and deterministic Daily room metadata. At that exact point, the Date route becomes owner. The Date route prepares entry, gets a token, and joins the Daily room. Daily and webhooks provide provider facts; clients submit joined/alive/remote-seen evidence. Supabase validates that evidence and promotes the session to an actual date. When the date ends with real encounter exposure, server truth requires survey. `/date/:sessionId` hosts PostDateSurvey until the user's verdict persists in `date_feedback`. Only then can the app route the user to lobby, chat, next Ready Gate, another date, ended state, or home.

## 8. Stage-By-Stage Ownership Responses

### A. Live Event Lobby

Case: a user is in a live event and browsing the deck.

Owners:

- Surface owner: `EventLobby` on web and native event lobby.
- Canonical state owner: event admission, event lifecycle, `event_registrations`, deck RPCs, active-session truth.
- Route owner: shared canonical route decision and active-session helpers.
- Evidence owner: lobby foreground, deck visibility, swipe submission, observability.

Current implementation:

- Web route is `/event/:eventId/lobby`.
- Deck state comes from event deck hooks and RPCs such as `get_event_deck_v3`.
- Swipes go through `useSwipeAction`, not direct table writes.
- Lobby queries session truth when it must decide whether Ready Gate, Date, or Survey should own the user.
- Active owner / terminal truth hardening disables lobby queue, readiness, drain, foreground, and action side effects while `/date` or survey owns the same-event session.

Answers to the attached lobby questions:

- The lobby remains owner only for browsing/idle/deck states.
- It opens Ready Gate only when backend match/session truth says a Ready Gate session exists and is actionable.
- It must redirect or yield to `/date` when non-ended `both_ready`, handshake, date, or routeable Daily state is canonical.
- It must yield to survey when registration or session truth says survey is pending.
- It should not directly set `event_registrations.queue_status` for Video Date ownership; status changes must be RPC/server-owned.
- If a user opens lobby while already `both_ready`, in date, or pending survey, lobby is a recovery surface, not the owner.

Legacy/conflict notes:

- Older lobby logic could keep polling/draining while a date route should own the session. Active owner/terminal truth hardening addresses this in current local source.

Risk:

- Route bounce if a stale lobby effect runs after `/date` becomes owner.
- Survey bypass if lobby/queue logic wins over `in_survey`.

Assessment:

- Ownership boundary is clear in current design. Runtime proof must show the lobby stays silent during active `/date` and pending survey.

Proof anchors:

- `src/App.tsx`
- `src/pages/EventLobby.tsx`
- `apps/mobile/app/event/[eventId]/lobby.tsx`
- `shared/matching/videoDateRouteDecision.ts`
- `shared/matching/activeSession.ts`

### B. Mutual Match

Case: two eligible users in the same live event both express positive interest.

Owners:

- Surface owner: lobby swipe UI owns only the click/tap.
- Canonical state owner: `swipe-actions` Edge Function and `handle_swipe_v2`.
- Persistence owner: SQL writes match/session/registration state.
- Evidence owner: swipe request, deck token, actor id, event id, target id.

Current implementation:

- Web `useSwipeAction` posts to `swipe-actions`.
- `swipe-actions` authenticates the user and calls `handle_swipe_v2`.
- `handle_swipe_v2` is actor-bound: authenticated callers must match `p_actor_id`.
- Backend creates or reuses the video session and returns payload fields such as `video_session_id`, `match_id`, `immediate`, and result status.

Answers to the attached mutual-match questions:

- Client does not decide that a mutual match exists.
- Client does not create `video_sessions`.
- Actor authentication is enforced in Edge and SQL.
- Event/deck/target validation belongs to server-side deck/swipe logic.
- Queued-vs-immediate Ready Gate handoff is backend-owned.
- Persistent romantic/chat match is not the same as Video Date session creation; persistent match outcome is later tied to post-date feedback/mutual verdict.
- If the client receives stale session id, route/session truth must re-check before rendering a later surface.

Legacy/conflict notes:

- Older `handle_swipe` variants and earlier direct RPC paths exist in migration history. Current active path is `swipe-actions` -> `handle_swipe_v2`.

Risk:

- Duplicate sessions if pair/event uniqueness and transaction semantics fail.
- Payload trust if client routes without rehydrating session truth.

Assessment:

- Ownership boundary is strong: client owns swipe intent; backend owns match truth.

Proof anchors:

- `src/hooks/useSwipeAction.ts`
- `supabase/functions/swipe-actions/index.ts`
- `supabase/migrations/20260607103000_video_date_mutual_match_handoff_closure.sql`
- earlier session creation migration sections that insert `video_sessions` and update `event_registrations`.

### C. Video Session Creation

Case: backend confirms a mutual event match and creates or reuses one Video Date session.

Owners:

- Canonical state owner: SQL match/session creation logic.
- Persistence owner: `video_sessions` and `event_registrations`.
- Route owner: later route decision reads this truth.

Current implementation:

- SQL inserts one `video_sessions` row with `event_id`, deterministic participant ordering, initial `ready_gate_status`, and Ready Gate expiry if both users are immediately available.
- SQL updates both `event_registrations` with `queue_status = in_ready_gate`, `current_room_id`, and `current_partner_id` for immediate matches.
- Queued matches keep a session id but do not necessarily advance both registrations immediately.

Answers to the attached creation questions:

- The client never synthesizes a session id.
- Participant ordering is stable because backend chooses the participant slots.
- `event_id` comes from the current event.
- Initial state is pre-date/Ready Gate, not live date.
- Creation and registration handoff must be transactional from the backend perspective.
- If one user is already in another active surface or pending survey, actionability and active-session truth should prevent an unsafe immediate handoff.

Legacy/conflict notes:

- Several migrations evolved creation and queued-promotion logic. Historical session-source markers were later removed by `20260609171950_remove_video_sessions_session_source.sql`; current creation no longer stores a source discriminator. Definitive contracts still provide drift validation.

Risk:

- Simultaneous mutual swipes, prior ended rows, queued sessions, and active-session conflicts must be covered by SQL uniqueness/locking and active-session validation.

Assessment:

- The authoritative source of downstream `sessionId` is the backend-created `video_sessions.id`.

Proof anchors:

- `handle_swipe_v2`
- `event_registrations.current_room_id`
- `event_registrations.current_partner_id`
- `video_sessions.id`

### D. Ready Gate Opens

Case: both users are routed to a pre-date screen where they consent to start.

Owners:

- Surface owner: web `ReadyGateOverlay` or `ReadyRedirect`; native Ready Gate overlay or native `/ready/[id]`.
- Canonical state owner: server Ready Gate state in `video_sessions` and registration pointers.
- Evidence owner: Ready Gate entry proof RPC/ledger.

Current implementation:

- Ready Gate can be overlay-based and route-based.
- `/ready/:readyId` remains routed and active as a fallback/recovery route.
- Ready Gate must load server truth and cannot trust only URL params or navigation state.
- Entry proof is recorded after actionable hydrated Ready Gate state.

Answers to the attached Ready Gate open questions:

- A valid Ready Gate requires participant authority, active event/session truth, non-ended session, current registration pointers, actionable ready status, and non-expired or protected gate timing.
- If session is already `both_ready`, date-owned, promoted, ended, or pending survey, Ready Gate must yield.
- Ready Gate expiry is server-owned; client countdown is display only.
- Snooze, forfeit, expiry, and invalid terminalization are server-owned.
- The exact handoff when Ready Gate stops owning is route/date ownership after `both_ready` or terminal/survey ownership if terminal truth appears.

Legacy/conflict notes:

- Older Ready Gate logic treated provider prepare failures as Ready Gate errors. Current behavior should keep date owner if canonical startability was already observed.

Risk:

- Ready Gate reopening after date ownership.
- Stale standalone `/ready` route for another session.

Assessment:

- Ready Gate ownership is clear before `both_ready`; after `both_ready`, it must become subordinate to `/date`.

Proof anchors:

- `src/components/lobby/ReadyGateOverlay.tsx`
- `src/pages/ReadyRedirect.tsx`
- `apps/mobile/components/lobby/ReadyGateOverlay.tsx`
- `apps/mobile/app/ready/[id].tsx`
- `record_video_date_ready_gate_entered_v1`

### E-G. User Taps Ready, Partial Ready, Second Ready

Case: one or both users press the Ready button.

Owners:

- Surface owner: Ready Gate UI owns the button and local waiting UX.
- Canonical state owner: `video_session_mark_ready_v2`.
- Idempotency owner: `video_session_commands` and deterministic request/idempotency key.
- Realtime/recovery owner: Ready Gate subscription/poll/sync logic and route decision.

Current implementation:

- Web `useReadyGate` calls `video_session_mark_ready_v2` for `mark_ready` when the feature path is enabled.
- Native `readyGateApi` mirrors this behavior.
- Non-mark-ready actions can still use `ready_gate_transition` or dedicated v2 wrappers.
- SQL locks the `video_sessions` row, verifies actor/participant authority, checks actionability, stamps the correct participant ready timestamp, computes `ready_a`, `ready_b`, or `both_ready`, and returns canonical JSON.

Answers to the attached ready-tap questions:

- User A double-tap should replay/idempotently return the existing committed result.
- Simultaneous User A/User B taps serialize through database locking and command handling.
- First ready sets only one participant timestamp and `ready_a` or `ready_b`.
- Second ready sets both participant timestamps and `both_ready`.
- Notification/outbox work is fail-soft and must not roll back readiness.
- `both_ready` is assigned only when both ready timestamps exist.
- `state` and `phase` remain `ready_gate` at this point.
- The waiting user learns partner readiness through realtime, polling, broadcast, or refetch based on current client path.
- The first line of route handoff after `both_ready` is the Ready Gate callback/route decision that marks date route ownership and navigates to `/date/:sessionId`.

Legacy/conflict notes:

- `ready_gate_transition` used to be more central for mark-ready. Current decisive commit is `video_session_mark_ready_v2`.

Risk:

- Ready tap vs expiry, snooze, forfeit, event inactive, registration drift, blocked/report state, or pending survey.

Assessment:

- Backend ownership is strong. The client must not infer success from local button state; only the RPC payload/session truth counts.

Proof anchors:

- `src/hooks/useReadyGate.ts`
- `apps/mobile/lib/readyGateApi.ts`
- `supabase/migrations/20260606092944_video_date_decisive_mark_ready_commit.sql`
- `supabase/migrations/20260608160809_video_date_ready_gate_partial_ready_definitive_closure.sql`

### H. `both_ready` + Canonical Daily Room

Case: both users have pressed Ready and the backend assigns deterministic Daily room metadata.

Owners:

- Canonical state owner: `video_session_mark_ready_v2`.
- Room naming owner: SQL plus shared Daily room contract.
- Provider owner: Daily room creation/recreation happens later or fail-soft; it does not own the `both_ready` commit.
- Route owner: date route becomes owner even if provider prepare is pending.

Current implementation:

- `ready_gate_status = both_ready` is written only after both ready timestamps exist.
- Canonical room name is `date-${sessionIdWithoutDashes}`.
- SQL writes deterministic `daily_room_name` and `daily_room_url`.
- `state` and `phase` remain `ready_gate`.
- `handshake_started_at`, `date_started_at`, joined timestamps, and remote-seen timestamps are not set by this step.

Answers to the attached both-ready questions:

- Daily room metadata is stored before actual provider join.
- Provider failure must not roll back `both_ready`.
- Provider failure still leaves the session date-owned.
- Client distinguishes `both_ready` from actual date by state/phase/timestamps/evidence: no accepted joins, no remote seen, no promotion, no `date_started_at`.
- Retry/repair logic lives in `daily-room` `prepare_date_entry`.
- Room URL can be recomputed from canonical name and domain.
- The invariant proving this is not an encounter is absence of provider-backed bilateral join/remote-seen/date promotion and missing `date_started_at`.

Legacy/conflict notes:

- Older warmup/ensure/create actions can exist, but canonical room metadata is not proof of live provider co-presence.

Risk:

- False finish line: treating `both_ready` or room metadata as success.

Assessment:

- This boundary is now well documented. It remains a common source of mistaken success claims.

Proof anchors:

- `docs/audits/both-ready-canonical-daily-room-current-codebase-audit-2026-06-08.md`
- `supabase/functions/daily-room/dailyRoomContracts.ts`
- `video_session_mark_ready_v2`

### I. `/date/:sessionId` Becomes Flow Owner

Case: a non-ended session is `both_ready` or otherwise date-capable.

Owners:

- Surface owner: web `VideoDate` or native date route.
- Route owner: `decideCanonicalVideoDateRoute`.
- Recovery owner: route hydration and active-session helpers.

Current implementation:

- Route decision reads session truth, registration truth, ended truth, ready status, provider room/date startability, and feedback state.
- Pending survey has higher priority than date.
- Non-ended `both_ready` routes to date even if provider prepare is pending.
- Ended/no-survey routes to ended or fallback, not date.

Answers to the attached route ownership questions:

- `both_ready` outranks lobby and Ready Gate.
- Pending survey outranks `both_ready`, live date, next Ready Gate, and lobby.
- Route decision can run on initial load, mutation result, refetch, realtime update, focus/visibility recovery, and route hydration.
- Guards against wrong-user sessions come from server reads/RLS/RPC participant checks and route denial.
- The truth table is:
  - missing feedback plus pending survey truth -> survey
  - ended plus no survey -> ended
  - provider room/date capable -> date
  - non-ended `both_ready` -> date
  - actionable Ready Gate -> ready gate
  - active event with no active session -> lobby
  - match result with persistent match -> chat when next-surface says chat
  - no event/session -> home

Legacy/conflict notes:

- Some older client paths had local route heuristics. The shared route decision should be treated as canonical.

Risk:

- Double navigation from fast realtime events.
- Stale URL session.
- Pending survey bypass.

Assessment:

- Route priority is clear in shared logic. Runtime proof must show no lobby/ready bounce after date ownership.

Proof anchors:

- `shared/matching/videoDateRouteDecision.ts`
- `shared/matching/activeSession.ts`
- `src/pages/ReadyRedirect.tsx`
- `src/pages/VideoDate.tsx`

### J. Daily Call Starts Once

Case: date route prepares and joins Daily.

Owners:

- Surface owner: Date route.
- Daily prepare owner: `daily-room` action `prepare_date_entry`.
- Call lifecycle owner: web `useVideoCall` and native date route/call logic.
- Provider owner: Daily SDK and Daily REST API.

Current implementation:

- `prepareVideoDateEntry` claims an entry owner and invokes `daily-room` with `prepare_date_entry`.
- `daily-room` checks actionability, calls `video_date_transition('prepare_entry')`, confirms routeable state, verifies/recreates provider room, and returns a caller-scoped token.
- `useVideoCall` reuses an existing same-session active/joining call object and waits for in-flight starts rather than always rebuilding.
- Same-session Daily identity and heartbeat ownership are preserved across supported remount/parking paths.

Answers to the attached Daily startup questions:

- `/date/:sessionId` calls `prepare_date_entry`, not `create_date_room` as the primary flow.
- Token issuance depends on authentication, participant authority, both-ready/actionability, no terminal/survey-preempting truth, and prepared route state.
- Prepare can succeed while join fails; date route owns retry/failure handling.
- If prepare fails but `both_ready` remains true, date route remains owner and Ready Gate should not reclaim the user.
- Provider room exists but DB metadata missing can be repaired by prepare.
- Date route must hard-stop Daily when survey-required truth appears.
- The invariant for one same-session call pipeline is: one active owner/call identity per session/user, reuse/park if same session is already joining/joined, destructive cleanup only for terminal/different-session/explicit cleanup cases.

Legacy/conflict notes:

- `ensure_date_room` is warmup and does not mint token.
- `create_date_room` and `join_date_room` are not the current route owner path.

Risk:

- Duplicate Daily call objects.
- Token refresh race.
- Remount destroying active call.
- Room deletion too early.

Assessment:

- This is one of the more fragile runtime sections because React/native lifecycle and provider state are hard to prove statically.

Proof anchors:

- `src/lib/videoDatePrepareEntry.ts`
- `apps/mobile/lib/videoDatePrepareEntry.ts`
- `supabase/functions/daily-room/index.ts`
- `src/hooks/useVideoCall.ts`

### K. Both Users Join Same Daily Room

Case: both users enter the deterministic Daily room.

Owners:

- Transport owner: Daily SDK/provider.
- Evidence owner: client `mark_video_date_daily_joined`, client `mark_video_date_daily_alive`, and Daily webhook ingestion.
- Canonical state owner: SQL acceptance logic.

Current implementation:

- Web calls Daily SDK `join({ url, token })`.
- On successful joined state, client builds provider-backed proof and calls `mark_video_date_daily_joined`.
- Alive heartbeat calls `mark_video_date_daily_alive`.
- Daily webhook stores provider `participant.joined` and `participant.left` events.
- SQL verifies participant authority, routeability, current provider session, and latest provider event where applicable.

Answers to the attached Daily join questions:

- Client joins are not final truth by themselves.
- Payload includes owner/call/provider session identity in current hardened paths.
- SQL rejects or no-ops stale/mismatched provider identity.
- Provider webhook can arrive before or after client RPC; latest provider event and provider session id determine currentness.
- If user A joins room X and user B joins room Y, canonical room identity and provider proof should prevent stable co-presence.
- If user leaves and rejoins quickly, later provider session and grace logic decide whether it is a reconnect or absence.
- The exact proof of same-room join is: both participants have current provider-backed presence tied to the canonical `date-<sessionId>` room, without newer matching leave/away truth.

Legacy/conflict notes:

- Earlier client-only join stamps were weaker. Current path is provider-backed.

Risk:

- Webhook lag, duplicate provider sessions, stale alive heartbeat, client RPC without webhook, webhook without client RPC.

Assessment:

- The model is correct: Daily owns transport, Supabase owns accepted join truth.

Proof anchors:

- `src/hooks/useVideoCall.ts`
- `supabase/functions/video-date-daily-webhook/index.ts`
- `mark_video_date_daily_joined`
- `mark_video_date_daily_alive`

### L. Active Co-presence

Case: backend decides both participants are currently present together.

Owners:

- Canonical state owner: `video_date_actor_provider_presence_v1` and `video_date_stable_copresence_v1`.
- Evidence owner: provider webhook events plus current owner heartbeat.

Current implementation:

- Provider-authoritative presence reads latest Daily join/leave events and current provider-backed owner heartbeat.
- Stable co-presence requires both participant presence to be current and not invalidated by newer provider leave/away state.
- Browser visibility/page lifecycle are not authoritative while Daily is active.

Answers to the attached co-presence questions:

- Active co-presence can exist before accepted remote-seen, but promotion rules decide whether co-presence alone is sufficient in that path.
- Current presence must reflect overlapping provider-backed windows, not stale historical joins.
- Brief reconnects can be tolerated through grace if provider/current-session evidence supports it.
- A stale client heartbeat cannot revive a participant after Daily has emitted a matching current provider leave.

Legacy/conflict notes:

- Earlier owner heartbeat logic was less provider-authoritative.

Risk:

- Delayed webhooks and stale heartbeats.

Assessment:

- Server owner is clear. Runtime evidence must include join/leave ordering.

Proof anchors:

- `supabase/migrations/20260606203000_video_date_provider_authoritative_presence.sql`
- `supabase/migrations/20260607194546_video_date_definitive_provider_overlap_promotion.sql`

### M. Remote Media Observed

Case: one participant has evidence that the remote participant was actually seen.

Owners:

- Evidence owner: Date route client and Daily event/media observation.
- Canonical state owner: `mark_video_date_remote_seen`.

Current implementation:

- Web detects remote participant joined/updated, snapshots, mounted tracks, or first-frame-like evidence and calls `mark_video_date_remote_seen`.
- Current hardened RPC requires owner/call/provider identity and current provider-backed session.
- SQL accepts the remote-seen stamp only when latest provider evidence supports the actor's current Daily session.

Answers to the attached remote-seen questions:

- Client cannot set remote-seen directly.
- Evidence is per participant: user A's observation stamps user A's remote-seen field, not user B's.
- Provider presence alone can support currentness, but accepted remote-seen still goes through SQL.
- Duplicate remote-seen is idempotent/no-op or restamp-limited.
- Remote-seen racing with provider leave should reject/no-op if leave is newer for the same provider session.
- The accepted predicate is: authenticated participant, current session, current provider-backed joined state, matching owner/call/provider identity, no terminal/survey preemption, and canonical server acceptance.

Legacy/conflict notes:

- Session-only remote-seen is superseded by provider-bound remote-seen.

Risk:

- Old Daily call after remount submitting stale remote-seen.

Assessment:

- Strong boundary in current SQL. Runtime logs must show accepted vs rejected remote-seen decisions.

Proof anchors:

- `src/hooks/useVideoCall.ts`
- `apps/mobile/app/date/[id].tsx`
- `supabase/migrations/20260608122623_video_date_remote_seen_lint_cleanup.sql`

### N. Promotion To Actual Date

Case: backend decides the encounter is real enough to start the actual date.

Owners:

- Canonical state owner: `video_date_promote_provider_overlap_v1`.
- Evidence owners: joined/alive/remote-seen/hot lifecycle paths that can call promotion.
- Persistence owner: `video_sessions` and `event_registrations`.

Current implementation:

- Promotion requires routeable non-ended session, usually `ready_gate_status = both_ready` or handshake/date-capable truth, no conflicting explicit verdict, and stable provider-backed co-presence/evidence.
- Promotion sets `state = date`, `phase = date`, `date_started_at`, `handshake_started_at` if absent, clears reconnect/away fields, repairs room metadata, and updates registrations to `in_date`.

Answers to the attached promotion questions:

- The client cannot directly update `state`, `phase`, or `date_started_at`.
- Promotion is idempotent: a second call should return already-promoted or no-op semantics rather than create a second date start.
- Promotion racing with terminalization must respect ended/terminal truth.
- `started_at` is initial session creation/start metadata; `handshake_started_at` is routeable/pre-date handshake; `date_started_at` is actual date start.
- The invariant proving actual date began is durable `date_started_at` plus `state/phase = date` from server promotion, backed by accepted provider evidence.

Legacy/conflict notes:

- Earlier `video_date_transition` promotion paths existed. Current provider-overlap helper centralizes the promotion predicate and can be invoked by hot paths.

Risk:

- Promotion vs leave, promotion vs terminal, and one-sided remote-seen assumptions.

Assessment:

- Promotion ownership is server-canonical. The exact evidence predicate is intentionally stricter than client UI observations.

Proof anchors:

- `supabase/migrations/20260607194546_video_date_definitive_provider_overlap_promotion.sql`
- `supabase/migrations/20260607205617_video_date_provider_overlap_current_remote_seen.sql`

### O. Live Video Date Runs

Case: the promoted date is actively running.

Owners:

- Surface owner: `VideoDate` / native date route.
- Canonical state owner: Supabase lifecycle state and transition RPCs.
- Transport owner: Daily.
- Timer owner: server truth, using `date_started_at` and server-now style synchronization, not merely local mount time.

Current implementation:

- Date route renders the live call UI, reconnect UX, safety modal, and survey modal host.
- Client listens to Daily participant events and Supabase truth.
- Daily `participant-left` starts local grace/reconnect handling, not immediate terminal truth.
- Normal end, timeout, reconnect expiry, explicit exit, report/end, and peer absence are server-owned lifecycle transitions.

Answers to the attached live-date questions:

- Local UI should not commit canonical phase/date/end without server RPC.
- Browser `visibilitychange`, `pagehide`, and unload are not authoritative while Daily is active.
- Native backgrounding is a transport/lifecycle signal, not final app truth unless server logic confirms.
- Partner temporarily away is a reconnect/grace state.
- Date transitions to terminal only through server lifecycle/terminalization rules.
- Events that should not terminalize the date alone: transient Daily leave, page hide, visibility hidden, local remount, token refresh, temporary network quality changes.

Legacy/conflict notes:

- Any older direct `sendBeacon`/direct update of `ended_at` would be unsafe if still active. Current ownership should route through lifecycle RPCs.

Risk:

- False away, reload/remount churn, local cleanup destroying active same-session Daily state.

Assessment:

- UI ownership is clear; transport-to-terminal interpretation is the fragile part.

Proof anchors:

- `src/pages/VideoDate.tsx`
- `src/hooks/useVideoCall.ts`
- native `/date/[id]`
- `video_date_transition`

### P. Date Ends Or Survey-Required Truth Appears

Case: the session reaches terminal truth and may require feedback.

Owners:

- Canonical state owner: lifecycle terminalization/finalizer SQL.
- Survey eligibility owner: shared server/session truth plus missing feedback check.
- Route owner: pending survey route decision.

Current implementation:

- Terminalization writes `ended_at`, `ended_reason`, terminal state/phase/status, registration status, and terminal audit fields in newer hardening.
- Survey eligibility requires terminal encounter exposure: ended session with real encounter evidence, not ineligible ended reason, and missing feedback for the current user.
- Registration `queue_status = in_survey` is a strong pending-survey signal and can recover survey when session fetch is stale/failing.

Answers to the attached terminalization questions:

- Ready Gate timeout/no-show should not become survey-required unless real encounter exposure exists.
- Failed Daily join should not be treated as survey completion or real date.
- Pending survey is derived from terminal encounter exposure plus missing `date_feedback`, and may also be represented in registration state.
- Terminal survey truth must stop Daily alive/join loops, surface-claim loops, queue drain loops, reconnect loops, and Ready Gate recovery for that session.
- Terminalization racing with promotion/remote-seen/feedback must preserve chronological audit and avoid raw 500s.

Legacy/conflict notes:

- Older terminal paths could clear registrations or resume lobby too early. Current hardening emphasizes sticky survey truth.

Risk:

- Survey-required truth vs reconnect loop or lobby queue drain.

Assessment:

- The right owner is server terminal truth. Runtime proof must show the user is held in survey until feedback.

Proof anchors:

- `shared/matching/activeSession.ts`
- `src/pages/VideoDate.tsx`
- terminal lifecycle migrations and command center notes.

### Q. PostDateSurvey Opens On `/date/:sessionId`

Case: date has terminal survey truth and current user lacks feedback.

Owners:

- Surface owner: `VideoDate` hosts `PostDateSurvey`.
- Route owner: canonical route decision chooses survey.
- Recovery owner: VideoDate terminal survey recovery and registration-based survey recovery.

Current implementation:

- `VideoDate` checks terminal session truth and whether a `date_feedback` row exists for the user/session.
- If survey is due, it calls terminal survey hard-stop, hydrates survey context, and opens `PostDateSurvey`.
- `PostDateSurvey` is rendered inside the Date route on web.
- Native date route has corresponding pending survey recovery and native PostDateSurvey.

Answers to the attached survey route questions:

- Survey is hosted by `/date/:sessionId`, not lobby.
- Pending survey outranks lobby, Ready Gate, live date routing, and next match routing.
- Refreshing `/date/:sessionId` with pending survey should reopen survey.
- Opening lobby while survey pending should route/yield back to survey ownership.
- Opening another ready/date route while prior mandatory survey is pending should be blocked by route/survey dominance if truth is visible.
- Survey is mandatory for eligible terminal Video Date feedback.
- Missing Daily metadata should not prevent survey.

Legacy/conflict notes:

- Lobby-hosted or route-independent survey recovery would be ambiguous. Current intended owner is date route.

Risk:

- Local `showFeedback` state hiding survey after refresh unless server recovery runs.

Assessment:

- Survey owner is clear: `/date` remains owner until feedback.

Proof anchors:

- `src/pages/VideoDate.tsx`
- `src/components/video-date/PostDateSurvey.tsx`
- native PostDateSurvey
- `shared/matching/videoDateRouteDecision.ts`

### R. `date_feedback` Persists

Case: user submits required post-date verdict.

Owners:

- Surface owner: `PostDateSurvey`.
- Edge owner: `post-date-verdict`.
- Canonical write owner: `submit_post_date_verdict_v3`, falling back to v2/base depending on request/version path.
- Detail owner: `update_post_date_feedback_details` after mandatory row exists.

Current implementation:

- Web `PostDateSurvey` submits verdict through a post-date outbox/Edge invocation path.
- Native uses a similar outbox/Edge function path.
- `post-date-verdict` validates JWT and calls `submit_post_date_verdict_v3` when idempotency/version is present.
- Base verdict SQL writes participant liked fields and inserts/updates `date_feedback`.
- `submit_post_date_verdict_v3` adds command idempotency, commit proof, verdict state, partner verdict state, and next-surface hints.
- Detail RPC rejects if no feedback row exists.

Answers to the attached feedback questions:

- Client must not insert/update `date_feedback` directly for the mandatory verdict.
- Client must not patch `video_sessions.participant_1_liked` or `participant_2_liked` directly.
- Mandatory field is the verdict/liked/pass outcome; optional details include highlights, energy, conversation flow, photo accuracy, representation, and safety/report details.
- SQL verifies user belongs to the session.
- SQL writes or updates one row per session/user.
- Mutual yes can create or confirm persistent match.
- Network retry after server commit is handled by idempotency/replay semantics in v3 path.
- Optional details before mandatory row are rejected with `verdict_required`.
- The invariant proving user-level completion is: `date_feedback` row exists for `(session_id, user_id)` and required verdict was committed.

Legacy/conflict notes:

- Older direct table writes or client-side `check_mutual` sequencing would violate ownership. Current comment and implementation explicitly forbid that for mandatory verdict.

Risk:

- Double-click submit, timeout after commit, detail update before verdict, navigating before confirmation.

Assessment:

- Persistence owner is very clear: verdict Edge -> SQL. This is the real finish line.

Proof anchors:

- `src/components/video-date/PostDateSurvey.tsx`
- `apps/mobile/components/video-date/PostDateSurvey.tsx`
- `supabase/functions/post-date-verdict/index.ts`
- `supabase/migrations/20260403120000_submit_post_date_verdict.sql`
- `supabase/migrations/20260525090000_video_date_verdict_confirmation_v2.sql`
- `supabase/migrations/20260508143000_video_date_surface_claims_post_date_continuity.sql`

### S. Return To Expected Next State

Case: feedback is persisted and user can leave survey ownership.

Owners:

- Decision owner: `resolve_post_date_next_surface` plus canonical route decision.
- Navigation owner: `PostDateSurvey` client after persistence confirmation.
- Persistence guard: `date_feedback` existence.

Current implementation:

- `PostDateSurvey.finishSurvey` calls `resolve_post_date_next_surface`.
- Client normalizes the result and then calls `decideCanonicalVideoDateRoute` with next session truth.
- Possible next targets include ready gate, date, survey, chat, lobby, event ended, or home.
- Queue drain is allowed from post-date survey context, but survey completion must remain the prerequisite.

Answers to the attached next-state questions:

- Server considers event/session/match/partner/queue/date/survey truth in next-surface resolution.
- Client should not override next surface without re-checking canonical route truth.
- If next surface points to stale session, route decision/session truth should correct it.
- If next surface is lobby but feedback is still missing, survey route must win.
- If next surface is chat but match creation failed, chat route should not be chosen.
- Navigation is guarded by in-flight refs to prevent duplicate route pushes.
- Web and native have parallel behavior, but native parity must be kept under test.
- The invariant is: no lobby/chat/next gate/home navigation before feedback persistence.

Legacy/conflict notes:

- Older server-next actions could be trusted too directly. Current flow rechecks canonical route decision.

Risk:

- Queue drain finding a next match while previous survey is still incomplete.

Assessment:

- Post-feedback routing is clear in intent, but multiple return targets make this a high-test-surface area.

Proof anchors:

- `src/components/video-date/PostDateSurvey.tsx`
- native PostDateSurvey
- `resolve_post_date_next_surface`
- `shared/matching/videoDateRouteDecision.ts`

## 9. State Model

Important `video_sessions` fields:

- Identity: `id`, `event_id`, `participant_1_id`, `participant_2_id`.
- Ready Gate: `ready_gate_status`, `ready_gate_expires_at`, `ready_participant_1_at`, `ready_participant_2_at`, Ready Gate entry proof fields.
- Daily metadata: `daily_room_name`, `daily_room_url`, provider verification fields, room expiry fields.
- Lifecycle: `state`, `phase`, `started_at`, `handshake_started_at`, `date_started_at`, `state_updated_at`.
- Provider/join evidence: participant joined/left/provider proof fields, joined timestamps, remote-seen timestamps.
- Reconnect/away: `reconnect_grace_ends_at`, participant away fields.
- Terminal: `ended_at`, `ended_reason`, terminal audit/generation fields in latest local patch.
- Verdict: participant liked/decided fields.

Important `event_registrations` fields:

- `event_id`, `profile_id`, `admission_status`, `queue_status`, `current_room_id`, `current_partner_id`, `last_active_at`.

Important `date_feedback` fields:

- `session_id`, `user_id`, `target_id`, `liked`, optional detail fields, timestamps, unique session/user identity.

Known `queue_status` values:

- `idle`, `browsing`, `searching`, `matched`, `in_ready_gate`, `in_handshake`, `in_date`, `in_survey`, `completed`, `offline`.

Known Ready Gate status families:

- Pre-date/actionable: `queued`, `ready`, `ready_a`, `ready_b`, `snoozed`.
- Date-owned handoff: `both_ready`.
- Terminal or non-actionable: `expired`, `forfeited`, ended/terminal variants depending on migration generation.

Known lifecycle state/phase families:

- `ready_gate`, `handshake`, `date`, `ended` plus historical/compat variants in older migrations.

Canonical vs derived:

- Canonical: database columns written by SQL/RPCs.
- Derived: route decision, UI status, computed survey eligibility, active-session helper outputs.
- Repairable: room metadata, registration/session drift, terminal survey registration, provider delayed evidence.
- UI-only: local loading, retries, countdown display, toast state, transient permission state.

Assessment:

- The state model is understandable if read as a ladder: registration status points to current surface, session status records lifecycle truth, provider/event tables record evidence, and feedback records completion.

## 10. Route Priority Table

| Priority | Truth condition | Route owner result |
| --- | --- | --- |
| 1 | Current user has pending required survey and no feedback | `/date/:sessionId` with `PostDateSurvey` |
| 2 | Session ended with no survey required | ended/fallback |
| 3 | Session date-capable with provider room/handshake/date truth | `/date/:sessionId` |
| 4 | Non-ended `ready_gate_status = both_ready` | `/date/:sessionId` |
| 5 | Actionable Ready Gate before `both_ready` | Ready Gate overlay or `/ready/:sessionId` |
| 6 | Server next-surface says chat after feedback/match | chat |
| 7 | Active event, no owned session | event lobby/deck |
| 8 | No event/session or event over | home or ended |

Assessment:

- Pending survey dominance is the critical rule. If any route ignores it, that route is unsafe.

## 11. Ownership Conflict Audit

| Conflict class | Current answer | Assessment |
| --- | --- | --- |
| Client writes canonical Video Date state directly | Required hot paths use RPC/Edge. Reads of `video_sessions` exist; mandatory writes should not be direct. | Clear, but direct-write scans should remain in tests. |
| Local UI phase can disagree with Supabase | UI has local state but canonical lifecycle comes from server truth. | Acceptable if UI yields to server truth. |
| Stale mutation response routes user | Route decision rechecks truth in critical paths. | Needs runtime verification under realtime churn. |
| Ready Gate active after `both_ready` | Should be suppressed/yield to date. | Clear in design; bounce risk remains a key smoke-test target. |
| Lobby active after date ownership | Active owner/terminal truth patch suppresses lobby side effects. | Current local implementation evidence; cloud/live status must be verified before product claim. |
| Daily cleanup deletes active room/call | Current model preserves same-session active call and avoids destructive cleanup for parked remounts. | Fragile runtime area. |
| Visibility/page lifecycle terminalizes date | Should not be authoritative while Daily active. | Needs browser/native lifecycle testing. |
| Stale heartbeat revives provider-left state | Provider-authoritative SQL rejects stale heartbeats. | Strong in SQL; provider logs needed for proof. |
| Remote-seen skips provider validation | Provider-bound remote-seen now requires current provider proof. | Strong boundary. |
| Survey submit skips mandatory SQL path | Current path uses `post-date-verdict`. | Strong boundary. |
| Next navigation before feedback | Should be prevented by PostDateSurvey flow and route decision. | Must be proven in E2E. |
| Native diverges from web | Native has parallel code and tests. | Medium risk due duplicate implementation. |

## 12. Race-Condition Matrix

| Race | Current owner/guard | Bad outcome prevented | Test need |
| --- | --- | --- | --- |
| Simultaneous mutual swipes | SQL transaction/unique pair/session logic | duplicate sessions | SQL/integration |
| Duplicate video session creation | backend conflict handling and session source contracts | two active sessions | SQL/integration |
| First ready double-tap | command idempotency and row lock | duplicate timestamps/commands | SQL/RPC |
| Both ready at same time | row lock serializes | impossible status | SQL/RPC |
| Ready tap vs expiry | actionability gate | accepting stale Ready Gate | SQL/RPC |
| Ready tap vs snooze/forfeit | actionability and transition semantics | wrong terminal/ready status | SQL/RPC |
| `both_ready` vs route redirect | route owner and date ownership latch | bounce to lobby/ready | E2E |
| Date mount vs provider prep failure | date remains owner after canonical startability | Ready Gate reopens | component/integration |
| Date remount vs existing Daily call | same-session call reuse/parking | call destroyed/rebuilt | browser/native E2E |
| Token refresh vs joining | refresh/retry path in call hook | failed join despite valid session | integration |
| Client join RPC vs webhook | provider-current SQL checks | false join acceptance | SQL/provider sim |
| Daily leave webhook vs alive heartbeat | provider-authoritative presence | stale revive after leave | SQL/provider sim |
| Remote-seen vs provider leave | provider-bound remote-seen wrapper | stale encounter proof | SQL/provider sim |
| Promotion vs terminalization | ended checks and lifecycle wrappers | date starts after terminal | SQL |
| Promotion vs reconnect expiry | server-owned lifecycle | false terminal/date conflict | SQL/E2E |
| Partner-left vs grace timer | local grace plus server terminal rules | false away | E2E |
| Browser refresh while live | route hydration, same-session call handling | lost owner/call | browser E2E |
| Browser close/unload while live | lifecycle suppressions | false terminal | browser E2E |
| Native background while live | native preservation/grace | false leave | device E2E |
| Survey truth vs reconnect loop | terminal survey hard-stop | survey bypass/churn | E2E |
| Feedback double-click | verdict command idempotency | duplicate feedback/match | RPC/E2E |
| Feedback persisted but navigation lost | feedback row is durable, route recovery | stuck in survey | E2E |
| Next Ready Gate while previous survey pending | pending survey dominance | skipping mandatory feedback | E2E |
| Queue drain while pending survey | survey source surface and route recheck | preempting survey | E2E |

Assessment:

- The biggest remaining proof gaps are runtime races involving two clients plus Daily timing, not static ownership contracts.

## 13. False Finish Line Audit

| False finish line | Is it final? | Correct interpretation |
| --- | --- | --- |
| `both_ready` | No | Ready Gate completed; date route becomes owner. |
| Canonical Daily room name/url | No | Deterministic room metadata exists or is repairable. |
| Daily room created by provider | No | Provider resource exists; no participant co-presence proven. |
| Daily token issued | No | One caller has credentials to join. |
| `/date/:sessionId` route entry | No | Correct owner is mounted, but live date not proven. |
| Local Daily join | No | Transport joined; server must accept provider-backed evidence. |
| One remote media/frame observation | No | Evidence can be submitted; SQL must accept it. |
| Promotion to `date` | No | Actual date started, but survey completion not done. |
| `ended_at` | No | Date ended, but required feedback may be missing. |
| Survey-required row/status | No | Survey is due; flow still incomplete. |
| PostDateSurvey opened | No | User has not necessarily submitted. |
| Analytics event `survey_completed` | Not by itself | Durable `date_feedback` must exist. |
| Persistent match creation | Not the Video Date finish | User-level survey completion still requires feedback row. |

Assessment:

- This section is the operational guardrail. A reader should treat persisted `date_feedback` as the only product finish line for the user.

## 14. Web vs Native Parity

| Surface | Web | Native/mobile | Parity assessment |
| --- | --- | --- | --- |
| Lobby | `src/pages/EventLobby.tsx` | `apps/mobile/app/event/[eventId]/lobby.tsx` | Same owner concept, separate implementations. |
| Ready Gate overlay | `src/components/lobby/ReadyGateOverlay.tsx` | `apps/mobile/components/lobby/ReadyGateOverlay.tsx` | Same handoff concept, parallel code. |
| Ready route | `/ready/:readyId`, `ReadyRedirect` | `apps/mobile/app/ready/[id].tsx` | Both active fallback routes. |
| Date route | `/date/:id`, `VideoDate` | `apps/mobile/app/date/[id].tsx` | Same owner after `both_ready`; native lifecycle differs. |
| Ready RPC | `useReadyGate` | `readyGateApi` | Both call `video_session_mark_ready_v2` for mark-ready. |
| Daily prepare | `prepareVideoDateEntry` -> `daily-room` | native prepare entry wrapper -> `daily-room` | Intended parity. |
| Join evidence | `useVideoCall` RPCs | native date route/API RPCs | Intended parity with different runtime. |
| Remote-seen | web Daily event/media hook | native Daily/media path | Must pass provider-bound proof. |
| Survey | web `PostDateSurvey` | native `PostDateSurvey` | Same backend verdict owner. |
| Background/lifecycle | browser visibility/page lifecycle | native background/foreground | Equivalent intent, different risk. |

Assessment:

- Web/native parity is good at backend contract level, but duplicate client implementations create drift risk. Keep contract tests and device smoke tests.

## 15. Observability And Runtime Proof

To reconstruct a two-user run, capture:

- `event_id`
- `video_session_id`
- both user ids
- Ready Gate payloads and command ids
- `video_session_commands`
- `video_session_events`
- `event_loop_observability_events`
- `video_date_surface_claims` and claim events
- `video_date_daily_webhook_events`
- `video_date_presence_events`
- Daily room name/url
- Daily provider session ids
- join/leave order by provider `occurred_at`
- alive heartbeat payloads
- remote-seen accepted/rejected payloads
- promotion payloads and `date_started_at`
- reconnect/away fields
- terminal fields and `ended_reason`
- `event_registrations.queue_status`
- `date_feedback`
- `post-date-verdict` response
- `resolve_post_date_next_surface` result

Minimum runtime proof story:

1. Session created from mutual match.
2. Both users enter same Ready Gate.
3. User A ready accepted.
4. User B ready accepted.
5. Same session reaches `both_ready`.
6. Both clients route to `/date/:sessionId` or native date route.
7. Both clients receive same Daily room.
8. Both Daily provider sessions join the same room.
9. Both users have current provider-backed presence.
10. Remote-seen is accepted for both users or server promotion evidence proves equivalent encounter truth.
11. Session promotes to `date`.
12. Date ends with survey-required truth.
13. PostDateSurvey opens on Date route.
14. `date_feedback` persists for the user under test, ideally both users for full run.
15. Next-surface route happens only after feedback.

Assessment:

- Logs can likely reconstruct most of the story, but a production smoke test must deliberately capture both client consoles, Supabase rows, and Daily dashboard/provider evidence.

## 16. Database And Migration Foundations

Key DB foundations:

- `video_sessions` was introduced early and later expanded with Ready Gate, Daily room, phase, handshake/date, provider, terminal, and feedback-related fields.
- `event_registrations.queue_status` includes the active Video Date statuses: `in_ready_gate`, `in_handshake`, `in_date`, `in_survey`.
- `date_feedback` has RLS and a unique session/user ownership model.
- Provider evidence tables include Daily webhook and presence ledgers.
- Public RPCs are exposed through generated types, including `video_session_mark_ready_v2`, `ready_gate_transition`, `video_date_transition`, `mark_video_date_daily_joined`, `mark_video_date_daily_alive`, `mark_video_date_remote_seen`, `resolve_post_date_next_surface`, and `submit_post_date_verdict_v3`.

Current migration assessment:

- Many older migrations remain in history and define superseded versions. Current ownership must be read from final function definitions and current wrappers, not first occurrence in migration history.
- Latest active docs mention a local `20260608171837_video_date_active_owner_terminal_truth.sql` patch as local implementation evidence only until committed/applied.
- For actual production claims, linked cloud migration history and deployed Edge Function versions must be verified at the time of the run.

Assessment:

- DB foundations are robust, but migration history is noisy. Engineers must distinguish current public function bodies from renamed historical bases.

## 17. Daily Provider Boundary

Daily owns:

- Provider room resources.
- Meeting tokens as accepted by Daily.
- Daily SDK meeting state.
- Provider session identity.
- Participant joined/left/updated events.
- Media track availability and first-frame/remote media facts.

Daily does not own:

- Whether Vibely considers the Ready Gate complete.
- Whether `/date` should own the route.
- Whether a join is accepted as canonical app evidence.
- Whether remote-seen counts.
- Whether a session promotes to date.
- Whether a date ends.
- Whether survey is required.
- Whether the user completed the flow.

Vibely/Supabase owns those app decisions after validating Daily facts.

Important actions:

- `prepare_date_entry`: Date route entry owner.
- `ensure_date_room`: warmup/verification, not token/join owner.
- `create_date_room` / `join_date_room`: older/admin/provider paths, not the canonical route entry path.
- `delete_room`: must be treated as cleanup/orphan operation, not a per-client local leave action that can destroy partner's active date.

Assessment:

- The correct mental model is "Daily is a witness and transport system; Supabase is the judge of app truth."

## 18. Security And Authorization

Security answers:

- A non-participant should not be able to mark ready, get a Daily token, submit Daily joined/alive evidence, submit remote-seen evidence, promote a date, end a date, or submit feedback for the session.
- `/date/:sessionId` route access alone is not authority; server reads/RPCs must enforce participant authority.
- Daily token issuance is behind authenticated `daily-room` logic and participant/actionability checks.
- `handle_swipe_v2` is actor-bound.
- `video_session_mark_ready_v2` uses `auth.uid()` and participant checks.
- Provider evidence RPCs use authenticated actor and provider-current validation.
- Verdict SQL verifies actor belongs to the session.
- Client cannot choose participant side; SQL derives it from authenticated user.
- Client cannot safely forge provider identity because SQL compares it to latest provider event/session evidence.
- Old evidence replay after leave should be rejected/no-op if provider leave/currentness invalidates it.

Remaining abuse/unknown cases:

- Provider webhook endpoint security must be verified through signature checks and deployed configuration.
- RLS direct-write policies should remain under static/runtime tests to ensure clients cannot mutate canonical Video Date tables directly.
- Service-role Edge Functions must continue to perform manual auth/participant checks because service role bypasses RLS.

Assessment:

- Authorization is strong in current ownership design, but service-role edges and provider webhooks are the highest-value surfaces to keep testing.

## 19. Acceptance Test Plan

Unit and shared tests:

- Route priority tests for survey > date > ready > lobby.
- `both_ready` date-owned tests.
- pending survey recovery tests.
- false finish line tests.
- web/native parity contract tests.

SQL/RPC tests:

- `handle_swipe_v2` actor binding and session creation.
- duplicate mutual swipe handling.
- `video_session_mark_ready_v2` first ready, second ready, double tap, simultaneous ready, expiry, snooze, forfeit, blocked/report state, pending survey preemption.
- `prepare_entry` actionability and routeable state.
- provider-backed joined/alive acceptance and rejection.
- stale provider heartbeat rejection.
- remote-seen provider-bound acceptance and stale rejection.
- promotion idempotency and promotion-vs-terminal races.
- terminal survey eligibility and non-eligibility.
- verdict idempotency and duplicate submit.
- `update_post_date_feedback_details` requiring existing row.
- `resolve_post_date_next_surface` all target classes.

Integration/E2E tests:

- Happy path: match -> Ready Gate -> both ready -> same Daily room -> provider-backed date -> end -> survey -> feedback -> next state.
- Provider prepare failure after `both_ready`: date remains owner.
- Route bounce prevention: lobby/ready cannot reclaim after date ownership.
- Survey recovery after refresh.
- Stale heartbeat rejection after provider leave.
- Duplicate Daily call prevention on remount.
- Partner leave with local grace and recovery.
- Browser visibility/unload while Daily active.
- Native background/foreground while Daily active.
- Queue drain while survey pending.

Production smoke test:

1. Use two disposable users in one live production event.
2. Capture browser/native logs for both clients.
3. Capture `event_id`, `video_session_id`, user ids, Daily room name, provider session ids.
4. Complete mutual match.
5. Enter Ready Gate on both users.
6. Tap Ready in sequence A then B; repeat later B then A in separate run.
7. Confirm `both_ready` and same canonical room.
8. Confirm both clients route to date and do not bounce.
9. Confirm both join same Daily room and provider webhooks record joined events.
10. Confirm remote media for both users.
11. Confirm server promotion to date and `date_started_at`.
12. Test short leave/rejoin and ensure no false terminal.
13. End date or let terminal path occur.
14. Confirm PostDateSurvey opens on `/date`.
15. Submit verdict/details.
16. Confirm `date_feedback` row for both users.
17. Confirm next-surface route only after feedback.
18. Run final SQL queries and provider dashboard check.

Assessment:

- The production smoke is mandatory. Static tests can reduce risk but cannot certify user-facing success.

## 20. Direct-Write Audit Summary

Allowed client actions:

- Read session/profile/deck state.
- Call authenticated RPCs.
- Invoke Edge Functions.
- Submit evidence to server-owned RPCs.
- Navigate after canonical decision.

Disallowed or unsafe client actions:

- Directly setting `video_sessions.state`, `phase`, `date_started_at`, `ended_at`, ready timestamps, joined timestamps, remote-seen timestamps, or liked fields.
- Directly inserting/updating `date_feedback` for the required verdict.
- Directly setting `event_registrations.queue_status` to move through Video Date.
- Deleting Daily room on ordinary local leave/remount.

Current assessment:

- The main hot paths use RPC/Edge, not direct canonical writes. Continue using static scans and RLS runtime probes to prevent regressions.

## 21. Final Unknowns

Code alone cannot prove:

- Daily provider room actually exists in production at the moment of the run.
- Daily webhook signing/configuration is active in the deployed environment.
- Both clients' real devices/browsers keep the same-session call identity through actual remount/background/foreground behavior.
- Provider events arrive in the expected order under real network lag.
- Production RLS/Edge Function versions match local source unless deployment/cloud state is verified.
- The full user-facing flow succeeds without route bounce, false away, or survey bypass.

Runtime checks still needed:

- Current Git/branch/deploy SHA.
- Current Supabase migration list.
- Current deployed Edge Function versions.
- Daily dashboard/provider evidence.
- Two-user production smoke through persisted `date_feedback`.

## 22. Final Assessment

The Video Date ownership model is understandable when compressed into one rule:

The client owns surfaces and evidence submission; Daily owns transport facts; Supabase owns every canonical state transition; `/date/:sessionId` owns the flow after `both_ready`; and the run is not complete until `date_feedback` persists.

My opinion is that the source model is now disciplined enough for another engineer to reason about it, but still operationally fragile because the hardest failures happen at timing boundaries across two clients, Daily, realtime, and terminal survey recovery. The correct next proof is not another static explanation. It is the fresh two-user production run with the evidence checklist above.
