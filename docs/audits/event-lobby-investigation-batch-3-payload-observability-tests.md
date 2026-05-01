# Event Lobby Investigation Batch 3: Payload, Observability, and Regression Harness

Date: 2026-05-01
Branch: `audit/event-lobby-investigation-payload-observability-tests`

## 1. Executive verdict

**Verdict: partial.**

Stream 5 deck payload/media and Stream 7 regression harness remain well supported by local source evidence, generated types, focused tests, and remote catalog checks. The `20260501230000_event_lobby_deck_payload_media.sql` migration is applied on the canonical Supabase project, and `supabase db push --linked --dry-run` reports the remote database is up to date.

Stream 6 observability is mostly intact for the canonical shared taxonomy and Edge Function structured logs, but the web lobby still emits legacy analytics events with raw target `profile_id` values. That conflicts with `docs/contracts/event-lobby-observability.md`, which forbids raw profile/target/actor/user identifiers in client analytics payloads. This report documents the drift and includes a focused bugfix prompt; no product behavior was patched in this investigation branch.

No production data mutation, Supabase deploy, Edge Function deploy, Docker, local Supabase, or private media fetch was performed.

## 2. Deck payload evidence table

| Check | Evidence | Verdict |
| --- | --- | --- |
| Safe payload fields exist | Local migration returns `primary_photo_path`, `photo_verified`, `premium_badge`, and `availability_state`; remote `get_event_deck` result shape also contains all four. Remote function MD5 observed: `17c5385df896d6c4b0947a50c7d04eb0`. | Pass |
| Existing card fields preserved | Remote return shape still includes `profile_id`, `name`, `age`, `gender`, `avatar_url`, `photos`, public profile copy, queue status, prior connection flags, `has_super_vibed`, and `shared_vibe_count`. | Pass |
| Generated types aligned | `npm run regen:supabase-types` rewrote `src/integrations/supabase/types.ts` with no git diff. | Pass |
| Active-event and busy-user hardening preserved | `get_event_deck` still calls `get_event_lobby_active_state`, rejects inactive events, filters non-idle/non-browsing queue states, and excludes candidates with unended Ready Gate/handshake/date sessions. | Pass |
| Security posture preserved | `get_event_deck` is `SECURITY DEFINER`, pins `SET search_path TO 'public'`, revokes `PUBLIC`/`anon`, and grants only `authenticated`/`service_role`. | Pass |
| Client parser tolerance | Shared Event Deck adapters include additive fields, sanitize string/photo inputs, default `availability_state`, and ignore unknown premium badge values. | Pass |

Remote read-only marker query confirmed:

- `has_primary_photo_path = true`
- `has_photo_verified = true`
- `has_premium_badge = true`
- `has_availability_state = true`
- return definition excludes forbidden-field markers

## 3. Forbidden-field exclusion table

| Field family | Evidence | Verdict |
| --- | --- | --- |
| Proof selfie URLs and private verification artifacts | Not present in the `get_event_deck` return definition locally or remotely. | Pass |
| Moderation, suspension, report, block internals | Not present in return shape; contract explicitly forbids these fields. | Pass |
| Phone/email PII | Not present in return shape or deck adapter output. | Pass |
| `photo_verified_at` | Not present; only safe boolean `photo_verified` is returned. | Pass |
| `premium_until` and admin grant metadata | Not present in return shape. | Pass |
| Raw `subscription_tier` | Not returned. The migration references `profiles.subscription_tier` only to derive bounded `premium_badge` values of `premium` or `vip`. | Pass |

## 4. Web/native media fallback matrix

| Surface | Evidence | Verdict |
| --- | --- | --- |
| Web full-card sizing | `LobbyProfileCard` passes `size="full"` to `ProfilePhoto`; `ProfilePhoto` maps full-size lobby images through `deckCardUrl`, not thumbnail transforms. | Pass |
| Web fallback order | `ProfilePhoto` resolves `primaryPhotoPath`, then first valid `photos[]`, then `avatar_url`, then placeholder/error fallback. | Pass |
| Web per-card profile fetch removal | `src/components/lobby/LobbyProfileCard.tsx` does not fetch `profiles` or call `get_profile_for_viewer` for badge/verification state. | Pass |
| Native full-card sizing | Native Event Lobby card resolves `primary_photo_path` or first valid photo/avatar and passes it through `deckCardUrl`. | Pass |
| Native per-card profile fetch removal | Native deck card rendering uses deck payload fields. Existing `get_profile_for_viewer` usage in native lobby is for active-session partner or received-vibes contexts, not Event Lobby deck card decoration. | Pass |
| Legacy/Bunny/Supabase path support | Shared `resolvePrimaryProfilePhotoPath` tests cover local storage paths, full HTTPS URLs, Supabase storage URLs, and Bunny CDN URLs. | Pass |
| Broken/missing media safety | Source and tests show fallback handling rather than a crash path. This remains source/static proof, not live image-provider proof. | Pass |

## 5. Observability taxonomy table

| Check | Evidence | Verdict |
| --- | --- | --- |
| Canonical event names exist | `shared/observability/eventLobbyObservability.ts` defines `lobby_entered`, `lobby_deck_loaded`, `lobby_deck_empty`, `lobby_deck_error`, `lobby_swipe_submitted`, `lobby_swipe_result`, `lobby_swipe_duplicate_suppressed`, `queue_drain_attempted`, `queue_drain_result`, `ready_gate_shown`, `ready_gate_transition`, `date_entered_from_lobby`, `notification_sent`, and `notification_suppressed`. | Pass |
| Deck-empty reasons are coarse | Shared taxonomy contains `event_not_active`, `user_not_eligible`, `no_confirmed_candidates`, `all_candidates_filtered`, `all_candidates_seen_locally`, `all_candidates_busy_or_unavailable`, `rpc_error`, `network_error`, and `unknown`. | Pass |
| Shared swipe result payload is identifier-free | `buildLobbySwipeResultPayload` emits event/platform/swipe/outcome/session-present/notification flags, not raw actor/target/profile identifiers. | Pass |
| Edge Function log sanitization | `swipe-actions` strips `user_id`/`target_id` from `logLifecycle` output, logs presence booleans, and sanitizes reason/dedupe/suppression fields. | Pass |
| Edge Function taxonomy coverage | Repo source logs `lobby_swipe_result`, `lobby_swipe_duplicate_suppressed`, `notification_suppressed`, and `notification_sent`. Local source hash: `e5ffa27b2c1a59bf28ac646df354807774f6e02845be195d4cb71955f146444a`. | Pass |
| Deployed `swipe-actions` source proof | Supabase read-only function list shows `swipe-actions` active, version `496`, updated `2026-05-01 16:24:30`. The CLI did not expose deployed source/hash, so exact source parity could not be independently proven here. | Warn |
| Legacy web analytics identifier redaction | `src/pages/EventLobby.tsx` still emits `profile_id: targetId` in `lobby_profile_swiped` and `super_vibe_used` payloads. This conflicts with the observability contract. | Fail |

## 6. Regression harness coverage table

| Check | Evidence | Verdict |
| --- | --- | --- |
| Package script exists | `package.json` exposes `npm run test:event-lobby-regression`, which runs `bash scripts/run_event_lobby_regression.sh`. | Pass |
| Script executable | `scripts/run_event_lobby_regression.sh` is executable and completed successfully. | Pass |
| Safe by default | Script states it does not deploy or execute live RPC smoke flows, runs source/static tests by default, and only performs Supabase dry-run when explicitly requested. | Pass |
| Production fixture guard | Optional staging metadata check refuses production ref `schdyxcunwcvddlcshwd` unless `--allow-production` and an explicit production fixture ID are present. | Pass |
| Coverage map | Harness covers active-event, canonical state, swipe idempotency, web gating, ready/queue contract, deck payload/media, native contract parity, observability, and shared video-session flow tests. | Pass |
| Runtime proof limits documented | Runbook and audit docs do not claim provider delivery, realtime timing, browser rendering, physical device rendering, or live data mutation proof. | Pass |

## 7. Validation results

| Command | Result |
| --- | --- |
| `supabase migration list --linked` | Passed; canonical linked project includes migration `20260501230000`. |
| `supabase db push --linked --dry-run` | Passed; remote database is up to date. |
| `npx tsx shared/matching/eventLobbyDeckPayloadMedia.test.ts` | Passed. |
| `npx tsx shared/profilePhoto/resolvePrimaryProfilePhotoPath.test.ts` | Passed. |
| `npx tsx shared/observability/eventLobbyObservability.test.ts` | Passed. |
| `npx tsx shared/matching/eventLobbyRegressionHarness.test.ts` | Passed. |
| `npm run test:event-lobby-regression` | Passed. |
| `./scripts/run_event_lobby_regression.sh` | Passed. |
| `npm run test:hardening-contracts` | Passed. |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed with existing warnings. |
| `npm run build` | Passed with existing Vite warnings. |
| `npm run regen:supabase-types` | Passed and produced no git diff. |

Final `git diff --check` must be run after this report is staged to confirm whitespace cleanliness.

## 8. Runtime proof limits

This audit intentionally used source inspection, generated-type regeneration, local tests, Supabase migration listing, Supabase dry-run, and read-only catalog checks. It did not:

- mutate production data
- deploy Supabase migrations or Edge Functions
- fetch private verification media
- verify live image-provider transformations against private assets
- prove realtime timing in a browser/device runtime
- prove provider delivery or notification receipt
- extract deployed Edge Function source bytes from Supabase

Those limits are acceptable for this investigation stream and should remain explicit in release readiness materials.

## 9. Findings and follow-up bugfix prompts

### B3-001 - Legacy web analytics emits raw target profile IDs

Severity: **fail**

Affected surface: `src/pages/EventLobby.tsx`

Evidence:

- `src/pages/EventLobby.tsx:1071` emits `trackEvent("lobby_profile_swiped", { event_id, swipe_type: "vibe", profile_id: targetId })`.
- `src/pages/EventLobby.tsx:1089` emits `trackEvent("lobby_profile_swiped", { event_id, swipe_type: "pass", profile_id: targetId })`.
- `src/pages/EventLobby.tsx:1106` emits `trackEvent("super_vibe_used", { event_id, profile_id: targetId })`.
- `src/pages/EventLobby.tsx:1109` emits `trackEvent("lobby_profile_swiped", { event_id, swipe_type: "super_vibe", profile_id: targetId })`.
- `docs/contracts/event-lobby-observability.md` forbids `profile_id`, `target_id`, `actor_id`, or raw `user_id` in analytics payloads.

Impact:

The canonical Event Lobby observability helpers and Edge Function logs are sanitized, but legacy web analytics still violate the identifier-redaction contract. This should be fixed in a narrow follow-up, not in this investigation branch.

Focused bugfix prompt:

```text
Objective: Remove raw profile identifiers from legacy Event Lobby web analytics while preserving canonical observability.

Scope:
- src/pages/EventLobby.tsx
- shared/observability/eventLobbyObservability.test.ts or a new focused static test
- docs/branch-deltas/fix-event-lobby-legacy-analytics-identifier-redaction.md

Requirements:
- Replace `profile_id: targetId` in `lobby_profile_swiped` and `super_vibe_used` payloads with low-cardinality fields such as `target_present: true` or remove the target identifier entirely.
- Preserve `event_id`, `swipe_type`, and current deck-advance behavior.
- Do not change backend swipe behavior, deck payload shape, notification behavior, Supabase migrations, or Edge Functions.
- Add a static test that fails on `trackEvent(... profile_id: targetId)` or equivalent raw target/profile identifier emission in Event Lobby analytics.
- Confirm canonical `buildLobbySwipeResultPayload` remains identifier-free.
- Run `npx tsx shared/observability/eventLobbyObservability.test.ts`, `npx tsx shared/matching/eventLobbyDeckPayloadMedia.test.ts`, `npm run test:event-lobby-regression`, `npm run typecheck`, `npm run build`, `npm run lint`, and `git diff --check`.
- No Supabase migration, no Edge Function deploy, no cloud mutation.
```

### B3-002 - Deployed Edge Function source hash not directly provable from CLI

Severity: **warn**

Affected surface: `supabase/functions/swipe-actions/index.ts`

Evidence:

- Local repo source contains the expected safe observability markers.
- Local source hash recorded: `e5ffa27b2c1a59bf28ac646df354807774f6e02845be195d4cb71955f146444a`.
- Supabase function list confirms `swipe-actions` is active at version `496`.
- The available CLI output did not include deployed source bytes or a comparable hash.

Impact:

This is a proof limitation, not a discovered implementation bug. A future release process could record deployment artifact hashes when Edge Functions change.

### No production mutation statement

This investigation performed no production data mutation, no Supabase deploy, no Edge Function deploy, no Docker/local Supabase startup, and no private verification media fetch. Supabase cloud usage was limited to read-only project/migration/function listing, dry-run, and catalog checks against the canonical project ref `schdyxcunwcvddlcshwd`.
