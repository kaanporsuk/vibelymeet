# Video Date Review Comments PR #1256-#1262 Follow-Ups

Date: 2026-06-09

Status: source/test/docs implementation evidence with linked Supabase cloud verified up to date. No new migration or Edge Function was required for this branch. Fresh two-user production proof through both users persisting `date_feedback` is still required.

## Scope

The GitHub review-comments workflow inspected the last seven merged PRs, `#1256` through `#1262`, for Copilot and Codex review comments.

- No Copilot-authored actionable review threads were found.
- PR `#1260` had an already-resolved/outdated Codex review thread and did not require a source change.
- Actionable Codex review threads were addressed for PRs `#1256`, `#1257`, `#1258`, `#1259`, `#1261`, and `#1262`.

## Implementation

- Web surface claims now wait for claimable date/handshake/server timeline truth before activating the surface lease.
- `SURFACE_NOT_CLAIMABLE` duplicate-tab claim responses reset the retry failure count/backoff instead of creating an exponential delay before the route becomes claimable.
- Web and native/mobile remote-seen retry loops keep the originally accepted render/media evidence source in `p_evidence_source`; retry attempt labels remain available as diagnostic context only.
- Native/mobile `PostDateSurvey` queue drain now uses a runtime ref for fast-changing UI/callback state, with narrowed effect dependencies, so verdict UI transitions cannot cancel an already-keyed drain.
- The PR #1259 audit now scopes the `20260608215911` migration evidence as historical/superseded by later linked-cloud state.
- The command center now scopes the `4e9f87d` main/origin-main alignment statement to the PR #1257 verification moment before later PRs advanced `main`.
- Added `shared/matching/reviewComments1256_1262Followups.test.ts` and wired it into `npm run test:video-date:red-flags` and `npm run test:video-date-v4`.
- Updated older remote-seen/static contracts to assert preserved base evidence source semantics.

## Verification

Verification completed during implementation:

- `npx tsx shared/matching/reviewComments1256_1262Followups.test.ts`
- `npx tsx shared/matching/reviewComments1188_1197Followups.test.ts`
- `npx tsx shared/matching/reviewComments1242_1256Followups.test.ts`
- `npx tsx shared/matching/videoDateStrictDailyJoinRemoteSeen.test.ts`
- `npx tsx shared/matching/videoDateStableBilateralMediaGateContracts.test.ts`
- `npx tsx shared/matching/videoDateEndToEndHardening.test.ts`
- `npm run test:video-date:red-flags`
- `npm run test:video-date-v4`
- `npm run typecheck`
- `npm run lint`

Linked Supabase cloud verification completed:

- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked` showed local and remote aligned through `20260609045533_video_date_pre_stable_survey_eligibility.sql`.
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run` returned `Remote database is up to date.`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --schema public --fail-on error` exited 0 with only legacy warning/notice output.
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db advisors --linked --level error --fail-on error` returned `No issues found`.

## Cloud Scope

No migration file, generated Supabase type, or Edge Function changed in this branch. The linked project was already aligned, so there was nothing to apply with `supabase db push --linked --yes` and nothing to deploy with `supabase functions deploy`.

## Proof Boundary

This is review-comment hardening from source, static contracts, and linked-cloud verification. It is not Video Date product-health proof. Do not call the feature fixed until a fresh disposable two-user production run completes match, Ready Gate, same Daily room, stable bilateral provider-backed media/date, date end, and both users' `date_feedback` rows, including short leave/rejoin and prolonged absence checks.
