# Event Lobby Investigation Synthesis

Date: 2026-05-01

Branch: `audit/event-lobby-investigation-synthesis`

Supabase project ref: `schdyxcunwcvddlcshwd / MVP_Vibe`

## 1. Executive Verdict

**Overall verdict: engineering/source closure is green; runtime smoke remains blocked.**

The original Event Lobby engineering claims still hold for repo source, SQL contracts, web/native contract alignment, and deployed Supabase migration/catalog parity. The five investigation batches found the backend active-event contract, swipe idempotency, notification dedupe, web/native gating, Ready Gate/queue invariants, deck payload/media safety, observability taxonomy, regression harness, and native contract implementation in place.

There was one implementation drift found in Batch 3: legacy web analytics emitted raw target profile IDs. That was closed by `fix/event-lobby-investigation-batch-3-payload-observability-tests-closure` with `target_present: true` replacing raw identifiers. Current source now reflects that fix.

Runtime smoke is **blocked, not proven**. No `docs/audits/event-lobby-runtime-smoke-proof.md` or `docs/audits/native-event-lobby-device-smoke.md` exists. `docs/audits/event-lobby-runtime-smoke-fixture-readiness.md` explicitly records that approved fixture metadata, environment classification, cleanup/reset boundaries, and native runtime target approval are missing. Therefore, web runtime, native device/simulator, provider delivery, Daily room handoff, and live media/CDN proof must not be collapsed into "done."

Exact next stream: **create/approve safe Event Lobby runtime fixtures, then run the runtime/native smoke proof stream.** No new implementation bugfix prompt is required from the current synthesis.

## 2. Batch Report Status Table

| Artifact | Present | Verdict | Synthesis status | Impact |
| --- | --- | --- | --- | --- |
| `docs/audits/event-lobby-closure-report.md` | Yes | Code/cloud contract closure ready; runtime smoke blocked | Source of original `EVT-LOBBY-*` finding statuses | Use as original baseline, not runtime proof. |
| `docs/audits/event-lobby-investigation-batch-1-backend-contracts.md` | Yes | PASS | Streams 0-2 still true | Backend active-event, idempotency, dedupe, and remote SQL/source evidence remain supported. |
| `docs/audits/event-lobby-investigation-batch-2-gating-queue-lifecycle.md` | Yes | PASS with WARNs | Streams 3/3b/4 still true | Web/native gating and server-owned busy/queue contracts remain aligned; surface inventory/lint warnings are not implementation blockers. |
| `docs/audits/event-lobby-investigation-batch-3-payload-observability-tests.md` | Yes | PARTIAL | Stream 5 and 7 pass; Stream 6 had one web analytics drift | The raw identifier analytics drift was fixed in closure PR #670; deployed Edge source hash proof remains a process limitation. |
| `docs/audits/event-lobby-investigation-batch-4-native-closure.md` | Yes | PASS with runtime-proof warnings | Streams 8-10 remain contractually aligned | Native source/contract parity is green; physical-device/runtime proof remains deferred. |
| `docs/audits/event-lobby-runtime-smoke-proof.md` | No | Missing | Runtime web smoke not proven | Missing proof means no end-to-end web runtime pass can be claimed. |
| `docs/audits/native-event-lobby-device-smoke.md` | No | Missing | Native device smoke not proven | Missing proof means no physical-device/native runtime pass can be claimed. |
| `docs/audits/event-lobby-runtime-smoke-fixture-readiness.md` | Yes | BLOCKED | Fixture-readiness report exists | It defines the missing metadata and cleanup plan required before runtime smoke. |

## 3. Original EVT-LOBBY Finding Table

| ID | Original status from closure report | Latest investigation status | Evidence doc | Remaining gap |
| --- | --- | --- | --- | --- |
| `EVT-LOBBY-001` Backend active-event enforcement | Closed | PASS | Batch 1; Batch 2; closure report | Runtime direct-call smoke still awaits approved fixtures, but backend contract proof is green. |
| `EVT-LOBBY-002` Web missing-event dead-end | Closed | PASS | Batch 2; `webEventLobbyGating.test.ts` via harness | Browser runtime smoke with fixture links is blocked. |
| `EVT-LOBBY-003` Ended-event stale lobby/stale swipes | Closed | PASS | Batch 1; Batch 2; Batch 4 | Live mounted-ended event scenario is blocked by missing fixtures. |
| `EVT-LOBBY-004` Busy/in-session candidates swipeable | Closed | PASS | Batch 2; Ready Gate/queue contract tests | Live busy-candidate conflict smoke is blocked by missing fixtures. |
| `EVT-LOBBY-005` Swipe retry/idempotency notification duplicate | Closed | PASS | Batch 1; `swipeRetryIdempotencyNotificationDedupe.test.ts` | Real notification/provider delivery proof remains unproven. |
| `EVT-LOBBY-006` Web image fallback | Closed | PASS | Batch 3; deck payload/media tests | Live CDN/media runtime proof remains blocked. |
| `EVT-LOBBY-007` Thumbnail-sized full-card media | Closed | PASS | Batch 3; native parity evidence | Live rendered media proof remains blocked. |
| `EVT-LOBBY-008` Empty-state copy/polling mismatch | Closed for launch | PASS for source/contract | Batch 2; Batch 3 regression harness | Live empty-deck diagnostics smoke remains blocked. |
| `EVT-LOBBY-009` Per-card profile fetches | Closed | PASS | Batch 3 | No remaining code gap identified. |
| `EVT-LOBBY-010` Super Vibe monetization/product contract | Partially closed, non-blocking | PASS for safety; product polish remains non-blocking | Batch 1; closure report | Monetization/product redesign remains outside Event Lobby safety closure. |
| `EVT-LOBBY-011` Observability gap | Closed | PASS after closure fix | Batch 3 plus `fix-event-lobby-investigation-batch-3-payload-observability-tests-closure.md` | Provider/runtime observability proof requires fixtures. |
| `EVT-LOBBY-012` Production migration state unknown | Closed | PASS | Closure report; Batches 1-5 dry-run/migration parity | No migration gap; current dry-run still reports remote DB up to date. |

## 4. Backend Contract Verdict

| Area | Verdict | Evidence | Caveat |
| --- | --- | --- | --- |
| Active-event | PASS | Batch 1 verified `get_event_lobby_active_state`, wrappers, reason taxonomy, safe grants, and active guards locally/remotely. | Live direct-call runtime smoke remains blocked. |
| Idempotency | PASS | Batch 1 verified first-time, duplicate, already-matched, already-swiped, and conflict outcomes; regression harness remains green. | No production data-mutating duplicate replay was run. |
| Notification dedupe | PASS | Batch 1 verified duplicate/no-op/inactive/conflict notification suppression and `swipe-actions` source parity at that time. | Provider delivery is not proven. |
| Queue/Ready Gate | PASS | Batch 2 verified deployed queue/busy/participant-lock/conflict markers and public guarded promotion path. | Live three-user queue promotion smoke is blocked. |
| Deployed parity | PASS for SQL/migration/catalog; WARN for latest Edge source hash process | Batches 1-4 and current startup confirmed canonical ref and migration parity through `20260501230000`; current dry-run says remote DB up to date. | Later reports note exact deployed `swipe-actions` source hash was historical/not freshly re-downloaded in every batch. No current implementation defect is identified. |

## 5. Web Verdict

| Area | Verdict | Evidence | Runtime status |
| --- | --- | --- | --- |
| Gating | PASS | Batch 2 verified missing/stale event, signed-out, unregistered, waitlisted, scheduled, live, ended, cancelled, archived, draft, and paused handling. | Runtime browser smoke blocked. |
| Media | PASS | Batch 3 verified safe deck payload, forbidden-field exclusion, fallback order, full-card `deckCardUrl`, and no per-card fetch for badge/verification. | Live CDN/media rendering blocked. |
| Observability | PASS after closure | Batch 3 found raw `profile_id` analytics drift; closure #670 replaced raw identifiers with `target_present: true`; current `EventLobby.tsx` reflects the fix. | Runtime observability rows/logs blocked by missing fixtures. |
| Runtime proof | BLOCKED | Runtime fixture-readiness report says approved fixture metadata is missing. | No web runtime pass claim is allowed. |

## 6. Native Verdict

| Area | Verdict | Evidence | Runtime status |
| --- | --- | --- | --- |
| Contract | PASS | Batch 4 verified `docs/contracts/event-lobby-native-contract.md` covers backend ownership, entry eligibility, deck payload, swipes, duplicates, notifications, Super Vibe, Ready Gate, queue, media, realtime, observability, and security/privacy. | Contract proof only. |
| Implementation | PASS | Batch 4 verified native calls canonical surfaces, avoids direct session/swipe mutation, handles inactive/duplicate/conflict outcomes, uses final deck payload fields, emits shared taxonomy, and gates side effects. | Source/static proof only. |
| Device proof | BLOCKED | `native-event-lobby-device-smoke.md` is missing; fixture-readiness report says native runtime target approval is missing. | No physical-device or simulator pass claim is allowed. |

## 7. Runtime And Providership Verdict

| Provider/path | Verdict | Evidence | Remaining proof |
| --- | --- | --- | --- |
| OneSignal / notification delivery | BLOCKED for runtime provider proof | Source paths and suppression semantics are covered by earlier provider and Event Lobby tests; runtime fixture report lists OneSignal touchpoint as blocked. | Approved fixture flow and provider-safe observation needed. |
| Daily / date handoff | BLOCKED for runtime provider proof | Backend and native/web date-entry contracts are covered by hardening tests; runtime fixture report did not invoke Ready Gate/date-entry provider path. | Approved fixture Ready Gate/date handoff needed. |
| Media/CDN | BLOCKED for runtime provider proof | Source and tests prove deck media path/fallback; runtime report did not load fixture deck media. | Approved fixture users/events with public test media needed. |
| Fixture availability | BLOCKER | `event-lobby-runtime-smoke-fixture-readiness.md` lists absent `EVENT_LOBBY_REGRESSION_*` metadata, User A/B/C fixtures, event fixtures, and cleanup plan. | Fixture creation/approval stream required before runtime smoke. |

Runtime classification: **blocked, not partially proven** for live user-flow smoke. Source/static harness proof is strong, but it is not runtime smoke.

## 8. Risk Register

| Risk | Class | Status | Owner/next move |
| --- | --- | --- | --- |
| Missing approved runtime fixtures and cleanup/reset plan | Launch blocker | Open | Run fixture creation/approval stream. |
| Missing native device/simulator smoke report | Release candidate blocker | Open | Run native smoke only after safe fixtures and runtime target are approved. |
| Missing provider delivery/runtime proof for OneSignal, Daily, media/CDN | Release candidate blocker | Open | Include provider touchpoint observations in the approved smoke run; do not mutate real production data. |
| Exact latest deployed Edge Function source hash not recorded in every audit | Non-blocking process polish | Open | Record artifact hashes when Edge Functions change. |
| Surface inventory component candidates | Non-blocking polish | Open | Keep as triage-only; do not delete without route/product proof. |
| Existing lint/build warning backlog | Non-blocking polish | Open | Separate lint/build debt stream if desired. |
| Super Vibe monetization/product redesign | Non-blocking product follow-up | Open | Separate product semantics stream only if desired and approved. |

## 9. Exact Next Prompts

### Required Next Stream: Fixture Creation/Approval

```text
STREAM
Event Lobby safe fixture approval and cleanup plan

MISSION
Create or approve safe Event Lobby runtime smoke fixtures without mutating real production users. Prefer a true staging Supabase project. If production-isolated fixtures are proposed, require explicit approval, fixture IDs, rollback-safe cleanup, and proof that no real users/provider actions are affected.

REQUIRED OUTPUT
- Environment classification: staging / isolated production fixture / unavailable
- Supabase ref
- User A/B/C fixture aliases and IDs
- Live event fixture
- Scheduled/not-started event fixture or safe state-transition plan
- Ended event fixture or safe end/reset plan
- Optional blocked/reported fixture pair
- Cleanup/reset plan for event_swipes, video_sessions, event_registrations, queue/status fields, notifications, observability, provider side effects, and event status
- Native runtime target approval if native smoke is included
- Explicit no-secrets/no-credentials-in-Git statement

SAFETY
No production data mutation unless the user explicitly approves the exact isolated production fixture and cleanup boundary.
```

### Follow-Up Stream After Fixtures: Runtime Smoke Proof

```text
STREAM
Event Lobby approved runtime and native smoke proof

MISSION
Using only the approved fixture metadata, validate ./scripts/run_event_lobby_regression.sh --staging-smoke-check, then run the web and native scenario matrices from docs/audits/event-lobby-runtime-smoke-fixture-readiness.md. Record exact pass/fail evidence, provider touchpoint limits, cleanup performed, and no-runtime-overclaim statements.

OUTPUT
- docs/audits/event-lobby-runtime-smoke-proof.md
- docs/audits/native-event-lobby-device-smoke.md, if native runtime was executed
```

No focused implementation bugfix prompt is currently required. The only implementation drift found in the investigation batches, legacy web analytics raw target IDs, was already fixed in closure PR #670.

## 10. Validation Commands And Results

| Command | Result |
| --- | --- |
| `git checkout main` / `git pull --ff-only origin main` | PASS; main was current before branch creation. |
| `git status --short` | PASS; clean before report creation. |
| Supabase linked ref check | PASS; `supabase/.temp/project-ref` is `schdyxcunwcvddlcshwd`. |
| `npm run test:event-lobby-regression` | PASS. |
| `npm run test:hardening-contracts` | PASS. |
| `npm run typecheck` | PASS, including mobile typecheck and `expo-crypto` guard. |
| `npm run lint` | PASS with existing warning backlog: 208 warnings, 0 errors. |
| `npm run build` | PASS with existing Vite dynamic-import/chunk-size warnings. |
| `supabase db push --linked --dry-run` | PASS; remote database is up to date. |

This synthesis performed no implementation fixes, no Supabase deploy, no Edge Function deploy, no production data mutation, no Docker/local Supabase startup, and no runtime/provider smoke.
