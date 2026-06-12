# Video Date Operational Runbook

Date: 2026-06-12 (rebuild PR 10). Operations companion to
`docs/video-date-architecture.md`. Linked Supabase project:
`schdyxcunwcvddlcshwd` (remote-only; confirm against `supabase/config.toml`
before any push or deploy; never `supabase db reset` / `start` / `stop`).

## Cron set (live `cron.job`, verified 2026-06-12)

Video Date lanes:

| Job | Schedule | What it does |
|---|---|---|
| `video-date-outbox-drainer` | `* * * * *` | Drains `video_date_provider_outbox` (`daily.ensure_video_date_room`, `daily.delete_video_date_room`, `notification.send`); per-row claim/lease RPCs |
| `video-date-deadline-finalizer` | `* * * * *` | Claims due session deadlines (`claim_video_session_deadlines_v2`) and finalizes entry/date timeouts |
| `expire-stale-video-sessions` | `* * * * *` | Stale-session expiry |
| `expire-video-date-reconnect-graces` | `* * * * *` | Expires reconnect graces so absence reconciliation can terminalize |
| `video-date-room-cleanup` | `* * * * *` | Session-bound Daily room deletes (presence-grace before delete; direct Daily API) |
| `video-date-orphan-room-cleanup` | `*/10 * * * *` | Provider-side room reconciliation with safety interlock; writes `video_date_orphan_room_cleanup_audit` |
| `daily-room-keepwarm` | `*/5 * * * *` | Keeps the daily-room Edge path warm |
| `synthetic-video-date-monitor` | `*/5 * * * *` | THE synthetic monitor (see below) |
| `video-date-recovery-alert-dispatcher` | `*/5 * * * *` | THE alert path (see below) |
| `post-date-verdict-reminders` | `*/5 * * * *` | Pending-verdict reminder lane only |

Room-cleanup/orphan-cleanup consolidation is deliberately deferred (both call
the Daily API directly, not the outbox delete kind — merging is a behavior
change). The concrete consolidation design and its acceptance bar live in
`docs/investigations/video-date-room-cleanup-consolidation-plan.md`
(2026-06-12); execute it as a dedicated PR.

## Monitoring posture (PR 9, user-decided)

- **ONE synthetic monitor**: `synthetic-video-date-monitor` reading
  `vw_synthetic_video_date_health` + `vw_video_date_flag_rollout`.
- **ONE alert path**: `video-date-recovery-alert-dispatcher` reading
  `vw_video_date_recovery_alerts` directly (base view
  `vw_video_date_lease_recovery_health`), recording dispatches in
  `video_date_recovery_alert_dispatches`.
- **Read-only support diagnostics**: `admin-video-date-ops` exposes only
  `metrics` and `get_session_timeline` (service-role
  `get_video_date_session_timeline`). No mutating ops actions exist.
- Forensics: `video_date_daily_webhook_events` (provider ledger),
  `video_date_presence_events`, surface-claim audit rows, and the session
  timeline reconstruct one chronological story per session.

Known alert noise — RESOLVED 2026-06-12 (acceptance follow-up migration
`20260612212014_vd_accept_followup_benign_notification_failures_non_paging.sql`):
failed `notification.send` outbox rows with `last_error` in
(`notification_no_preferences`, `notification_no_player_id`) now classify as
non-paging `watch` severity (still emitted and dispatched; details expose
`benignFailedCount`). Preferences backfill alone is NOT sufficient for
disposable/headless users — they have no OneSignal player. Paging requires a
non-benign failure: `(failed_count - benign_failed_count) > 0` or an
expired-lease pileup.

Benign `watch` groups still record dispatch rows while failed rows exist; this
is deliberate (visible, non-paging) and bounded — the dispatcher dedupes on
(severity, fingerprint, hour_bucket), so accumulation is at most one row per
hour per group. Prompt tag-scoped smoke cleanup removes the source rows and
stops the dispatches entirely.

RESOLVED 2026-06-12: the 20 stale `notification_http_401` failed outbox rows
(2026-05-27 → 2026-06-04, OneSignal auth failures from that era) were purged
after verifying provenance (documented smoke pair, one deleted user, one test
account) and that sends have been healthy since 2026-06-05 (27 `done`, zero
non-benign failures). The group dropped from page to benign-only watch.

## Validation battery (static, minutes)

```
npm run typecheck && npm run lint
npm run test:video-date-v4
npm run test:video-date:red-flags
npm run test:event-lobby-regression
SUPABASE_CLI_TELEMETRY_OPTOUT=1 npx supabase migration list --linked
SUPABASE_CLI_TELEMETRY_OPTOUT=1 npx supabase db push --linked --dry-run   # must be up to date
npx supabase db lint --linked                                             # no new errors
```

The curated `test:video-date-v4` composition and what each file pins is mapped
in `docs/video-date-architecture.md`. Env-gated runtime RLS proofs:
`npm run test:video-date-runtime-rls:required`. Live invariants:
`npm run check:video-date:invariants` (read-only SQL pack
`docs/sql/video-date-invariants.sql`); function inventory:
`npm run verify:video-date:functions`; certification wrapper:
`npm run certify:video-date:golden-flow`.

## Committed operator tooling (2026-06-12)

- `npm run livegate:video-date` — the two-user live gate as a runnable artifact
  (`scripts/video-date-live-gate.mjs`): tagged disposable fixtures, real-client
  golden flow, optional `--offline-drop` / `--revisit-check` /
  `--stale-stamp-check` probes, tag-scoped zero-residue cleanup. Requires the
  dev server on 5173 and keychain CLI login. Failures keep fixtures for
  forensics (`… cleanup` afterwards).
- `npm run check:contract-fixture-drift` — dumps every pinned public head from
  live and diffs against `supabase/contract-fixtures/2026-06/`; dropped-chain
  history fixtures are allowlisted. Run after any backend-touching merge; on
  its first run (2026-06-12) it caught five silently stale fixtures.
- `npm run loadprobe:video-date` — bounded ready-gate convoy probe
  (`--pairs=N`, default 12): concurrent mutual swipes + a simultaneous
  mark_ready storm via real user tokens, latency percentiles + error codes
  (57014 watch), tag-scoped cleanup. Run deliberately — it creates real
  concurrent load; pair with compute-tier decisions.

## Smoke procedure (mutating production test)

Follow the repo smoke rules (`.claude/CLAUDE.md` "Disposable Production Smoke
Testing") exactly:

1. **Fixtures**: create a fresh disposable confirmed pair tagged
   `vd-smoke-YYYYMMDD-<timestamp>` (fake `@vibely.test` emails, zero-UUID
   `instance_id`, `aud`/`role` = `authenticated`, crypt-hashed passwords,
   `email_confirmed_at` set). Never reuse a pair with real artifacts. Profile
   triggers may need GUC context for SQL-only inserts.
2. **Real sessions**: sign in with password grant; drive the actual flow with
   user bearer tokens — swipe to mutual match, Ready Gate mark-ready on both,
   `/date/:sessionId` entry, Daily join from two real clients, date end,
   both surveys submitted.
3. **Verify** (read-only admin SQL): same Daily room on both sides; webhook
   ledger shows both `participant.joined` with provider session ids and no
   later unmatched `participant.left`; `date_started_at` stamped; both
   `date_feedback` rows persisted; registrations released from `in_survey`;
   outbox rows for the session drained or terminal.
4. **Cleanup**: delete only rows created by the smoke tag (pair-scoped,
   tag-scoped predicates that also prove the fake emails); verify final counts
   are zero. Mask IDs/emails/tokens in all evidence.

## Acceptance bar

Static tests, PR checks, migration alignment, `both_ready`, route entry, Daily
room creation, or brief media are NEVER product acceptance. The bar is a fresh
two-user run that ends with BOTH users' rows persisted in `date_feedback`
(survey completion), with provider-backed copresence evidence in the webhook
ledger. A failed pre-stable session must downgrade to `pre_stable_media_failed`
with `survey_required = false` and release both users without a survey.

## Deploy discipline

- Forward migrations only; never edit an applied migration — correct with a new
  one. After any apply: `npm run regen:supabase-types` (never hand-edit).
- Deploy Edge Functions only when their source changed; record deployed
  versions in the PR/branch delta.
- Schema or Edge changes update `docs/video-date-architecture.md`, this
  runbook, and `docs/active-doc-map.md` in the same branch.
- No silent removals: every dropped function/table/view/column/flag/cron job is
  enumerated in the PR description with dependent-scan evidence
  (`pg_depend`/`pg_proc.prosrc` + repo grep including `supabase/functions` and
  generated types).
