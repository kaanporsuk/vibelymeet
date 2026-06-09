# Event Lobby Active Event Contract Verification

Date: 2026-05-01
Branch: `fix/event-lobby-active-event-contract`
Mode: remote verification first, then additive migration hardening. No production data mutation was performed during pre-audit.

2026-06-09 supersession: this verification predates Mystery Match removal and the later direct legacy queue/session RPC removal. Historical rows and patch-plan references to `find_mystery_match`, `find_video_date_match`, or `join_matching_queue` describe the May 1 active-event hardening state only. Current schema drops `find_mystery_match` via `20260609152000_remove_mystery_match.sql` and drops `find_video_date_match(uuid,uuid)` plus `join_matching_queue(uuid,uuid)` via `20260609163130_remove_legacy_queue_session_rpcs.sql`.

## Scope

This stream verified and tightened the backend Event Lobby active-event contract across deck fetch, swipe, then-supported Mystery Match, queue promotion, and direct legacy session paths. It did not change web/native UI, Super Vibe monetization, queue design, or historical migrations.

## Primary Audit Source

Requested source: `docs/audits/event-lobby-deck-deep-dive.md`.

Result: the file is not present in this checkout. `docs/branch-deltas/chore-hardening-audit-cleanup.md` records that the scratch deep-dive was intentionally left untracked and removed because it contained stale pre-hardening claims. Current verification therefore used:

- `docs/audits/event-lobby-production-contract-verification.md`
- `docs/branch-deltas/fix-event-lobby-active-event-contract.md`
- live `supabase db query --linked` function-definition checks
- current repo migrations and static hardening tests

## Remote Verification

Checked project ref:

- `supabase/config.toml`: `schdyxcunwcvddlcshwd`
- `supabase/.temp/project-ref`: `schdyxcunwcvddlcshwd`

Startup state:

- Branch created from `origin/main` at `049a6fe15a7471580b67d75c695a60b22712a3a9`
- Worktree was clean before edits
- GitHub CLI auth available for `kaanporsuk`
- Supabase CLI version: `2.95.4`

Migration status before patch:

- Local latest migration: `20260501220000_premium_credits_observability.sql`
- Remote latest migration: `20260501220000_premium_credits_observability.sql`
- `supabase migration list --linked`: local and remote versions matched through `20260501220000`
- `supabase db push --linked --dry-run`: `Remote database is up to date.`

Docker note:

- `supabase db dump --linked --schema public --file /tmp/vibely_remote_public_schema.sql` was attempted but blocked because Docker was not running.
- Direct Management API SQL via `supabase db query --linked` succeeded and was used for deployed function inspection.

## Functions Inspected

Remote `pg_get_functiondef` was queried for:

| Function | Remote MD5 before patch | Current deployed posture before patch |
|---|---:|---|
| `get_event_deck(uuid,uuid,integer)` | `61cfc877ed62451f73174183c44f3d6c` | Auth guard present, uses old inactive helper, silently returns zero rows when inactive. |
| `handle_swipe(uuid,uuid,uuid,text)` | `f6a7201bf4871b5ad48f5fca44a98d4e` | Auth/registration and old active guard present before `event_swipes`, `video_sessions`, and delegated mutation. |
| `find_mystery_match(uuid,uuid)` | historical May 1 marker | Auth/registration and old active guard were present before delegated session creation; removed from current schema on 2026-06-09. |
| `drain_match_queue(uuid)` | `282bd05410e55cf1dda6e7b100231434` | Auth/registration and old active guard present before delegated drain/promotion. |
| `promote_ready_gate_if_eligible(uuid,uuid)` | `8653fbf87b9901e42159056e2df73381` | Auth/registration and old active guard present before delegated promotion. |
| `ready_gate_transition(uuid,text,text)` | `edc877ec0657cf772259dd5ac4b89483` | `sync`/`mark_ready`/`snooze` detect inactive event through old helper after locking the session row. |
| `find_video_date_match(uuid,uuid)` | `a72768446c41e0a04985506df5a96c5d` | Deprecated legacy surface; returns `deprecated_legacy_queue_surface`; no session creation. |
| `join_matching_queue(uuid,uuid)` | `ad071896f1838c874a456d1e169cf9de` | Deprecated legacy surface; returns `deprecated_legacy_queue_surface`; no session creation. |
| `leave_matching_queue(uuid)` | `3cbf2d353879f303c950815fec09abdf` | Cleanup surface; can clear/end existing state, does not create sessions. |
| `get_event_lobby_inactive_reason(uuid)` | `0d5d765537f8ce6920bc1c044139644d` | Old helper lacks `p_now`, `is_active`, `event_status`, `event_draft`, and `event_not_started`. |
| `is_event_lobby_active(uuid)` | `476b6a946782740b6d71ea9ab6bec107` | Boolean wrapper around old helper. |

Remote schema columns checked:

- `events`: `status`, `event_date`, `duration_minutes`, `archived_at`, `ended_at`; no separate draft/cancelled/archive boolean columns exist.
- `video_sessions`: Ready Gate/date lifecycle fields and provider-prepared fields exist.
- `event_registrations`: `queue_status`, `current_room_id`, `current_partner_id`, `admission_status`, and lobby presence fields exist.

## Deployed vs Repo Divergence

No migration-history divergence was found. Remote function definitions matched the current repo posture by contract markers and current migration lineage.

Contract gaps versus this stream's target:

- No canonical `get_event_lobby_active_state(uuid, timestamptz)` helper existed.
- The old inactive helper could not inject deterministic `p_now` in tests/assertions.
- The old reason taxonomy collapsed scheduled pre-start events into `event_outside_live_window` and did not distinguish `event_draft`.
- `get_event_deck` silently returned an empty deck for inactive events instead of explicit backend rejection.
- Direct legacy `find_video_date_match` and `join_matching_queue` were not active-event bypasses because they are already retired and create no `video_sessions`; this remains documented rather than re-enabled.

## Surface Verdict Before Patch

| Surface | Rejects inactive before patch? | Notes |
|---|---:|---|
| `get_event_deck` | Partial | Guard exists but silently returns zero rows. |
| `handle_swipe` | Yes | Guard runs after actor auth/registration and before target lookup, swipes, sessions, registration updates, or notification outcomes. |
| `find_mystery_match` | Historical only | Guard ran after auth/registration and before base session creation in the May 1 state; current schema removes this RPC. |
| `drain_match_queue` | Yes | Guard runs after auth/registration and before delegated drain. |
| `promote_ready_gate_if_eligible` | Yes | Guard runs after auth/registration and before delegated promotion. |
| `ready_gate_transition` | Yes for `sync`/`mark_ready`/`snooze` | Inactive cleanup runs after locked session row. `forfeit` remains cleanup and delegates to the hardened base. |
| `find_video_date_match` | N/A | Deprecated, returns no session. |
| `join_matching_queue` | N/A | Deprecated, returns no session. |
| `leave_matching_queue` | N/A | Cleanup only; does not create a session and must remain callable for stale cleanup. |
| `swipe-actions` | Yes | Calls `handle_swipe`; inactive outcomes suppress notifications. |

## Patch Plan

New migration: `20260501223000_event_lobby_canonical_active_state.sql`.

Changes:

- Add `get_event_lobby_active_state(p_event_id uuid, p_now timestamptz default now())`.
- Return `is_active`, `reason`, and `event_status`.
- Keep `get_event_lobby_inactive_reason(uuid)` and `is_event_lobby_active(uuid)` as compatibility wrappers over the canonical helper.
- Preserve internal helper posture: `SECURITY DEFINER`, pinned `search_path`, revoked from `PUBLIC`, `anon`, and `authenticated`, granted only to `service_role`.
- Recreate `get_event_deck` to raise `event_not_active` after auth and before base delegation.
- Recreate `handle_swipe`, then-supported `find_mystery_match`, `promote_ready_gate_if_eligible`, and `drain_match_queue` so they use the canonical helper while preserving existing success-path delegation and return shapes. Current schema later removes `find_mystery_match`.
- Add `outcome: "event_not_active"` to inactive `handle_swipe` JSON while preserving `result`, `error`, `reason`, `notification_suppressed`, and `dedupe_reason`.
- Keep direct legacy queue/session surfaces documented as deprecated non-bypasses.

## Rebuild Delta

Schema/RPC contract delta:

- New internal RPC helper: `get_event_lobby_active_state(uuid, timestamptz) returns table(is_active boolean, reason text, event_status text)`.
- Updated internal compatibility helpers: `get_event_lobby_inactive_reason(uuid)`, `is_event_lobby_active(uuid)`.
- Updated public RPC behavior:
  - `get_event_deck(uuid, uuid, integer)` now raises `event_not_active` instead of returning an empty deck for inactive events.
  - `handle_swipe(uuid, uuid, uuid, text)` inactive JSON now includes additive `outcome: "event_not_active"`.
  - Historical May 1 state: `find_mystery_match(uuid, uuid)`, `drain_match_queue(uuid)`, and `promote_ready_gate_if_eligible(uuid, uuid)` used the canonical helper. Current schema removes `find_mystery_match`.
- Updated validation: `supabase/validation/event_lobby_active_event_contract.sql`.
- Added source/static regression: `shared/matching/eventLobbyCanonicalActiveState.test.ts`.
- Updated hardening test runner: `scripts/run_hardening_contract_tests.sh`.

Edge Functions changed:

- None.

Environment/provider changes:

- None.

Deploy requirement:

- Supabase migration deploy required after merge if dry-run shows only `20260501223000_event_lobby_canonical_active_state.sql`.
- No Edge Function deploy required.

## Risks

- Deck clients that treated an empty inactive deck as a soft state will now receive an RPC error. This is intentional for backend contract visibility and matches the stream requirement not to silently return an empty deck.
- Static tests verify ordering and source contracts without mutating production. Production smoke must remain catalog-only unless safe fixtures are provided.
- The compatibility helper reason taxonomy changes pre-start live events from `event_outside_live_window` to `event_not_started`. Ready Gate terminal mapping falls back to `ready_gate_event_inactive` for that reason, which is acceptable for stale/pre-date cleanup.

## Rollback Plan

Historical May 1 rollback plan: add a forward migration that restores the prior `get_event_deck`, `handle_swipe`, then-supported `find_mystery_match`, `promote_ready_gate_if_eligible`, `drain_match_queue`, `get_event_lobby_inactive_reason`, and `is_event_lobby_active` definitions from the then-current deployed base migrations. Do not use this as current guidance: `find_mystery_match` is intentionally removed by `20260609152000_remove_mystery_match.sql`, and current rollback work must not restore it.
