# Codex Operating Note

For any Vibely Video Date, Ready Gate, Daily.co, event-lobby handoff, notification outbox, or post-date survey task, start with:

- `docs/video-date-success-command-center.md`
- `docs/active-doc-map.md`
- `AGENTS.md`

Update `docs/video-date-success-command-center.md` after every material investigation, code change, migration, deployment, manual test, or newly observed failure. The current acceptance bar is a fresh end-to-end successful Video Date run: match -> Ready Gate -> Daily room -> live video -> post-date survey completion.

Current implementation baseline: app `main` / `origin/main` is expected at `d2c912c873cd3c119b2296a507d5c4b05007f8a9` after PR #1195. PR #1194 is merged with squash commit `0a160cd975d87cd756e9c399e748810508f005cb`; it builds on PR #1192 at `b2a4a10ce22c2f4950b94fa6b9e49aa235c6c7fa` and PR #1190 at `b72e487d65972566e63f508d023cf2e1e886734a`. Supabase migrations `20260604142017_video_date_active_presence_join_guard.sql`, `20260604170438_video_date_warmup_reconnect_stability.sql`, `20260604193140_video_date_latest_presence_grace_repair.sql`, and `20260604205645_video_date_remote_seen_latest_state.sql` are applied to project `schdyxcunwcvddlcshwd`; verify Git and cloud state before assuming it. The latest stabilization work adds web/native Daily start ownership, lifecycle soft-signal handling, latest-state presence, canonical remote-seen latest-state repair, reconnect grace clearing/recheck, and terminal-survey hard-stop changes. This is not acceptance proof; a fresh manual two-user run is still required.

Do not equate `both_ready`, route entry, Daily room creation, brief warm-up UI, or stale `participant_*_joined_at` with a successful Video Date. Active Daily co-presence requires latest joined presence for both users without a later `participant.left` / `participant_*_away_at`; verify webhook ledger rows, remote media evidence, `date_started_at`, and survey completion. Same-session Daily calls in joining/joined state should be reused or waited on, not rebuilt. Browser `visibilitychange` is soft telemetry during active Daily handoff/warm-up/date. Daily `participant-left` should only reach backend partner-away after local transport grace expires with `p_reason = daily_transport_grace_expired`; survey-required terminal truth should hard-stop Daily/surface churn and open `PostDateSurvey` on `/date/:sessionId`.
