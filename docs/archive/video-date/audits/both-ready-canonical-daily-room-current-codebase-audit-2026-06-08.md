# both_ready + canonical Daily room Audit - Vibely Vibe Video Date Flow

Date: 2026-06-08

Scope: answers the attached `both_ready + canonical Daily room` interrogation pack from the current Vibely repo and linked Supabase migration state. This is a source/backend audit, not a fresh two-user production proof.

Read-only note: no app code was changed for this audit. The only intended output is this Markdown file. The repo already had local modifications in web/native Video Date files, tests, and `docs/video-date-success-command-center.md`; those dirty files were treated as current live source and were not reverted.

Post-audit implementation note: later on 2026-06-08, local source added the active-owner / terminal-truth patch recorded in `docs/branch-deltas/fix-video-date-active-owner-terminal-truth.md` and migration `20260608171837_video_date_active_owner_terminal_truth.sql`. That follow-up does not change this audit's evidence class: `both_ready` and canonical Daily room remain source/test/cloud mechanics, not product success proof. It does add a stricter operational rule for this audit's failure successors: once `/date/:sessionId` owns the session, web/native lobby queue, readiness, status, and drain side effects must stop; once survey truth exists, Daily/date/queue loops must hard-stop until `date_feedback` persists.

## 0. Evidence and proof classes

Primary evidence inspected:

- Operating docs: `docs/video-date-success-command-center.md`, `docs/active-doc-map.md`, `AGENTS.md`, `CODEX.md`, `CLAUDE.md`.
- Prompt: `/Users/kaanporsuk/.codex/attachments/3f3c9d1a-5285-443f-9021-e563409fcc0d/pasted-text.txt` with 1,251 lines.
- Current mark-ready/actionability SQL:
  - `supabase/migrations/20260608160809_video_date_ready_gate_partial_ready_definitive_closure.sql`
  - `supabase/migrations/20260606092944_video_date_decisive_mark_ready_commit.sql`
  - `supabase/migrations/20260607152000_video_session_created_definitive_contracts.sql`
- Current Daily room/token backend:
  - `supabase/functions/daily-room/index.ts`
  - `supabase/functions/daily-room/dailyRoomContracts.ts`
- Current route and client ownership:
  - `shared/matching/videoDateRouteDecision.ts`
  - `shared/matching/videoDateEntryOwner.ts`
  - `src/hooks/useReadyGate.ts`
  - `src/components/lobby/ReadyGateOverlay.tsx`
  - `src/pages/ReadyRedirect.tsx`
  - `src/pages/VideoDate.tsx`
  - `src/hooks/useVideoCall.ts`
  - `apps/mobile/components/lobby/ReadyGateOverlay.tsx`
  - `apps/mobile/app/ready/[id].tsx`
  - `apps/mobile/app/date/[id].tsx`
- Current provider join/remote-seen/promotion SQL:
  - `supabase/migrations/20260607194546_video_date_definitive_provider_overlap_promotion.sql`
  - `supabase/migrations/20260608080938_video_date_lifecycle_rpc_last_resort_failsoft.sql`
  - `supabase/migrations/20260608122623_video_date_remote_seen_lint_cleanup.sql`

Commands run in this audit:

- `npm run test:daily-room-contract` - passed 14/14.
- `npm run test:video-date:red-flags` - passed 56/56 across the listed red-flag contract files.
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked` - local and remote migrations aligned through `20260608160809`.
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run` - `Remote database is up to date.`

Proof classes used below:

- CODE: proven from current source/migrations/functions.
- TEST: covered by current static/contract tests, including tests run above.
- CLOUD: linked Supabase migration parity checked in this run.
- LIVE: requires a real disposable two-user production run through survey completion and persisted `date_feedback`. No such LIVE proof was produced in this audit.
- UNKNOWN: not proven from the current source/test/cloud checks.

## 1. Current canonical behavior

`both_ready + canonical Daily room` is a server-owned Ready Gate completion stage. It starts when the second successful public `video_session_mark_ready_v2(uuid, text, text)` call commits `video_sessions.ready_gate_status = 'both_ready'`, both participant ready timestamps are present, and deterministic Daily metadata is written or repairable.

The exact canonical room name is `date-${sessionIdWithoutDashes}`. `dailyRoomContracts.ts` defines it in `videoDateRoomNameForSession`, and SQL derives the same value with `'date-' || replace(v_session.id::text, '-', '')`.

This stage is not the live date. At mark-ready commit:

- `state` remains `ready_gate`.
- `phase` remains `ready_gate`.
- `handshake_started_at` is not set.
- `date_started_at` is not set.
- Daily token is not minted.
- Daily call is not joined.
- joined evidence is not written.
- remote-seen evidence is not written.

The practical owner after this point is `/date/:sessionId`, even while SQL still says `state='ready_gate'` and `phase='ready_gate'`. Shared route truth in `decideCanonicalVideoDateRoute` treats `ready_gate_status='both_ready'` as date-owned when the session is not ended, and the prepare-entry protection lease makes that routeability durable.

Current status: CODE, TEST, CLOUD for stage mechanics; no LIVE proof.

## 2. Stage boundaries

Starts:

- First ready tap sets `ready_a` or `ready_b` with the correct slot timestamp.
- Second ready tap sets `both_ready` only after both slot timestamps are present.
- Duplicate/replayed calls after commit return an idempotent already-terminal Ready Gate payload rather than creating a second transition.

Ends:

- Normal successor: `/date/:sessionId` calls `prepare_date_entry`, confirms route state, gets/repairs provider room, mints a caller-scoped token, and starts Daily.
- Provider-backed Daily joined/remote-seen evidence then promotes the session to `state='date'`, `phase='date'`, and `date_started_at`.
- Failure successor: `/date` remains owner and shows retry/failure/terminal truth. Ready Gate and lobby should not reclaim ownership merely because provider prepare failed.
- Survey successor: terminal survey truth keeps ownership on `/date/:sessionId` until `date_feedback` persists.

Must never happen during this stage:

- Ready Gate, lobby, or deck resumes ownership after `both_ready`.
- `both_ready` rolls back because Daily provider creation failed.
- Daily metadata is treated as live co-presence.
- `terminal: true` in mark-ready response is interpreted as date ended.
- A token is minted for the partner or before participant/auth/actionability checks.

## 3. Preconditions and predecessor states

Normal predecessor is `ready_a` or `ready_b`. Two simultaneous taps from `ready` serialize through row locks and command/idempotency rows: one transaction creates the partial-ready state, the other observes/commits `both_ready`.

Current public `video_session_mark_ready_v2` is wrapped by `video_date_ready_gate_actionability_v1` before delegating to the decisive base. That wrapper rejects or terminalizes invalid pre-date Ready Gate rows before the base can write readiness.

Predecessor matrix:

| Case | Current answer |
| --- | --- |
| From `ready_a` or `ready_b` | Yes, this is the normal path. |
| Directly from `ready` via simultaneous taps | Not as one logical state jump; concurrency serializes into first partial-ready, then `both_ready`. |
| From `queued` | No. Current actionability and tests reject queued for mark-ready. |
| From `snoozed` | Not through current public mark-ready, because actionability is called with actor-owned snooze disabled. Older/base code accepted broader statuses, but current public wrapper is authoritative. |
| From stale client status | Yes if server truth is still actionable; client belief does not own state. |
| Duplicate replay after commit | Returns idempotent/replay terminal Ready Gate payload, not a new commit. |
| Admin/service repair | Not a normal product path. Direct SQL/service repair can alter rows outside the user RPC contract; public mark-ready still uses `auth.uid()` participant checks. |
| `video_date_transition` | No for creating `both_ready`; its current role here is `prepare_entry` route protection. |
| Legacy `ready_gate_transition` | Compatibility/legacy, not the current canonical path for this stage. |

Inconsistent truth:

- New writes are protected by `video_sessions_ready_gate_timestamp_consistency` in `20260608160809`, but it is `NOT VALID`, so it does not prove every historical row.
- `video_date_ready_gate_actionability_v1` detects impossible partial/both-ready timestamp combinations and can terminalize invalid pre-date Ready Gate sessions.
- `video_date_partial_ready_diagnostics_v1` provides support diagnostics for partial-ready/impossible rows.
- If `event_registrations` drift away from `in_ready_gate` or lose reciprocal `current_room_id/current_partner_id`, actionability rejects/terminalizes current ready/prepare operations. Route decision still gives pending survey highest priority.

## 4. both_ready database contract

Current public wrapper:

- File: `supabase/migrations/20260608160809_video_date_ready_gate_partial_ready_definitive_closure.sql`
- Function: `public.video_session_mark_ready_v2(uuid, text, text)` at line 975.
- It calls `video_date_ready_gate_actionability_v1(..., p_terminalize_invalid=true, p_lock_rows=true)` before delegating to `vd_mark_ready_partial_base`.

Decisive commit base:

- File: `supabase/migrations/20260606092944_video_date_decisive_mark_ready_commit.sql`
- Function originally defines `public.video_session_mark_ready_v2`; current wrapper later renamed it to `vd_mark_ready_partial_base`.
- It uses `SECURITY DEFINER`, `auth.uid()`, command/idempotency rows, row lock on `video_sessions`, and fail-soft side effects.

Field-by-field answer for Q41-Q80:

| Field or behavior | Answer |
| --- | --- |
| Writes `ready_gate_status='both_ready'` | Decisive mark-ready base, reached through current public wrapper. |
| Row locks session | Yes, base selects `video_sessions` `FOR UPDATE`; current actionability can also lock. |
| Row locks registrations | Current actionability locks registration rows when `p_lock_rows=true`; base also updates registrations on terminal/expired paths. |
| Command/idempotency rows | Yes, `video_session_commands` are used for begin/replay/in-progress/retryable handling. |
| Advisory locks | No advisory lock was found in the current decisive mark-ready migration. |
| Requires both ready timestamps | Yes for new current writes; the `both_ready` status is computed only after both slot timestamps are non-null, and the new check constraint enforces the shape for new writes. |
| Sets participant timestamps atomically | Yes in the same `UPDATE public.video_sessions` that writes status. |
| Preserves first timestamp | Yes, it uses existing timestamp values and only fills the actor's missing slot. |
| Overwrites first timestamp | No in the normal decisive commit. |
| Sets `state` and `phase` | Yes, to `ready_gate`; it does not set handshake/date. |
| Sets `state_updated_at` | Yes. |
| Sets `ready_gate_expires_at` | Yes, to at least current value or `now + 45 seconds` in the decisive commit. |
| Extends after `both_ready` | Yes initially; later prepare protection can extend via `prepare_entry_expires_at`. |
| Sets `prepare_entry_*` | No at mark-ready; `video_date_protect_both_ready_entry_v1` and `video_date_transition('prepare_entry')` set the lease. |
| Sets `daily_room_name` | Yes on `both_ready`, deterministically. |
| Sets `daily_room_url` | Yes on `both_ready`, deterministically. |
| Sets `daily_room_verified_at` / `daily_room_expires_at` | No as provider proof in mark-ready; provider verification is later/async. |
| Sets provider reason | Yes as metadata/reason for the deterministic commit; provider verification/recreation writes stronger reasons later. |
| Sets `handshake_started_at` or `date_started_at` | No. |
| Sets joined or remote-seen timestamps | No. |
| Clears queue/snooze fields | It guards against queued and updates ready-gate state; terminalizer clears queue/snooze fields for invalid rows. |
| Updates registrations to `in_handshake` | No at mark-ready. They remain Ready Gate-linked until prepare/confirm. |
| Preserves `current_room_id/current_partner_id` | Yes in the normal mark-ready commit. |
| Appends `video_session_events` | Yes, fail-soft `ready_gate_mark_ready` / `ready_gate_both_ready`. |
| Enqueues Daily ensure | Yes, fail-soft via outbox topic `daily.ensure_video_date_room`. |
| Enqueues notifications | Current wrapper enqueues `partner_ready` on first-ready statuses; no direct both-ready/date-start push was found in mark-ready. |
| Decisive writes | status, ready timestamps, deterministic room metadata, expiry, state/phase, command result. |
| Fail-soft writes | event append, Daily ensure outbox, partner notification enqueue, auxiliary observability. |

## 5. Canonical Daily room contract

Canonical contract:

- Name: `date-${sessionIdWithoutDashes}`.
- URL: `https://${dailyDomain}/${roomName}`.
- Dashes are always removed. No lowercasing transform is needed for canonical UUID text because UUID output is lowercase.
- Defined in `supabase/functions/daily-room/dailyRoomContracts.ts` by `videoDateRoomNameForSession` and `videoDateRoomUrlForName`.
- SQL mark-ready derives the same format.
- TTL is `14_400` seconds; max participants is 2.

Room metadata behavior:

| Case | Answer |
| --- | --- |
| `daily_room_name` set but `daily_room_url` null | Not a complete provider-entry result. `prepare_date_entry`/provider ensure repairs or rejects/returns typed failure. |
| Provider room creation failed but deterministic DB metadata exists | `both_ready` still stands. Provider work is fail-soft relative to mark-ready. |
| Provider metadata missing but route decision says date-owned | `/date` still owns if `ready_gate_status='both_ready'` and not ended; prepare repairs/returns failure. |
| Noncanonical room name/url in row | `prepare_date_entry` recomputes/recanonicalizes through provider room proof and URL validation; shared parser rejects malformed success envelopes. |
| Wrong Daily domain | Production Daily config blocks missing/invalid domain for provider actions; URL validation is bound to expected domain. |
| Provider room exists but DB metadata absent | `prepare_date_entry`/ensure can recover and persist canonical metadata. |
| DB metadata exists but provider room deleted | Provider ensure can recreate the same deterministic room name. |
| Metadata from pre-both-ready warmup | It is not lifecycle truth. Mark-ready and prepare recompute/preserve only canonical values. |
| Daily URL exposed to user | No current user-facing display of the raw Daily room URL was found; it is backend/client transport metadata. |

Important nuance: SQL in `20260606092944` can derive a fallback domain (`vibelyapp.daily.co`) if config/existing metadata does not provide one. The Edge function production readiness blocks missing Daily config for provider actions. This audit verified migration parity, not actual deployed Daily secrets.

## 6. Mark-ready response shape

On successful `both_ready`, the decisive base returns a JSONB payload containing:

- `ok`, `success`
- `commandStatus`
- `commandId`
- `requestHash`
- `status`
- `ready_gate_status`
- `result_status`
- `result_ready_gate_status`
- `event_id`
- `participant_1_id`, `participant_2_id`
- `ready_participant_1_at`, `ready_participant_2_at`
- `ready_gate_expires_at`
- `snooze_*` fields where applicable
- `daily_room_name`
- `daily_room_url`
- `daily_room_verified_at`
- `daily_room_expires_at`
- `daily_room_provider_reason`
- `provider_outbox_degraded`
- `hot_path`
- `decisive_mark_ready_commit`
- `terminal`
- retry/degraded fields
- `server_now_ms`, `serverNowMs`

It does not include:

- Daily token.
- Partner token.
- A definitive `date_started_at`.
- Daily joined proof.
- Remote-seen proof.
- A first-class route target like `/date/:sessionId`.

`terminal: true` here means Ready Gate terminal, because `both_ready` ends Ready Gate readiness. It does not mean the Video Date ended. Current web/native code mostly keys on `status === 'both_ready'`, route decisions, and snapshot truth, not `terminal` alone. The attached ambiguity is valid: any future consumer that treats `terminal:true` as ended would be wrong.

Generated types include the RPC in `src/integrations/supabase/types.ts`, but the response is JSONB, so drift protection is mostly contract/static tests plus client defensive parsing rather than a strongly typed payload model.

If the response is lost after commit, clients recover through realtime/snapshot/polling/idempotent replay; `useReadyGate`, Ready Gate overlays, and `/ready` recovery paths observe `both_ready` from server truth and route to date.

## 7. Route ownership

Shared route authority:

- File: `shared/matching/videoDateRouteDecision.ts`.
- `videoDateRouteTruthDateOwnedAfterBothReady` returns true for non-ended rows with `ready_gate_status='both_ready'`.
- `decideCanonicalVideoDateRoute` gives pending survey first priority, then date-owned truth, then Ready Gate/lobby fallbacks.
- For `both_ready` without provider metadata, it returns date ownership with reason `both_ready_provider_prepare_pending`.
- For server next surface ready-gate plus both-ready truth, it returns date with reason `server_next_ready_gate_both_ready_date_owner`.

Route answers Q146-Q180:

| Situation | Route owner |
| --- | --- |
| `both_ready`, no provider metadata | `/date/:sessionId`. |
| `both_ready`, provider metadata present | `/date/:sessionId`. |
| `both_ready`, provider prepare failure | `/date/:sessionId` should remain owner and show retry/failure. |
| `both_ready`, expired `ready_gate_expires_at` | During active prepare lease, actionability allows it; otherwise actionability can terminalize. Shared route still sees both-ready date-owned unless ended/survey truth wins. |
| `both_ready`, stale registration state | Mark/prepare actionability rejects; route decision may still date-own from session truth. This is a risk area for runtime proof. |
| `both_ready`, `in_survey` | `/date/:sessionId` survey recovery wins. |
| Ready route after both-ready | Web `/ready/:id` and native `/ready/[id]` recover/navigate to date. |
| Event lobby after both-ready | Event lobby yields when active scoped session/route owner indicates Video Date. |
| Notification/cold start/reload | Push preload and native deep-link recovery use snapshot route decision, so both-ready should canonicalize to date/survey. |

Bounce prevention:

- `ReadyGateOverlay` calls `handleBothReady`, attempts `prepareVideoDateEntry`, then navigates to date.
- On retryable or non-retryable prepare failures with routeable truth, web and native still navigate date-owned (`both_ready_prepare_failed_date_owned`, `both_ready_prepare_exception_date_owned`, or equivalent native guarded navigation).
- `SessionRouteHydration` and native route hydration pin date ownership when canonical route says date/survey or a date-entry latch is active.
- `videoDateEntryOwner` keeps session-scoped entry ownership latches to prevent lobby/Ready/date churn.

Nuance/gap: some active-session classification paths are more conservative and require provider-room/date-state truth before reporting a video session as active. The shared canonical route decision and date-route latches mitigate this, but runtime reload/background/cold-start proof is still required.

## 8. prepare_date_entry contract

Frontend callers:

- Web overlay and `/date`: `src/lib/videoDatePrepareEntry.ts` and `src/hooks/useVideoCall.ts`.
- Native overlay and native date route: `apps/mobile/lib/videoDatePrepareEntry.ts` and `apps/mobile/app/date/[id].tsx`.

Request body:

```json
{
  "action": "prepare_date_entry",
  "sessionId": "<video_session_id>",
  "entry_attempt_id": "<client attempt id>",
  "video_date_trace_id": "<trace id>"
}
```

It does not send a user id, current route, or platform as authoritative identity. The Edge function derives the caller from bearer auth and requires the caller to be a participant.

Backend flow in `supabase/functions/daily-room/index.ts`:

1. Requires auth for all relevant Daily actions except health/cron paths.
2. Requires Daily config for `prepare_date_entry`.
3. Calls `video_date_ready_gate_actionability_v1` through RPC preflight paths.
4. Calls `video_date_transition('prepare_entry')`, now wrapped with both-ready route protection.
5. Calls `confirm_video_date_entry_prepared`.
6. Confirms/persists `state='handshake'`, `phase='handshake'`, Daily room metadata, and registration `queue_status='in_handshake'`.
7. Does not set `handshake_started_at` at prepare confirmation; that is intentionally deferred until provider-backed joined/copresence evidence.
8. Ensures/recreates/verifies the provider room.
9. Mints a caller-scoped Daily token.
10. Returns only the current caller's token.

Response shape includes:

- `success`
- `room_name`
- `room_url`
- `token`
- `token_expires_at`
- `token_ttl_seconds`
- token/provider reason
- `session_state`
- `phase`
- `handshake_started_at`
- `ready_gate_status`
- `ready_gate_expires_at`
- participant ids
- `entry_attempt_id`
- `video_date_trace_id`
- provider reuse/created/repaired flags
- `daily_room_verified_at`
- `daily_room_expires_at`
- timings

Failure classes:

- Auth/nonparticipant/block/report/hidden/event-inactive/state failures are business/auth failures and can be non-retryable or terminal depending on returned code.
- Provider failures are typed separately (`Daily auth failed`, rate limit, unavailable, request rejected, token failure, etc.) and may be retryable with retry-after metadata.
- Provider failure can block token issuance, but must not roll back `both_ready` or bounce the user back to Ready Gate/lobby.

## 9. ensure_date_room / prepare_solo_entry boundary

| Action | Current boundary |
| --- | --- |
| `ensure_date_room` | Room-only warmup. Authenticated participant. Eligible for `ready`, `ready_a`, `ready_b`, `both_ready` after actionability. Can create/verify/recover provider room and persist metadata. Does not mint token, join Daily, mark joined, mark remote-seen, or own route lifecycle. Failure does not affect `both_ready`. |
| `prepare_solo_entry` | Still present as an Edge action but server-disabled by `videoDateSoloPrejoinServerEnabled(): false`. Current clients should not rely on it. It cannot mark joined/remote-seen/date-started while disabled. |
| Direct malicious calls | Auth and actionability still apply; `prepare_solo_entry` returns disabled before it can mask state behind provider work. |

This satisfies the product direction that `prepare_date_entry` is the normal token-minting path. `prepare_solo_entry` remains a documented disabled surface, not removed.

## 10. Daily provider dependency map

Provider config:

- `DAILY_API_KEY` is required for provider room creation and token creation.
- `DAILY_DOMAIN` is required in production for correct URL/domain binding.
- Fallback domain is `vibelyapp.daily.co`, but `resolveDailyRuntimeConfig` only allows fallback in explicit local/dev/test posture. Production fallback is blocked by Daily runtime config tests.
- Daily room URLs are validated as HTTPS, exact expected domain, and exact room path.

Failure matrix Q261-Q290 and Q486-Q510:

| Failure | Current behavior |
| --- | --- |
| Daily API key missing | Provider actions blocked with typed config/provider failure. `both_ready` should remain committed. |
| Daily domain missing/wrong | Production config blocks or URL validation fails; prepare returns failure/retry state under date ownership. |
| Daily account/domain mismatch | Provider create/token calls fail; classified as provider failure. |
| Room create `already exists` | Treated as idempotent success/reuse. |
| Room create 429/outage | Retryable provider failure with retry/backoff metadata where available. |
| Room deleted after metadata | Provider ensure can recreate same deterministic room. |
| Token creation fails after room success | Room metadata may remain; prepare/token fails and date-owned retry UX should handle it. |
| Confirm prepared entry fails before token | Token should not be returned if confirm fails; provider work is after confirm in current `prepare_date_entry`. |
| Supabase RPC/Edge unavailable | Client retry/failure state; if mark-ready already committed, recovery uses snapshot/replay. |
| Realtime unavailable | Polling/snapshot/direct response recover. |
| OneSignal unavailable | Does not own readiness/date lifecycle. |
| Sentry/PostHog unavailable | Observability loss only, not lifecycle truth. |
| Camera/mic permission failure | Date route remains owner; Daily startup fails into local UX/failure handling. |
| Network offline before/after token | Date route retry/recovery; no readiness rollback. |
| Daily JS/call creation/join failure | Date-owned failure/retry; no immediate survey/date proof. |
| Remote participant never appears | Session may remain handshake/date-owned until timeout/reconnect/terminal logic; no remote-seen promotion. |

Provider failures are CODE/TEST for fail-soft classification. Live Daily provider behavior was not tested in this audit.

## 11. Web/native handoff behavior

Web:

- `useReadyGate` observes direct RPC, realtime, broadcast, polling/snapshot, and raw session truth.
- `ReadyGateOverlay` calls `handleBothReady` on `both_ready`, prepares entry, warms/preauths Daily client-side transport where applicable, and navigates to `/date/:sessionId`.
- Comment at `src/components/lobby/ReadyGateOverlay.tsx:1582` explicitly says real join and `mark_video_date_daily_joined` are owned by `/date`.
- `/ready/:id` uses canonical route recovery and navigates date when both-ready/date-owned truth is present.

Native:

- `apps/mobile/components/lobby/ReadyGateOverlay.tsx` mirrors the Ready Gate handoff and explicitly leaves real join / `mark_video_date_daily_joined` to the date route.
- `apps/mobile/app/ready/[id].tsx` performs standalone ready recovery and guarded navigation.
- `apps/mobile/app/date/[id].tsx` performs provider-bound joined and remote-seen calls with native Daily provider session IDs.

Important runtime gap: static parity tests passed, but no web-web, web-native, native-web, or native-native live smoke was run here.

## 12. User option matrix

| User/system event after `both_ready` | Expected current behavior |
| --- | --- |
| User waits in overlay | Overlay continues handoff/prepare or navigates date-owned failure state. |
| User refreshes browser | Snapshot/route decision should send to `/date` or survey. |
| User hits Back | Route hydration/date-entry latches should prevent Ready Gate/lobby from reclaiming if server truth is both-ready/date-owned. |
| User opens notification | Push preload/deep-link handler canonicalizes by snapshot to date/survey when both-ready. |
| App cold starts | Native deep-link/session hydration uses snapshot/canonical route to recover. |
| One user reaches date first | `/date` owns; Daily may wait/retry until partner joins or terminal logic applies. |
| Camera/mic permission fails | Date-owned local failure UX; no mark-ready rollback. |
| Provider prepare fails | Date-owned retry/failure UX; no Ready Gate/lobby bounce. |
| Survey truth appears | `/date` hard-stops Daily/reconnect/surface churn and opens survey. |

## 13. Realtime, broadcast, polling, recovery

Signals:

- Direct RPC result can short-circuit both-ready handling.
- Realtime video session updates can trigger both-ready.
- Broadcast events can trigger both-ready.
- Snapshot/polling/raw row recovery handles missed realtime or lost RPC responses.
- Idempotency replay handles lost mark-ready responses.

Conflict handling:

- Server truth wins over stale client status.
- Pending survey wins over both-ready/date route.
- Ended terminal truth wins over prepare retry unless survey-required truth says date/survey route.
- `ready_gate_status='both_ready'` is considered Ready Gate terminal but not Video Date ended.

Tests cover these mostly through static/contract expectations, not live dropped-realtime network behavior.

## 14. Notification and deep-link behavior

Initial mutual match notifications:

- `supabase/functions/swipe-actions/index.ts` enqueues `ready_gate` notifications with path `/ready/:sessionId`.

First-ready notification:

- Current `video_session_mark_ready_v2` wrapper enqueues `partner_ready` on `ready_a`/`ready_b` first-ready states.
- The payload includes session/event/status/actor/source data. I did not find an explicit URL/deep-link in that first-ready payload, so renderer/category mapping should be verified separately.

After both-ready:

- I did not find a direct both-ready/date-starting notification from mark-ready itself.
- `src/lib/videoDatePushPreload.ts` and `apps/mobile/components/NotificationDeepLinkHandler.tsx` canonicalize notification opens through snapshot route decision, mapping date/survey truth to `/date/:sessionId`.

Conclusion: notification click recovery is CODE-supported through snapshot canonicalization, but backgrounded already-ready push coverage and live notification click behavior remain not LIVE-proven.

## 15. Race and failure matrix

| Race | Current answer |
| --- | --- |
| Duplicate ready, same idempotency key | Command replay returns prior result. |
| Duplicate ready, different idempotency keys | Row lock/status/timestamp logic prevents duplicate status corruption; second sees committed truth. |
| User A duplicate taps while User B commits | Same command/row-lock protections apply. |
| Ready vs forfeit/snooze/expiry/event end | Actionability wrapper and base guards reject or terminalize invalid pre-date state before decisive ready commit. |
| Ready vs block/report | Actionability checks block/report before commit. |
| Daily warmup vs mark-ready | Daily metadata is not lifecycle truth; deterministic/canonical metadata is repaired/preserved by mark-ready/prepare. |
| Solo prejoin vs second ready | Current `prepare_solo_entry` is server-disabled. |
| Two `prepare_date_entry` callers | Entry ownership/inflight caches on clients plus backend idempotent route protection; both callers should get same room and caller-scoped tokens. |
| Prepare before both-ready visible | Actionability rejects partial-ready for `prepare_date_entry`. |
| Prepare vs forfeit/terminal | Actionability/transition wrappers should reject terminal or invalid sessions. |
| Token succeeds but later DB confirm fails | Current order confirms route state before provider room/token work, reducing this risk. |
| Outbox ensure after prepare already created room | Daily already-exists/reuse behavior is idempotent. |

Still UNKNOWN/live-unproven:

- True concurrent DB integration test with two users/two transactions.
- Real Daily 429/outage timing.
- Browser/native background and notification cold-start races.
- Runtime reload/back-button bounce under dirty provider state.

## 16. Safety and RLS audit

Current safety checks found:

- `video_date_ready_gate_actionability_v1` validates auth user is a participant.
- It rejects ended/terminal state, queued, stale/expired ready gate rows, event inactive rows, blocked pairs, user reports, hidden profiles, and registration mismatch when required.
- `daily-room` actions derive user from bearer auth, use service role only after business auth checks, and require participant ownership for token minting.
- `mark_video_date_remote_seen` is provider-bound and participant/auth checked.
- Generated Supabase types include current RPC signatures for mark-ready, actionability, prepare transition, joined, remote-seen, and both-ready protection.

Security answers Q511-Q535:

| Question class | Answer |
| --- | --- |
| Nonparticipant reads/prepares/ensures/mints | Should be blocked by auth/RLS/RPC participant checks. Live malicious tests were not run here. |
| Participant mints partner token | No normal path found; `prepare_date_entry` mints caller-scoped token only. |
| Participant calls prepare before both-ready | Rejected by actionability/transition. |
| Participant spoofs room/token/join/remote | Direct table mutation should be RLS-blocked; RPCs recompute room and provider-bound evidence. Live malicious proof not run. |
| `daily-room` JWT posture | Edge function performs manual bearer auth for relevant actions; health/cron exceptions are limited. Deployment posture was not separately inspected beyond source. |
| Suspended/paused/deleted/deactivated/age-gated | Open gap: actionability clearly checks block/report/hidden/event inactive, but I did not find explicit suspended/paused/deleted/deactivated/age-gated checks in the ready-gate actionability path. |

## 17. Observability and support

Telemetry/support surfaces found:

- `ready_gate_transition` observability on mark-ready transitions.
- `video_session_events` for `ready_gate_mark_ready` / `ready_gate_both_ready`.
- Client `vdbg`/analytics around both-ready observed, prepare entry start/failure/success, date route navigation, Daily join, remote-seen, terminal survey truth.
- Daily-room telemetry for provider ensure/create/reuse/failure and token timing.
- Provider overlap promotion events and `event_loop_observability_events`.
- Admin timeline surfaces reference launch latency and both-ready checkpoints.

Support queries:

- There are diagnostics helpers for partial-ready/impossible Ready Gate rows in `20260608160809`.
- I did not find a single named admin RPC specifically for every attached support query below. These can be reconstructed from tables.

Useful read-only query shapes:

```sql
-- both_ready older than X seconds with no prepare entry
select id, event_id, ready_gate_status, ready_gate_expires_at,
       prepare_entry_started_at, prepare_entry_expires_at,
       daily_room_name, daily_room_url, state, phase
from public.video_sessions
where ready_gate_status = 'both_ready'
  and ended_at is null
  and prepare_entry_started_at is null
  and state = 'ready_gate'
  and created_at < now() - interval '30 seconds';
```

```sql
-- prepare entry started but no joined evidence
select id, event_id, prepare_entry_started_at, prepare_entry_expires_at,
       participant_1_joined_at, participant_2_joined_at,
       state, phase, daily_room_name
from public.video_sessions
where prepare_entry_started_at is not null
  and ended_at is null
  and (participant_1_joined_at is null or participant_2_joined_at is null);
```

```sql
-- both users joined but remote seen missing
select id, event_id, participant_1_joined_at, participant_2_joined_at,
       participant_1_remote_seen_at, participant_2_remote_seen_at,
       state, phase
from public.video_sessions
where participant_1_joined_at is not null
  and participant_2_joined_at is not null
  and ended_at is null
  and (participant_1_remote_seen_at is null or participant_2_remote_seen_at is null);
```

```sql
-- Daily room metadata mismatch against deterministic room
select id, daily_room_name, daily_room_url,
       'date-' || replace(id::text, '-', '') as expected_room_name
from public.video_sessions
where daily_room_name is not null
  and daily_room_name is distinct from ('date-' || replace(id::text, '-', ''));
```

Missing observability:

- First-class dashboard/query for stuck both-ready without date entry.
- Live notification-click trace after both-ready.
- Live Daily provider proof linked to same-room proof and remote media.
- Live malicious/RLS proof artifacts.

## 18. Existing tests and missing tests

Tests located/relevant:

- `supabase/functions/daily-room/dailyRoomContracts.test.ts`
- `shared/matching/readyGateDecisiveMarkReadyCommit.test.ts`
- `shared/matching/readyGateMarkReadyActionabilitySafety.test.ts`
- `shared/matching/readyGatePartialReadyDefinitiveClosure.test.ts`
- `shared/matching/videoSessionCreatedDefinitiveContracts.test.ts`
- `shared/matching/videoDateSprint1RouteDecisionContracts.test.ts`
- `shared/matching/videoDateSprint2QueueReadyGateContracts.test.ts`
- `shared/matching/videoDateSprint3DailyHandoffContracts.test.ts`
- `shared/matching/videoDateProviderOverlapPromotion.test.ts`
- `shared/matching/videoDateFailsoftDateRoomRpcs.test.ts`
- `shared/matching/videoDateStableCopresenceOwnerContracts.test.ts`
- `shared/matching/nativeReadyGateParityContract.test.ts`
- `shared/matching/videoDateGoldenFlowCertificationContracts.test.ts`
- `shared/matching/videoDateSprint5PostDateSurveyContracts.test.ts`
- `shared/matching/videoDateSprint7SafetyPrivacyOpsContracts.test.ts`
- Full suite script: `npm run test:video-date-v4`.
- Runtime RLS scripts exist, but were not run in this audit: `npm run test:video-date-runtime-rls:required`.

Current run:

- `test:daily-room-contract`: passed 14/14.
- `test:video-date:red-flags`: passed 56/56.

Coverage classification for Q566-Q600:

- Deterministic room name/url, Daily room contracts, provider already-exists/recovery, private/two-person room props: TEST.
- Mark-ready actionability, decisive commit shape, partial-ready timestamp invariant, both-ready prepare failure date-owned behavior: TEST.
- Route decision both-ready without provider metadata and provider prepare pending: TEST.
- Prepare-entry fail-soft behavior and solo-prejoin disabled behavior: TEST.
- Native overlay and native `/ready` parity: TEST.
- Same Daily room across real users, real Daily credentials, remote media, web-native/native-native pairing, OneSignal notification click, live RLS malicious calls: not run in this audit, so not LIVE.

Required missing-test matrix Q23:

| Items | Status |
| --- | --- |
| 1-14 ready transitions, timestamps, canonical room, no token/join/remote/date, fail-soft ensure | Mostly CODE/TEST, but true concurrent DB integration remains missing. |
| 15-25 both-ready date ownership across web/native/overlay/ready/lobby | CODE/TEST static; live reload/cold-start/background missing. |
| 26-34 prepare-entry, token scoping, ensure warmup, solo prejoin disabled | CODE/TEST; two real callers same-room/different-token is contract-tested, not live. |
| 35-40 Daily API/provider failure UX | CODE/TEST for classification; real provider failures not live-tested. |
| 41-44 reload/cold-start/missed realtime/lost response | CODE/TEST only. |
| 45-48 web/native smoke matrix | Missing LIVE. |
| 49-53 same-room proof, remote media, date promotion, survey, `date_feedback` | Missing LIVE acceptance proof. |

## 19. Acceptance checklist

| Q range | Current result |
| --- | --- |
| 601-617 server-owned both-ready, slot correctness, timestamps, not queued/terminal/expired/nonparticipant/safety-invalid, canonical room, no token/join/remote/date start | CODE/TEST mostly satisfied for current paths. Historical rows remain constrained only by a `NOT VALID` check. |
| 618-623 immediate date ownership, no Ready/lobby/deck/queue reclaim | CODE/TEST partial. Shared route and overlays support this, but live bounce-proof is missing. |
| 624-631 prepare-entry token path, idempotency, repair, provider verify, caller token, reject partial-ready, ensure warmup, solo disabled | CODE/TEST satisfied. |
| 632-638 provider failure does not roll back/bounce, date-owned failure UX, web/native handoff, missed realtime/lost response/notification | CODE/TEST partial. Notification and live provider failure proof missing. |
| 639-645 same room, scoped tokens, join, remote media, promotion, survey, `date_feedback` | Same room/scoped tokens are CODE/TEST. Join/remote/promotion/survey/feedback require LIVE proof and were not proven here. |
| 646-650 live smoke/provider proof | Not met in this audit. |
| 651 live RLS malicious proof | Not met in this audit. |
| 652 support diagnosis | Partially met by telemetry and queryable tables; dashboard/packaged query gaps remain. |
| 653 production migration parity | CLOUD met for migrations: linked migration list aligned through `20260608160809`, and dry-run push said remote DB is up to date. Function deployment/secrets were not separately proven. |
| 654 declare healthy only after fresh two-user run | Not met. This audit must not be used to claim the path fully fixed/healthy. |

## 20. Potential gaps and improvement areas

1. No fresh disposable two-user production run through persisted `date_feedback` was produced.
2. `video_sessions_ready_gate_timestamp_consistency` is `NOT VALID`, so it protects new writes but does not prove historical data.
3. SQL `state/phase` remain `ready_gate` at `both_ready`; any consumer not using shared canonical route decision can misread ownership.
4. Some active-session classification paths are more conservative than shared route decision and may require provider/date truth before classifying active video state.
5. First-ready `partner_ready` notification payload lacks an explicit deep-link in the SQL payload inspected; category rendering needs verification.
6. No direct both-ready/date-starting notification from mark-ready was found.
7. Ready-gate actionability does not visibly cover every suspended/paused/deleted/deactivated/age-gated account state.
8. Daily fallback domain is safe in Edge production config tests, but SQL can still derive fallback metadata; deployed secrets/domain should be checked.
9. Provider failure UX is contract-tested but not live-tested against real Daily 429/outage/token failures.
10. Runtime reload/back/cold-start/notification recovery after both-ready remains unproven.
11. Live RLS/malicious token-mint proof is missing.
12. Support dashboards/packaged admin queries for stuck both-ready/date-entry gaps are incomplete.

## 21. Minimal fix plan

No fixes were applied. If this stage needs to be promoted from CODE/TEST/CLOUD to release confidence, the minimal plan is:

1. Run a fresh disposable two-user production test from live event mutual match through Ready Gate, same Daily room, remote media, date promotion, terminal survey, and persisted `date_feedback`.
2. Capture evidence IDs: `event_id`, `video_session_id`, both user IDs, Daily room name/session IDs, provider join/leave events, joined/remote-seen timestamps, `date_started_at`, terminal/survey row, and `date_feedback` rows.
3. Add DB integration tests for concurrent ready taps and simultaneous `prepare_date_entry` callers.
4. Add browser/native runtime smoke coverage for web-web, web-native, native-web, and native-native.
5. Verify notification category rendering for `partner_ready` and both-ready/cold-start paths.
6. Audit and, if needed, extend actionability for suspended/paused/deleted/deactivated/age-gated account states.
7. Package support queries/dashboard panels for stuck both-ready, prepare-without-join, join-without-remote-seen, and room metadata mismatch.
8. Verify deployed Daily secrets/domain and function deployment parity, not only DB migration parity.

## 22. Open questions

Highest-value ambiguities from the attached pack, resolved or still open:

| Ambiguity | Answer |
| --- | --- |
| `both_ready` requires both ready timestamps | Resolved: yes for current writes; historical data only partially protected because the check is `NOT VALID`. |
| `both_ready` writes canonical room name/url | Resolved: yes in decisive mark-ready commit. |
| Canonical room is `date-${sessionIdWithoutDashes}` | Resolved: yes. |
| Mark-ready does not mint token/join/mark joined/remote-seen/start date | Resolved: yes. |
| `/date/:sessionId` owns immediately after `both_ready` | Resolved in shared route/overlay code; live bounce-proof still open. |
| `/date` owns if provider metadata is missing | Resolved in shared route decision; prepare repairs/fails under date ownership. |
| `/date` owns if `prepare_date_entry` fails | Resolved in web/native contract tests for failure routes; live proof open. |
| Ready Gate/lobby never reclaim | CODE/TEST partial; live proof open. |
| `prepare_date_entry` is normal token path | Resolved. |
| `prepare_date_entry` idempotent for both users | CODE/TEST; true concurrent DB/live proof open. |
| Caller-scoped tokens only | Resolved from Edge/token contract tests; live proof open. |
| Both users receive same room | CODE/TEST; live proof open. |
| `ensure_date_room` warmup only | Resolved. |
| `prepare_solo_entry` status | Resolved: server-disabled, not removed. |
| Daily provider failure cannot roll back `both_ready` | Resolved for mark-ready commit. |
| Daily provider failure cannot bounce to lobby/Ready Gate | CODE/TEST partial; live UX proof open. |
| Missed realtime/lost response/reload/background/notification recover to `/date` | CODE/TEST partial; live proof open. |
| Safety/account invalidation cannot proceed to Daily | Partial; block/report/hidden/event inactive covered, other account states open. |
| Registration drift cannot create one-sided date entry | CODE/TEST partial through actionability; live drift/race proof open. |
| Live two-user proof for same room, remote media, promotion, survey, feedback | Open; not completed in this audit. |

Core invariant:

After `both_ready`, the app must treat `/date/:sessionId` as the owner, and Daily/provider failures must be handled as date-owned prepare/join failures. They must not roll back readiness, reopen Ready Gate, resume lobby/deck/queue, or claim the date is successful until same-room provider join, remote media, date promotion, terminal survey, and `date_feedback` have been proven in a fresh two-user production run.
