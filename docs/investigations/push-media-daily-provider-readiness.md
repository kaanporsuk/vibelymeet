# Push, Media, Daily Provider Readiness Investigation

Date: 2026-05-01
Branch: `docs/investigate-push-media-daily-provider-readiness`
Base: `main` at `4dc0254b2`

## Executive Verdict

WARN.

Streams 11, 12, and 13 are closed on `main`; their branch deltas, tests, provider source surfaces, and safe read-only checks are present. No provider secret value, real provider mutation, deployment requirement, native module drift, or `expo-av` import was found.

Warnings:

- OneSignal runtime code and Stream 11 tests are env-backed, but older provider docs still contain stale hardcoded/fallback OneSignal app-ID language.
- The prompt asked to verify that `chat-videos` are not treated as Bunny-owned, but current Stream 12 code/docs/tests intentionally treat `chat-videos/...` as Bunny Storage. This is not a hidden code defect if that is the accepted baseline, but it needs product/doc confirmation if the prompt expectation is authoritative.

NOT READY markers: none.

## Artifacts Inspected

Stream 11:

- `docs/branch-deltas/fix-onesignal-provider-operational-qa.md`
- `shared/matching/onesignalProviderOperationalQa.test.ts`
- `apps/mobile/lib/onesignal.ts`
- `src/lib/onesignal.ts`
- `public/OneSignalSDK.sw.js`
- `public/OneSignalSDKWorker.js`
- `public/sw.js`
- `supabase/functions/send-notification/index.ts`
- `supabase/functions/push-webhook/index.ts`

Stream 12:

- `docs/branch-deltas/fix-bunny-provider-operational-qa.md`
- `shared/matching/bunnyProviderOperationalQa.test.ts`
- `supabase/functions/create-video-upload/index.ts`
- `supabase/functions/video-webhook/index.ts`
- `supabase/functions/delete-vibe-video/index.ts`
- `supabase/functions/upload-image/index.ts`
- `supabase/functions/upload-event-cover/index.ts`
- `supabase/functions/upload-voice/index.ts`
- `supabase/functions/upload-chat-video/index.ts`
- `supabase/functions/_shared/bunny-media.ts`
- `src/components/vibe-video/VibeStudioModal.tsx`
- `src/services/imageUploadService.ts`
- `src/services/eventCoverUploadService.ts`
- `src/services/voiceUploadService.ts`
- `src/utils/imageUrl.ts`
- `apps/mobile/lib/imageUrl.ts`
- `apps/mobile/lib/vibeVideoState.ts`
- `apps/mobile/lib/vibeVideoPlaybackUrl.ts`
- `apps/mobile/lib/vibeVideoApi.ts`

Stream 13:

- `docs/branch-deltas/fix-daily-provider-operational-qa.md`
- `shared/matching/dailyProviderOperationalQa.test.ts`
- `supabase/functions/daily-room/index.ts`
- `supabase/functions/daily-room/dailyRoomContracts.ts`
- `supabase/functions/match-call-room-cleanup/index.ts`
- `supabase/functions/video-date-room-cleanup/index.ts`
- `src/hooks/useVideoCall.ts`
- `src/hooks/useMatchCall.tsx`
- `src/pages/VideoDate.tsx`
- `apps/mobile/app/date/[id].tsx`
- `apps/mobile/lib/videoDateApi.ts`
- `apps/mobile/lib/videoDatePrepareEntry.ts`
- `apps/mobile/lib/videoDateEntryStartable.ts`
- `apps/mobile/lib/useMatchCall.tsx`
- `apps/mobile/lib/matchCallApi.ts`

Cross-provider docs/config:

- `supabase/config.toml`
- `_cursor_context/vibely_onesignal_provider_sheet.md`
- `_cursor_context/vibely_bunny_provider_sheet.md`
- `_cursor_context/vibely_daily_provider_sheet.md`
- `_cursor_context/vibely_external_dependency_ledger.md`
- `_cursor_context/vibely_rebuild_runbook.md`
- `apps/mobile/package.json`

## Stream 11: OneSignal Provider Operational QA

Verdict: WARN.

Code proof:

- `public/OneSignalSDK.sw.js`, `public/OneSignalSDKWorker.js`, and `public/sw.js` exist locally.
- Production HEAD checks for all three root-served worker assets returned HTTP 200 from `https://www.vibelymeet.com`.
- Web OneSignal initialization is sourced from `VITE_ONESIGNAL_APP_ID`; no hardcoded app ID was found in `src/lib/onesignal.ts`.
- Web and native identity binding both keep `lastLoggedInUserId` / identity generation guards to avoid repeated `OneSignal.login` calls for the same Supabase user.
- Web and native player/subscription sync paths upsert into `notification_preferences`.
- `send-notification` reads `ONESIGNAL_APP_ID` and `ONESIGNAL_REST_API_KEY` by name, preserves suppression gates, writes `notification_log`, and stores safe `push_delivery_diagnostic` context.
- `push-webhook` is secret-gated with `PUSH_WEBHOOK_SECRET` and writes generic `push_notification_events`; it does not reference OneSignal app IDs or REST keys.
- Stream 11 correctly documents that `push-webhook` is not proven OneSignal receipt truth.
- No real production push smoke was run.

Dashboard proof still required:

- Confirm frontend `VITE_ONESIGNAL_APP_ID` and backend `ONESIGNAL_APP_ID` refer to the same OneSignal app.
- Confirm `ONESIGNAL_REST_API_KEY`, production origin, service-worker settings, player-ID registration, delivery, click deep links, preference suppression, and whether `push-webhook` is intentionally wired to OneSignal receipts.

WARN:

- `_cursor_context/vibely_onesignal_provider_sheet.md` and `_cursor_context/vibely_rebuild_runbook.md` still contain stale language saying the web app has a hardcoded/fallback OneSignal app ID. Current `src/lib/onesignal.ts` instead disables web push when `VITE_ONESIGNAL_APP_ID` is unset. The Stream 11 branch delta/test are correct; older provider docs need cleanup.

## Stream 12: Bunny Media Provider Operational QA

Verdict: WARN.

Code proof:

- `create-video-upload` reads `BUNNY_STREAM_LIBRARY_ID`, `BUNNY_STREAM_API_KEY`, and `BUNNY_STREAM_CDN_HOSTNAME`.
- Bunny Stream video creation occurs before TUS credential return; web/native TUS upload targets `https://video.bunnycdn.com/tusupload`.
- Profile UID/status writes go through backend-owned media/profile RPCs.
- `video-webhook` maps Bunny statuses to `ready`, `failed`, or `processing`, checks webhook auth/signature posture, and updates by Bunny video UID through media-session RPC first with a legacy profile fallback.
- `delete-vibe-video` clears local profile state and exposes deferred remote-delete posture through the media delete worker.
- Bunny Storage path conventions remain:
  - `photos/{userId}/{uuid}.{ext}`
  - `events/{eventId}/{timestamp}.{ext}` or `events/covers/{timestamp}.{ext}`
  - `voice/{conversationId}/{userId}_{timestamp}.{ext}`
- Web/native URL resolvers use Bunny CDN for `photos/...` and preserve full URL plus legacy Supabase storage-style fallbacks.
- Vibe Video playback uses the Bunny Stream CDN `playlist.m3u8` shape.
- Native uses `expo-video`; no `expo-av` package/import was found.
- No real production media mutation was run.

Dashboard proof still required:

- Confirm Bunny Stream library/API key, Stream CDN hostname, webhook URL/auth mode, Storage zone/API key, CDN hostname/DNS, CORS/origin posture, and controlled internal media smoke with test users/events only.

WARN:

- Prompt expectation said to verify `chat-videos` are not Bunny-owned. Current closed Stream 12 baseline says the opposite: `upload-chat-video` writes Bunny Storage objects under `chat-videos/...`, records provider `bunny`, and docs warn not to confuse the path prefix with a Supabase bucket. If `chat-videos` should not be Bunny-owned, that is a separate product/provider ownership correction stream.

## Stream 13: Daily Provider Operational QA

Verdict: PASS.

Code proof:

- `daily-room` reads `DAILY_API_KEY` and `DAILY_DOMAIN`; missing `DAILY_DOMAIN` is now blocked for staging/production certification, with `vibelyapp.daily.co` fallback limited to explicit `ENVIRONMENT=local|dev|development|test` mode.
- `daily-room` calls Daily REST at `https://api.daily.co/v1`, creates rooms, looks up rooms, deletes rooms when safe, and creates meeting tokens.
- Meeting token values are response-only; tests verify console logs do not print raw token values.
- Video-date entry remains backend prepare-entry gated before Daily token issuance.
- Match-call create/answer/join flows remain present on web and native.
- `delete_room` is authenticated, participant-gated, and documented as intentionally supported; video-date provider deletion remains cleanup-worker owned.
- Cleanup/reconnect behavior is documented and covered by static tests.
- No real production Daily room was created or deleted.

Dashboard proof still required:

- Confirm Daily workspace/account, API key permissions, production domain, private-room/token settings, quota/rate-limit health, recording/transcription/dashboard automation settings, and controlled internal Daily QA with test users only.

## Cross-Provider Findings

Verdict: WARN.

- No provider secret values were printed or committed during this audit. `supabase secrets list` output was redacted to names plus `<digest-redacted>`.
- A high-signal static scan found no Stripe secret key, Stripe webhook secret, Resend key, Twilio auth token/SID, or Daily API-key literal patterns. It did find UUID-like literals in docs/tests/config; these are not provider secret-key patterns. Some OneSignal public app-ID references remain in older docs.
- No new env vars were added by this investigation.
- No broad Edge Function deploy requirement was introduced.
- OneSignal/Bunny/Daily manual dashboard checklists exist.
- Provider docs generally distinguish code proof from dashboard proof, with the OneSignal stale hardcoded/fallback doc language noted above.
- Native package manifests do not add `expo-av`; static tests scan native source for `expo-av` imports.

## Safe Read-Only Checks

Run without provider mutation:

- `curl -I -L https://www.vibelymeet.com/OneSignalSDK.sw.js` -> HTTP 200 from Vercel.
- `curl -I -L https://www.vibelymeet.com/OneSignalSDKWorker.js` -> HTTP 200 from Vercel.
- `curl -I -L https://www.vibelymeet.com/sw.js` -> HTTP 200 from Vercel.
- `curl -I -L https://cdn.vibelymeet.com/` -> HTTP 404 from BunnyCDN root, acceptable for bare CDN hostname without object path.
- `curl -I -L https://vz-5585ddfc-604.b-cdn.net/` -> HTTP 404 from BunnyCDN root, acceptable for bare Stream CDN hostname without video path.
- `supabase projects list` -> linked project is `schdyxcunwcvddlcshwd / MVP_Vibe`.
- `supabase functions list --project-ref schdyxcunwcvddlcshwd` -> Stream 11/12/13 functions active, including `send-notification`, `push-webhook`, `create-video-upload`, `video-webhook`, `delete-vibe-video`, `upload-image`, `upload-event-cover`, `upload-voice`, `upload-chat-video`, `process-media-delete-jobs`, `daily-room`, `match-call-room-cleanup`, and `video-date-room-cleanup`.
- `supabase secrets list --project-ref schdyxcunwcvddlcshwd` -> provider secret names present; digests were redacted in terminal output and no values were printed.

No real push, media upload/delete/webhook, Daily room create/delete, deploy, Docker, or local Supabase action was run.

## Deployment Posture

- Stream 11: no migration deploy; no Edge Function deploy; normal web/static deploy only if public/web assets change in a future branch.
- Stream 12: no migration deploy; no Edge Function deploy because current closure did not change media functions.
- Stream 13: no migration deploy; no Edge Function deploy because current closure did not change `daily-room`.
- This investigation branch changes only this report.

## Validation Results

Passed:

- `npx tsx shared/matching/onesignalProviderOperationalQa.test.ts`
- `npx tsx shared/matching/bunnyProviderOperationalQa.test.ts`
- `npx tsx shared/matching/dailyProviderOperationalQa.test.ts`
- `for f in shared/matching/*.test.ts; do npx tsx "$f"; done`
- `npm run typecheck`
- `npm run build`
- `cd apps/mobile && npm run typecheck`
- `npm run lint`
- `git diff --check`

Notes:

- `npm run build` completed with existing Vite dynamic-import/chunk-size warnings.
- `npm run lint` exited 0 with the repo's existing warning backlog: 208 warnings, 0 errors.

## Repair Recommendations

Recommended doc-only repair:

- Align `_cursor_context/vibely_onesignal_provider_sheet.md` and `_cursor_context/vibely_rebuild_runbook.md` with current `src/lib/onesignal.ts`: web push is env-backed and disabled when `VITE_ONESIGNAL_APP_ID` is unset; there is no current hardcoded/fallback app ID in the runtime source.

Recommended product/doc confirmation:

- Confirm whether `chat-videos/...` should remain Bunny Storage-owned. Current Stream 12 source/docs/tests say yes; the current prompt wording expected no.

Manual provider follow-ups:

- OneSignal: dashboard app identity, REST key, web origin/service worker settings, player-ID sync, controlled internal push smoke, and webhook receipt wiring.
- Bunny: dashboard library/zone/CDN/webhook auth, controlled internal media smoke, and chat-video provider ownership confirmation.
- Daily: dashboard workspace/domain/token/private-room settings, provider quotas, and controlled internal video-date/match-call QA.

## Safety Confirmation

- No Docker used.
- No local Supabase used.
- No Supabase cloud mutation.
- No deploy.
- No real production push.
- No real production media mutation.
- No real production Daily room create/delete.
- No secret values printed or committed.
