# Branch Delta: Video Date Provider-Authoritative Presence

Date: 2026-06-07

## Purpose

Close the post-stable-copresence failure class where a route/client owner could keep sending heartbeats after Daily had already emitted a provider `participant.left`, causing the backend to treat stale joined evidence as active copresence.

Latest failed production session `c9dc7af1-1f40-431f-93ed-4435019126aa` for event `43d1614c-9b2d-45d6-be59-c56fa6cb852f` proved that Ready Gate, same Daily room, visible local/remote media, and the date UI could appear. The failure moved to provider truth: participant 2's Daily provider session left at `2026-06-06T19:22:52Z` and never had a later provider join, while client heartbeats with missing/stale provider proof kept the backend believing both sides were active.

## Code Changes

- Web `src/hooks/useVideoCall.ts` reads Daily meeting state and the local provider session id before sending `mark_video_date_daily_alive(...)`.
- Native/mobile `apps/mobile/app/date/[id].tsx` mirrors the same rule.
- Web and native/mobile send `owner_state='joined'` only when Daily reports `joined-meeting` and a provider session id is present; otherwise heartbeats are `joining` or `lost`.
- Web and native/mobile event lobbies treat `queue_status='in_survey'` with a cleared `current_room_id` as active terminal-survey recovery, not lobby/deck ambiguity.

## Database Changes

Migrations:

- `supabase/migrations/20260606203000_video_date_provider_authoritative_presence.sql`
- `supabase/migrations/20260606205211_video_date_provider_participant_id_presence_repair.sql`

The first migration adds provider-authoritative copresence:

- `video_date_actor_provider_presence_v1(session_id, actor_id)` returns current Daily provider-backed presence.
- `video_date_stable_copresence_v1(session_id)` requires both participants to have current provider presence before stable copresence, remote-seen shortcut, or already-date shortcut can count.
- `mark_video_date_daily_alive(...)` records every heartbeat, but only clears away state or advances joined evidence when the heartbeat is `owner_state='joined'`, has a provider session id, and is not contradicted by the Daily provider ledger.

The corrective migration fixes the review-discovered provider identity source:

- Daily webhook ingestion stores participant provider identity in `video_date_daily_webhook_events.provider_participant_id`.
- Provider-presence checks must prefer `provider_participant_id` before sanitized payload fallback fields.
- Applied migrations are immutable history; once `20260606203000` had been pushed to cloud, the provider-id source fix correctly landed as `20260606205211` rather than rewriting the already-applied migration.

## Rollout Boundary

Merged via PR #1216 at `3ae7f196749f2229d66da6f0ef73ae2f76f30768`.

Supabase project `schdyxcunwcvddlcshwd` is aligned through `20260606205211_video_date_provider_participant_id_presence_repair.sql`. Final dry-run returned `Remote database is up to date`.

The source branch `codex/video-date-provider-authoritative-presence` was deleted remotely and pruned locally. The parent workspace has no remote; its local pointer commit after the nested repo merge is `012fdb3`.

## Review Lessons

- Daily provider session identity comes from `provider_participant_id` as recorded by `video-date-daily-webhook`; payload-only `payload.session_id` extraction is not sufficient.
- PR review conversations can surface real production blockers even after local tests and Supabase dry-runs pass. Resolve substantive review comments before merging.
- If a migration has already been applied to the linked cloud project, never edit that migration file to address review feedback. Add a corrective follow-up migration and verify cloud alignment.
- Repository policy disallows merge commits and auto-merge. PR #1216 merged by squash after checks passed and the review thread was resolved.

## Verification

Local:

- `git diff --check`
- `npx tsx shared/matching/videoDateStableCopresenceOwnerContracts.test.ts`
- `npm run typecheck`
- `npm run test:video-date-v4` with only the two expected env-gated runtime RLS skips

PR checks:

- Host-safe smoke
- Static matrix and contracts
- Quick golden-path smoke
- Video-date golden-path smoke
- Phase 7 no-go guardrails
- Phase 8 privacy and media contracts
- Phase 9 playback, captions, and lifecycle contracts
- Vercel preview deployment

Supabase:

- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`
- Live catalog markers confirmed:
  - provider-session helper exists,
  - actor provider presence uses `vde.provider_participant_id`,
  - Daily alive uses `vde.provider_participant_id`,
  - stable copresence retains the provider guard.

## Acceptance Boundary

This is implementation, cloud, and CI verification only. Do not claim Video Date healthy from PR #1216, static tests, CI, Supabase alignment, `both_ready`, Daily room creation, visible brief media, or a terminal survey row.

Acceptance remains a fresh disposable two-user production run:

match -> Ready Gate -> same Daily room -> stable provider-backed bilateral media/date -> date end -> post-date survey opens and completes.

Also verify:

- short Daily leave/rejoin under 12 seconds recovers without terminalizing;
- prolonged absence terminalizes correctly;
- provider-null or provider-stale client heartbeats cannot revive a participant after a matching Daily `participant.left`;
- `in_survey` with cleared `current_room_id` still routes to terminal-survey recovery on web and native/mobile.
