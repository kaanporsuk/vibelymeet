# Event Lobby Investigation Batch 4: Native Contract, Native Parity, Closure Integrity

Date: 2026-05-01
Branch: `audit/event-lobby-investigation-native-closure`
Supabase project ref: `schdyxcunwcvddlcshwd`

2026-06-09 supersession: this investigation predates Mystery Match removal. Historical references to `apps/mobile/lib/useMysteryMatch.ts` and `find_mystery_match` are no longer current; the native hook and backend RPC are removed.

## 1. Executive Verdict

Verdict: **PASS with runtime-proof warnings**.

Streams 8, 9, and 10 remain contractually correct and implementation-aligned on current `main`. The native Event Lobby contract documents backend ownership, safe payloads, swipe/Ready Gate/queue semantics, observability, privacy constraints, and implementation status. Native Event Lobby calls the canonical backend surfaces, avoids direct session/swipe writes, consumes the final deck payload, handles additive/idempotent outcomes, and keeps Ready Gate/date routing backend-truth gated.

No implementation defect was found in this investigation. No deploy, production data mutation, TestFlight/app-store rollout, native module addition, or `expo-av` use occurred.

Warning: closure-report Edge Function version/source evidence is correctly historical. Current `supabase functions list --project-ref schdyxcunwcvddlcshwd` shows `swipe-actions` active at version `498` updated `2026-05-01 16:47:39 UTC`, while the closure report records an earlier version `471` and source hash proof from that closure run. Current migration parity and dry-run proof remain reproducible in this batch.

## 2. Native Contract Completeness Matrix

| Contract area | Evidence | Verdict |
|---|---|---|
| Backend ownership | `docs/contracts/event-lobby-native-contract.md` assigns event/registration eligibility, deck filters, swipes, Super Vibes, session creation, queue promotion, Ready Gate transitions, video-date entry, and one-active-session protection to backend. | PASS |
| Entry eligibility and active-event invariant | Contract lists auth, route event id, event existence, backend active-state, confirmed registration, pause/safety gates, and canonical inactive reasons. | PASS |
| Deck RPC request/response | Contract documents `get_event_deck(p_event_id,p_user_id,p_limit)` and the safe card fields, including `primary_photo_path`, `photo_verified`, `premium_badge`, and `availability_state`. | PASS |
| Safe media and forbidden fields | Contract documents media fallback and forbids proof selfie paths, verification artifacts, moderation fields, report/block internals, phone/email PII, `photo_verified_at`, `premium_until`, and admin grant metadata. | PASS |
| Swipe request/response/outcomes | Contract documents `swipe-actions`, `outcome`/`result` compatibility, duplicate/idempotent markers, conflict/inactive outcomes, and Ready Gate routing rules. | PASS |
| Notification side effects | Contract states duplicate/no-op/inactive/blocked/reported/paused/unavailable/conflict outcomes are notification-suppressed and clients must not send their own swipe push. | PASS |
| Super Vibe policy | Contract documents 3 per user per event and backend authority for limit/retry/conflict outcomes without changing pricing semantics. | PASS |
| Ready Gate actions/states | Contract documents `ready_gate_transition`, `mark_ready`, `snooze`, `forfeit`, `sync`, queued/immediate recovery, stale link behavior, and `/date/[id]` backend truth gating. | PASS |
| Queue and one-active-session invariant | Contract documents `drain_match_queue`, promotion guard, busy-user states, participant locks/conflict checks, and no client-side session creation. | PASS |
| Realtime/polling/dedupe | Contract documents participant-scoped session discovery, own registration subscriptions, Ready Gate session listeners, polling recovery, and dedupe by `video_session_id`. | PASS |
| Observability | Contract names shared client and Edge taxonomy and forbids raw target/actor ids, moderation details, PII, and proof-media paths in analytics. | PASS |
| Native implementation checklist/status | Contract includes Prompt 9 checklist and implementation status with no schema/RPC/Edge/env changes. | PASS |

## 3. Native Implementation Parity Matrix

| Native behavior | Evidence | Verdict |
|---|---|---|
| Canonical surfaces | Current native uses `apps/mobile/lib/eventsApi.ts` for `get_event_deck`, `swipe-actions`, and `drain_match_queue`; `apps/mobile/lib/readyGateApi.ts` calls `ready_gate_transition`. Historical May 1 `apps/mobile/lib/useMysteryMatch.ts` / `find_mystery_match` path was removed on 2026-06-09. | PASS |
| No direct lobby session/swipe mutation | Audited native Event Lobby paths only read/count `video_sessions` and `event_swipes`; no `event_swipes` or `video_sessions` insert/update/upsert/delete was found in the audited lobby/Ready Gate/session paths. | PASS |
| Outcome normalization | `apps/mobile/app/event/[eventId]/lobby.tsx` normalizes `result`, `outcome`, and `error` before failure handling, telemetry, Ready Gate routing, and deck advancement. | PASS |
| `event_not_active` handling | Native maps deck-empty and swipe `event_not_active` to terminal lobby-closed state through `serverInactiveEventReason`. | PASS |
| Duplicate/no-op handling | Native handles `already_swiped`, `swipe_already_recorded`, duplicate/idempotent markers, and emits `LOBBY_SWIPE_DUPLICATE_SUPPRESSED` without opening Ready Gate or advancing like a fresh success. | PASS |
| Blocked/conflict/paused/registration outcomes | Native handling includes `blocked`, `reported`, `account_paused`, `target_unavailable`, `target_not_found`, `not_registered`, and `participant_has_active_session_conflict`. | PASS |
| Super Vibe backend authority | Native displays remaining count from backend data and treats `limit_reached` / `already_super_vibed_recently` as backend-authoritative outcomes. | PASS |
| Non-available candidates | `availability_state` defaults to `available`; non-available cards disable swipe controls and render unavailable/in-session copy. | PASS |
| Ready Gate dedupe | Native overlay and active-session recovery are keyed by `activeSessionId` / backend `video_session_id`; duplicate session opening is latched. | PASS |
| Final deck payload | Native card consumes `primary_photo_path`, `photo_verified`, `premium_badge`, and `availability_state`. | PASS |
| Media fallback and sizing | Native uses `resolvePrimaryProfilePhotoPath` and `deckCardUrl`; `deckCardUrl` uses the full-card `1080x1440` preset. | PASS |
| Observability | Native emits shared Event Lobby taxonomy for swipe, queue, Ready Gate, and deck states via `shared/observability/eventLobbyObservability.ts`. | PASS |
| Side-effect gates | Native gates deck fetch, queue refresh/drain, foreground/status effects, and swipe actions behind route/user/event/registration/live/pause/focus truth. Historical Mystery Match gating was removed with the feature. | PASS |

## 4. Native Module / Binary Constraint Check

| Check | Evidence | Verdict |
|---|---|---|
| No `expo-av` dependency | Precise package/import scan across `apps/mobile`, `src`, and package manifests returned no `expo-av` dependency/import/require. | PASS |
| No `react-native-draggable-flatlist` | Same scan returned no package or runtime use. | PASS |
| No new native modules in this audit | This branch is report-only; `apps/mobile/package.json` was read for command discovery and not modified. | PASS |
| Current binary constraints | Existing mobile dependencies include Daily/RevenueCat/OneSignal/native Expo modules already present on `main`; this investigation introduces no binary drift. | PASS |

## 5. Web / Native Drift Table

| Scenario | Web behavior | Native behavior | Classification |
|---|---|---|---|
| Missing/stale event | Web gate blocks deck and renders unavailable state. | Native gate blocks deck/status/side effects and renders terminal/unavailable state. | No drift |
| Scheduled/not started | Web treats as not-live and disables lobby effects. | Native local live-window gate blocks deck/swipe/queue and shows not-live copy. | Acceptable copy difference |
| Live confirmed event | Web enables deck/actions through gate. | Native enables deck/actions through matching route/user/registration/live gates. | No drift |
| Ended while mounted | Web lifecycle/gate closes stale Ready Gate and stops deck/actions. | Native maps ended/local inactive/backend `event_not_active` to closed state and stops side effects. | No drift |
| Cancelled/archived/draft | Web terminal gate. | Native terminal gate, including `archived_at` / `ended_at` handling from prior hardening. | No drift |
| Deck payload parsing | Web card reads safe payload fields and avoids per-card profile fetch for badges. | Native card reads the same safe payload fields. | No drift |
| Media fallback | Web uses shared primary-photo fallback and deck-card sizing. | Native uses shared primary-photo fallback and `deckCardUrl`. | No drift |
| Swipe outcomes | Web and native normalize backend/Edge outcome shapes and trust backend authority. | Native covers the same duplicate, conflict, inactive, unavailable, Super Vibe, and match outcomes. | No drift |
| Duplicate/no-op | Web emits duplicate suppression and does not treat retry as fresh advance. | Native emits duplicate suppression and suppresses fresh-success routing. | No drift |
| Ready Gate dedupe | Web latches by session id. | Native latches by session id / `activeSessionId`. | No drift |
| Queue promotion | Web relies on backend drain/realtime/polling. | Native relies on backend drain/realtime/polling with focus/live gates. | No drift |
| Observability | Web uses shared taxonomy. | Native uses shared taxonomy with platform-specific payload values. | Acceptable platform difference |

## 6. Closure Report Integrity Table

| Closure-report claim | Current evidence | Verdict |
|---|---|---|
| Original `EVT-LOBBY-*` findings preserved | `docs/audits/event-lobby-closure-report.md` contains `EVT-LOBBY-001` through `EVT-LOBBY-012`; `docs/audits/event-lobby-deck-deep-dive.md` is a tracked status pointer to the closure report. | PASS |
| Current source of truth | Closure report explicitly supersedes the old scratch deep dive and does not present stale pre-hardening notes as current truth. | PASS |
| Latest local/remote migration | Startup and validation dry-runs confirmed local/remote parity through `20260501230000_event_lobby_deck_payload_media.sql`; `supabase db push --linked --dry-run` reports remote DB up to date. | PASS |
| Remote Supabase verification | Migration parity remains reproducible. Remote function source/hash proof in the closure report is a dated historical artifact from that run. Current function list shows a later redeployed `swipe-actions` version, so the old version number should not be read as current live version. | WARN |
| Runtime staging smoke | Closure report marks two-user/three-user smoke as **blocked, not passed**. | PASS |
| Super Vibe monetization | Closure report marks Super Vibe monetization/product work as partially closed and non-blocking, not a completed redesign. | PASS |
| Provider/device proof | Closure report does not claim provider delivery or physical-device proof that was not run. | PASS |
| PR/commit/migration evidence | The report contains Prompt 1-9 PR/commit/migration evidence; later audit/closure commits extend the lineage but do not invalidate the closure evidence. | PASS |

## 7. Validation Results

| Command | Result |
|---|---|
| `git status --short` | Clean before report creation. |
| `supabase migration list --linked` | Local/remote parity through `20260501230000`; canonical project linked. |
| `supabase db push --linked --dry-run` | PASS: `Remote database is up to date.` |
| `supabase functions list --project-ref schdyxcunwcvddlcshwd` | PASS read-only; `swipe-actions` active at version `498`. |
| Precise `expo-av` / `react-native-draggable-flatlist` scan | PASS: no dependency/import/require/package matches in runtime/package scope. |
| `npx tsx shared/matching/nativeEventLobbyContractParity.test.ts` | PASS: 5 tests. |
| `npx tsx shared/observability/eventLobbyObservability.test.ts` | PASS: 6 tests. |
| `npm run test:event-lobby-regression` | PASS; harness includes active-event, idempotency, gating, queue, payload/media, native parity, observability, and `videoSessionFlow` checks. |
| `npm run test:hardening-contracts` | PASS; includes Event Lobby, Ready Gate, realtime, payments/provider carry-forward, native video-date, and video date end-to-end hardening checks. |
| `npm run typecheck` | PASS; includes root/core and mobile typecheck. |
| `npm run lint` | PASS with existing warning backlog: 208 warnings, 0 errors. |
| `npm run build` | PASS with existing Vite dynamic-import/chunk-size warnings. |
| `cd apps/mobile && npm run typecheck` | PASS; `expo-crypto` guard passed and TypeScript completed. |
| `git diff --check` | PASS before report creation. |

## 8. Remaining Runtime Proof Gaps

- No production data was mutated.
- No Supabase migration or Edge Function was deployed.
- No TestFlight/app-store rollout was attempted.
- No physical-device native runtime session was run in this batch.
- No live provider delivery, realtime timing, or staging two-user/three-user smoke was executed because no approved safe fixtures were provided and production mutation is forbidden.
- Closure report source/hash proof for `swipe-actions` is historical; current live source hash was not re-downloaded in this batch to avoid local artifact churn.

## 9. Follow-Up Bugfix Prompts

No bugfix prompt is required from this investigation.

Optional non-bugfix follow-up:

```text
Run the Event Lobby golden-path staging smoke from docs/golden-path-event-lobby-regression-runbook.md using approved non-production fixtures only. Record two-user immediate match, three-user queued promotion, stale-link recovery, ended-event recovery, Ready Gate dedupe, and native physical-device results without mutating production data.
```

## No-Production-Mutation Statement

This investigation used local source inspection, static tests, build/typecheck/lint commands, Supabase migration listing, Supabase function listing, and Supabase dry-run checks only. It did not deploy, push migrations, invoke provider actions, mutate production data, add native modules, or import/require `expo-av`.
