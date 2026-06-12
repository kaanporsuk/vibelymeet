# Fix Video Date Strict Daily Join And Remote Seen

Date: 2026-06-09

## Concern

The `Both join same Daily room` stage still had two unsafe proof edges:

- A client Daily alive/join heartbeat could be bridged as joined evidence while the matching Daily `participant.joined` webhook was still missing.
- Web/native/mobile could call canonical `mark_video_date_remote_seen` from participant/snapshot hydration events, before rendered remote media evidence existed.

Those gaps could later promote an unsuccessful Vibe Video Date as an actual date.

## Implementation

- Added migration `20260609003604_video_date_strict_daily_join_remote_seen.sql`.
- Added `video_date_session_lifecycle_eligibility_v1(...)` so joined, remote-seen, and promotion RPCs reject ended sessions, inactive events, stale event registrations, and ineligible participants.
- Added `video_date_current_provider_session_proof_v1(...)` so Daily alive/join acceptance requires a matching provider-session `participant.joined` webhook and no newer same-provider-session `participant.left` webhook.
- Wrapped public `mark_video_date_daily_alive(...)` before the existing base, preserving the public RPC name used by web/native/mobile.
- Wrapped public `mark_video_date_remote_seen(...)` with a new optional `p_evidence_source` argument. The wrapper accepts only render/media evidence sources, then delegates to the existing provider/current-call guarded base.
- Wrapped `video_date_promote_provider_overlap_v1(...)` and `video_session_handshake_auto_promote_v2(...)` so promotion cannot bypass lifecycle eligibility.
- Updated web `/date` Daily calls to stamp remote-seen only from rendered media events (`loadeddata` / `playing`) and to pass `p_evidence_source`.
- Updated native/mobile `/date/[id]` Daily calls to stamp remote-seen only from mounted remote media evidence and to pass `p_evidence_source`.
- Updated generated Supabase RPC types.
- Added `shared/matching/videoDateStrictDailyJoinRemoteSeen.test.ts` and wired it into `npm run test:video-date:red-flags` and `npm run test:video-date-v4`.

## Proof Boundary

Local verification passed:

- `npx tsx shared/matching/videoDateStrictDailyJoinRemoteSeen.test.ts`
- `npx tsx shared/matching/videoDateEndToEndHardening.test.ts`
- `npx tsx shared/matching/reviewComments1188_1197Followups.test.ts`
- `npm run test:video-date:red-flags`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- `npm run test:video-date-v4`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`

The linked Supabase dry-run shows `20260609003604_video_date_strict_daily_join_remote_seen.sql` as pending; remote remains aligned through `20260608224048`.

This is source, migration, and contract coverage. It is not product-health proof until the migration is applied together with updated web/native/mobile clients, those clients are deployed, and a fresh disposable two-user production run completes match -> Ready Gate -> same Daily room -> live video -> date end -> both `date_feedback` rows persisted.
