# Review Comments 1298-1305 Follow-ups

Date: 2026-06-13

Scope: thread-aware GitHub review-comment follow-up for merged PRs #1298 through
#1305. No Copilot-authored review threads exist in this repository; all threads
are Codex (`chatgpt-codex-connector[bot]`). Each thread was re-triaged against
current `main` HEAD (post #1306-#1321), because the rebuild's later ops purge,
test curation, and validation follow-ups already resolved several of them.

## Addressed Threads

- **#1299 P2 — session-row cache re-poisoning (`videoDateSessionRow.ts`).**
  A default mount-path read and a `{ fresh: true }` recovery read now run
  concurrently on split in-flight keys, but both wrote `rowRecent` stamped with
  resolve time, so an older default read that finished last could overwrite the
  fresh read's post-terminal row and route the next 300ms reader off stale
  truth. Both web (`src/lib/videoDateSessionRow.ts`) and native
  (`apps/mobile/lib/videoDateSessionRow.ts`) now stamp the cache with the
  read's *issue* time and only overwrite when the in-flight read started at or
  after the cached entry, so an older read can no longer undo a newer one.

- **#1300 P2 — native post-mutation verification read cached pre-mutation truth
  (`apps/mobile/lib/videoDateApi.ts`).** `recordEntryDecision`'s verification
  `fetchTruth` and `completeEntry`'s post-RPC `truthAfter` read flowed through
  `fetchVideoSessionDateEntryTruth`, which reuses the 300ms snapshot and row
  caches. Within 300ms of any date-route read, a persisted Vibe/Pass could look
  like `decision_not_persisted`, triggering a spurious retry / false save
  failure. `fetchVideoSessionDateEntryTruth` now takes `{ fresh }` and threads
  it to both `fetchVideoDateStartSnapshot` (new `{ fresh }` option, mirroring the
  row helper) and `fetchVideoDateSessionRow`; the two mutation-verification call
  sites pass `{ fresh: true }`. Default route-guard/hydration reads still share
  the cache. Web's verification path already reads uncached
  (`src/lib/videoDateSessionTruth.ts`), so this is native-only.

- **#1301 P3 — public-head fixture count (`contract-fixtures/2026-06/README.md`).**
  The header said `(14 files)` and the inline list omitted the two PR-8 v2 heads.
  Updated to `(16 files)` and added `video_session_forfeit_v2` and
  `video_session_date_timeout_v2`. The code list
  (`scripts/check-contract-fixture-drift.mjs`, `videoDateBackendTruthPinContracts.test.ts`)
  already carried both; only the README lagged.

- **#1304 P1 — terminal sessions reported as actionable
  (`video_date_ready_gate_actionability_v1`).** The single-body rewrite (PR
  #1304) evaluated the non-ready-gate ownership shortcut
  (`state IS DISTINCT FROM 'ready_gate'` → `ok/success: true`,
  `non_ready_gate_owned`) *before* the terminal `SESSION_ENDED` branch. An ended
  session has `state = 'ended'`, which satisfies the DISTINCT-FROM test, so
  terminal rows were reported as actionable; callers (`video_session_mark_ready_v2`,
  `video_date_transition.prepare_entry`) could churn on no-longer-mutable rows
  instead of returning terminal immediately. Forward migration
  `20260613113508_review_comments_1298_1305_actionability_terminal_order.sql` is
  a pure-reorder `CREATE OR REPLACE` (verbatim from the live `20260611215259`
  body) that moves the terminal check ahead of the non-ready-gate shortcut,
  restoring the pre-rebuild order that
  `readyGatePartialReadyDefinitiveClosure.test.ts` already pins on the
  pre-rebuild migration. A new assertion in
  `videoDateReadyGateSingleBodyContracts.test.ts` (in the v4 + red-flags
  batteries) now pins terminal-first ordering against this live single body so it
  cannot regress again. No signature or grant change.

- **#1305 P2 — validation packs cast a dropped cleanup RPC.** PR #1305 folded and
  dropped `expire_stale_video_sessions_bounded(integer)` and its
  `*_202605031300_base` / `*_202605060900_base` helpers into
  `public.expire_stale_video_sessions()`. Two operator validation packs still
  cast the dropped signature to `regprocedure`, which aborts the whole pack with
  `undefined_function` under `psql -v ON_ERROR_STOP=1`:
  - `supabase/validation/video_date_prepare_entry_lease.sql` — the
    `expire_cleanup_preserves_active_lease_and_terminalizes_expired_lease` and
    `renamed_prepare_lease_bases_*` checks now target
    `public.expire_stale_video_sessions()` and assert the folded behavior
    (`expire_stale_video_date_phases_bounded`, `repair_stale_video_date_prepare_entries`)
    and that the archived bases are folded/dropped.
  - `supabase/validation/stale_ready_gate_room_blocker_repair.sql` — the
    `expire_cleanup_wraps_stale_room_metadata_repair` and
    `stale_cleanup_base_name_is_not_truncated` checks now target the folded body
    (`terminalize_stale_pre_date_ready_gate_blockers`, `recover_ready_gate_missing_rooms_v1`)
    and assert the abbreviated base is dropped while the fold target exists.
  Check names referenced by `staleReadyGateRoomBlockerRepair.test.ts` were kept;
  both that test and `videoDatePrepareEntryLease.test.ts` stay green.

## Resolved Before This Branch (no action needed)

- **#1299 P2 (Sprint 7 ops health validation):** the
  `video_date_sprint7_safety_privacy_ops.sql` pack and all `queue_drain_*`
  assertions were removed by the later validation curation; nothing references
  them.
- **#1301 P2 (trailing blank line in `video_sessions_triggers.sql`):** the
  fixture already ends with a single newline; `git diff --check` is clean.
- **#1302 P2 (validations cast dropped `private_video_date` helpers):** already
  retargeted — the live SQL uses non-raising `to_regprocedure(...) is null`
  assertions / public targets, with the `private_video_date` references left as
  comments only.
- **#1302 P1 (stale private-chain contract tests):**
  `reviewComments1291_1298Followups.test.ts` was deleted in the test curation and
  `videoDateEndToEndHardening.test.ts` no longer references the dropped `vdt_*`
  helpers.

## Intentional Boundaries

- `video_date_prepare_entry_lease.sql`'s
  `confirm_prepare_entry_clears_lease_after_success` check still asserts markers
  (`confirm_vde_prepared_202605031300_base`, the inline `IF v_success THEN` lease
  clear) that PR #1305 relocated when `confirm_video_date_entry_prepared` was
  folded to delegate to `confirm_vde_event_inactive_base_v1`. This check returns
  `false` but does **not** abort the pack (its cast target still exists) and was
  **not** in any Codex thread for #1298-#1305. Retargeting it correctly requires
  mapping the `confirm_vde_*_base_v1` delegation chain, so it is deferred to a
  dedicated validation-curation pass rather than expanded here.
- These operator validation packs (`supabase/validation/*.sql`) are read-only and
  run by hand; they are not wired into `test:video-date-v4`. The fixes restore
  runnability after the PR #1305 drops; they are not product acceptance. The
  acceptance bar remains a fresh disposable two-user production run through both
  users' persisted `date_feedback`.
- This is review-comment hardening and cloud-alignment work. The actionability
  reorder is the only live behavior change and is a strict correctness fix
  (terminal sessions short-circuit to `SESSION_ENDED`); no signature, grant,
  surface, or non-terminal branch behavior changed.
