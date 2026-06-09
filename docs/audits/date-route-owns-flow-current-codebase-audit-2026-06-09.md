# /date/:sessionId Owns the Flow Audit - Vibely Vibe Video Date Flow

Generated: 2026-06-09

Supersession note, 2026-06-09: the later Daily-room legacy action cleanup removes public `create_date_room` and `join_date_room` action support from the active Edge Function contract/dispatch. Current room/token entry remains `prepare_date_entry`; `enter_handshake` remains intentionally preserved.

Repo root: `/Users/kaanporsuk/Documents/Vibely/Git/vibelymeet`

Scope: current source, migrations, generated Supabase types, and read-only linked Supabase checks for the `/date/:sessionId owns the flow` stage. This is a documentation-only audit; no app/source behavior was changed.

Attachment coverage: questions 1-750 are answered by the 20 required sections below. Where the question asks for production health, the answer remains `UNKNOWN` unless a fresh two-user live run proves it.

Proof legend:

| Label | Meaning |
|---|---|
| CODE | Proven by current source or migration text. |
| TEST | Proven by a local test run or explicit contract test source. |
| CLOUD | Proven against linked Supabase project `schdyxcunwcvddlcshwd` by read-only CLI checks. |
| LIVE | Proven by a fresh disposable two-user runtime run through `date_feedback`. |
| UNKNOWN | Not proven in this audit. |

Read-only cloud evidence:

| Check | Result |
|---|---|
| `supabase migration list --linked` | Audit-time read-only evidence topped out at `20260608215911`; this row is historical to the PR #1259 audit snapshot and is superseded by later command-center/cloud alignment evidence, including `20260608224048` and the 2026-06-09 stable-media migration chain. |
| `supabase db push --linked --dry-run` | `Remote database is up to date.` |
| `supabase functions list` | `daily-room` active, version 861, updated `2026-06-08 13:49:31 UTC`; Video Date support functions active. |
| `npm run verify:video-date:functions -- --require-remote` | 42 pass, 0 warn, 0 fail. |

## 1. Current canonical behavior

`/date/:sessionId owns the flow` currently means: after server truth makes a non-ended `video_sessions` row date-route-owned, Ready Gate and lobby surfaces must yield to `/date/:sessionId` (web) or `/date/[id]` (native), and the date route owns Daily token acquisition, Daily join, joined evidence, remote-seen evidence, terminal survey hosting, and post-date feedback completion.

Canonical route authority is `shared/matching/videoDateRouteDecision.ts`, not the URL alone and not `shared/matching/videoDateEntryOwner.ts`. `videoDateEntryOwner.ts` is an in-memory latch/single-flight helper with active TTLs (`ENTRY_OWNER_ACTIVE_TTL_MS = 180000`, `DAILY_OWNER_ACTIVE_TTL_MS = 90000`); it does not define durable ownership and does not survive reload.

Current ownership answers:

| Truth | Owner | Answer |
|---|---|---|
| `ready_gate_status='both_ready'`, non-ended | `/date` owner | `videoDateRouteTruthDateOwnedAfterBothReady` returns true even when `state='ready_gate'`, `phase='ready_gate'`, and provider metadata is missing. CODE/TEST. |
| `state='handshake'` or `phase='handshake'` with provider room truth | `/date` owner | `canAttemptDailyRoomFromCanonicalVideoDateTruth` routes date. CODE/TEST. |
| `state='date'` or `phase='date'` | `/date` owner | Date route owns live date and reconnect. CODE. |
| `event_registrations.queue_status='in_survey'` without feedback | Survey owner inside `/date` | Survey truth outranks stale Ready Gate/date truth. CODE/TEST. |
| `ready`, `ready_a`, `ready_b`, `snoozed` | Ready Gate owner while actionable | `/ready`/overlay owner unless terminal, expired, or stale. CODE. |
| Queued/browsing/no active session | Lobby/deck/home owner | Not date-owned. CODE. |
| Ended without survey-required truth | Ended/lobby/home owner | `/date` may recover survey if encounter exposure exists; otherwise it leaves date. CODE. |

`both_ready` is date-owned before `prepare_date_entry`, after missing Daily metadata, and after retryable Daily/provider prepare failure. It is not guaranteed to remain date-owned after terminal/auth/safety failures such as `SESSION_ENDED`, `ACCESS_DENIED`, or `BLOCKED_PAIR`; those are not provider churn and can correctly end or redirect.

Legacy/compatibility code still exists: older `create_date_room`, `join_date_room`, and `enter_handshake` paths remain in `supabase/functions/daily-room/index.ts` and native API helpers, but the normal current token path is `prepare_date_entry`.

Production health verdict: CODE/TEST/CLOUD strong; LIVE remains UNKNOWN because no fresh disposable two-user production run through survey completion was performed.

## 2. Stage boundaries

Stage start:

| Boundary | Current condition |
|---|---|
| Normal start | Two participants reach `video_sessions.ready_gate_status='both_ready'` on a non-ended row. |
| Recovery start | Existing `handshake`/`date` truth, pending terminal survey truth, or server `next_surface` maps to date/survey. |
| Direct URL start | `/date/:sessionId` can recover if current user is a participant and shared truth is date-capable. |

Successful successor chain:

| Step | Server/client truth |
|---|---|
| Prepare entry | `daily-room` action `prepare_date_entry` calls `video_date_transition('prepare_entry')`, then service-only `confirm_video_date_entry_prepared`. |
| Durable handoff | `confirm_video_date_entry_prepared` writes `daily_room_name`, `daily_room_url`, `state='handshake'`, `phase='handshake'`, and registration `queue_status='in_handshake'` unless already date. |
| Daily joined | Web/native date runtime calls `mark_video_date_daily_joined` with owner/call/provider session evidence. |
| Remote seen | Web/native date runtime calls `mark_video_date_remote_seen` with current provider-bound joined evidence. |
| Date promotion | `video_date_promote_provider_overlap_v1` sets `state='date'`, `phase='date'`, `date_started_at`, registration `queue_status='in_date'`. |
| Terminal survey | Terminal survey truth opens `PostDateSurvey` on `/date/:sessionId`; Daily/reconnect churn is hard-stopped. |
| Real finish | `date_feedback` persists; only then should queue drain/next state proceed. |

Unsuccessful ends:

| Failure | Current behavior |
|---|---|
| Provider/Daily config/rate-limit/token/join retryable failure | Stays on date-owned failure/retry UI. CODE/TEST. |
| Missing/ended/nonparticipant/session invalid | Denied, ended recovery, survey recovery, or lobby/home fallback depending on truth. CODE. |
| Safety/account/event invalidation | `video_date_ready_gate_actionability_v1` and blocked-pair guards reject or terminalize; not all runtime invalidation cases are LIVE-proven. CODE/UNKNOWN. |

Must never happen after non-ended date ownership starts: automatic Ready Gate reclaim, automatic lobby/deck queue activation for the same participant, minting a partner/nonparticipant token, logging Daily tokens, or stamping joined/remote-seen from stale provider/self-view evidence.

## 3. Route-entry source inventory

| Source | Can route to `/date`? | Current path/function | Proof |
|---|---:|---|---|
| ReadyGateOverlay after both_ready | Yes | `src/components/lobby/ReadyGateOverlay.tsx`, `handleBothReady`, `navigateToDate` | CODE/TEST |
| `/ready/:id` reload/direct | Yes | `src/pages/ReadyRedirect.tsx`, `decideCanonicalVideoDateRoute`, `navigateToDate` | CODE/TEST |
| EventLobby | Yes | `src/pages/EventLobby.tsx`, `navigateToDateSession`, realtime canonical decision | CODE/TEST |
| Dashboard/active session | Yes, via active-session classification | `src/hooks/useActiveSession.ts`, `shared/matching/activeSession.ts` | CODE/TEST for helper; no live dashboard run |
| EventDetails | Recovery/entry only if it uses active session/deep link; no separate canonical owner found | Search did not identify it as primary authority | UNKNOWN |
| Notification click | Yes | `apps/mobile/components/NotificationDeepLinkHandler.tsx`, `send-notification`, date_starting/open_video_date payload | CODE/TEST |
| Native deep link/cold start | Yes for active session/date truth | `NativeSessionRouteHydration.tsx`, notification handler, native active session | CODE/TEST partially; native contract tests stale |
| Browser reload on `/date` | Yes if participant and truth date-capable/survey | `src/pages/VideoDate.tsx` route guard | CODE |
| Browser reload on `/ready` | Yes after both_ready | `ReadyRedirect.tsx` | CODE/TEST |
| Browser reload on lobby | Yes through EventLobby realtime/refetch active session | `EventLobby.tsx` | CODE/TEST |
| Manual `/date/:sessionId` | Yes if participant and date-capable/survey | `VideoDate.tsx`; nonparticipant denied | CODE |
| `/date` while ready_a/ready_b/queued/expired | Not date-owned | Route guard can redirect to Ready Gate/lobby/ended | CODE |
| `/date` while in_survey | Yes, survey hosted in date route | `PostDateSurvey` path | CODE/TEST |
| Nonparticipant | No | Web/native guards plus `prepare_date_entry` participant check | CODE |
| Blocked/reported pair | Should reject/terminalize, not proceed | Edge and SQL blocked-pair/actionability checks | CODE; LIVE malicious proof UNKNOWN |

Canonical entry source is shared route truth (`decideCanonicalVideoDateRoute`) plus backend-owned session state. ReadyGateOverlay, lobby, notification, and hydration are entry/recovery surfaces. The most bounce-prone source is native direct `/date` or stale `/ready` because native route guards still have explicit not-startable fallback branches and stale string-based tests currently fail.

## 4. Canonical route decision

File: `shared/matching/videoDateRouteDecision.ts`.

Inputs consumed by `decideCanonicalVideoDateRoute`:

| Input | Read? | Notes |
|---|---:|---|
| `video_sessions.ready_gate_status` | Yes | `both_ready` is date-owned even without provider metadata. |
| `state` / `phase` | Yes | Handshake/date/ended decisions; raw state alone does not override survey. |
| `daily_room_name` / `daily_room_url` | Yes | Required for `canAttemptDaily=true`; not required for date ownership at `both_ready`. |
| `daily_room_verified_at` | No | Not a route-decision input. |
| `prepare_entry_started_at` / `prepare_entry_expires_at` | No | Not a route-decision input. |
| `ready_gate_expires_at` | Yes | Used for active Ready Gate/date entry timing decisions. |
| `event_registrations.queue_status` | Yes | `in_survey` outranks stale truth. |
| `current_room_id` | Yes, through registration/session association | Helps identify active room/session. |
| `current_partner_id` | No direct route priority | Used elsewhere for registration convergence, not canonical route target. |
| `date_feedback` table | No direct read | Caller passes `userFeedbackSubmitted`; route helper uses that boolean. |
| Survey-required truth | Yes, indirectly | Via pending survey registration and terminal encounter exposure helpers. |

Priority order:

1. Pending survey registration without feedback.
2. Server `next_surface`.
3. Missing truth fallback to lobby/home.
4. Ended truth: survey if encounter exposure and no feedback; otherwise ended.
5. Date-capable Daily attempt (`handshake`/`date` with provider metadata).
6. Non-ended `both_ready` date owner, reason `both_ready_provider_prepare_pending`.
7. Active Ready Gate.
8. Stale `in_handshake`/`in_date` without routeable truth fallback.
9. Lobby/home default.

Disagreeing inputs are resolved by priority. Survey outranks both_ready; terminal-ended truth outranks both_ready; date ownership outranks Ready Gate for non-ended both_ready/date-capable truth. Daily room URL alone does not route date without routeable state/truth. Web and native import the same shared decision helpers, but some native tests look for stale string patterns and fail even though the code path now uses double-quoted RPC strings and current helpers.

## 5. Web /date implementation

Route and owner:

| Question group | Answer |
|---|---|
| Route mapping | `src/App.tsx` maps `<Route path="/date/:id" element={<ProtectedRoute><VideoDate />}>`. |
| Component | `src/pages/VideoDate.tsx`. |
| Auth | `ProtectedRoute` plus current user checks. |
| Participant validation | `VideoDate` fetches `video_sessions`; nonparticipant sets denied. |
| Session fetch | Direct select from `video_sessions` with participants, event, state, phase, Daily room, joined, remote-seen, and terminal fields. |
| Registration fetch | Used for queue/status recovery and logging; stale `in_ready_gate` is ignored if session truth is date-capable. |
| Partner profile | Fetched after participant guard via profile view helper. |
| Prepare entry | `useVideoCall.startCall` owns prepare/token acquisition; `VideoDate` itself wires the hook and route guard. |
| Route latch | Uses `markVideoDateRouteOwned`, `isVideoDateRouteOwned`, and route-entry pipeline markers. |
| PostDateSurvey | Rendered inside `VideoDate`; terminal survey truth hard-stops Daily and opens survey. |
| Realtime | Subscribes to `video_sessions`; listens for terminal/survey/promotion/remote/join truth. |
| Cleanup | Parks/reuses Daily singleton for same-session continuity; terminal survey destroys/stops Daily. |

First practical mount actions are: mark entry pipeline, emit route-enter telemetry, check auth/user/session id, recover terminal survey if needed, and fetch/validate session truth. The exact order is split across effects.

UI states:

| Condition | Web UI |
|---|---|
| Loading session | "Opening your date". |
| Prepare/token in progress | Date connecting state via `useVideoCall`; route remains `/date`. |
| Retryable prepare/Daily failure | "Still connecting your date", retry button, manual Back. |
| Nonretryable auth/access/block | Denied, lobby/events fallback, or safety-specific failure. |
| Nonparticipant | No access copy. |
| Terminal survey truth | `PostDateSurvey` opens immediately in `/date`. |

Web `/date` can redirect to Ready Gate/lobby only when shared truth is not date-owned or the user manually exits. It suppresses Ready Gate/lobby bounce when date route ownership is active.

## 6. Native /date implementation

Route and owner:

| Question group | Answer |
|---|---|
| Route mapping | `apps/mobile/app/date/[id].tsx`. |
| Component | Large native date screen in that file. |
| Shared route helpers | Uses `adviseVideoSessionTruthRecovery`, `fetchVideoSessionDateEntryTruthCoalesced`, and date route ownership latch helpers. |
| Prepare entry | Native token acquisition uses `apps/mobile/lib/videoDateApi.ts` `getDailyRoomToken`, which calls `prepareVideoDateEntry(sessionId, { source: 'native_video_date_token' })`. |
| Request body | Same as web: `{ action: "prepare_date_entry", sessionId, entry_attempt_id, video_date_trace_id }`. No `userId` in request body. |
| Participant guard | Fetches truth and uses `getVideoSessionPartnerIdForUser`; nonparticipant blocks. |
| Cold start/deep link | `NativeSessionRouteHydration.tsx` and `NotificationDeepLinkHandler.tsx` route date/survey truth to `/date/:id`. |
| Background/foreground | Uses `AppState.addEventListener("change", ...)`, background grace, reconnect sync, and permission-settings retry. |
| Native Daily | Uses `@daily-co/react-native-daily-js`, native call singleton/prewarm, guarded call object creation, `call.join`. |
| Survey | `openNativePostDateSurvey` and terminal recovery keep survey hosted on `/date`. |

Native has a date-owned failure UI: "Could not start your date" with Retry/Open Settings and Back to lobby. It also has explicit route-guard branches that redirect to Ready Gate/lobby when truth is truly not startable (`ready_a`, stale Ready Gate, missing date truth, ended-without-survey). For non-ended both_ready/date-capable truth, it marks date entry eligible and stays on date.

Native parity gaps:

| Gap | Classification |
|---|---|
| Native contract tests have stale regex expectations (`supabase.rpc('...')`, `case 'SESSION_ENDED'`, single-quoted AppState pattern) while current code uses different syntax/structure. | TEST GAP |
| Native physical cold start/background/foreground behavior was not run on devices here. | UNKNOWN |
| Native code is much larger and less centralized than web; audit confidence is CODE/TEST but not LIVE. | OBSERVABILITY GAP |

## 7. prepare_date_entry contract

Frontend callers:

| Platform | File/function |
|---|---|
| Web | `src/lib/videoDatePrepareEntry.ts` `prepareVideoDateEntry` |
| Native | `apps/mobile/lib/videoDatePrepareEntry.ts` `prepareVideoDateEntry`; `apps/mobile/lib/videoDateApi.ts` `getDailyRoomToken` |
| Shared cache/coalesce | `shared/matching/videoDatePrepareEntry.ts` |

Request body:

```json
{
  "action": "prepare_date_entry",
  "sessionId": "<video_sessions.id>",
  "entry_attempt_id": "<generated attempt id>",
  "video_date_trace_id": "<generated trace id>"
}
```

No `userId` is sent in the body. Platform is telemetry only in frontend events, not authoritative request input. The Edge Function derives the user from bearer auth via `supabase.auth.getUser()`.

Edge owner:

| Contract point | Current behavior |
|---|---|
| Function | `supabase/functions/daily-room/index.ts`, action `prepare_date_entry`. |
| Gateway config | `supabase/config.toml` has `[functions.daily-room] verify_jwt = true`. |
| Manual auth | Normal actions also require `Authorization`; no normal unauthenticated date action. |
| Actionability | Calls `video_date_ready_gate_actionability_v1` through `requireVideoDateReadyGateActionability`. |
| Participant | Verifies auth user is participant after transition payload. |
| Safety | Blocks `BLOCKED_PAIR`; actionability migration covers suspension, hidden/deleted/deactivated/age gates. |
| Event/registration | Actionability checks event activity and registration drift and may terminalize invalid Ready Gates. |
| Main RPC | Calls `video_date_transition(p_action='prepare_entry')`. |
| Durable confirmation | Calls service-only `confirm_video_date_entry_prepared`. |
| Provider | Ensures/recreates/reuses deterministic Daily room before token. |
| Token | Creates caller-scoped meeting token with `user_id=auth.uid()`, returns only to caller, never persists token. |

DB writes:

| Write source | Writes |
|---|---|
| `video_date_transition('prepare_entry')` | Validates actionability, returns enriched payload; prepares routeable entry through wrapped base. |
| `confirm_video_date_entry_prepared` | Writes `daily_room_name`, `daily_room_url`, `state='handshake'`, `phase='handshake'`, clears reconnect/away, updates both registrations to `in_handshake` or `in_date`. It does not set Daily joined or remote-seen fields. |
| Provider metadata repair | `ensureVideoDateProviderRoomForToken` and helper persistence write verification/expires/provider reason fields. |

Success response shape includes `success`, `room_name`, `room_url`, `token`, `token_expires_at`, `token_ttl_seconds`, `token_expiry_reason`, `session_state`, `session_phase`, `handshake_started_at`, `ready_gate_status`, `ready_gate_expires_at`, participant ids, `entry_attempt_id`, `video_date_trace_id`, provider reuse/recreate/recovered/skipped flags, Daily room verification fields, and timings.

Failure shape is structured JSON through `createDateRoomRejectResponse`: `success:false`, `code`, `error`, `message`/detail where allowed, `retryable`, retry-after fields, session context, entry/trace ids. Provider failures use `DAILY_PROVIDER_ERROR` or provider-specific rate/config codes and are retryable date-owned failures. Terminal/safety failures include `SESSION_ENDED`, `ACCESS_DENIED`, `BLOCKED_PAIR`, `EVENT_NOT_ACTIVE`, `READY_GATE_NOT_ACTIONABLE`, or related codes.

## 8. Daily call runtime

| Runtime area | Web | Native |
|---|---|---|
| Owner | `src/hooks/useVideoCall.ts` | `apps/mobile/app/date/[id].tsx` |
| Starts only under date route | `VideoDate` invokes hook; Ready Gate only prewarms | Native date screen owns call; Ready Gate only prewarms |
| Token source | `prepareVideoDateEntry` handoff/cache or direct call | Prepared handoff/cache or `getDailyRoomToken` |
| Call object | Daily JS call object with singleton parking/reuse | Native Daily call object with shared singleton/prewarm |
| Duplicate prevention | Same-session joining/joined call reused or waited on; duplicate tab conflict overlay | Shared call entry, guarded creation, prewarm reuse |
| Wrong room prevention | Prepared payload validation checks room URL/name and session/user cache key | Same room/session/user checks before singleton/prewarm reuse |
| Joined evidence | `markDailyJoinedWithBackoff` calls `mark_video_date_daily_joined` | Same pattern |
| Remote seen | provider-bound `mark_video_date_remote_seen` after current joined proof | Same pattern |
| Terminal cleanup | Hard-stops on terminal survey truth | Hard-stops and opens native survey |

Daily room/token facts:

| Question | Answer |
|---|---|
| Room name | `date-${sessionId-without-dashes}` from `videoDateRoomNameForSession`. |
| URL | `https://${DAILY_DOMAIN}/${room_name}`; fallback domain only allowed for explicit local/dev/test. |
| Private room | Yes. |
| Max participants | 2. |
| Screenshare/chat/recording/knocking | Disabled. |
| Unique user IDs | Enforced. |
| Room TTL | 14400 seconds. |
| Token TTL | Bounded by video-date token window; current contract aligns with room lifetime unless phase-bounded flags change. |
| Token persistence | Not persisted. |
| Partner token | Not returned. |
| Nonparticipant token | Rejected by Edge participant guard/actionability. |

Both users get the same room because the backend derives deterministic room name from the same session id. Tokens are different/caller-scoped because meeting token properties use `user_id=auth.uid()`. This is CODE/CLOUD for function deployment, not LIVE for two-user provider join.

## 9. User option matrix

| User action during date ownership | Current behavior |
|---|---|
| Wait during prepare | Date route connecting UI. |
| Retry prepare/Daily | Retry button on failure UI; bounded automatic retries for retryable failures. |
| Cancel/leave/back | Manual Back to lobby exists in failure/connection UI; this is user-initiated, not automatic reclaim. |
| Go back to Ready Gate | Not offered as normal option after date-owned truth; stale ready URLs should bounce date. |
| Refresh/reload | Re-fetches truth and restarts/reuses token/call pipeline if date-capable. |
| Close tab/app | In-memory latches/calls may be lost; server truth remains. |
| Background app | Native grace/reconnect handling; not LIVE-proven here. |
| Deny camera/mic | Permission failure UI with retry/open settings. |
| Mute/unmute/camera switch | Available after Daily/local media setup; native has camera flip controls. |
| Leave before join | Manual abort path can return lobby; server remains governed by lifecycle/reconnect/terminal logic. |
| Report/block | Safety sheet/path exists; backend safety invalidation checks are present but post-both-ready live path not proven. |
| Partner profile | Partner profile fetch/sheet exists. |
| Open another tab/device | Web has duplicate tab/surface conflict; native multi-device conflict not live-proven. |
| Receive another match | Queue drain is guarded; pending date/survey should block new Ready Gate promotion. |
| Ready Gate countdown | Date route owns after both_ready; Ready Gate countdown should not reclaim date-owned truth. |
| Daily warmup metadata | Handoff/prewarm metadata consumed or rejected by date route. |

Intentionally unavailable: automatic return to Ready Gate after both_ready provider failure, partner token access, direct DB mutation of lifecycle fields by clients, and completing the stage without `date_feedback`.

## 10. Realtime/reload/deep-link recovery

| Scenario | Answer |
|---|---|
| Realtime on `/date` | Subscribes to `video_sessions`; native also uses session channel/broadcast recovery. |
| `event_registrations` realtime | Used more heavily by lobby/active-session/hydration; date route fetches registration for guard decisions. |
| Daily/provider events | Indirect through Daily JS/native SDK and server `video_date_daily_webhook_events`. |
| Terminal survey truth | Web and native actively recover/open survey. |
| Partner-away/reconnect | Date route listens and syncs reconnect/away truth; Daily participant-left starts grace, not immediate final truth. |
| Missed both_ready event | Direct `/ready`, lobby, dashboard, and `/date` reload fetch shared truth. |
| Lost prepare response | Date route can re-call/coalesce `prepare_date_entry`; cache/handoff can be missed safely. |
| Expired token | Token refresh/recover paths exist; rate-limited/terminal errors are classified. |
| Already joined call | Same-session call reuse/parking. |
| Stale Ready Gate notification | Shared/native notification handlers recover date/survey truth before final route. |
| Stale lobby URL | EventLobby active-session/realtime path should navigate date for active video session. |
| Support stuck threshold | No single explicit threshold found for this exact stage; diagnostics expose stuck categories. OBSERVABILITY GAP. |

## 11. Provider failure matrix

| Failure | Route ownership | UI/behavior | Proof |
|---|---|---|---|
| Missing `DAILY_API_KEY`/invalid config | Date-owned retryable failure; Edge returns `DAILY_CONFIG_BLOCKED` 503 | Retry/failure UI, no Ready Gate rollback | CODE |
| Missing/invalid Daily domain in production | Blocked by `resolveDailyRuntimeConfig`; fallback blocked unless local/dev/test | Retry/failure UI | CODE |
| Daily room creation 429 | Provider rate limit classified retryable | Retry/backoff | CODE/TEST |
| Daily "already exists" | Treated as reusable success | Continue token/join | CODE |
| Token creation failure | Provider failure, no token persisted | Date-owned retryable failure | CODE |
| Daily JS/native call object failure | Date-owned failure UI; retry possible | No ready/lobby automatic reclaim | CODE |
| Join failure | Retry/recover token or show date-owned failure | Grace/retry paths | CODE |
| Network offline during prepare | Timeout/network classified retryable | Retry UI | CODE |
| Network offline after join | Daily/network/reconnect grace, not browser visibility authority | Reconnect UI/grace | CODE |
| Provider room deleted | Prepare verifies/recreates provider room | Repair before token | CODE |
| DB room metadata missing/wrong | Canonical room restored/repaired by prepare/promotion helpers | Same canonical room | CODE/TEST |
| Provider room wrong settings | Ensure/recreate path exists; exact settings audit is code-level | Private/max=2/chat/screenshare disabled | CODE |

Every provider failure should preserve server readiness and route ownership. Non-provider terminal/safety/auth failures are allowed to end or redirect.

## 12. Route-bounce/race matrix

| Race | Current mitigation | Status |
|---|---|---|
| ReadyGateOverlay still mounted after both_ready | Calls prepare, prewarms only, then `navigateToDate`; retryable/exhausted failures navigate date. | PASS CODE/TEST |
| ReadyRedirect rehosts Ready Gate after both_ready | Uses snapshot/canonical route decision to navigate date/survey. | PASS CODE/TEST |
| EventLobby queue/deck continues after date ownership | Active video session/date navigation state suppresses ready/deck paths; tests cover competing loops. | PASS CODE/TEST |
| Active-session classifier stricter than route decision | Recent helper allows direct fallback fresh for `navigate_date`; still a watch item. | PARTIAL |
| Browser Back to stale Ready Gate | `/ready` should recover to date; manual navigation remains possible but guard recovers. | PASS CODE/TEST |
| Manual lobby URL after both_ready | Lobby should recover/navigate date. | PASS CODE/TEST; LIVE UNKNOWN |
| Manual `/date` before both_ready | Correctly bounces to Ready Gate/lobby/denied. | PASS CODE |
| Two web tabs | Duplicate/surface conflict and singleton guards exist; no live two-tab proof here. | UNKNOWN |
| One tab leaves/deletes Daily room | `delete_room` is auth-required; video-date cleanup skipped/cron-owned. | PASS CODE |
| Latch lifetime | Shared entry owner 180s, Daily owner 90s; native route ownership latch is 10 minutes for user, 2 minutes anonymous. | CODE |
| Latch persistence | Not persisted across reload; server truth is durable. | PRODUCT DECISION |

## 13. Security/RLS/token audit

| Question | Current answer |
|---|---|
| Can nonparticipant open `/date/:sessionId`? | They can load the URL shell, but route guard denies meaningful access. |
| Can nonparticipant call `prepare_date_entry`? | No, Edge auth + participant guard/actionability reject. |
| Can nonparticipant mint/join Daily token? | No token from backend; Daily room is private and requires token. |
| Can participant mint partner token? | No; token user id comes from bearer auth user. |
| Can participant spoof `userId` in request body? | No `userId` body is accepted for prepare; server derives auth user. |
| Can participant spoof room name/url? | Prepare request does not accept room fields; server derives canonical room. |
| Can participant directly update lifecycle fields? | Client code does not; RLS malicious live proof not run. |
| Can joined/remote-seen be spoofed? | RPCs are callable by authenticated participants but require provider/current owner evidence; still LIVE malicious proof UNKNOWN. |
| Are lifecycle RPCs `SECURITY DEFINER`? | Yes for wrappers; they derive actor from `auth.uid()`. |
| Is `daily-room verify_jwt=false`? | No. Current config has `verify_jwt = true`. |
| Which daily-room actions are unauthenticated? | Normal actions require auth. `health_ping` is a diagnostic special case, not the date route token path. |
| Is `delete_room` unauthenticated? | No. Current code requires auth before `delete_room`; video-date room deletion is skipped/cron-owned. |
| Are logs token-safe? | Source logs and telemetry use token presence/timing, not token value; no token persistence found. |

RLS/security proof level: CODE strong, CLOUD function deployment present, live malicious RLS/token-mint proof UNKNOWN.

## 14. Web/native parity

| Capability | Web | Native | Parity |
|---|---|---|---|
| Shared route decision | Yes | Yes | PASS |
| both_ready date-owned without provider metadata | Yes | Yes via shared helper/hydration | PASS |
| Ready Gate handoff | Prepare/prewarm, no real join | Prepare/prewarm, no real join | PASS |
| Real Daily join owner | `/date` `useVideoCall` | `/date/[id]` screen | PASS |
| Prepare request body | Same | Same | PASS |
| Provider-bound joined/remote-seen | Yes | Yes | PASS |
| PostDateSurvey hosted in date route | Yes | Yes | PASS |
| Background/foreground | Browser lifecycle + unload handling | AppState grace/reconnect | PARTIAL |
| Failure UI | Retry/back | Retry/open settings/back | Similar but not identical |
| Test health | Key web/shared tests pass | Some native contract tests stale/fail | TEST GAP |
| Live device/browser proof | Not run | Not run | UNKNOWN |

Native has more route-guard branches and a larger runtime surface; that is the main parity risk.

## 15. Observability/support

Telemetry and diagnostics found:

| Signal | Present? | Examples |
|---|---:|---|
| `/date` route mount | Yes | `date_route_entered`, latency checkpoints, vdbg/Sentry breadcrumbs. |
| Route ownership claimed/suppressed bounce | Yes | `markVideoDateRouteOwned`, `route_bounce_suppressed_by_date_ownership`. |
| `prepare_date_entry` start/success/failure | Yes | `VIDEO_DATE_PREPARE_ENTRY_*`, `daily_token_*`, trace/attempt ids. |
| Token minted | Yes, without token value | `daily_token_success`, `token_created`, token timings. |
| Daily call object/join | Yes | `daily_call_*`, `VIDEO_DATE_DAILY_JOIN_*`. |
| Joined evidence | Yes | `mark_video_date_daily_joined_*`, owner state, provider session id. |
| Remote media/remote-seen | Yes | `VIDEO_DATE_REMOTE_SEEN`, remote frame/render diagnostics, RPC logs. |
| Date promotion | Yes | SQL `event_loop_observability_events`, provider-overlap promotion events. |
| Survey required/feedback | Yes | pending survey recovery, `date_feedback` guard, drain guard tests. |
| Stuck state support | Yes, service-role diagnostics | `video_date_both_ready_operator_diagnostics_v1`, `video_date_missing_feedback_operator_diagnostics_v1`, invariant SQL. |

Missing/weak observability:

| Area | Classification |
|---|---|
| Product/operator dashboard for stuck both_ready/prepare-without-join/join-without-remote-seen/survey-without-feedback | OBSERVABILITY GAP |
| Fresh support query threshold for "stuck" in this exact stage | OBSERVABILITY GAP |
| Native test assertions aligned to current implementation syntax | TEST GAP |
| Live event run evidence attached to telemetry | LIVE UNKNOWN |

## 16. Existing tests and missing tests

Focused tests run in this audit:

| Test command | Result |
|---|---|
| `npx tsx shared/matching/videoDateSprint1RouteDecisionContracts.test.ts` | PASS 11/11 |
| `npx tsx shared/matching/videoDateLatestFailureRouteLifecycleContracts.test.ts` | PASS 6/6 |
| `npx tsx shared/matching/bothReadyCanonicalDailyRoomDefinitiveOwner.test.ts` | PASS 8/8 |
| `npx tsx shared/matching/videoDateHandoffOwnershipContract.test.ts` | PASS 6/6 |
| `npx tsx shared/matching/videoDateFailsoftDateRoomRpcs.test.ts` | PASS 12/12 |
| `npx tsx shared/matching/videoDateProviderOverlapPromotion.test.ts` | PASS 6/6 |
| `npx tsx shared/matching/videoDateSurveyFeedbackDrainGuard.test.ts` | PASS 8/8 |
| `npx tsx shared/matching/videoDateStableCopresenceOwnerContracts.test.ts` | PASS 12/12 |
| `npx tsx shared/matching/videoDateTerminalSurveyLifecycleHardening.test.ts` | PASS 8/8 |
| `npx tsx shared/matching/videoDateDefinitiveHandoffRecovery.test.ts` | FAIL 1 stale native cleanup string assertion |
| `npx tsx shared/matching/nativeVideoDateContractRecovery.test.ts` | FAIL 3 stale native string assertions |

Existing test coverage:

| Area | Test files |
|---|---|
| Route decision/both_ready/no metadata | `videoDateSprint1RouteDecisionContracts.test.ts`, `bothReadyCanonicalDailyRoomDefinitiveOwner.test.ts` |
| Ready Gate handoff and no real join before date | `videoDateHandoffOwnershipContract.test.ts`, `videoDateStableCopresenceOwnerContracts.test.ts` |
| Prepare retry/fail-soft | `videoDateFailsoftDateRoomRpcs.test.ts`, `videoDatePrepareEntry.test.ts`, `videoDatePrepareEntryLease.test.ts` |
| Native date route | `nativeVideoDateContractRecovery.test.ts`, currently stale/failing on 3 assertions |
| Joined/remote-seen/provider proof | `videoDateStableCopresenceOwnerContracts.test.ts`, `videoDateProviderOverlapPromotion.test.ts` |
| Survey/date_feedback drain | `videoDateSurveyFeedbackDrainGuard.test.ts`, `videoDateTerminalSurveyLifecycleHardening.test.ts`, missing-feedback/certification tests |
| RLS/runtime | `videoDatePublicApiRlsRuntime.test.ts`, `videoDateRealtimeRlsRuntime.test.ts`, `videoDateLifecycleRpcPostgrestRuntime.test.ts` exist but were not run in this audit. |

Required missing-test matrix from attachment:

| Range | Status |
|---|---|
| 1-5 both_ready route ownership, no metadata, retryable prepare failure | Mostly covered by shared/static tests. |
| 6 non-retryable prepare failure remains date-owned | Not generally true for terminal/auth/safety failures. Product decision/test gap. |
| 7 stale registration no one-sided date | Partially covered by actionability/drain tests; live proof UNKNOWN. |
| 8-12 ready/lobby/dashboard/notification/native cold start route date | Covered by static contract tests; live proof UNKNOWN. |
| 13-18 manual direct URL/nonparticipant/reject early/terminal | Code/static coverage; runtime RLS malicious proof UNKNOWN. |
| 19-24 room repair/same room/tokens/idempotent prepare | Code/static coverage; two-user live proof UNKNOWN. |
| 25-28 provider config/API/token failures stay date-owned | Fail-soft code/tests; live provider failure UI UNKNOWN. |
| 29-32 one call object/reuse/tabs | Static tests for singleton/reuse; two-tab live proof UNKNOWN. |
| 33-39 background/hidden/missed realtime/stale URLs | Static/native code coverage; browser/native live proof UNKNOWN. |
| 40-44 joined/remote_seen/promotion/date_started | Code/static tests; live provider proof UNKNOWN. |
| 45-48 terminal survey/date_feedback/return | Code/static tests; fresh survey completion proof UNKNOWN. |
| 49-55 web-web/web-native/native-web/native-native/live malicious proof | UNKNOWN; requires live runs and malicious RLS/token tests. |

## 17. Acceptance checklist

| ID | Criterion | Status | Evidence |
|---:|---|---|---|
| 661 | `/date` owns immediately after both_ready | PASS | CODE/TEST |
| 662 | Owns despite `state='ready_gate'` | PASS | CODE/TEST |
| 663 | Owns despite `phase='ready_gate'` | PASS | CODE/TEST |
| 664 | Owns without provider metadata | PASS | CODE/TEST |
| 665 | Owns after retryable prepare failure | PASS | CODE/TEST |
| 666 | Owns after all nonretryable prepare failures | FAIL | Terminal/auth/safety failures can redirect/end by design. |
| 667 | Ready Gate never reopens after both_ready | PASS with scope | For non-ended date-owned truth. |
| 668 | Lobby/deck never auto-resumes after both_ready | PASS with scope | Manual Back exists. |
| 669 | Queue drain cannot activate another session | PASS | CODE/TEST drain guard |
| 670 | `/ready` redirects/recovers date | PASS | CODE/TEST |
| 671 | EventLobby redirects/recovers date | PASS | CODE/TEST |
| 672 | Dashboard/active-session routes date | PASS/UNKNOWN | CODE/TEST helper; no live dashboard proof |
| 673 | Notification/deep-link routes date | PASS/UNKNOWN | CODE/TEST; no live push proof |
| 674 | Web/native use same route decision | PASS | CODE |
| 675 | Date route validates participant | PASS | CODE |
| 676 | Nonparticipant cannot read/join | PASS/UNKNOWN | CODE; live malicious proof UNKNOWN |
| 677 | `prepare_date_entry` normal token path | PASS | CODE |
| 678 | `prepare_date_entry` idempotent | PASS | CODE/TEST |
| 679 | Repairs room metadata | PASS | CODE/TEST |
| 680 | Verifies provider room | PASS | CODE |
| 681 | Returns caller token only | PASS | CODE |
| 682 | Daily token not logged | PASS | CODE audit |
| 683 | Daily runtime starts only under `/date` | PASS | CODE/TEST |
| 684 | Creates/reuses one same-session call | PASS | CODE/TEST |
| 685 | Avoids same-session churn | PASS | CODE/TEST |
| 686 | Provider failure cannot roll back both_ready | PASS | CODE |
| 687 | Provider failure cannot bounce Ready/lobby | PASS with scope | Provider failures only, not terminal/safety. |
| 688 | Provider failure shows date-owned retry UX | PASS/UNKNOWN | CODE; no live provider failure UX proof |
| 689 | Both users get same room | PASS/UNKNOWN | CODE; no live two-user proof |
| 690 | Both users join same room | UNKNOWN | Requires fresh two-user run |
| 691 | Joined evidence written per participant | PASS/UNKNOWN | CODE; live proof UNKNOWN |
| 692 | Remote-seen evidence written correctly | PASS/UNKNOWN | CODE; live proof UNKNOWN |
| 693 | Both remote-seen promotes to date | PASS/UNKNOWN | CODE/TEST; live proof UNKNOWN |
| 694 | `date_started_at` not set before encounter proof | PASS | CODE/TEST |
| 695 | Terminal survey truth remains on `/date` | PASS/UNKNOWN | CODE/TEST; live proof UNKNOWN |
| 696 | `date_feedback` persists before finish | PASS/UNKNOWN | CODE/TEST; live proof UNKNOWN |
| 697 | Web-web live proof exists | UNKNOWN | Not run |
| 698 | Web-native live proof exists | UNKNOWN | Not run |
| 699 | Native-web live proof exists | UNKNOWN | Not run |
| 700 | Native-native live proof exists | UNKNOWN | Not run |
| 701 | Daily credentials/domain/function deployment proven | PARTIAL | Functions active and db aligned; secrets not directly readable; no live token mint |
| 702 | Live RLS malicious proof exists | UNKNOWN | Not run |
| 703 | Support can diagnose stuck states | PASS/PARTIAL | Service-role diagnostics exist; dashboard gap remains |
| 704 | Healthy only after fresh two-user run | PASS as rule | No healthy/fixed claim made |

## 18. Potential gaps / improvement areas

| ID | Item | Classification | Note |
|---:|---|---|---|
| 705 | SQL state/phase remain ready_gate at both_ready | PRODUCT DECISION | Canonical route helper owns bridge; prepare confirms handshake later. |
| 706 | Active-session classifiers stricter than route decision | OK/PARTIAL | Recent direct fallback covers date route; keep watching. |
| 707 | Overlay may wait for prepare before visible date navigation | PRODUCT DECISION | It now navigates on success or exhausted retryable failure; still can spend time in overlay. |
| 708 | Ownership depends on latches that do not survive reload | OK | Server truth, not latch, is authority. |
| 709 | Daily provider failure UX not live-proven | TEST GAP | Needs provider-failure runtime proof. |
| 710 | Daily function deployment/secrets not proven | PARTIAL | Deployment proven; secrets not directly visible; token live proof missing. |
| 711 | Fallback domain can hide misconfiguration | OK | Production fallback is blocked unless explicit local/dev/test. |
| 712 | Prepare failure can leave user visually outside `/date` | PRODUCT DECISION/PARTIAL | ReadyGate may show connecting before navigation; retryable exhaustion routes date. |
| 713 | EventLobby cleanup race | OK/PARTIAL | Tests cover active date route disabling competing loops; live unknown. |
| 714 | Queue polling race | OK/PARTIAL | Drain/date ownership guards present. |
| 715 | Duplicate call object | OK/PARTIAL | Singleton/guard code and tests present; two-tab live unknown. |
| 716 | Same-session call destroyed/rebuilt | OK/PARTIAL | Parking/reuse tests pass. |
| 717 | Two tabs/devices conflict | OBSERVABILITY GAP | Web conflict UI exists; native multi-device live unknown. |
| 718 | Browser Back reopens stale Ready Gate | OK/PARTIAL | `/ready` recovery present; live unknown. |
| 719 | Native back stack stale Ready Gate | TEST GAP | Code has hydration guard; native tests stale. |
| 720 | Notification payload stale URL | OK/PARTIAL | Click revalidates truth; live push unknown. |
| 721 | Account invalidation after both_ready incomplete | TEST GAP | Actionability/eligibility code exists; live invalidation proof missing. |
| 722 | Registration drift creates one-sided date | TEST GAP | Actionability/drain cover; live proof missing. |
| 723 | Joined can be spoofed | OK/PARTIAL | Provider-bound owner proof required; malicious live proof missing. |
| 724 | Remote-seen can be spoofed | OK/PARTIAL | Current provider session required; malicious live proof missing. |
| 725 | Room metadata mismatch lacks support panel | OBSERVABILITY GAP | Service diagnostics exist; panel not proven. |
| 726 | both_ready without prepare lacks alert | OBSERVABILITY GAP | Diagnostics exist; alert/dashboard not proven. |
| 727 | prepare without join lacks alert | OBSERVABILITY GAP | Diagnostics exist; alert/dashboard not proven. |
| 728 | join without remote-seen lacks alert | OBSERVABILITY GAP | Diagnostics exist; alert/dashboard not proven. |
| 729 | survey without feedback lacks alert | OBSERVABILITY GAP | Missing-feedback diagnostics/reminders exist; alert proof partial. |
| 730 | Live two-user proof missing | TEST GAP | Required before declaring healthy. |

## 19. Minimal fix plan

No code changes were made for this audit. If/when implementation is allowed, the minimal next plan is:

1. Refresh stale native contract tests so they assert behavior instead of brittle quote/case strings.
2. Add explicit runtime-style tests for non-ended `both_ready` plus stale registration, missing provider metadata, retryable provider failure, stale `/ready`, stale lobby, and native cold start.
3. Add an operator dashboard or scripted report for stuck `both_ready`, prepare-without-join, join-without-remote-seen, remote-seen-without-promotion, and in_survey-without-feedback.
4. Run required live proof in order: web-web, web-native, native-web, native-native as needed, with disposable users, same Daily room, joined evidence, remote-seen evidence, promotion to date, terminal survey, and both `date_feedback` rows.
5. Run malicious RLS/token checks against approved fixtures: nonparticipant read, nonparticipant prepare, wrong session, partner token spoof, joined/remote-seen spoof before provider proof.

## 20. Open questions

1. Does a fresh disposable two-user production run now complete from live event lobby through both `date_feedback` rows? UNKNOWN.
2. Are Daily production secrets currently valid enough to mint real tokens? Function deployment is proven, but secret values are not directly visible and no live token mint was run.
3. Do native physical devices preserve the date-owned flow across kill/background/foreground/push/deep-link? CODE says yes in many paths; LIVE remains UNKNOWN.
4. Are support dashboards wired to the service-only diagnostics, or only SQL/runbook diagnostics? Dashboard proof not found.
5. Should manual Back to lobby during date-owned failure be product-approved, or should date ownership hard-block all exit paths until terminal/survey truth? Current code allows manual exit.
6. Should the Ready Gate overlay navigate to `/date` immediately at `both_ready` before attempting prepare, or is current prepare-first-with-date-owned-fallback the intended UX?
7. Should acceptance item 666 be narrowed to provider failures only? Current code correctly treats terminal/auth/safety failures differently.
8. Should live certification require native-native before launch, or only web-web plus one web/native cross-platform pair?
