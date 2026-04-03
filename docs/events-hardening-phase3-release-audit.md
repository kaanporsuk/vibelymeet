# Events Hardening — Phase 3 Release Audit

Date: 2026-04-04

## Scope

Cleanup/consolidation pass after Phase 1, 1.1, and 2.

- Retire safe legacy queue-era surfaces with compatibility-first deprecation.
- Normalize active swipe/session payload contract.
- Reduce lifecycle ambiguity without changing canonical product behavior.
- Keep rebuild docs/inventory/manifests aligned.

## Files changed

- `supabase/migrations/20260412143000_phase3_legacy_queue_contract_cleanup.sql`
- `supabase/functions/swipe-actions/index.ts`
- `src/hooks/useSwipeAction.ts`
- `_cursor_context/vibely_migration_manifest.md`
- `_cursor_context/vibely_schema_appendix.md`
- `_cursor_context/vibely_machine_readable_inventory.json`
- `docs/events-hardening-phase3-release-audit.md`

## Migration added

- `20260412143000_phase3_legacy_queue_contract_cleanup.sql`

## Legacy surface disposition

- `find_video_date_match`:
  - Classification: **deprecated**
  - Action: converted to compatibility no-op response (`deprecated_legacy_queue_surface`), no queue-era writes.
- `join_matching_queue`:
  - Classification: **deprecated**
  - Action: converted to compatibility no-op response (`deprecated_legacy_queue_surface`), no queue-era writes.
- `leave_matching_queue`:
  - Classification: **kept for compatibility**
  - Action: retained cleanup behavior, now returns `deprecated: true` contract marker.
- active use of `leave_matching_queue` in web/native:
  - Classification: **already retired from active path**
  - Action: no active app callsites in `src/` or `apps/mobile/`; compatibility surface retained for older clients.

## Contract cleanup

### Swipe response payload (before/after)

| Surface | Before | After |
|---|---|---|
| `handle_swipe` match/match_queued payload | mixed usage (`match_id` often used as session id; `video_session_id` inconsistently present after later drift) | canonical `video_session_id` + `event_id`; `match_id` preserved as legacy alias for compatibility |
| `swipe-actions` edge response | passed-through `swipe_recorded` alias accepted downstream | normalizes `swipe_recorded` -> `vibe_recorded` at edge boundary |

### Queue/ready/date state values (before/after)

| Domain | Before | After |
|---|---|---|
| Legacy queue RPC writes | `join_matching_queue`/`find_video_date_match` could write queue-era `searching`/`matched` states | deprecated compatibility no-op; no new queue-era writes from these surfaces |
| Active queued flow | swipe-first + queued sessions (with potential drift from later function rewrites) | explicitly re-anchored to queued TTL + cleanup semantics and swipe-first path |
| Immediate ready-gate activation | could drift to queue-status-only checks in later rewrites | explicit strict 60s true lobby foreground recency preserved |
| `leave_matching_queue` | legacy compatibility behavior only | kept for compatibility; marked deprecated in response |

## Proof: active web/native path does not depend on retired legacy surfaces

- No active RPC invocation found in app code for:
  - `find_video_date_match`
  - `join_matching_queue`
  - `leave_matching_queue`
- Active app flow uses:
  - swipe: `swipe-actions` -> `handle_swipe`
  - queued activation: `drain_match_queue`
  - ready gate/date lifecycle: `ready_gate_transition`, `video_date_transition`

## Locked-rule preservation check

- Swipe-first matching remains canonical.
- Immediate ready-gate still requires true lobby foreground recency within 60 seconds.
- Queued matches remain allowed with canonical queued TTL/cleanup semantics.
- No payment-settlement or payment-flow logic changed.

## Rebuild delta/docs/inventory updates included

- Migration manifest: Phase 3 addendum.
- Schema appendix: Phase 3 delta + explicit deprecated legacy queue surfaces.
- Machine-readable inventory: migration count/last migration updated + Phase 3 hardening notes.
