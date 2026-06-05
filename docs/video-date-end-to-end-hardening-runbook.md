# Video Date End-to-End Hardening Runbook

Current recovery overlay (2026-06-05): this runbook is historical context for the earlier hardening chain. For current Video Date recovery work, start with `docs/video-date-success-command-center.md`. Functional Video Date code landed in PR #1200 at merge commit `fbca4996a096273914ee650b556ba7994477aa5e`; current terminal-survey lifecycle hardening adds `20260605135616_video_date_terminal_survey_lifecycle_hardening.sql`, `20260605143637_video_date_terminal_room_metadata_backfill.sql`, `20260605144003_video_date_terminal_room_metadata_corrective_backfill.sql`, `20260605145306_video_date_terminal_room_cleanup_preserve_metadata.sql`, `20260605145926_video_date_terminal_room_metadata_final_repair.sql`, `20260605150130_video_date_terminal_room_metadata_historical_delete_marker.sql`, and `20260605152058_video_date_pending_survey_registration_repair.sql`, plus redeployed cleanup/outbox Edge Functions that preserve terminal room metadata and stamp provider-delete markers. Verify current Git/Supabase state before assuming deployment, and treat the manual match -> survey acceptance run as still unproven until a fresh test completes.

Branch: `fix/video-date-end-to-end-hardening`

## Rebuild Delta

- Routes changed: event lobby convergence after survey, Ready Gate overlay date handoff, web video date lifecycle.
- Edge Functions changed: none.
- Schema/RPC changed: `spend_video_date_credit_extension`, `submit_post_date_verdict`, `check_mutual_vibe_and_match`, `ready_gate_transition`, `handle_swipe`; new table `video_date_credit_extension_spends`.
- Env/secrets changed: none.
- Provider/dashboard changes: none.
- Docs updated: this runbook and `supabase/validation/video_date_end_to_end_hardening.sql`.

Supabase cloud deploy is required before production use because the client now sends `p_idempotency_key` and depends on the new verdict/Ready Gate/super-vibe semantics. Do not deploy with `supabase db push` until the PR is reviewed.

## Contract Notes

- Extra Time is server-authoritative. Clients must use `added_seconds` and `date_extra_seconds` returned by `spend_video_date_credit_extension`; button-local minutes are display hints only.
- Post-date verdict is survey-eligible only when `video_sessions.ended_at` and `date_started_at` are both present and `ended_reason` is not a pre-date/blocked/handshake failure reason.
- Ready Gate `both_ready` extends the authoritative provider handoff to `45s` from the second ready tap, but expired gates are not reopened.
- Provider preparation makes the date routeable and persists Daily metadata; the visible handshake timer starts only after both participants have active latest Daily presence through `mark_video_date_daily_joined(...)`. `participant_*_joined_at` alone is not proof if a later Daily `participant.left` / `participant_*_away_at` marks that participant away. Later client/provider joins and canonical remote-seen repairs must advance latest evidence and clear reconnect grace when they prove return.
- A same-session, same-room Daily call in joining/joined state should be reused or waited on, not torn down and rebuilt. Cleanup/rebuild is expected only for terminal, mismatched, or unrecoverable call state and should emit `daily_call_cleanup` diagnostics.
- Daily `participant-left` is local transport evidence first. Backend `mark_reconnect_partner_away` should happen only after local transport grace expires with `p_reason = daily_transport_grace_expired`.
- Browser `visibilitychange` is soft telemetry during active Daily handoff/warm-up/date and should not mark self away while Daily is joining/joined.
- Ended sessions with survey-required encounter evidence must open `PostDateSurvey` on `/date/:sessionId` and stop Daily start/retry, surface claim, reconnect, and peer-missing loops.
- Historical remote-seen/date-entry proof makes an ended session survey-eligible, but it must not suppress current peer-missing UI after later Daily leave/rejoin churn. Only terminal survey truth suppresses peer-missing.
- After `date_started_at`, peer absence should terminalize with survey-eligible `partner_absent_after_confirmed_encounter` instead of pre-date `partial_join_peer_timeout`.
- `in_survey` is sticky until the current user submits `date_feedback`; client `offline`/`idle`/`browsing` status writes must not clear it while a survey-eligible ended session is pending.
- Terminal timeout/replay/already-ended responses should preserve or repair `daily_room_name` / `daily_room_url`; cleanup workers must stamp `daily_room_provider_deleted_at` / `daily_room_provider_delete_reason` instead of nulling room metadata, already-ended survey-eligible rows with missing/non-canonical Daily metadata were repaired and marker-backfilled through `20260605150130`, and pre-hardening downgraded registrations still pointing at pending surveys were restored through `20260605152058`.
- Web refresh/close does not send `video_date_transition('end')`; reconnect/away semantics and server cleanup own recovery.
- Event ending mid-date policy: do not interrupt a date that already reached `date_started_at`; prevent new promotions through event status checks, then route survey completion away from the lobby if the event is no longer live.

## Operator Diagnostics

Run read-only diagnostics from:

```bash
supabase/validation/video_date_end_to_end_hardening.sql
```

The pack checks:

- idempotency ledger presence
- spend RPC idempotency-key signature
- verdict rows that would now be rejected
- stale Ready Gates
- registrations pointing at ended sessions
- long-running handshakes beyond the visible 60s + 10s window

## Manual QA Script

1. Two test accounts join same live event.
2. Both enter lobby.
3. User A vibes User B; User B vibes User A.
4. Ready Gate opens for both.
5. Both tap Ready.
6. Verify second Ready tap → date route begins within 1–2s.
7. Daily connects and both remote videos appear.
8. After both Daily participants have active latest presence, with no later `participant.left` / `participant_*_away_at`, the handshake starts at 60s ±1s on both clients.
9. One-sided Vibe waits into 10s grace.
10. Both Vibe enters date.
11. Extra Time +2min extends both clients by 120s.
12. Extended Vibe +5min extends both clients by 300s.
13. Refresh one client during handshake and during date; it restores accurately.
14. Background/foreground native during date; reconnect works.
15. End date; survey opens for both.
16. One Vibe + one Pass creates no match.
17. Both Vibe creates exactly one match.
18. After survey:
    - if queued match exists, next Ready Gate opens;
    - if no queued match, deck resumes.
19. Force event end while date is active; active date completes naturally, no new dates are created, survey routes safely.
20. Run stuck-state SQL diagnostics and confirm no stale `in_ready_gate`, `in_date`, `in_survey`, or orphan Daily room rows.
21. Simulate a short Daily leave/rejoin under 12s and confirm backend reconnect grace does not terminalize the session.
22. Simulate a real prolonged absence and confirm backend reconnect grace ends the session correctly.
23. Confirm no `/date` <-> `/ready` cycling after terminal survey truth; `/date/:sessionId` should host survey recovery.
24. Simulate post-encounter peer disappearance after `date_started_at`; confirm `partner_absent_after_confirmed_encounter` or another survey-eligible terminal path, sticky `in_survey`, and survey completion for both users.
25. Confirm terminal rows keep deterministic Daily room metadata for support forensics.

## Validation Commands

Run from repo root:

```bash
git status --short
npm run typecheck
npm run lint
npm run build
npx tsx --test shared/matching/*.test.ts
cd apps/mobile && npm run typecheck
cd apps/mobile && npm test
supabase migration list
supabase db push --linked --dry-run
```

Only run commands that exist and are safe in the current environment. Do not run live `supabase db push` without explicit approval.
