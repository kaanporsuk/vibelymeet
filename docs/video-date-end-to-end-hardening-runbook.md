# Video Date End-to-End Hardening Runbook

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
- Ready Gate `both_ready` extends the authoritative join window to at least 15 seconds from the second ready tap.
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
8. Handshake starts at 60s ±1s on both clients.
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
