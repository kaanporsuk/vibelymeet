# Branch Delta — codex/remove-ready-gate-entry-proof-telemetry

Simplification PR 1: remove Ready Gate mount entry-proof telemetry (PR #1230-era proof scaffolding, implicated in the 2026-06-10 lock convoy). Full audit + verification evidence in `docs/video-date-success-command-center.md` ("2026-06-11 Simplification PR 1").

| Change | Detail |
| --- | --- |
| Deleted | `src/lib/readyGateEntryProof.ts`, `apps/mobile/lib/readyGateEntryProof.ts`, `shared/matching/readyGateEntryProofContracts.test.ts` |
| Client removals | Mount-telemetry effect + `isReadyGateEntryProofStatus` + proof-key ref removed from web `ReadyGateOverlay`, native `ReadyGateOverlay`, native `/ready/[id]` |
| Migration `20260611091620_remove_ready_gate_entry_proof.sql` (cloud-applied) | Redefines `video_date_partial_ready_diagnostics_v1` without `video_date_ready_gate_entries` laterals; drops `record_video_date_ready_gate_entered_v1(uuid,text,text,text,text,text,text)`, `video_date_ready_gate_entries`, `video_sessions.ready_gate_participant_{1,2}_entered_at` |
| TTL decision | The RPC's 45s first-entry TTL extension is NOT relocated; Ready Gate timing owned by session creation + `mark_ready` |
| Tests | New `readyGateEntryProofRemovalContracts.test.ts` (absence + drop + no-TTL-relocation + 15s timeout config pin, wired into v4 chain); parity/57014 tests keep warmup/prepare-entry intent minus proof assertions |
| Types | Regenerated: 117 pure deletions |

Validation: typecheck 0, lint clean, v4 suite 0 failures, red-flags 0, event-lobby regression 0, linked DB lint clean (error level), live catalog markers confirm drops + diagnostics probe `ok:true`, post-push dry-run up to date.
