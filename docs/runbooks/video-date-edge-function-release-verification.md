# Video Date Edge Function Release Verification

Date: 2026-06-08

This runbook verifies that the Video Date Edge Function surface is present and aligned for a release. It does not perform deployment unless an operator explicitly runs the deploy command.

Exact byte-for-byte equality against deployed Supabase function bundles is not assumed. The accepted release proof is: deploy from the current commit, verify the remote function catalog, verify migration state, run the static gates, run invariants, then complete the live two-user golden flow.

## Local Verification

```bash
npm run verify:video-date:functions -- --skip-remote
npm run test:video-date:red-flags
npm run test:video-date-v4
```

The function verifier checks the local `supabase/config.toml` catalog and required function source directories for:

- `daily-room`
- `video-date-daily-webhook`
- `video-date-snapshot`
- `video-date-token-refresh`
- `video-date-room-cleanup`
- `video-date-orphan-room-cleanup`
- `video-date-outbox-drainer`
- `video-date-deadline-finalizer`
- `video-date-recovery-alert-dispatcher`
- `post-date-verdict`
- `post-date-verdict-reminders`
- `admin-video-date-ops`
- `synthetic-video-date-monitor`

## Remote Non-Mutating Verification

Before deployment or certification:

```bash
SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked
SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run
npm run verify:video-date:functions -- --require-remote
```

If database credentials are available:

```bash
SUPABASE_DB_URL=<postgres-url> npm run check:video-date:invariants
```

Any pending migration, missing function, or critical invariant failure blocks certification.

## Deployment

Deploy only from a clean, reviewed branch/commit and only during an approved release window.

```bash
SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --yes
SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase functions deploy daily-room --project-ref schdyxcunwcvddlcshwd
SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase functions deploy video-date-daily-webhook --project-ref schdyxcunwcvddlcshwd
SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase functions deploy video-date-snapshot --project-ref schdyxcunwcvddlcshwd
SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase functions deploy video-date-token-refresh --project-ref schdyxcunwcvddlcshwd
SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase functions deploy video-date-room-cleanup --project-ref schdyxcunwcvddlcshwd
SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase functions deploy video-date-orphan-room-cleanup --project-ref schdyxcunwcvddlcshwd
SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase functions deploy video-date-outbox-drainer --project-ref schdyxcunwcvddlcshwd
SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase functions deploy video-date-deadline-finalizer --project-ref schdyxcunwcvddlcshwd
SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase functions deploy video-date-recovery-alert-dispatcher --project-ref schdyxcunwcvddlcshwd
SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase functions deploy post-date-verdict --project-ref schdyxcunwcvddlcshwd
SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase functions deploy post-date-verdict-reminders --project-ref schdyxcunwcvddlcshwd
SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase functions deploy admin-video-date-ops --project-ref schdyxcunwcvddlcshwd
SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase functions deploy synthetic-video-date-monitor --project-ref schdyxcunwcvddlcshwd
```

For all functions, `scripts/deploy-supabase-cloud.sh --functions-only` remains available, but the targeted list above is preferred for Video Date release verification.

## Post-Deployment Verification

```bash
SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked
SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run
npm run verify:video-date:functions -- --require-remote
SUPABASE_DB_URL=<postgres-url> npm run check:video-date:invariants
```

Then run `docs/qa/video-date-golden-flow-certification.md`.

## Certification Boundary

Remote function listing, migration alignment, and green static gates are release-readiness evidence. They do not certify Video Date. Certification still requires the fresh two-user golden flow through both users saving `date_feedback`.
