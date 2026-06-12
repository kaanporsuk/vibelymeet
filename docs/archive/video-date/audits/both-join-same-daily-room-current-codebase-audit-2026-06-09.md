# Both Join Same Daily Room Audit - Vibely Vibe Video Date Flow

Audit date: 2026-06-09

Supersession note, 2026-06-09: the later Daily-room legacy action cleanup removes public `create_date_room` and `join_date_room` action support from the active Edge Function contract/dispatch. Current room/token entry remains `prepare_date_entry`; provider room creation/reuse/verification remains internal to the active prepare path.

Repo audited: `/Users/kaanporsuk/Documents/Vibely/Git/vibelymeet`

Local commit audited: `47ca0c6b8a5cbda0c0b1d9910e0ee416bd5de835`

Scope: current local source, current migrations, generated Supabase types, local contract tests, and linked Supabase cloud checks. This is not a fresh live two-user Daily provider run.

Proof classes used below:
- CODE: current source or migrations prove the behavior.
- TEST: local tests passed in this audit.
- CLOUD: linked Supabase CLI state proves deployment/database shape.
- LIVE: a real two-user provider run proves it. No LIVE proof was produced in this audit.
- UNKNOWN: production health cannot be asserted from the available evidence.

## 1. Current canonical behavior

"Both join same Daily room" currently means both authenticated participants of one `video_sessions.id` reach `/date/:sessionId` or native `/date/[id]`, receive the same server-derived Daily room identity, receive separate caller-scoped tokens, join a single same-session Daily call pipeline per surface, and persist participant-slot joined evidence through `mark_video_date_daily_joined`/`mark_video_date_daily_alive`. It does not mean token receipt alone, call-object creation alone, local `call.join()` alone, remote media observed, `date_started_at`, survey success, or full Video Date success. The successor boundary is active co-presence, provider-bound remote-seen, and later date promotion.

## 2. Stage boundaries

| Boundary | Current behavior | Source files | DB truth | Owner |
|---|---|---|---|---|
| Predecessor: both ready | `video_date_transition(..., p_action='prepare_entry')` and `prepare_date_entry` require routeable `both_ready` or already-prepared handshake/date truth. | `supabase/functions/daily-room/index.ts`, migrations defining `video_date_transition` | `video_sessions.ready_gate_status='both_ready'`, state/phase routeable | Server |
| Date route ownership | Web `VideoDate` invokes `useVideoCall`; native `/date/[id]` owns Daily bootstrap. Ready Gate only prewarms or navigates. | `src/pages/VideoDate.tsx`, `src/hooks/useVideoCall.ts`, `apps/mobile/app/date/[id].tsx`, ReadyGate overlays | Route ownership latches plus session truth | Mixed client/server |
| Prepare-entry room/token | `prepare_date_entry` derives canonical room, confirms room metadata, then mints caller token. Client cannot choose room. | `src/lib/videoDatePrepareEntry.ts`, `apps/mobile/lib/videoDatePrepareEntry.ts`, `supabase/functions/daily-room/index.ts` | `video_sessions.daily_room_name`, `daily_room_url`, state/phase `handshake` | Server/provider |
| Local Daily join | Web uses `DailyIframe`; native uses `@daily-co/react-native-daily-js`. Both pass `room_url` and caller token. | `src/hooks/useVideoCall.ts`, `apps/mobile/app/date/[id].tsx`, `apps/mobile/lib/videoDateDailyMediaConfig.ts` | No DB write yet | Client/provider |
| Joined proof | Client sends provider-backed owner/call/session proof to RPC after local Daily join and provider session id. | `src/hooks/useVideoCall.ts`, `apps/mobile/app/date/[id].tsx`, `shared/matching/dailyJoinedConfirmation.ts` | `participant_1_joined_at`, `participant_2_joined_at`, `video_date_presence_events` | Mixed server/provider/client |
| Successful end of this stage | Both participant slots have current joined evidence for the same session, without newer away/left truth. | `supabase/migrations/20260606203000_video_date_provider_authoritative_presence.sql`, `20260606205211_video_date_provider_participant_id_presence_repair.sql` | joined timestamps plus presence/webhook evidence | Server |
| Next stage | Stable active co-presence and provider-bound remote-seen can promote to date. | `video_date_stable_copresence_v1`, `mark_video_date_remote_seen`, provider-overlap migrations | remote_seen fields, `date_started_at` | Server |

## 3. Preconditions

| Requirement | Enforced where | Failure behavior | Evidence | Gap |
|---|---|---|---|---|
| Authenticated current user | Edge `daily-room` derives user from bearer auth; RPCs use `auth.uid()`. | 401/403 or fail-soft rejected payload. | CODE | None for code path. |
| User is participant | `prepare_date_entry`, `mark_video_date_daily_alive`, `mark_video_date_daily_joined`, `mark_video_date_remote_seen`. | `ACCESS_DENIED`, no joined/remote-seen write. | CODE, TEST | LIVE malicious proof not run. |
| `both_ready` or already routeable | `requireVideoDateReadyGateActionability`, `confirm_video_date_entry_prepared`, client startability guards. | `READY_GATE_NOT_READY`; client retries/refetches or shows setup error. | CODE, TEST | None for static behavior. |
| `prepare_date_entry` succeeded before normal join | Web/native call `prepareVideoDateEntry`; handoff cache is session/user scoped. | Join cannot proceed without `room_url` and token. | CODE, TEST | Reload loses client handoff; server truth recovers. |
| Canonical room metadata exists | `confirm_video_date_entry_prepared` writes `daily_room_name`/`daily_room_url` and state/phase `handshake`. | Prepare failure; no local Daily join. | CODE | None. |
| Caller token exists and is unexpired or refreshable | `prepare_date_entry`, `video-date-token-refresh`, client token recovery advisors. | Refresh, reprepare recovery, reconnect grace, or terminal survey truth. | CODE, CLOUD | LIVE token expiry rejoin not proven. |
| Pair/account/event eligibility before token | `requireVideoDateReadyGateActionability`, blocked-pair checks, confirm wrapper inactive-event guard. | Access denied, blocked pair, event not active. | CODE, TEST | If eligibility changes after token issue but before joined RPC, joined RPC repeats participant/terminal/provider checks but not the full pre-token account safety matrix. |
| Survey/terminal truth wins | Date route hard-stops Daily/surface churn and opens `PostDateSurvey`. | Cleanup and survey recovery. | CODE, TEST | Fresh production survey completion not proven here. |

## 4. Same-room identity contract

| Field/evidence | Expected value | Source of truth | Repair behavior | Risk |
|---|---|---|---|---|
| `room_name` | `date-${sessionIdWithoutDashes}` | `videoDateRoomNameForSession` in `supabase/functions/daily-room/dailyRoomContracts.ts` | Edge recomputes canonical room for prepare/provider proof. | CODE/TEST strong. |
| `room_url` | `https://${dailyDomain}/${room_name}` | `videoDateRoomUrlForName`, `resolveCanonicalVideoDateRoom` | Domain/room URL validation and recanonicalization. | CLOUD config checked, but real provider room not joined live. |
| Client request to prepare | `{ action:'prepare_date_entry', sessionId, entry_attempt_id, video_date_trace_id }` | Web/native `videoDatePrepareEntry` wrappers | No client room field accepted. | Good. |
| Malicious room override | Not accepted in normal prepare path. | Edge action derives room from `sessionId`; auth user from bearer. | Wrong metadata gets rejected or repaired in provider room ensure. | Direct legacy actions still exist but are not current `/date` normal path. |
| Token refresh room | Must match current room name and URL. | `src/hooks/useVideoCall.ts`, `apps/mobile/app/date/[id].tsx` | Mismatch becomes `token_refresh_room_mismatch` and does not silently switch rooms. | LIVE refresh mismatch not run. |
| Provider room settings | Private two-person room, `max_participants:2`, `enforce_unique_user_ids:true`, chat/screenshare/recording/knocking disabled. | `buildVideoDateRoomProperties` | Already-exists is treated idempotently; stale provider rooms can be recovered with same name. | Daily provider behavior not LIVE verified. |

## 5. Token contract

| Token property | Expected behavior | Evidence | Risk | Test |
|---|---|---|---|---|
| Minting path | Normal path is `prepare_date_entry`; `prepare_solo_entry`, `create_date_room`, and `join_date_room` remain compatibility/flagged or legacy paths. | `daily-room/index.ts`, web/native prepare wrappers | Legacy surfaces can confuse audits; current date route uses prepare-entry. | `dailyRoomContracts.test.ts`, `videoDatePrepareEntry.test.ts` |
| Caller scoping | Token `user_id` is auth user, not request body user. | `createMeetingToken(roomName, user.id, ...)` | Nonparticipant token mint blocked by Edge before mint. | CODE/TEST |
| Room scoping | Token includes `room_name`; client joins with returned `room_url` and token. | `buildMeetingTokenProperties`, web/native join code | LIVE provider token acceptance not tested here. | CODE/TEST |
| Expiry | Token has finite `exp`; refresh path mints a new token for same room. | `video-date-token-refresh`, client refresh logic | Rejoin can leave and rejoin same call object; live expiry not tested. | CODE |
| Partner token | Response contains only caller token; no partner token path found. | Edge response shape, prepare wrappers | Token not persisted in DB. | CODE |
| Logging | Analytics/Sentry breadcrumbs carry room name, ids, timings, errors, not token values. | `src/lib/videoDatePrepareEntry.ts`, `apps/mobile/lib/videoDatePrepareEntry.ts`, webhook sanitizer | Full runtime log sinks were not exhaustively live-scraped. | CODE |
| Privilege | No owner/admin/recording mutation token fields found; screenshare disabled in token/room properties. | `dailyRoomContracts.ts` | Depends on Daily interpreting token props as expected. | CODE/TEST |

## 6. Web runtime

| Step | File/function | Daily action | Backend action | Failure behavior |
|---|---|---|---|---|
| Route owner | `src/pages/VideoDate.tsx` | None | Fetches/subscribes to `video_sessions` and invokes `useVideoCall`. | Terminal truth opens survey; not date-owned redirects/recovery. |
| Prepare | `src/lib/videoDatePrepareEntry.ts`, `useVideoCall.acquireDateRoom` | None | Edge `daily-room` action `prepare_date_entry`. | Retry/cooldown; reject unsafe/stale handoff. |
| Call object | `src/hooks/useVideoCall.ts`, `src/lib/dailyCallInstance.ts` | `DailyIframe.createCallObject` guarded | Owner state tracked in memory. | Waits/reuses same-session call; duplicate create guarded. |
| Join | `useVideoCall.startCall` | `callObject.join({ url, token })` | None until joined proof. | Token refresh/retry, reconnect grace, peer-missing wait. |
| Joined proof | `markDailyJoinedWithBackoff` path in `useVideoCall.ts` | Reads local meeting state and provider session id | RPC `mark_video_date_daily_joined` with owner/call/provider proof. | Bounded retry; terminal truth stops Daily. |
| Alive heartbeat | `startDailyAliveHeartbeat` | Reads provider session id every heartbeat | RPC `mark_video_date_daily_alive` every 3s while active. | Skips if provider proof missing; terminal truth stops heartbeat. |
| Remote evidence | `markRemoteSeenOnServer` | Triggered by participant/snapshot/track evidence | RPC `mark_video_date_remote_seen` provider-bound. | Retry or stuck-state observability. |
| Cleanup | `cleanupCallObject` | Park, leave, or destroy call object | Release/terminal recovery depending truth. | Same-session live handoff can preserve call and heartbeat. |

## 7. Native runtime

| Step | File/function | Daily action | Backend action | Failure behavior |
|---|---|---|---|---|
| Route owner | `apps/mobile/app/date/[id].tsx` | None | Uses `useVideoDateSession`, route latches, surface claims. | Not-startable truth recovers or shows Ready Gate/setup copy. |
| Prepare/token | `getDailyRoomTokenWithTimeout`, `prepareVideoDateEntry` | None | Edge `prepare_date_entry`; consumes session/user handoff if fresh. | Retries `READY_GATE_NOT_READY` races and retryable provider errors. |
| Native call options | `apps/mobile/lib/videoDateDailyMediaConfig.ts` | Audio/video sources enabled; optional bandwidth optimization. | None. | Camera constraint fallback from ideal to fallback capture profile. |
| Prewarm | `apps/mobile/lib/videoDateDailyPrewarm.ts` | May create/preauth/join prewarm for same session/user/room. | None. | TTL 45s, room mismatch fallback/destroy. |
| Call object guard | `apps/mobile/lib/nativeDailyCallInstance.ts` | `Daily.createCallObject`, duplicate-call guard, cleanup queue. | None. | Blocks busy external call, serializes create, destroys idle external call if safe. |
| Join | `apps/mobile/app/date/[id].tsx` | `call.join({ url, token })`, or waits joined/inflight prewarm. | None until joined proof. | Token auth refresh/rejoin, constraint fallback, retry state. |
| Joined proof | `apps/mobile/app/date/[id].tsx` | Requires `meetingState==='joined-meeting'` and provider session id. | RPC `mark_video_date_daily_joined` with same arg shape as web. | Bounded retry and stuck-state event on exhaustion. |
| Alive heartbeat | `markNativeVideoDateDailyAlive`, heartbeat every 3s | Reads provider session id and meeting state. | RPC `mark_video_date_daily_alive`. | Skips/stops on missing terminal provider state. |
| Remote evidence | `markRemoteSeenOnServer` | Requires provider-backed joined, call instance id, provider session id. | RPC `mark_video_date_remote_seen`. | Retry or stuck-state event. |
| Background | AppState handler | Leaves/destroys Daily on background, gives 12s grace, reconnects or ends on timeout. | `markReconnectReturn`, `signalVideoDateLeave`, `endVideoDate`, refetch. | LIVE native OS behavior not proven here. |

## 8. Daily call object / churn

| Scenario | Current behavior | Risk | Test |
|---|---|---|---|
| Web rerender | Existing hook refs and singleton/owner latches avoid rebuild. | In-memory only; reload loses call object. | `videoDateStableCopresenceOwnerContracts.test.ts` |
| Web same-session active call | Reused, waited on, or parked; not destroyed just because date route remounts. | Same-tab/source proof only, no LIVE Daily trace. | TEST |
| Native prewarm to date | Same session/user/room prewarm can be consumed; wrong room falls back. | Physical device behavior not LIVE proven. | `nativeVideoDateContractRecovery.test.ts` |
| Native duplicate create | Guard serializes create, waits cleanup, blocks busy external calls. | Native SDK edge cases need device test. | TEST |
| Same user second tab/device | Surface claims and Daily `enforce_unique_user_ids` reduce duplicate risk. | Real Daily replacement/kick behavior not LIVE proven. Duplicate device safety is UNKNOWN for production health. | CODE/TEST only |
| Token refresh | Refresh preserves room; mismatch fails. Web/native can leave and rejoin same call object. | LIVE expiry/rejoin not run. | CODE |
| Route bounce | `/date` owns Daily; Ready Gate/lobby should yield after routeable truth. | Current proof is code/test, not fresh production run. | TEST |

## 9. `mark_video_date_daily_joined` contract

| Actor/slot | Evidence required | DB writes | Idempotency | Failure behavior |
|---|---|---|---|---|
| Participant 1 | Auth user equals `participant_1_id`; provider-backed joined proof from current Daily call owner. | `participant_1_joined_at`, clear own away/reconnect state, insert `video_date_presence_events`. | Outcome idempotent; latest accepted evidence can refresh timestamp in newer alive path. | Fail-soft JSON, retryable unless terminal. |
| Participant 2 | Auth user equals `participant_2_id`; same proof shape. | `participant_2_joined_at`, clear own away/reconnect state, insert presence event. | Same. | Same. |
| Nonparticipant | Auth user not participant. | No slot write. | N/A | `ACCESS_DENIED`/fail-soft rejected. |
| Wrong room | RPC has no client room field; server binds to session and provider session/webhook evidence. | No intended write if provider evidence is not current for that session. | N/A | Potential gap: current `mark_video_date_daily_alive` allows a provider-lag bridge when no latest webhook exists but client has provider session id. Remote-seen is stricter. |
| Terminal session | Ended/survey truth wins. | No join stamp or terminal response. | N/A | Client stops heartbeat and opens survey if required. |

Exact public RPC args in generated types and clients:

```text
mark_video_date_daily_joined(
  p_session_id uuid,
  p_owner_id text,
  p_call_instance_id text,
  p_provider_session_id text,
  p_entry_attempt_id text,
  p_owner_state text
)
```

`mark_video_date_daily_joined` is now a compatibility facade over provider-backed alive/join logic. The stronger current liveness source is `mark_video_date_daily_alive`; the stricter remote evidence source is `mark_video_date_remote_seen`.

## 10. Active co-presence boundary

Joined evidence is not active co-presence by itself. Current active/stable co-presence requires both participant joined timestamps to be active, no newer away marker, current owner/client heartbeat after the latest joined evidence, fresh heartbeat not older than 15 seconds, and a short overlap window before `video_date_stable_copresence_v1` treats the session as stable. Remote-seen is later and requires provider-bound owner/call/provider evidence. Date promotion/date start is later still and sets `date_started_at` only after bilateral remote-seen/provider-overlap promotion conditions, not from both joined alone.

## 11. User option matrix

| State | User option | Allowed? | Backend effect | Partner effect |
|---|---|---|---|---|
| Preparing room/token | Wait or retry after failure | Yes | New prepare-entry attempt or retryable provider path | None until joined proof. |
| Permission denied | Retry/open settings | Yes | No joined write | Partner may wait/peer-missing. |
| Local joined, partner absent | Wait; retry/reconnect | Yes | Own joined/alive evidence, peer absent diagnostics | Partner not marked away by local absence alone. |
| Local joined, remote transport left | Wait through reconnect grace | Yes | Away/terminal delayed through server/local grace | Partner gets grace before away semantics. |
| Background native within 12s | Return/foreground | Yes | Reconnect return/refetch | Avoids immediate terminal if within grace. |
| Background native after timeout | None in call; end/recover | Yes, terminal path | `signalVideoDateLeave`/`endVideoDate` | May move to survey/terminal depending truth. |
| Token expired/interrupted | Automatic refresh/rejoin | Yes | Same-room refresh or terminal truth | Partner may see reconnect. |
| Manual leave/back before real date | Exit/recovery path | Yes but guarded | Pre-date exit/cleanup, no false date success | Partner waits or server handles absence. |
| Terminal survey truth | Complete survey only | Yes | `date_feedback` after survey | Partner state follows survey truth. |

## 12. Provider failure matrix

| Failure | Current behavior | Date-owned? | Retry/terminal? | User copy |
|---|---|---|---|---|
| Missing Daily API key/domain | Provider actions are blocked by `DAILY_CONFIG_BLOCKED`; production fallback blocked. | Yes, after route ownership/prepare handling. | Terminal/retry classified by Edge response. | Setup/retry copy. |
| Room create already exists | Treated as idempotent success for same canonical room. | Yes | Success/reuse. | None. |
| Provider room verify stale/missing | Recreate/recover same-name room before token. | Yes | Retryable provider path. | Setup/retry copy. |
| Daily 429/rate limit | Edge token/room helpers retry bounded and expose retry-after. | Yes | Retryable. | "still opening" style copy. |
| Token mint failure | Prepare fails; no join. | Yes | Retryable or terminal by classification. | "Could not start video" / retry copy. |
| Daily join auth/eject | Client token refresh and rejoin same room. | Yes | Retryable unless terminal. | Reconnecting copy. |
| Provider session id missing | Joined/alive/remote-seen RPC skipped or returns provider-missing. | Yes | Retry while nonterminal. | Sync/reconnect copy. |
| Participant-left | Local transport signal first; grace before away/terminal. | Yes | Reconnect grace. | Reconnecting/waiting copy. |
| Webhook missing/late | Alive path may bridge briefly with client provider session proof; remote-seen requires stronger provider event. | Yes | Retry/diagnostic. | Usually hidden. |

## 13. Realtime/reload/background recovery

| Scenario | Current behavior | Failure fallback | Test |
|---|---|---|---|
| Web reload | In-memory token/call handoff lost; `/date` refetches server truth and prepares same canonical room/token. | Retry/terminal survey recovery. | CODE/TEST |
| Web duplicate tab | Dup tab/surface ownership guards and singleton model reduce churn. | Conflict/block or owner yield. | CODE/TEST, LIVE UNKNOWN |
| Native background before join | AppState can retry/refetch on foreground; prejoin latches clear on final failure. | Retry route-owned setup. | TEST |
| Native background after join | Leaves/destroys local call, 12s grace, foreground refetch/rejoin or timeout end. | `endVideoDate`/survey recovery. | CODE/TEST, LIVE UNKNOWN |
| Lost prepare response | Client cache/inflight coalescing and refetch/retry paths recover. | Cooldown/retry. | TEST |
| Token expiry | Web/native refresh before expiry or after auth/eject; same-room mismatch is terminal for that attempt. | Reprepare same-room recovery or reconnect. | CODE |
| Realtime gap | Date route refetches, snapshots, reconnect sync, broadcast gap recovery. | Survey/terminal truth wins. | TEST |

## 14. Security/RLS/token-spoofing audit

- Nonparticipant token access: `prepare_date_entry` derives the user from bearer auth and verifies participant/actionability before token mint. Evidence: CODE/TEST.
- Partner token access: no current path returns a partner token. Tokens are caller-scoped and not stored in DB. Evidence: CODE/TEST.
- Wrong-room spoofing: normal prepare path does not accept `room_name` or `room_url`; Edge derives canonical room. Token refresh rejects room mismatch. Evidence: CODE/TEST.
- Joined spoofing: public RPC requires authenticated participant, routeable nonterminal session, owner/call/provider fields, and current provider-backed state. Risk remains that `mark_video_date_daily_alive` has a webhook-lag bridge accepting a client provider session id when no latest webhook exists. That is not enough to call spoof resistance LIVE-proven.
- Token logging: source inspection found room names, trace ids, and timings logged, not token strings. Webhook sanitizer redacts token/secret/key-like fields. Evidence: CODE.
- RLS/direct writes: lifecycle writes are through SECURITY DEFINER RPCs; `video_date_presence_events` is service-owned. Generated types expose RPCs but not direct table mutation for clients. Evidence: CODE/TEST.

## 15. Web/native parity

- Web-web: CODE/TEST supports same-room prepare, caller tokens, guarded call object, provider-backed joined, and remote-seen. LIVE same-room proof is UNKNOWN.
- Web-native: Shared Edge/RPC contracts and matching proof shapes support mixed clients. LIVE same-room proof is UNKNOWN.
- Native-web: Same as above, with native using React Native Daily SDK and the same RPC args. LIVE same-room proof is UNKNOWN.
- Native-native: CODE/TEST supports native route, prewarm, guarded call object, provider-backed joined, AppState recovery. LIVE same-room proof is UNKNOWN.
- Reload/cold-start/background: CODE/TEST supports recovery through server truth and same canonical room. Physical/browser/provider LIVE proof is UNKNOWN.

## 16. Observability/support

- Prepare without join: prepare/token events, ready-gate-to-date latency checkpoints, client stuck state, and operator diagnostics exist.
- One joined only: `video_sessions.participant_1_joined_at`/`participant_2_joined_at`, away fields, `video_date_presence_events`, and Daily webhook events expose asymmetry.
- Both joined no remote-seen: `video_date_both_ready_operator_diagnostics_v1` includes joined/remote-seen/date promotion categories; remote-seen fields identify the gap.
- Wrong room/domain: Daily room URL validation and diagnostics include domain mismatch categories.
- Duplicate tab/device: surface claims, owner/daily owner latches, singleton diagnostics, and client stuck events exist; production dashboard proof not found.
- Token failure: `VIDEO_DATE_DAILY_TOKEN_FAILURE`, Sentry messages without token payload, provider operation metadata, and retry classifications exist.

Support can diagnose many of these with code-level tools and tables, but I did not find proof of an always-on production dashboard/alert for every item. Treat observability health as CODE/CLOUD partial, LIVE UNKNOWN.

## 17. Existing tests and missing tests

Executed during this audit:

| Command | Result |
|---|---|
| `npm run test:daily-room-contract` | 14 pass |
| `npx tsx shared/matching/videoDatePrepareEntry.test.ts` | 17 pass |
| `npx tsx shared/matching/dailyJoinedConfirmation.test.ts` | 5 pass |
| `npx tsx shared/matching/bothReadyCanonicalDailyRoomDefinitiveOwner.test.ts` | 8 pass |
| `npx tsx shared/matching/nativeVideoDateContractRecovery.test.ts` | 13 pass |
| `npx tsx shared/matching/videoDateStableCopresenceOwnerContracts.test.ts` | 12 pass |
| `npx tsx shared/matching/videoDateProviderJoinedAbsenceTerminal.test.ts` | 6 pass |
| `npx tsx shared/matching/videoDateProviderOverlapPromotion.test.ts` | 6 pass |

Linked cloud checks:

| Command | Result |
|---|---|
| `supabase migration list --linked` | Local and remote aligned through `20260608224048` |
| `supabase db push --linked --dry-run` | Remote database is up to date |
| `supabase functions list` | Relevant Video Date functions are ACTIVE |
| `npm run verify:video-date:functions -- --require-remote` | 42 pass, 0 warn, 0 fail |

Missing proof:
- No fresh disposable two-user production run through both users joining Daily and persisting `date_feedback`.
- No real Daily provider evidence matrix for web-web, web-native, native-web, native-native.
- No live duplicate-tab/device test with Daily `enforce_unique_user_ids`.
- No live token-expiry/rejoin, provider-late-webhook, native background, or permission-revocation run.
- No malicious client proof that joined spoofing fails under real provider/webhook timing.

## 18. Acceptance checklist

| Item | Status | Evidence |
|---|---|---|
| Same deterministic room for both participants | PASS for CODE/TEST/CLOUD, UNKNOWN for LIVE | Shared canonical helper, tests, linked DB aligned |
| Separate caller-scoped tokens | PASS for CODE/TEST | Token properties use caller `user_id` |
| Partner token inaccessible | PASS for CODE | No partner-token response/storage path found |
| Nonparticipant cannot mint token | PASS for CODE/TEST | Edge participant/auth checks |
| Web/native call objects only under date route | PASS for CODE/TEST | Web `VideoDate`/`useVideoCall`; native `/date/[id]` |
| Same-session call reused/waited/parked | PASS for CODE/TEST | Singleton/prewarm/owner contracts |
| Duplicate tabs/devices do not create false partner presence | UNKNOWN for LIVE | CODE/TEST guard exists, Daily behavior not run |
| Wrong-room metadata rejected/repaired | PASS for CODE/TEST | Prepare/refresh validations |
| Joined fires only after provider-backed local join | PASS for CODE/TEST | Web/native provider session id guards |
| Joined writes correct participant slot | PASS for CODE/TEST | Auth uid slot logic in RPC |
| Joined is idempotent in outcome | PASS for CODE/TEST | Fail-soft facade/heartbeat contracts |
| Joined cannot be spoofed for wrong room | PARTIAL | Normal path strong; webhook-lag bridge needs malicious/live proof |
| Both joined is not remote-seen | PASS for CODE/TEST | Separate fields/RPCs |
| Both joined does not set `date_started_at` directly | PASS for CODE/TEST | Separate promotion layer |
| Both joined feeds co-presence/remote-seen | PASS for CODE/TEST | Stable co-presence/provider overlap tests |
| Provider errors stay date-owned | PASS for CODE/TEST | Date route recovery and provider classifications |
| Reload/lost response/token expiry/background rejoin same room | PASS for CODE, UNKNOWN for LIVE | Recovery logic exists, no live run |
| Web-web/web-native/native-web/native-native LIVE proof | UNKNOWN | Not run |
| Support can diagnose stuck states | PARTIAL | Diagnostics exist; full dashboard/alert proof not found |
| Production health for this stage | UNKNOWN | Requires fresh real two-user Daily run |

## 19. Potential gaps / improvement areas

| Area | Classification | Detail |
|---|---|---|
| No fresh real Daily matrix | TEST GAP | The repo proves contracts, not real provider co-join across web/native pairs. |
| Joined spoof resistance under webhook lag | TEST GAP / SECURITY GAP | `mark_video_date_daily_alive` has a provider-lag bridge; remote-seen is stricter, but joined needs malicious/live proof. |
| Full eligibility changes after token issue | PRODUCT DECISION / SECURITY GAP | Prepare checks account/block/actionability; joined/remote-seen mostly enforce auth participant, terminal, routeable, provider proof. |
| Duplicate same-user device behavior | TEST GAP | Daily unique-user replacement/kick not live verified. |
| Native AppState behavior | TEST GAP | Code handles background/foreground, but physical OS behavior is unproven. |
| Token expiry/rejoin | TEST GAP | Code preserves room, but real Daily expiry/ejection path is unproven. |
| Observability dashboards | OBSERVABILITY GAP | Tables/events exist; full production dashboard/alert proof not found. |
| Remote-seen definition | PRODUCT DECISION | Client can trigger from provider participant/snapshot/track events; server requires provider/owner proof, not necessarily decoded visible pixels. |
| Legacy `create_date_room`/`join_date_room` actions | OK / AUDIT RISK | They remain in Edge code but current date route uses `prepare_date_entry`; audits must distinguish legacy from current. |
| Production config fallback | OK | Production fallback is blocked; local fallback requires explicit opt-in. |

## 20. Minimal fix plan

1. Add a runtime/migration contract that explicitly asserts joined stamps require either current Daily webhook `participant.joined` for the same provider session or a documented, bounded webhook-lag bridge. If the bridge is intentional, name it and add negative spoof tests.
2. Add mixed-client same-room tests that compare web and native request shapes, token refresh room mismatch, prewarm consumption, and duplicate owner behavior in one matrix.
3. Add or document operator dashboard queries for `prepare_without_join`, `one_joined_only`, `both_joined_no_remote_seen`, `wrong_room_domain`, duplicate-surface conflicts, and token/provider failures.
4. Run the required LIVE matrix: web-web, web-native, native-web, native-native, each through both joined, active co-presence, remote-seen, date promotion, survey, and `date_feedback`.
5. Decide whether `remote_seen` must mean first decoded/rendered media frame. If yes, move client RPC triggers later or add a first-frame-specific server proof.

## 21. Open questions

- Is the webhook-lag bridge for `mark_video_date_daily_alive` an intentional acceptance of client provider-session proof, or should joined evidence require a Daily webhook row before writing `participant_*_joined_at`?
- Should account/block/event eligibility be rechecked at joined/remote-seen time with the same strength as prepare-entry?
- Is a camera-off or audio-only Daily join allowed for the product, or must both local camera and microphone remain required through join?
- What is the intended user experience when the same user opens the same date on two physical devices and Daily enforces unique user ids?
- Where is the production support dashboard or alert definition for one-joined-only and both-joined-no-remote-seen, if it exists outside this repo?
- Until a fresh production two-user run is performed, production health for "Both join same Daily room" remains UNKNOWN, even though code, test, and linked cloud evidence are strong.
