# Video Date Expire-Stale Bounding Deferral

The remaining hardening branch intentionally does not rewrite the historical
`expire_stale_video_sessions()` body. The current deployed function has been
replaced many times across migrations and contains several terminal-state,
snooze, ready-gate, and observability paths. Copying that full body into a new
bounded implementation without a DB-executed migration rehearsal would be a
higher-risk change than the audit item itself.

Current state:

- `20260501103000_video_date_remaining_hardening.sql` wraps the historical
  function and bounds only the new `repair_stale_video_date_prepare_entries`
  path with a `p_limit`.
- The historical delegated body remains unbounded and is explicitly documented
  in the migration comment.
- This is a tracked operational risk, not a closed item.

Future closure plan:

1. Rehearse a DB migration against a production-like copy.
2. Extract the current historical function body from the live database with
   `pg_get_functiondef`.
3. Convert each stale-session loop to a bounded candidate CTE using
   `FOR UPDATE SKIP LOCKED` and `LIMIT`.
4. Keep the function idempotent so pg_cron can call it repeatedly until it
   returns zero.
5. Compare affected session IDs and observability rows against the historical
   function before applying in production.
