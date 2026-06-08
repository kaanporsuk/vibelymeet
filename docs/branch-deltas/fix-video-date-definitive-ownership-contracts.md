# Video Date Definitive Ownership Contracts

Date: 2026-06-09

## Scope

This branch adds a source-level regression guard for the Video Date ownership ladder across web, native, and mobile.

No runtime code or Supabase schema behavior changed in this patch. The current implementation already keeps the critical owners separated; the missing hardening was an executable contract that would fail if a future change moved evidence stamping or survey completion ownership back into the wrong surface.

## Added Contract

`shared/matching/videoDateDefinitiveOwnershipContracts.test.ts` now verifies:

- `both_ready` is a `/date/:sessionId` ownership signal, but not Daily-start proof when provider room state is not ready.
- Daily room metadata alone is not a route/date/survey completion proof.
- A stale server `ready_gate` next-surface cannot override non-ended `both_ready` date ownership.
- Route entry without encounter evidence does not become survey completion truth.
- Terminal `in_survey` truth routes web and native to the date route because `PostDateSurvey` is hosted by `/date/:sessionId`.
- Completion is only modeled after the actor has persisted `date_feedback`.
- `mark_video_date_daily_alive`, `mark_video_date_daily_joined`, and `mark_video_date_remote_seen` are called only by the web `/date` hook and native `/date/[id]` route.
- `video_session_mark_ready_v2` remains Ready Gate owned.
- `claim_video_date_surface` remains date-surface/duplicate-tab-guard owned.
- Optional feedback detail patches remain `PostDateSurvey` owned.
- Web and native client source contains no direct `date_feedback` writes.

## Verification

Focused verification:

```sh
npx tsx shared/matching/videoDateDefinitiveOwnershipContracts.test.ts
```

The new contract is wired into:

- `npm run test:video-date:red-flags`
- `npm run test:video-date-v4`

Completed verification for this patch:

- `npx tsx shared/matching/videoDateDefinitiveOwnershipContracts.test.ts`
- `npm run test:video-date:red-flags`
- `npm run test:video-date-v4`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run` (`Remote database is up to date.`)

## Remaining Proof Bar

This is source/test evidence only. The product is still not acceptance-proven until a fresh disposable two-user production run completes match -> Ready Gate -> same Daily room -> stable co-presence -> remote media -> date promotion -> terminal survey -> both users persist `date_feedback`.
