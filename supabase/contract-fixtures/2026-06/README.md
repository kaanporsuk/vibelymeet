# Video Date Backend Contract Fixtures — June 2026 Truth Pin

**Reference only. Never executable. Never deployed.**

These files pin the observable Video Date backend contract as it existed live in
project `schdyxcunwcvddlcshwd` on **2026-06-11**, immediately before the staged
Video Date re-foundation (10-PR rebuild sequence, PR 1). Every later rebuild PR
proves behavior preservation against this snapshot.

Do not:

- run any of these files against any database (they are catalog dumps, not migrations);
- edit them to "fix" anything — if live state changes legitimately, re-dump and
  commit the diff with an explanation;
- treat them as the source of truth going forward — the live database is the
  source of truth; this directory is the source of *history*.

## How these were captured

All content is raw output of read-only catalog queries via the Supabase
Management API (`pg_get_functiondef`, `pg_get_triggerdef`,
`information_schema.columns`, `cron.job`). Files contain pure catalog output
with no added headers, so a future re-dump diffs cleanly against this snapshot.

## Layout

### `functions/private_video_date/` (25 files)

`pg_get_functiondef()` for every function in schema `private_video_date` — the
internal `vdt_*` delegation chain behind `public.video_date_transition`.
All share the signature `(p_session_id uuid, p_action text, p_reason text)`.

### `functions/public-heads/` (14 files)

`pg_get_functiondef()` for the public RPC heads that constitute the
client/Edge-facing Video Date surface:

`video_date_transition`, `ready_gate_transition`, `video_session_mark_ready_v2`,
`mark_video_date_daily_joined`, `mark_video_date_daily_alive`,
`mark_video_date_remote_seen`, `claim_video_date_surface`,
`release_video_date_surface_claim`, `video_session_handshake_auto_promote_v2`,
`finalize_video_date_entry_deadline`, `finalize_video_date_handshake_deadline`,
`expire_stale_video_sessions`, `confirm_video_date_entry_prepared`,
`submit_post_date_verdict_v3`.

### `snapshots/`

- `public_archived_functions_manifest.json` — the 91 public functions whose
  names match `_20[0-9]{6}` (date-suffixed archived versions): name, identity
  arguments, and `md5(pg_get_functiondef())`. Full bodies are intentionally not
  stored (≈10k lines of dead versions); the hash pins identity so any later
  DROP can prove exactly what was dropped, and any silent change is detectable.
- `cron_jobs.json` — all live `cron.job` rows (jobid, jobname, schedule,
  command, active). Includes non-Video-Date jobs on purpose: this is the whole
  scheduler surface, so rebuild PRs can prove they did not disturb unrelated jobs.
- `video_sessions_triggers.sql` — `pg_get_triggerdef()` for the 4 non-internal
  triggers on `public.video_sessions`.
- `video_sessions_columns.json` — ordered column list of `public.video_sessions`
  (name, type, nullability, default).

## Intentional post-pin re-dumps

- `functions/public-heads/video_date_transition.sql` was re-dumped on
  2026-06-11 after rebuild PR 2 (migration
  `20260611175511_video_date_transition_single_body.sql`) replaced the
  delegation shell with a single self-contained body and dropped schema
  `private_video_date`. The 25 `functions/private_video_date/` dumps remain as
  the pre-rebuild history of the dropped chain.
- `functions/public-heads/claim_video_date_surface.sql`,
  `mark_video_date_daily_alive.sql`, `mark_video_date_daily_joined.sql`, and
  `mark_video_date_remote_seen.sql` were re-dumped on 2026-06-11 after rebuild
  PR 3 (migration `20260611190852_video_date_evidence_single_bodies.sql`)
  replaced each delegation shell with a single self-contained body and dropped
  the 26 historical public generations of these families (including
  `vd_alive_strict_provider_base`, a live chain layer surfaced during the
  rebuild inventory). `vd_daily_webhook_terminal_truth_base` is intentionally
  retained (Daily webhook ledger family).
  `release_video_date_surface_claim.sql` was already a single body and is
  unchanged. The dropped generations' identities remain pinned in
  `snapshots/public_archived_functions_manifest.json`.

## Re-verifying against live

Dump the same queries again and `diff` against this directory. Any difference
is either (a) an intentional rebuild-PR change that must be called out in that
PR's description, or (b) drift that needs investigation.
