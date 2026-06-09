# Event Lobby Deep Cleanup Audit

Date: 2026-05-01
Branch: `audit/event-lobby-deep-cleanup`
Base commit: `b6b93814e2ad3f837a3aa793c079050e738a665f`
Supabase project ref: `schdyxcunwcvddlcshwd`

2026-06-09 addendum: this audit is historical for the May 1 hardening stack. Mystery Match was later removed from active web/native/backend surfaces, and direct legacy queue/session RPCs `find_video_date_match(uuid,uuid)` plus `join_matching_queue(uuid,uuid)` were later removed from the active linked schema. Current source/generated types should not expose `useMysteryMatch`, `find_mystery_match`, `find_video_date_match`, or `join_matching_queue`.

## Executive Verdict

The Event Lobby hardening stack is landed as intended across Git, local source, and Supabase cloud.

No new launch-blocking drift was found in the active-event, swipe idempotency, busy-user/queue, deck payload/media, observability, web gating, native parity, or regression harness work. The deployed database is in migration parity through `20260501230000_event_lobby_deck_payload_media.sql`, and deployed `swipe-actions` source matches the repo by SHA-256.

No tracked Event Lobby source files were identified as safely redundant. The static surface inventory still reports no orphan pages or hooks, and its component candidates remain a triage queue rather than a deletion manifest because the analyzer cannot prove runtime/dynamic usage. One ignored Finder artifact, `docs/.DS_Store`, was removed locally.

## Audit Scope

Reviewed:

- Event Lobby audit docs, contract docs, branch deltas, and closure report
- Prompt 1-9 merged PR evidence summarized in `docs/audits/event-lobby-closure-report.md`
- Event Lobby migrations and validation SQL
- `swipe-actions` Edge Function source and deployed copy
- Web `EventLobby` route, deck/swipe hooks, and local gating helpers
- Native Event Lobby route, API adapters, Ready Gate API, and media helpers
- Event Lobby regression harness and surface inventory script/output
- Current ignored/untracked artifact posture

## Git And Repo Alignment

- Local `main` and `origin/main` were aligned at `b6b93814e2ad3f837a3aa793c079050e738a665f` before this branch.
- Current cleanup branch was created from latest `origin/main`.
- The final closure PR is already merged: `docs/audits/event-lobby-closure-report.md` is the canonical finding-by-finding status artifact.
- The requested historical source path, `docs/audits/event-lobby-deck-deep-dive.md`, exists only as a status pointer to the closure report. This is intentional and avoids resurrecting stale pre-hardening claims.

## Supabase Cloud Verification

- Linked ref: `schdyxcunwcvddlcshwd`.
- `supabase migration list --linked`: local and remote matched through `20260501230000`.
- `supabase db push --linked --dry-run`: `Remote database is up to date.`
- `supabase functions list --project-ref schdyxcunwcvddlcshwd`: `swipe-actions` active, version `471`, updated `2026-05-01 02:26:12 UTC`.
- Downloaded deployed `swipe-actions` with `supabase functions download swipe-actions --project-ref schdyxcunwcvddlcshwd --use-api`; local and deployed SHA-256 both equal `e5ffa27b2c1a59bf28ac646df354807774f6e02845be195d4cb71955f146444a`.

Remote RPC marker query confirmed:

| Function | Remote marker result |
|---|---|
| `get_event_lobby_active_state(uuid,timestamptz)` | deployed canonical active-state helper |
| `get_event_deck(uuid,uuid,integer)` | active helper, `event_not_active`, `availability_state`, `primary_photo_path`, `photo_verified`, `premium_badge` |
| `handle_swipe(uuid,uuid,uuid,text)` | active helper, `event_not_active`, `already_swiped`, `participant_has_active_session_conflict` |
| `find_mystery_match(uuid,uuid)` | historical May 1 marker: active helper and `event_not_active`; removed from current schema by `20260609152000_remove_mystery_match.sql` |
| `drain_match_queue(uuid)` | active helper and `event_not_active` |
| `promote_ready_gate_if_eligible(uuid,uuid)` | active helper, `event_not_active`, active-session conflict marker |
| `ready_gate_transition(uuid,text,text)` | inactive-event terminal handling |
| `find_video_date_match(uuid,uuid)` / `join_matching_queue(uuid,uuid)` | deprecated legacy queue markers |
| `leave_matching_queue(uuid)` | cleanup compatibility surface, no session-creation marker |

## Contract Review

Backend:

- Active-event checks are centralized through `get_event_lobby_active_state`.
- Deck, swipe, then-supported Mystery Match, queue drain, promotion, and Ready Gate paths exposed or enforced inactive-event outcomes in the May 1 state. Current schema removes Mystery Match.
- Swipe retry/idempotency returns duplicate/no-op semantics and suppresses notification side effects.
- Busy/in-session users are hidden from normal deck candidates, and direct active-session collisions fail safely.
- Deck payload additions are viewer-safe and exclude private proof/moderation/contact fields by contract and tests.

Web:

- `EventLobby` gates missing, not-registered, not-confirmed, scheduled/not-started, cancelled, archived, draft, ended, and paused states before deck/swipe side effects.
- Swipes go through `swipe-actions`; no app-owned direct `handle_swipe` call was found.
- Media fallback is photo, then avatar, then placeholder with deck-card sizing.

Native:

- Native Event Lobby consumes the final backend/native contract for gating, payload parsing, swipe outcomes, media fallback, and Ready Gate handoff.
- Native side effects are gated behind valid event/user/registration/live state.
- No `expo-av` dependency or import is present; only comments documenting the intentional non-use were found.

Observability:

- Shared taxonomy covers deck empty reasons, swipe results, duplicate suppression, queue drain, Ready Gate, and notification sent/suppressed events.
- No sensitive block/report/moderation details are surfaced to user-facing taxonomy.

## Cleanup Findings

Removed:

- Local ignored junk: `docs/.DS_Store`.

Kept intentionally:

- `docs/audits/event-lobby-deck-deep-dive.md`: status pointer required by prior audit references.
- Event Lobby branch-delta docs: historical provenance for merged streams.
- Event Lobby per-stream verification docs: evidence trail for closure report.
- `docs/audits/recent-hardening-deep-audit-2026-05-01.md`: historical partial audit; now explicitly marked as superseded for final Event Lobby state.
- Surface inventory component candidates: not safe to delete from a static graph alone.
- Ignored `.env*`, `.vercel`, `supabase/.temp`, native iOS generated files, Pods, node_modules, and build output: local environment/generated state, not source cleanup targets.

Tooling tidy:

- `scripts/surface-inventory-audit.mjs` now writes the human interpretation caveat into the generated report so reruns do not erase the no-mass-delete warning.

## Surface Inventory

`npm run audit:surfaces` result:

- orphan pages: `0`
- orphan hooks: `0`
- orphan components: `41`
- reachable modules in graph: `500`

Interpretation: no page/hook deletion is indicated. Component candidates need separate product/route ownership proof before removal.

## Validation Results

- `npm run audit:surfaces`: passed; refreshed surface inventory with `0` orphan pages, `0` orphan hooks, `41` component candidates, and `500` reachable graph modules.
- `npm run test:event-lobby-regression -- --db-dry-run`: passed, including linked Supabase ref verification and a clean `supabase db push --linked --dry-run`.
- `npm run test:hardening-contracts`: passed.
- `npm run typecheck`: passed across core, mobile, and app TypeScript projects.
- `npm run lint`: passed with the existing warning backlog, `0` errors / `210` warnings.
- `npm run build`: passed with existing Vite dynamic-import and chunk-size warnings.
- `git diff --check`: passed.
- Read-only remote RPC marker query: expected Event Lobby active-event, idempotency, queue, Ready Gate, and deck payload markers present.
- Deployed `swipe-actions` source download and SHA-256 compare: local and remote source matched.

## Remaining Risks

- Runtime two-user/three-user staging smoke is still blocked without approved non-production fixtures. This is documented in `docs/golden-path-event-lobby-regression-runbook.md`.
- Super Vibe monetization/product redesign remains a non-blocking product follow-up; backend retry/limit safety is closed.
- Repository-wide lint warning debt remains outside this cleanup stream.

## Launch Posture

Code/cloud contract posture remains launch-ready.

Before external launch signoff, run the Event Lobby staging smoke runbook with approved non-production fixtures and attach results to either this audit or a dated follow-up report.
