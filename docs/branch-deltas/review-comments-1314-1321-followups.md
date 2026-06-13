# Review Comments 1314-1321 Follow-ups

Date: 2026-06-13

Scope: thread-aware GitHub review-comment follow-up for merged PRs #1314 through
#1321 (#1315 was closed and re-merged on the same branch as #1316). No
Copilot-authored review threads exist in this repository; all 10 threads are
Codex (`chatgpt-codex-connector[bot]`). Each thread was re-triaged against
current `main` HEAD — several were already resolved by later PRs or in-PR
commits. This batch ships one migration (`update_participant_status` recreate)
and one Edge Function change (`video-date-room-cleanup`), plus a contract-test
pin and operator-tooling hardening.

## Addressed Threads

- **#1316 P2 — in-gate release guard ignored terminal sessions.**
  `update_participant_status`' first guard short-circuits *any* self-downgrade
  (browsing/idle/in_survey/offline) whenever the registration is still
  `in_ready_gate`/`in_entry`/`in_date` with a non-null `current_room_id` —
  regardless of whether that room points at an already-ended session. That is the
  exact stale terminal-pointer state migration `20260612221535` set out to clear:
  an in-gate registration whose session has ended could never reach the
  `v_clear_room` logic, so it stayed pinned to a dead room pointer. The second
  guard already does the correct active-only check (it returns only when the
  session is genuinely live/joined), so the first guard's unconditional return was
  the gap. Fix (migration `20260613131415`, one-site, full live-body recreate from
  `20260613015625`): the first guard now adds a terminal-session `NOT EXISTS`
  exclusion, so it blocks the downgrade only while the session is *live*. Once
  terminal, the call falls through — a release status computes `v_clear_room=true`
  and the UPDATE clears `current_room_id`/`current_partner_id`; an `in_survey`
  target writes `queue_status='in_survey'` (downstream survey claim still gates on
  `video_date_session_is_post_date_survey_eligible_v2`). The change can only ever
  *allow* a previously-blocked release and cannot let a client escape a live gate
  (sessions are terminal one-way → no TOCTOU). Regression pin added in
  `videoDateAcceptFollowupContracts.test.ts` ("2a-followup").

- **#1317 P2 — reconciliation failures were not propagated to the result.**
  The merged `video-date-room-cleanup` response computed `ok: providerRateLimited
  === 0` and status `429|200` with no regard for the reconciliation pass: a
  `marker_check_failed` (could not read the gate) or a ran-but-failed pass (Daily
  listing 500/429/401, marker write failure) still returned `ok: true` HTTP 200.
  Since stage 2 repoints the `synthetic-video-date-monitor` orphan probe (which
  treats `response.ok && payload.ok !== false` as success) at this function, a
  broken reconciliation lane would be masked. Fix: derive
  `reconciliationFailed` (`ran:false → reason==='marker_check_failed'`; else
  `ok===false`; `not_due` stays green), set response `ok: false` + HTTP 500 on a
  genuine failure (rate-limit 429 still takes precedence), and emit a
  `reconciliation_failed` field in both the log and the response.

- **#1319 P2 — postgres_changes pin did not enforce the listener shape.**
  `videoDateValidationFollowupContracts.test.ts` pinned the two sanctioned
  vibe-questions listeners by channel name + occurrence count, but not by shape —
  a sanctioned client could widen its subscription (drop the `id=eq.${sessionId}`
  filter, change event/table) and still pass. Added `VIBE_LISTENER_SHAPE`
  assertions requiring `event: "UPDATE"`, `table: "video_sessions"`, and
  ``filter: `id=eq.${sessionId}` `` for each sanctioned file. (The thread's first
  half — derive the scan recursively instead of a hard-coded list — was already
  fixed in-PR by the author in `0bab263a`.)

- **#1320 P2 — load probe accepted a missing deck token.** When
  `get_event_deck_v3` returned a partner card without a `deck_token`,
  `scripts/video-date-load-probe.mjs` still sent `p_deck_token: null` into
  `handle_swipe_v2` and counted the swipe, so the probe could report a
  "successful" tokenized swipe it never actually exercised (the single reserved
  partner card resolves through the legacy no-token branch). Fix: a missing token
  now records a `swipe:missing_deck_token` error and skips that swipe instead of
  faking the tokenized path.

- **#1315 P2 — load probe could exit 0 with leftover fixtures.** Cleanup
  `catch`ed and only logged each DELETE failure, and the zero-residue query was
  only logged — so `npm run loadprobe:video-date` could exit 0 after leaving
  disposable users/events behind in the linked project. Fix: accumulate cleanup
  errors, sum the residue counters, record both on `report.cleanup`, and set
  `process.exitCode = 1` (with a prominent `PROBE CLEANUP FAILED` log) when either
  is non-zero unless `--keep` is set. `process.exitCode` is used rather than
  throwing out of the `finally` block so a primary run error from the try body is
  not masked (the residue check itself is now `.catch`-wrapped so a failed query
  records an error instead of escaping `finally`).

## Resolved Before This Branch (no action needed)

- **#1314 P1 (active-doc-map not updated):** the round-2 branch
  (`claude/vd-accept-followups-2`) merged as **#1316** even though #1315 was
  closed; `docs/active-doc-map.md` already carries the operator-tooling /
  follow-up row, so the index is current.
- **#1317 P2 (honor `dry_run` before session deletes):** the merged function now
  gates the entire session-row fetch behind `if (!reconcileDryRun)` with an
  explicit read-only comment — the session pass (room deletes, marker stamps) is
  skipped entirely in dry-run, not just the reconciliation deletes.
- **#1319 P2 (cover all date-surface files):** fixed in-PR by the author
  (`0bab263a`) — the pin scans eight date-surface roots recursively with a vacuity
  guard (≥40 files; both sanctioned files must be seen).

## Intentional Boundaries

- **#1321 P1 (preserve old `queue_status` until clients are upgraded):** the
  `in_handshake → in_entry` writer flip (migration `20260613015625`) is already
  cloud-applied; Supabase is forward-only, so the server flip cannot be reversed,
  and reversing it would contradict the shipped coordinated change. The current
  client source (web + native + `shared`) already accepts **both** `in_entry` and
  `in_handshake` in every active-status filter (verified by grep across
  `useActiveSession`, `ReadyGateOverlay`, `videoDateRouteDecision`, etc.), which
  is the documented one-release bridge. The only residual exposure is *old
  released native binaries* that predate the `in_entry` tolerance — a
  rollout-sequencing concern already bounded by the project's pre-launch
  disposable-data posture (no production builds in the wild) and tracked in the
  quarantine note: drop the legacy `in_handshake` read-tolerance only after the
  web deploy + a native release carrying `in_entry`. No code change in this
  branch.
- This is review-comment hardening. The only live behavior changes are the
  #1316 release-guard passthrough (a strict correctness fix that can only allow a
  previously-stuck release) and the #1317 reconciliation-failure surfacing (an
  observability fix); both preserve signatures, grants, and security posture.
  Acceptance remains a fresh two-user run through persisted `date_feedback`.

## Validation

- `npm run typecheck` (core + apps/mobile + tsconfig.app) — clean
- `npm run lint` — clean
- `npm run test:video-date:red-flags` — pass
- `npm run test:video-date-v4` — pass (incl. the new `2a-followup` pin and the
  strengthened listener-shape pin)
- `npm run audit:video-date-remote-frame` — pass
- `node --check scripts/video-date-load-probe.mjs` — pass
- `npx supabase db push --dry-run --linked` — only `20260613131415` pending;
  `npx supabase db lint --linked` — clean (pre-existing shadowed-variable warnings
  in unrelated functions only)
