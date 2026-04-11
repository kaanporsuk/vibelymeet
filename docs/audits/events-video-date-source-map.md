# Events + video-date source map

Maps major mechanics to **file-level** evidence. **Baseline** = `_cursor_context/vibely_golden_snapshot_audited.md` + migration manifest frozen zip cutoff (`20260310124838`). **Later handoff** = `docs/events-hardening-phase*-release-audit.md`, `docs/repo-hardening-closure-2026-04-11.md`. **Current HEAD** = files as of investigation.

---

## Edge: deck swipe → match / queue

| Mechanic | Baseline doc | Later handoff | Current HEAD code / SQL |
|----------|--------------|---------------|-------------------------|
| Swipe HTTP entry | §6 **does not** name `swipe-actions` | Phase 3 references EF | `supabase/functions/swipe-actions/index.ts` |
| `handle_swipe` RPC | Types listed RPC in golden §7 | Phase 1–3 redefine semantics | Final body: `supabase/migrations/20260412143000_phase3_legacy_queue_contract_cleanup.sql` (also earlier phases) |
| Web client path | — | swipe-actions only | `src/hooks/useSwipeAction.ts` |

---

## Lobby foreground + participant status

| Mechanic | Baseline | Later | Current HEAD |
|----------|----------|-------|--------------|
| `mark_lobby_foreground` | Not in frozen zip | Phase 1.1 audit | Migration `20260404191500_phase1_1_true_lobby_foreground.sql`; `src/pages/EventLobby.tsx` (visibility + route + 30s refresh) |
| `update_participant_status` | Listed in golden §7 | Phase 1: no longer stamps foreground | `src/hooks/useEventStatus.ts` RPC + **direct** `event_registrations.last_active_at` heartbeat every 30s |
| Heartbeat | — | — | `useEventStatus.ts` lines 53–57 |

---

## Queue: create, TTL, drain, promotion

| Mechanic | Baseline | Later | Current HEAD |
|----------|----------|-------|--------------|
| Queued session creation | `handle_swipe` mutual path | Phase 2 TTL column | `handle_swipe` in `20260412143000_*` sets `ready_gate_status` `queued`, `queued_expires_at` +10m |
| Expiry / cleanup | — | Phase 2 `expire_stale_video_sessions` + cron | `20260404195500_phase2_queue_ttl_ready_gate_sync_daily_gate.sql` |
| Drain / promote | `drain_match_queue` in types | Phase 3 “cleanup-first” | `20260412143000_*` `drain_match_queue`; `src/hooks/useMatchQueue.ts` (calls RPC when `currentStatus` in `browsing`/`idle`) |
| Legacy `join_matching_queue` / `find_video_date_match` | Listed in golden §7 | Phase 3 deprecated | No-ops in `20260412143000_*` |

---

## Ready Gate

| Mechanic | Baseline | Later | Current HEAD |
|----------|----------|-------|--------------|
| RPC introduction | **After** frozen zip (`20260311153000`) | Phase 2 extends | Latest consolidated in `20260412143000_*` (inherits Phase 2 `sync`, expiry hook) |
| Web UX | — | Phase 4A: `ReadyGate.tsx` removed | `docs/repo-hardening-closure-2026-04-11.md`; UI: `src/components/lobby/ReadyGateOverlay.tsx`; hook: `src/hooks/useReadyGate.ts` |
| Deep link | — | — | `src/pages/ReadyRedirect.tsx`; route in `src/App.tsx` per golden snapshot |

---

## Video date + Daily room

| Mechanic | Baseline | Later | Current HEAD |
|----------|----------|-------|--------------|
| `video_date_transition` | Stream 2A migration after frozen zip | Reconnect grace migration | `20260409100000_video_date_reconnect_grace_queue_sync.sql` (supersedes parts of earlier) |
| Daily token policy | — | Phase 2 audit “tightened gate” | `supabase/functions/daily-room/index.ts` `canIssueVideoDateRoomToken` |
| Web page | — | — | `src/pages/VideoDate.tsx` (`enter_handshake`, `vibe`, `complete_handshake`, `end`, beforeunload fetch) |
| Reconnect | — | — | `src/hooks/useReconnection.ts` (`sync_reconnect`, `mark_reconnect_*`) |

---

## Auth / admission overlay (affects who can call RPCs)

| Mechanic | Current HEAD |
|----------|--------------|
| Hardened `handle_swipe`, `drain_match_queue`, etc. | `supabase/migrations/20260405103000_event_admission_rpc_auth_stripe_settle.sql` (large file; JWT binding + confirmed cohort) |

**Note:** Final semantics are the **last** migration that `CREATE OR REPLACE`s each function (Phase 3 after admission migration order — verify with `grep` + migration filename sort when patching).

---

## Docs explicitly mixing eras (read with care)

| File | Issue |
|------|--------|
| `_cursor_context/vibely_golden_snapshot_audited.md` | §6 EF list (28) and §7 RPC list **incomplete vs HEAD**; banner warns verify `App.tsx` |
| `_cursor_context/vibely_migration_manifest.md` | Clearly separates **101 frozen** vs **post-repair** migrations — **use this** for chronology |
| `docs/events-hardening-phase*-release-audit.md` | Accurate for **their** date scope; **not** a substitute for March 10 zip contents |

---

## Requested-but-missing narrative docs

These names from the investigation brief were **not found** in-repo (use `_cursor_context/` + `docs/vibely-canonical-project-reference.md` instead):  
`vibely-source-of-truth-consolidated-2026-03-24.md`, `vibely-master-reference-consolidated.md`, `vibely-project-reference-march2026.md`, `vibely_canonical_project_reference_GPT.md`, `vibely_canonical_project_reference_March23.md`.
