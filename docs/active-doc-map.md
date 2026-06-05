# Active doc map

Date: 2026-06-05
Purpose: Keep one current execution path visible for native launch closure and make older planning/runbook references explicitly historical.

---

## Start here

0. **Video Date recovery command center:** `docs/video-date-success-command-center.md` — mandatory first read/update point for all Ready Gate, Video Date, Daily, notification, and post-date survey recovery work. It records PR #1190/#1192/#1194/#1196/#1199/#1200 plus the current terminal-survey lifecycle hardening and surface-owner recovery work, functional Video Date code baseline `fbca4996a096273914ee650b556ba7994477aa5e`, deployed/expected Supabase migrations `20260604142017_video_date_active_presence_join_guard.sql`, `20260604170438_video_date_warmup_reconnect_stability.sql`, `20260604193140_video_date_latest_presence_grace_repair.sql`, `20260604205645_video_date_remote_seen_latest_state.sql`, `20260605085010_video_date_confirmed_encounter_deadline_rescue.sql`, `20260605115657_video_date_early_confirmed_encounter_promotion.sql`, `20260605135616_video_date_terminal_survey_lifecycle_hardening.sql`, `20260605143637_video_date_terminal_room_metadata_backfill.sql`, `20260605144003_video_date_terminal_room_metadata_corrective_backfill.sql`, `20260605145306_video_date_terminal_room_cleanup_preserve_metadata.sql`, `20260605145926_video_date_terminal_room_metadata_final_repair.sql`, `20260605150130_video_date_terminal_room_metadata_historical_delete_marker.sql`, `20260605152058_video_date_pending_survey_registration_repair.sql`, `20260605170249_video_date_surface_owner_outer_failsoft.sql`, and `20260605174703_video_date_vibe_question_outer_base_name_repair.sql`, Daily start ownership, latest-state presence, canonical remote-seen latest-state repair, immediate confirmed-encounter promotion, current-peer-vs-historical-encounter separation, sticky survey status until feedback, pending-survey registration repair, terminal Daily room repair/backfill, cleanup/outbox provider-delete markers that preserve room forensics, cross-surface active video/survey route ownership with web/native forced survey guard bypass, exposed lifecycle RPC outer fail-soft wrappers, terminal-survey hard-stop, sync/deploy evidence, a fresh-session handoff prompt, and the still-unproven manual match -> survey acceptance run.
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
| **Video Date active recovery command center, PR #1190/#1192/#1194/#1196/#1199/#1200 deploy state, latest-state presence, immediate confirmed-encounter promotion, Daily start ownership, sticky survey lifecycle, terminal Daily room repair, cross-surface active video/survey route ownership with forced survey guard bypass, lifecycle RPC outer fail-soft wrappers, terminal-survey hard-stop, sync evidence, and handoff prompt (2026-06-05)** | `docs/video-date-success-command-center.md` |
| **Video Date Sprint 0 baseline and risk map (2026-05-25)** | `docs/audits/video-date-sprint0-baseline-risk-map-2026-05-25.md`; branch delta `docs/branch-deltas/video-date-sprint0-baseline-risk-map.md`; regression assertion `shared/matching/videoDateSprint0BaselineContracts.test.ts` |
| **Branch delta (Video Dates P0/P1 closure)** | `docs/branch-deltas/fix-video-date-p0-p1-closure.md` |
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
| **Video Date Handshake/active-presence release: timer starts after active latest Daily co-presence, confirmed encounters promote before deadline fallback, survey terminal state persists until feedback, and active video/survey owns the route surface** | `docs/vibely-canonical-project-reference.md` §4.1 and `docs/video-date-success-command-center.md`; migrations `20260501170000_video_date_handshake_starts_after_daily_join.sql`, `20260604142017_video_date_active_presence_join_guard.sql`, `20260604193140_video_date_latest_presence_grace_repair.sql`, `20260604205645_video_date_remote_seen_latest_state.sql`, `20260605085010_video_date_confirmed_encounter_deadline_rescue.sql`, `20260605115657_video_date_early_confirmed_encounter_promotion.sql`, `20260605135616_video_date_terminal_survey_lifecycle_hardening.sql`, `20260605143637_video_date_terminal_room_metadata_backfill.sql`, `20260605144003_video_date_terminal_room_metadata_corrective_backfill.sql`, `20260605145306_video_date_terminal_room_cleanup_preserve_metadata.sql`, `20260605145926_video_date_terminal_room_metadata_final_repair.sql`, `20260605150130_video_date_terminal_room_metadata_historical_delete_marker.sql`, `20260605152058_video_date_pending_survey_registration_repair.sql`, `20260605170249_video_date_surface_owner_outer_failsoft.sql`, and `20260605174703_video_date_vibe_question_outer_base_name_repair.sql`; Edge Functions `daily-room`, `video-date-outbox-drainer`, `video-date-room-cleanup`, and `video-date-orphan-room-cleanup` |
| **Event Lobby active-event, swipe retry, and web/native lobby gating closure** | `docs/audits/event-lobby-active-event-contract-verification.md`, `docs/audits/event-lobby-swipe-idempotency-verification.md`, `docs/audits/event-lobby-web-gating-verification.md`; branch deltas `docs/branch-deltas/fix-event-lobby-active-event-contract.md`, `docs/branch-deltas/fix-swipe-retry-idempotency-notification-dedupe.md`, `docs/branch-deltas/fix-event-lobby-web-gating.md`; migrations `20260501223000_event_lobby_canonical_active_state.sql`, `20260501224000_event_lobby_swipe_already_swiped.sql`; Edge Function `swipe-actions` |
| **Event Lobby Ready Gate and queued-match contract** | `docs/contracts/event-lobby-ready-queue-contract.md`, `docs/audits/event-lobby-ready-queue-contract-verification.md`; branch delta `docs/branch-deltas/fix-event-lobby-ready-queue-contract.md`; migration `20260501225000_event_lobby_ready_queue_contract.sql` |
| **Event Lobby deck payload and media contract** | `docs/contracts/event-lobby-deck-payload-contract.md`, `docs/audits/event-lobby-deck-payload-media-verification.md`; branch delta `docs/branch-deltas/fix-event-lobby-deck-payload-media.md`; migration `20260501230000_event_lobby_deck_payload_media.sql` |
| **Event Lobby observability taxonomy** | `docs/contracts/event-lobby-observability.md`, `docs/audits/event-lobby-observability-verification.md`; branch delta `docs/branch-deltas/fix-event-lobby-observability.md`; Edge Function `swipe-actions` |
| **Event Lobby regression harness** | `scripts/run_event_lobby_regression.sh`, `docs/golden-path-event-lobby-regression-runbook.md`, `docs/audits/event-lobby-regression-harness-verification.md`; branch delta `docs/branch-deltas/test-event-lobby-regression-harness.md` |
| **Event Lobby native/backend contract** | `docs/contracts/event-lobby-native-contract.md`, `docs/audits/event-lobby-native-contract-verification.md`; branch delta `docs/branch-deltas/docs-event-lobby-native-contract.md` |
| **Event Lobby native parity implementation** | `docs/audits/native-event-lobby-parity-implementation.md`; branch delta `docs/branch-deltas/fix-native-event-lobby-parity.md`; regression assertion `shared/matching/nativeEventLobbyContractParity.test.ts` |
| **Event Lobby final closure audit** | `docs/audits/event-lobby-closure-report.md`; source status pointer `docs/audits/event-lobby-deck-deep-dive.md`; branch delta `docs/branch-deltas/audit-event-lobby-closure.md` |
| **Event Lobby deep cleanup audit** | `docs/audits/event-lobby-deep-cleanup-audit-2026-05-01.md`; branch delta `docs/branch-deltas/audit-event-lobby-deep-cleanup.md` |
| **Event Lobby batch-1 backend contract investigation closure** | `docs/audits/event-lobby-investigation-batch-1-backend-contracts.md`; branch delta `docs/branch-deltas/fix-event-lobby-investigation-batch-1-backend-contracts-closure.md`; regression assertion `shared/matching/eventLobbyInvestigationBatch1Closure.test.ts` |
| **Provider operational QA: OneSignal push** | `docs/branch-deltas/fix-onesignal-provider-operational-qa.md`; provider sheet `_cursor_context/vibely_onesignal_provider_sheet.md`; regression assertion `shared/matching/onesignalProviderOperationalQa.test.ts` |
| **Provider operational QA: Bunny media** | `docs/branch-deltas/fix-bunny-provider-operational-qa.md`; provider sheet `_cursor_context/vibely_bunny_provider_sheet.md`; regression assertion `shared/matching/bunnyProviderOperationalQa.test.ts` |
| **Provider operational QA: Daily calls** | `docs/branch-deltas/fix-daily-provider-operational-qa.md`; provider sheet `_cursor_context/vibely_daily_provider_sheet.md`; regression assertion `shared/matching/dailyProviderOperationalQa.test.ts` |
| **Provider operational QA: Resend email** | `docs/branch-deltas/fix-resend-email-provider-operational-qa.md`; regression assertion `shared/matching/resendEmailProviderOperationalQa.test.ts` |
| **Provider operational QA: Twilio phone verification** | `docs/branch-deltas/fix-twilio-phone-verification-qa.md`; regression assertion `shared/matching/twilioPhoneVerificationQa.test.ts` |
| **Provider/notification deep tidy audit** | `docs/audits/deep-audit-implemented-work-2026-05-01.md`; branch delta `docs/branch-deltas/chore-deep-audit-implemented-work-tidy.md`; regression assertion `shared/matching/deepAuditImplementedWorkTidy.test.ts` |
| **Current work deep tidy audit** | `docs/audits/deep-audit-current-work-tidy-2026-05-01.md`; branch delta `docs/branch-deltas/chore-deep-audit-current-work-tidy.md`; regression assertion `shared/matching/deepAuditCurrentWorkTidy.test.ts` |
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
| **Video Date active recovery source of truth** | `docs/video-date-success-command-center.md` |
| **Video Date Sprint 0 source baseline and risk map** | `docs/audits/video-date-sprint0-baseline-risk-map-2026-05-25.md` |
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
