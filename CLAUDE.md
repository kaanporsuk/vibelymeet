# Claude Operating Note

For any Vibely Video Date, Ready Gate, Daily.co, event-lobby handoff, notification outbox, or post-date survey task, start with:

- `docs/video-date-success-command-center.md`
- `docs/active-doc-map.md`
- `AGENTS.md`

Update `docs/video-date-success-command-center.md` after every material investigation, code change, migration, deployment, manual test, or newly observed failure. Do not treat static tests or partial route entry as proof of recovery; the bar is a fresh end-to-end successful Video Date run from match through post-date survey completion.

Current recovery baseline: PR #1190 is merged on `main` at `b72e487d65972566e63f508d023cf2e1e886734a`, and Supabase migration `20260604142017_video_date_active_presence_join_guard.sql` is applied to project `schdyxcunwcvddlcshwd`. This is not acceptance proof; a fresh manual two-user run is still required.

Do not equate `both_ready`, route entry, Daily room creation, or `participant_*_joined_at` with a successful Video Date. Active Daily co-presence requires latest joined presence for both users without a later `participant.left` / `participant_*_away_at`; verify webhook ledger rows, remote media evidence, `date_started_at`, and survey completion.
