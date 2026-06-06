# Branch Delta: Video Date Provider-Terminal Recovery

Date: 2026-06-07

## Purpose

Close the failure class seen in production session `98d50175-1c75-4966-a6e6-f444c4631289`: the UI briefly reached a real date, then fell back into opening/reconnecting churn while the client kept hot-looping `mark_video_date_daily_alive` without current provider-backed proof.

The provider-authoritative work made provider truth the source of copresence, but old and current clients could still spam no-provider alive RPCs, repeatedly touch presence/registration state, and block terminal-survey recovery when the first session-row fetch failed.

## Code Changes

- Web `src/hooks/useVideoCall.ts` now updates local owner state but skips `mark_video_date_daily_alive(...)` unless Daily is `joined-meeting` and a local provider session id is present.
- Native/mobile `apps/mobile/app/date/[id].tsx` mirrors the same provider-backed heartbeat gate.
- Web and native/mobile stop the alive heartbeat on terminal RPC truth (`session_ended` or provider-terminal payload).
- Web `src/pages/VideoDate.tsx` falls back to the authenticated user's `event_registrations.queue_status='in_survey'` row when terminal survey recovery cannot fetch `video_sessions`.
- Native/mobile `/date/[id]` mirrors that registration fallback and opens the post-date survey instead of returning to date-opening churn.

## Database Changes

Migration:

- `supabase/migrations/20260606224200_video_date_provider_terminal_recovery.sql`

The migration redefines `mark_video_date_daily_alive(...)`:

- no-provider or provider-terminal alive calls are throttled telemetry, not join-stamping authority;
- provider-backed calls preserve the first accepted `participant_*_joined_at` stamp with `COALESCE(..., v_now)`;
- event-registration updates are diff/throttle guarded;
- terminal ended sessions release stale `video_date` surface claims;
- responses expose `provider_presence_missing`, `provider_presence_terminal`, `provider_backed_current`, `join_stamp_accepted`, owner/call/entry/provider ids, and stable-copresence fields.

## Regression Coverage

- `shared/matching/videoDateProviderTerminalRecovery.test.ts`
- `npm run test:video-date-v4` includes the new contract.

The contract locks the backend throttling/indexes, immutable join-stamp behavior, web/native RPC skip before provider proof, terminal heartbeat shutdown, and web/native `in_survey` registration fallback.

## Rollout Boundary

Supabase project `schdyxcunwcvddlcshwd` is applied/aligned through `20260606224200_video_date_provider_terminal_recovery.sql`.

This branch delta records source implementation, cloud migration apply, and verification scope. It is not product acceptance proof.

Before claiming the fix is live for all users:

- Web production must deploy the updated `useVideoCall` / `VideoDate` bundle.
- Native/mobile builds must include the updated `/date/[id]` lifecycle.
- A fresh disposable two-user production run must complete match -> Ready Gate -> same Daily room -> stable provider-backed bilateral media/date -> date end -> survey completion.

Also verify short leave/rejoin and prolonged absence behavior.

## Verification

- `npx tsx shared/matching/videoDateProviderTerminalRecovery.test.ts`
- `npx tsx shared/matching/videoDateStableCopresenceOwnerContracts.test.ts`
- `npx tsx shared/matching/reviewComments1205_1216Followups.test.ts`
- `npx tsx shared/matching/videoDateTerminalSurveyLifecycleHardening.test.ts`
- `npm run test:video-date-v4` with only the expected env-gated RLS skips
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --yes`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --schema public --fail-on error`
- Live catalog marker query confirmed the migration row, rewritten `mark_video_date_daily_alive(...)` body, and both new indexes.
