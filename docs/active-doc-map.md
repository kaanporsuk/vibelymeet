# Active doc map

Date: 2026-06-12
Purpose: Keep one current execution path visible for native launch closure and make older planning/runbook references explicitly historical.

---

## Start here

0. **Video Date (post-rebuild, 2026-06-12):** the single current architecture map is `docs/video-date-architecture.md` (scope boundary, ownership model, rebuilt RPC layer, outbox, controller, contract-to-test map) and the single operational runbook is `docs/video-date-runbook.md` (cron set, monitoring posture, validation battery, smoke procedure, acceptance bar). The 2026-06 rebuild branch deltas are `docs/branch-deltas/video-date-rebuild-pr*.md`. Superseded Video Date narratives, audits, and branch deltas — including the former `video-date-success-command-center.md` — are archived under `docs/archive/video-date/` (moved, not deleted). The curated static battery is `npm run test:video-date-v4` plus `npm run test:video-date:red-flags`; static tests are never product acceptance — the bar is a fresh two-user run through both users' persisted `date_feedback`.
1. **Preflight:** from repo root run `npm run launch:preflight`, then `npm run typecheck`.
2. **Operator execution sheet:** `docs/kaan-launch-closure-execution-sheet.md`
3. **Canonical runbook:** `docs/native-launch-closure-master-runbook.md`
4. **Active blocker matrix and evidence log:** `docs/native-final-blocker-matrix.md`
5. **Strict go/no-go:** `docs/native-release-readiness/stage5-release-readiness-and-go-nogo.md`

Use `docs/native-external-setup-checklist.md` for provider/store depth and `docs/native-sprint6-launch-closure-runbook.md` for the phase-by-phase narrative only after starting from the chain above.

---

## Where evidence is recorded

| Evidence type | Canonical file |
|---|---|
| **Video Date Golden Flow red-flag closure and certification checklists (2026-06-08)** | `docs/qa/video-date-golden-flow-certification.md`; `docs/qa/video-date-native-device-certification.md`; `docs/runbooks/video-date-edge-function-release-verification.md`; invariant SQL `docs/sql/video-date-invariants.sql`; commands `npm run test:video-date:red-flags`, `npm run check:video-date:invariants`, `npm run verify:video-date:functions`, `npm run certify:video-date:golden-flow` |
| **Branch delta (Video Dates P0/P1 closure)** | `docs/archive/video-date/branch-deltas/fix-video-date-p0-p1-closure.md` |
| **Full-system forensic closure audit + cleanup matrix (2026-04-14)** | `docs/audits/full-system-forensic-closure-audit-2026-04-14.md` and `docs/audits/full-system-cleanup-matrix-2026-04-14.md` |
| **Branch delta (forensic audit pass)** | `docs/branch-deltas/audit-full-system-forensic-closure-and-cleanup.md` |
| **Mechanical trust closure (types + inventory + surface audit)** | `docs/audits/mechanical-trust-closure-2026-04-14.md` |
| **Last-mile closure (E2E + orphan triage + deduct_credit review)** | `docs/audits/e2e-minimal-layer-2026-04-14.md`, `docs/audits/orphan-triage-2026-04-14.md`, `docs/audits/deduct-credit-security-review-2026-04-14.md` |
| **`deduct_credit` auth closure (caller map + migration)** | `docs/audits/deduct-credit-caller-map-2026-04-14.md`, `docs/branch-deltas/deduct-credit-security-closure-2026-04-14.md`, migration `20260429100000_deduct_credit_auth_bind.sql` |
| **Deleted video-date components (reverse audit, PR #399)** | `docs/audits/deleted-files-reverse-audit-2026-04-14.md`, `docs/audits/deleted-files-restore-matrix-2026-04-14.md` |
| **SelfViewPIP follow-ups (match-call PIP mount + feedback takeover)** | Closure: `docs/branch-deltas/selfview-pip-followups-closure-2026-04-14.md`. Audits: `docs/audits/selfview-pip-followups-audit-2026-04-14.md`, `docs/audits/selfview-pip-drag-snap-investigation-2026-04-14.md` (snap deferred). Background: deleted-file reverse audit row above (`docs/audits/deleted-files-reverse-audit-2026-04-14.md`) |
| Launch blocker status, build ids, pass/fail updates | `docs/native-final-blocker-matrix.md` |
| Browser/runtime proof results | `docs/browser-auth-runtime-proof-results.md` |
| Post-audit ops checklist (Supabase vs Vercel vs manual QA) | `docs/post-audit-operational-verification-checklist.md` |
| Google TLS certificate posture (Q2 2026 GTS/ECDSA notice) | `docs/audits/google-tls-certificate-posture-2026-06-04.md`; static guard `npm run test:google-tls-posture` |
| Distance Visibility Stage 1 rollout and Stage 2 final enforcement | `docs/distance-visibility-stage1-rollout.md`, `docs/distance-visibility-stage2-final-enforcement.md` |
| Activity Status privacy boundary rebuild delta | `docs/branch-deltas/fix-activity-status-privacy-boundary.md`, `docs/activity-status-privacy-verification.sql` |
| Blocked Users server-owned safety production closure | `docs/branch-deltas/blocked-users-server-owned-safety-production-closure.md` |
| Fresh smoke bootstrap method and proof boundaries | `docs/fresh-smoke-proof-bootstrap.md` |
| Proof policy and rebuild-proof context | `docs/authenticated-proof-and-rebuild-plan.md` |
| Clean rebuild rehearsal log | `docs/rebuild-rehearsal-log.md` |
| Ready Gate registration ownership hardening | `docs/ready-gate-server-owned-registration-status.md`, `docs/ready-gate-server-owned-registration-status-final-audit.md`; migrations `20260501141000_ready_gate_server_owned_registration_status.sql`, `20260501142000_ready_gate_client_lifecycle_overwrite_guard.sql` |
| **Video Date flow/ownership/contract truth (post-rebuild)** | `docs/video-date-architecture.md`; operations in `docs/video-date-runbook.md`; rebuild deltas `docs/branch-deltas/video-date-rebuild-pr*.md`; Edge Functions `daily-room`, `video-date-snapshot`, `video-date-outbox-drainer`, `video-date-deadline-finalizer`, `video-date-daily-webhook`, `post-date-verdict`, `video-date-room-cleanup`, `video-date-orphan-room-cleanup` |
| **Video Date operator tooling + room-cleanup consolidation plan (2026-06-12)** | `scripts/video-date-live-gate.mjs` (`npm run livegate:video-date`), `scripts/check-contract-fixture-drift.mjs` (`npm run check:contract-fixture-drift`), `scripts/video-date-load-probe.mjs` (`npm run loadprobe:video-date`); cron-merge plan `docs/investigations/video-date-room-cleanup-consolidation-plan.md` |
| **Event Lobby active-event, swipe retry, and web/native lobby gating closure** | `docs/audits/event-lobby-active-event-contract-verification.md`, `docs/audits/event-lobby-swipe-idempotency-verification.md`, `docs/audits/event-lobby-web-gating-verification.md`; branch deltas `docs/branch-deltas/fix-event-lobby-active-event-contract.md`, `docs/branch-deltas/fix-swipe-retry-idempotency-notification-dedupe.md`, `docs/branch-deltas/fix-event-lobby-web-gating.md`; migrations `20260501223000_event_lobby_canonical_active_state.sql`, `20260501224000_event_lobby_swipe_already_swiped.sql`; Edge Function `swipe-actions` |
| **Event Lobby Ready Gate direct-match contract** | `docs/contracts/event-lobby-ready-queue-contract.md` now documents queue removal; historical verification remains in `docs/audits/event-lobby-ready-queue-contract-verification.md`; branch delta `docs/branch-deltas/remove-post-date-instant-next.md`; migration `20260610000100_remove_post_date_instant_next.sql` |
| **Event Lobby deck payload and media contract** | `docs/contracts/event-lobby-deck-payload-contract.md`, `docs/audits/event-lobby-deck-payload-media-verification.md`; branch delta `docs/branch-deltas/fix-event-lobby-deck-payload-media.md`; migration `20260501230000_event_lobby_deck_payload_media.sql` |
| **Event Lobby observability taxonomy** | `docs/contracts/event-lobby-observability.md`, `docs/audits/event-lobby-observability-verification.md`; branch delta `docs/branch-deltas/fix-event-lobby-observability.md`; Edge Function `swipe-actions` |
| **Event Lobby regression harness** | `scripts/run_event_lobby_regression.sh`, `docs/golden-path-event-lobby-regression-runbook.md`, `docs/audits/event-lobby-regression-harness-verification.md`; branch delta `docs/branch-deltas/test-event-lobby-regression-harness.md` |
| **Event Lobby registration RLS authority hardening** | Migration `supabase/migrations/20260606164737_event_registration_rpc_owned_dml_lockdown.sql`; validation `supabase/validation/event_registration_rpc_owned_dml_lockdown.sql`; static contract `shared/matching/eventRegistrationRlsAuthority.test.ts`; env-gated runtime proof `shared/matching/eventLobbyDirectWriteRlsRuntime.test.ts` |
| **Event Lobby native/backend contract** | `docs/contracts/event-lobby-native-contract.md`, `docs/audits/event-lobby-native-contract-verification.md`; branch delta `docs/branch-deltas/docs-event-lobby-native-contract.md` |
| **Event Lobby native parity implementation** | `docs/audits/native-event-lobby-parity-implementation.md`; branch delta `docs/branch-deltas/fix-native-event-lobby-parity.md`; regression assertion `shared/matching/nativeEventLobbyContractParity.test.ts` |
| **Event Lobby legacy RPC removal** | Migrations `supabase/migrations/20260609163130_remove_legacy_queue_session_rpcs.sql` and `supabase/migrations/20260609165218_remove_leave_matching_queue.sql`; validation `supabase/validation/event_lobby_active_event_contract.sql`; contracts `shared/matching/eventLobbyCanonicalActiveState.test.ts`; generated Supabase types no longer expose `find_video_date_match`, `join_matching_queue`, or `leave_matching_queue` |
| **Event Lobby Mystery Match removal** | Migration `supabase/migrations/20260609152000_remove_mystery_match.sql`; removal contract `shared/matching/mysteryMatchRemovalContracts.test.ts`; validation `supabase/validation/event_lobby_active_event_contract.sql`; generated Supabase types no longer expose `find_mystery_match`; read-only verification evidence is archived in `docs/archive/video-date/video-date-success-command-center.md` |
| **Event Lobby session-source removal** | Migration `supabase/migrations/20260609171950_remove_video_sessions_session_source.sql`; branch delta `docs/branch-deltas/remove-video-sessions-session-source.md`; contract `shared/matching/videoSessionSourceRemovalContracts.test.ts`; validation `supabase/validation/event_lobby_active_event_contract.sql`; generated Supabase types no longer expose `video_sessions.session_source` |
| **Chat Match Calls removal** | Migration `supabase/migrations/20260609224646_remove_match_calls.sql`; branch delta `docs/branch-deltas/remove-match-calls.md`; removal contracts in `shared/matching/dailyRoomLegacyActionRemovalContracts.test.ts`, `shared/matching/dailyProviderOperationalQa.test.ts`, `shared/chat/chatOverflowActionsContracts.test.ts`, permission/profile contracts, and `supabase/functions/daily-room/dailyRoomContracts.test.ts`; active source and generated Supabase types no longer expose Match Call UI/actions/table/RPC/preference/cron; Chat messages and golden Video Date are preserved |
| **Daily-room non-golden Video Date action removal** | Branch delta `docs/branch-deltas/remove-daily-room-non-golden-actions.md`; supersedes `docs/branch-deltas/remove-daily-room-legacy-actions.md`; contract `shared/matching/dailyRoomLegacyActionRemovalContracts.test.ts`; active `daily-room` Video Date entry contract/dispatch no longer accepts `create_date_room`, `join_date_room`, `ensure_date_room`, `prepare_diagnostic_entry`, or `prepare_solo_entry`; web/native entry remains `prepare_date_entry` |
| **Event Lobby final closure audit** | `docs/audits/event-lobby-closure-report.md`; source status pointer `docs/audits/event-lobby-deck-deep-dive.md`; branch delta `docs/branch-deltas/audit-event-lobby-closure.md` |
| **Event Lobby deep cleanup audit** | `docs/audits/event-lobby-deep-cleanup-audit-2026-05-01.md`; branch delta `docs/branch-deltas/audit-event-lobby-deep-cleanup.md` |
| **Event Lobby batch-1 backend contract investigation closure** | `docs/audits/event-lobby-investigation-batch-1-backend-contracts.md`; branch delta `docs/branch-deltas/fix-event-lobby-investigation-batch-1-backend-contracts-closure.md` |
| **Provider operational QA: OneSignal push** | `docs/branch-deltas/fix-onesignal-provider-operational-qa.md`; provider sheet `_cursor_context/vibely_onesignal_provider_sheet.md`; regression assertion `shared/matching/onesignalProviderOperationalQa.test.ts` |
| **Provider operational QA: Bunny media** | `docs/branch-deltas/fix-bunny-provider-operational-qa.md`; provider sheet `_cursor_context/vibely_bunny_provider_sheet.md`; regression assertion `shared/matching/bunnyProviderOperationalQa.test.ts` |
| **Provider operational QA: Daily calls** | `docs/branch-deltas/fix-daily-provider-operational-qa.md`; provider sheet `_cursor_context/vibely_daily_provider_sheet.md`; regression assertion `shared/matching/dailyProviderOperationalQa.test.ts` |
| **Provider operational QA: Resend email** | `docs/branch-deltas/fix-resend-email-provider-operational-qa.md`; regression assertion `shared/matching/resendEmailProviderOperationalQa.test.ts` |
| **Provider operational QA: Twilio phone verification** | `docs/branch-deltas/fix-twilio-phone-verification-qa.md`; regression assertion `shared/matching/twilioPhoneVerificationQa.test.ts` |
| **Provider/notification deep tidy audit** | `docs/audits/deep-audit-implemented-work-2026-05-01.md`; branch delta `docs/branch-deltas/chore-deep-audit-implemented-work-tidy.md` |
| **Current work deep tidy audit** | `docs/audits/deep-audit-current-work-tidy-2026-05-01.md`; branch delta `docs/branch-deltas/chore-deep-audit-current-work-tidy.md` |
| **Native physical-device QA readiness** | `docs/qa/native-physical-device-qa-runbook.md`; branch delta `docs/branch-deltas/qa-native-physical-device-flow.md`; regression assertion `shared/matching/nativePhysicalDeviceQaReadiness.test.ts` |
| **RevenueCat native entitlement readiness** | `docs/branch-deltas/fix-revenuecat-native-entitlement-readiness.md`; regression assertion `shared/matching/revenueCatNativeEntitlementReadiness.test.ts` |
| **Post-stream provider/native deep audit and tidy** | `docs/audits/post-stream-provider-native-readiness-audit-2026-05-01.md` |
| **Screenshot-led native visual parity capture plan** | `docs/qa/screenshot-led-native-visual-parity-capture-plan.md`; branch delta `docs/branch-deltas/fix-screenshot-led-native-visual-parity.md`; regression assertion `shared/matching/screenshotLedNativeVisualParity.test.ts` |
| **Recent hardening deep audit and cleanup (historical partial pass)** | `docs/audits/recent-hardening-deep-audit-2026-05-01.md`; branch delta `docs/branch-deltas/chore-deep-audit-recent-hardening.md` |
| **Admin P4 growth-scale intelligence** | `docs/p4/metrics-dictionary.md`, `docs/p4/analytics-instrumentation-map.md`, `docs/p4/native-store-operations-playbook.md`, `docs/p4/bi-governance.md`; branch delta `docs/branch-deltas/admin-p4-growth-scale-intelligence.md`; regression assertion `shared/admin/adminP4IntelligenceContracts.test.ts` |

---

## Canonical docs

| Role | File |
|---|---|
| Preflight | `npm run launch:preflight` + `npm run typecheck` |
| **Video Date architecture + operations source of truth** | `docs/video-date-architecture.md`; `docs/video-date-runbook.md` |
| **Video Date survey feedback drain guard local patch** | `docs/archive/video-date/branch-deltas/fix-video-date-survey-feedback-drain-guard.md`; migration `supabase/migrations/20260608211359_video_date_survey_feedback_drain_guard.sql`; contract `shared/matching/videoDateSurveyFeedbackDrainGuard.test.ts` |
| **Video Date active owner / terminal truth local patch** | `docs/archive/video-date/branch-deltas/fix-video-date-active-owner-terminal-truth.md`; migration `supabase/migrations/20260608171837_video_date_active_owner_terminal_truth.sql`; runtime probe `shared/matching/videoDateLifecycleRpcPostgrestRuntime.test.ts` |
| **Video Date Golden Flow certification** | `docs/qa/video-date-golden-flow-certification.md`; native device proof `docs/qa/video-date-native-device-certification.md`; Edge Function release verification `docs/runbooks/video-date-edge-function-release-verification.md` |
| **Video Date Sprint 0 source baseline and risk map** | `docs/archive/video-date/audits/video-date-sprint0-baseline-risk-map-2026-05-25.md` |
| **Architecture, providers, import boundaries (`@shared/*` vs root `shared/`)** | `docs/vibely-canonical-project-reference.md` |
| **Native v1 architecture lock (routes, backend contracts, providers, gap list)** | `docs/native-sprint0-architecture-lock.md` |
| **Ready Gate / video-date registration ownership** | `docs/ready-gate-server-owned-registration-status-final-audit.md` |
| **Ready Gate and Event Lobby backend contract** | `docs/ready-gate-backend-contract.md` |
| **Sprint 5 launch-polish triage (static matrix + implemented handoff fixes)** | `docs/native-sprint5-launch-polish-triage.md` |
| Operator execution sheet | `docs/kaan-launch-closure-execution-sheet.md` |
| Canonical launch-closure runbook | `docs/native-launch-closure-master-runbook.md` |
| Active launch backlog and blocker matrix | `docs/native-final-blocker-matrix.md` |
| Strict release-readiness decision | `docs/native-release-readiness/stage5-release-readiness-and-go-nogo.md` |
| Provider and store setup depth | `docs/native-external-setup-checklist.md` |
| **Native external setup closure gate** | `docs/native-external-setup-closure.md` |
| Phased operator detail | `docs/native-sprint6-launch-closure-runbook.md` |
| **Web regression harness (static + manual checklist)** | `scripts/run_golden_path_smoke.sh` → `docs/golden-path-regression-runbook.md` |
| **Event Lobby regression harness (focused static + staging checklist)** | `scripts/run_event_lobby_regression.sh` → `docs/golden-path-event-lobby-regression-runbook.md` |
| **Event Lobby native/backend contract** | `docs/contracts/event-lobby-native-contract.md` |
| **Native RC smoke pack (iOS/Android operator checklist)** | `docs/qa/native-rc-smoke-pack.md` |
| **Native physical-device QA runbook** | `docs/qa/native-physical-device-qa-runbook.md` |
| **Screenshot-led native visual parity capture plan** | `docs/qa/screenshot-led-native-visual-parity-capture-plan.md` |
| **Provider readiness evidence pack (OneSignal, Bunny, Daily, Resend, Twilio, RevenueCat)** | Stream deltas in `docs/branch-deltas/` plus assertions in `shared/matching/*ProviderOperationalQa.test.ts` and `shared/matching/revenueCatNativeEntitlementReadiness.test.ts` |
| **Web push / OneSignal production verification** | `docs/web-push-production-checklist.md` |
| **Native runtime provider hardening (push boundary + iOS React source-build fix)** | `docs/native-runtime-provider-hardening.md` |
| **Authenticated proof / rebuild policy** | `docs/authenticated-proof-and-rebuild-plan.md` |
| **Rebuild rehearsal evidence log** | `docs/rebuild-rehearsal-log.md` |
| **Repo hardening / dead-surface closure (dated)** | `docs/repo-hardening-closure-2026-04-11.md` |
| **Final closure sprint report (branch isolation + ESLint + proof boundaries)** | `docs/hardening-final-closure-sprint-2026-04-11.md` |
| **Current-email OTP (Edge + web/native parity + secret/HMAC semantics)** | `docs/email-verification-settlement-2026-04-11.md` |

**Singular backlog framing:** for launch closure, the only active backlog/evidence log is `docs/native-final-blocker-matrix.md`. Older sprint boards, deferred backlogs, and parity plans are historical context only unless this map or a canonical doc explicitly promotes them again.

---

## Historical or superseded docs

These remain in-repo for audit history, provenance, or deep context, but they are **not** active entrypoints for launch closure:

- `docs/native-launch-readiness.md` — historical pre-consolidation readiness summary
- `docs/native-deployment-validation-sequence.md` — superseded by the current execution-sheet/runbook chain; contains stale branch naming
- `docs/native-v1-rc-operator-runbook.md` — supplemental RC validation workflow, not the launch-closure entrypoint
- `docs/native-sprint-board.md` — historical implementation backlog
- `docs/native-deferred-runtime-bugs-backlog.md` — historical deferred backlog, not the active launch backlog
- `docs/native-web-handoff-burndown.md` — historical scope/handoff reference, still cited only for accepted web handoffs
- `_cursor_context/vibely_rebuild_runbook.md` — canonical for frozen web rebuild only, not native launch closure (banner at top notes 2026-04-11 removals)
- `_cursor_context/Native_Build_Beginning_Handoff.md` — historical native kickoff handoff; superseded by the agent-neutral current docs in this map
- `_cursor_context/vibely_cursor_hardening_campaign.md` — historical filename retained for provenance; content now functions as an agent-neutral rebuildability brief
- `_cursor_context/vibely_discrepancy_report.md` — historical rebuild audit
- **`_cursor_context/vibely_golden_snapshot_audited.md`** and **`_cursor_context/vibely_rebuild_runbook.md`** — include a **2026-04-11** alignment note for `/ready/:readyId` → `ReadyRedirect` and removed unrouted surfaces; still **verify** against `src/App.tsx` for any older § inventory counts. **Other `_cursor_context/*.md` files** — audit/snapshot provenance; some may still name Lovable-era hosting or pre-removal paths. Do not treat them as current route or deploy truth without cross-checking `docs/repo-hardening-closure-2026-04-11.md` and the live `src/App.tsx` route table.
- `docs/_archive/historical/vibely_golden_snapshot_audited_duplicate_2026-04-11.md` — archived duplicate copy; use `_cursor_context/vibely_golden_snapshot_audited.md`

---

## Branch and source-of-truth note

- Branch names shown inside older phase docs are provenance only; do not treat them as the required current working branch or branch base.
- For legacy parity/planning docs, "web as source of truth" now means historical design-reference context only. Current launch-closure truth is the shared backend/runtime state plus the canonical docs listed above.
