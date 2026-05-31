# Bunny Provider Operational QA

Branch: `fix/bunny-provider-operational-qa`

## Problem

Streams 1-11 hardened Event Lobby, Ready Gate, swipe/realtime/payment, native video-date recovery, and OneSignal provider readiness. Stream 12 audits Bunny as Vibely's media provider boundary so Vibe Video, profile images, event covers, voice uploads, CDN URL generation, webhook readiness, and hybrid legacy media paths are production-verifiable without changing media/product semantics.

## Audit Note

Audited:

- `supabase/functions/create-video-upload/index.ts`
- `supabase/functions/video-webhook/index.ts`
- `supabase/functions/delete-vibe-video/index.ts`
- `supabase/functions/upload-image/index.ts`
- `supabase/functions/upload-event-cover/index.ts`
- `supabase/functions/upload-voice/index.ts`
- `supabase/functions/upload-chat-video/index.ts`
- `supabase/functions/_shared/bunny-media.ts`
- `supabase/functions/_shared/bunny-stream-webhook.ts`
- `supabase/functions/process-media-delete-jobs/index.ts`
- `src/components/vibe-video/VibeStudioModal.tsx`
- `src/lib/heroVideo/heroVideoUploadController.ts`
- `src/lib/vibeVideo/webVibeVideoState.ts`
- `src/lib/vibeVideo/attachHlsPlayback.ts`
- `src/services/imageUploadService.ts`
- `src/services/eventCoverUploadService.ts`
- `src/services/voiceUploadService.ts`
- `src/utils/imageUrl.ts`
- `src/lib/photoUtils.ts`
- `src/components/ProfilePreview.tsx`
- `src/components/ProfileDetailDrawer.tsx`
- `src/components/admin/AdminProfilePreview.tsx`
- `apps/mobile/lib/vibeVideoState.ts`
- `apps/mobile/lib/vibeVideoPlaybackUrl.ts`
- `apps/mobile/lib/vibeVideoApi.ts`
- `apps/mobile/lib/nativeHeroVideoUploadController.ts`
- `apps/mobile/lib/vibeVideoPoll.ts`
- `apps/mobile/lib/imageUrl.ts`
- `apps/mobile/lib/uploadImage.ts`
- `apps/mobile/lib/chatMediaUpload.ts`
- `apps/mobile/components/video/VibeVideoPlayer.tsx`
- `apps/mobile/components/video/FullscreenVibeVideoModal.tsx`
- `supabase/config.toml`
- existing Bunny/provider docs

No Ready Gate, swipe, payment, realtime, OneSignal, Daily, RevenueCat, provider dashboard, Supabase migration, or media semantics changed.

## Production CDN / Read-Only Checks

Safe HEAD checks only:

- `curl -I -L https://cdn.vibelymeet.com/` returned HTTP 404 from BunnyCDN root with `server: BunnyCDN-AT1-1170` and pull zone headers. This is acceptable for a bare CDN hostname without an object path and verifies DNS/CDN routing reaches Bunny.
- `curl -I -L https://vz-5585ddfc-604.b-cdn.net/` returned HTTP 404 from BunnyCDN root with Bunny CORS/edge headers. This is acceptable for a bare Stream CDN hostname without a video path and verifies the host reaches Bunny.

Discoverable non-secret local frontend/mobile hostnames:

- `VITE_BUNNY_CDN_HOSTNAME=cdn.vibelymeet.com`
- `VITE_BUNNY_STREAM_CDN_HOSTNAME=vz-5585ddfc-604.b-cdn.net`
- `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME=cdn.vibelymeet.com`
- `EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME=vz-5585ddfc-604.b-cdn.net`

No private/profile-specific media URLs were accessed.

## Supabase Bunny Function Deployment Posture

Read-only Supabase checks confirmed:

- linked project: `schdyxcunwcvddlcshwd / MVP_Vibe`
- migrations list read succeeded against the linked project
- deployed and active:
  - `create-video-upload`
  - `video-webhook`
  - `delete-vibe-video`
  - `upload-image`
  - `upload-event-cover`
  - `upload-voice`
  - `upload-chat-video`
  - `process-media-delete-jobs`

## Bunny Secret-Name Presence Posture

`supabase secrets list --project-ref schdyxcunwcvddlcshwd` showed names/digests only. Secret values were not printed.

Present:

- `BUNNY_STREAM_LIBRARY_ID`
- `BUNNY_STREAM_API_KEY`
- `BUNNY_STREAM_CDN_HOSTNAME`
- `BUNNY_STORAGE_ZONE`
- `BUNNY_STORAGE_API_KEY`
- `BUNNY_CDN_HOSTNAME`
- `BUNNY_CHAT_STORAGE_CDN_HOSTNAME`
- `BUNNY_CHAT_STORAGE_TOKEN_SECURITY_KEY`
- `CHAT_MEDIA_DIRECT_CDN_ENABLED`
- `CHAT_MEDIA_PROXY_SECRET`
- `BUNNY_VIDEO_WEBHOOK_TOKEN`
- `BUNNY_WEBHOOK_SIGNING_KEY` (present externally; current `video-webhook` source uses `BUNNY_VIDEO_WEBHOOK_TOKEN` plus Stream signature validation against `BUNNY_STREAM_API_KEY`)

Frontend/mobile variables are documented and represented locally:

- `VITE_BUNNY_STREAM_CDN_HOSTNAME`
- `VITE_BUNNY_CDN_HOSTNAME`
- `EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME`
- `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME`

## Vibe Video Create / Upload / TUS / Webhook / Playback Path

Posture:

- `create-video-upload` requires JWT auth, resolves the Supabase user, validates core profile fields, reads `BUNNY_STREAM_LIBRARY_ID`, `BUNNY_STREAM_API_KEY`, and `BUNNY_STREAM_CDN_HOSTNAME`, creates a Bunny Stream video object, generates a TUS signature, creates a media session, and activates the profile snapshot through `activate_profile_vibe_video` with status `uploading`.
- Web and native upload bytes directly to Bunny TUS at `https://video.bunnycdn.com/tusupload`; Supabase does not proxy the video file body.
- Web `heroVideoUploadController` and native `nativeHeroVideoUploadController` move to processing after TUS success and poll backend-owned `profiles.bunny_video_uid` / `bunny_video_status`.
- `video-webhook` has `verify_jwt = false` so Bunny can call it. It authenticates with Bunny Stream signature headers when present, otherwise bearer token or legacy query token using `BUNNY_VIDEO_WEBHOOK_TOKEN`.
- `video-webhook` validates `VideoGuid`, guards `VideoLibraryId` against `BUNNY_STREAM_LIBRARY_ID` when Bunny sends it, maps Bunny status `3`/`4` to `ready`, status `5` to `failed`, and all other statuses to `processing`.
- Webhook updates `draft_media_sessions` through `update_media_session_status` first; the RPC keeps active profile mirrors in sync. A narrow legacy fallback updates `profiles.bunny_video_status` by `.eq("bunny_video_uid", VideoGuid)`.
- Web/native playback URLs are constructed as `https://<stream-cdn-host>/<video-guid>/playlist.m3u8`; thumbnails use `thumbnail.jpg`.
- Processing states remain score-eligible when `bunny_video_uid` is non-empty but are not treated as playable.

## Vibe Video Deletion Path

Posture:

- `delete-vibe-video` requires JWT auth, reads the current profile video UID, clears local profile state through `clear_profile_vibe_video`, marks related media sessions deleted, and returns success once local state is definitive.
- Physical Bunny Stream deletion is deferred to media lifecycle purge/delete worker flow (`process-media-delete-jobs` -> `_shared/bunny-media.ts` -> `deleteBunnyStreamVideo`). The function returns `possibleBunnyOrphan: true` / `deleteDeferredToWorker: true` to make the operational risk visible.
- This preserves current product behavior: local delete is definitive; remote delete is best-effort/deferred.

## Image Upload Path

Posture:

- `upload-image` requires JWT auth, validates type/size, optionally validates chat match membership for `context=chat`, writes Bunny Storage objects under `photos/{userId}/{uuid}.{ext}`, registers media lifecycle rows, and returns the relative `path`.
- Profile-photo replacement remains draft-safe; old published assets are not deleted during raw upload.
- Web/native `getImageUrl` resolves `photos/...` through Bunny CDN and preserves full URLs plus legacy Supabase storage-style paths.

## Event Cover Upload Path

Posture:

- `upload-event-cover` requires JWT auth and admin role membership.
- It validates type/size, writes Bunny Storage objects under `events/{eventId}/{timestamp}.{ext}` or `events/covers/{timestamp}.{ext}`, registers lifecycle references, and returns `path` plus a full CDN URL using `BUNNY_CDN_HOSTNAME`.

## Voice Upload Path

Posture:

- `upload-voice` requires JWT auth, requires `conversation_id`, verifies the user belongs to the match, validates type/size, writes Bunny Storage objects under `voice/{conversationId}/{userId}_{timestamp}.{ext}`, registers lifecycle, and returns `path` plus `bunnyCdnUrl(storagePath)`.
- Web and native clients pass the returned CDN URL through the message-send contract rather than directly inserting chat rows.

## URL Resolver / Hybrid Legacy Media Posture

Posture:

- Web `src/utils/imageUrl.ts` and native `apps/mobile/lib/imageUrl.ts` treat `photos/...` as Bunny CDN paths only.
- Full HTTP(S), `data:`, and local preview URL forms are preserved where supported.
- Legacy Supabase storage-style paths still fall back to `${SUPABASE_URL}/storage/v1/object/public/...`.
- Optional CDN path-prefix support exists for storage pull-zone setups via `VITE_BUNNY_CDN_PATH_PREFIX`, `EXPO_PUBLIC_BUNNY_CDN_PATH_PREFIX`, and `BUNNY_CDN_PATH_PREFIX`.
- Chat Vibe Clip video currently uses Bunny Storage through `upload-chat-video` under the `chat-videos/...` path prefix. Do not confuse that prefix with a Supabase Storage bucket; historical Supabase-style media paths remain supported by resolvers where applicable.

## Native Vibe Video Posture

Posture:

- Native Vibe Video state uses `apps/mobile/lib/vibeVideoState.ts`, which delegates to shared `resolveCanonicalVibeVideoState`.
- Native playback URL construction is centralized in `apps/mobile/lib/vibeVideoPlaybackUrl.ts`.
- Native upload uses `tus-js-client` with React Native file sources and does not materialize full videos as base64 strings.
- Native playback uses `expo-video` through `VibeVideoPlayer`.
- No `expo-av` import/require was found in code, and `apps/mobile/package.json` does not include `expo-av`.

## Video-Webhook Trust / Exposure Posture

Posture:

- `video-webhook` is externally callable by design (`verify_jwt = false`) because Bunny cannot present a Supabase user JWT.
- Current trust controls are:
  - Bunny Stream signature validation when Bunny sends signature headers and `BUNNY_STREAM_API_KEY` is configured
  - bearer token fallback via `BUNNY_VIDEO_WEBHOOK_TOKEN`
  - legacy query-token fallback via `?token=...`
  - optional `VideoLibraryId` guard against `BUNNY_STREAM_LIBRARY_ID`
  - GUID format validation before DB mutation
- Manual dashboard verification must confirm which Bunny auth mode is actually configured and whether query-token fallback can be retired later.

## Code Fixes

- 2026-05-21 update: web/native image URL helpers now keep display-size option signatures but stop emitting Bunny Optimizer query params. Bunny Storage images resolve as plain CDN URLs because Bunny Optimizer is off/not required.
- `_cursor_context/vibely_bunny_provider_sheet.md` was corrected where it described old immediate-delete / old-photo-delete / voice fallback behavior that no longer matches the lifecycle-backed implementation.

## Tests Added

- `shared/matching/bunnyProviderOperationalQa.test.ts`

Coverage:

- Bunny Stream env names used by `create-video-upload`
- Bunny Stream object creation before TUS credential return
- TUS endpoint remains `https://video.bunnycdn.com/tusupload`
- profile UID/status activation through the backend-owned RPC
- webhook status mapping and profile/session update by video UID
- delete local clear plus Bunny delete-worker handoff
- Bunny Storage path conventions for images, event covers, voice, and current chat Vibe Clips
- URL resolver Bunny/legacy hybrid behavior
- web/native Stream CDN playback URL shape
- canonical native Vibe Video resolver and no `expo-av`
- no new env vars, native modules, or Supabase migrations
- Streams 1-11 artifacts remain present

## Manual Bunny Provider-Dashboard Checklist

Before a media release or controlled internal smoke:

1. Confirm Bunny Stream library matches `BUNNY_STREAM_LIBRARY_ID`.
2. Confirm `BUNNY_STREAM_API_KEY` can create/delete videos in that library.
3. Confirm `BUNNY_STREAM_CDN_HOSTNAME` / `VITE_BUNNY_STREAM_CDN_HOSTNAME` / `EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME` point to the intended Stream CDN hostname.
4. Confirm Bunny video processing webhook is configured to the deployed `video-webhook` URL.
5. Confirm whether `video-webhook` should receive a signature, bearer token, or legacy query token, and whether the Bunny dashboard supports the preferred mode.
6. Confirm Bunny Storage zone matches `BUNNY_STORAGE_ZONE`.
7. Confirm `BUNNY_STORAGE_API_KEY` can write/delete in the Storage zone.
8. Confirm `BUNNY_CDN_HOSTNAME` / `VITE_BUNNY_CDN_HOSTNAME` / `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME` point to intended CDN/pull zone.
9. Confirm DNS/custom hostname for `cdn.vibelymeet.com`.
10. Confirm public CDN edge rule `Block_Not_Public_Media` is enabled and blocks only:
    - `https://cdn.vibelymeet.com/voice/*`
    - `https://cdn.vibelymeet.com/chat-videos/*`
    - `https://cdn.vibelymeet.com/photos/match-*`
    - `https://cdn.vibelymeet.com/media/*`
11. Confirm private chat Storage pull zone `vibely-chat-storage-hot.b-cdn.net` points to the hot Storage zone with Token Authentication enabled and Token IP validation off.
12. Run `BUNNY_CHAT_STORAGE_CDN_HOSTNAME=vibely-chat-storage-hot.b-cdn.net npm run probe:media-privacy`; it must pass public-CDN and unsigned-private-CDN denial checks.
13. Run controlled internal media smoke only with a test user/test event:
    - vibe video upload
    - webhook readiness
    - HLS playback
    - delete video
    - image upload
    - event cover upload
    - voice upload
14. Confirm chat videos remain on the current intended provider path. Current baseline uses Bunny Storage under `chat-videos/...`; do not migrate ownership without a separate stream.

## 2026-05-31 Private Chat Media Closure Addendum

- The prior public-CDN private chat media exposure is closed by Bunny configuration plus code guards.
- Active private chat Storage media is no longer allowed through `cdn.vibelymeet.com` by path.
- Private chat Storage direct delivery uses `BUNNY_CHAT_STORAGE_CDN_HOSTNAME` with Bunny Token Authentication; resolver-issued signed URLs remain short-lived.
- Unsigned requests to the private chat Storage CDN must fail.
- The read-only GitHub Actions gate is `.github/workflows/media-privacy-live-probe.yml`; it runs on `main`, daily, and manually.
- `LEGACY_UPLOAD_CHAT_VIDEO_ENABLED` should remain unset/off unless a separate rollback is approved.

No real production media smoke was run in this stream.

## Deploy Requirements

- Supabase migration requirement: none
- Edge Function deploy requirement: none because no Edge Function changed
- Web/static deploy requirement: normal host deployment after merge because web image URL resolver behavior changed
- Env var changes: none
- Native module changes: none
- `expo-av`: not used
- Docker/local Supabase: not used

## Remaining Deferred Work

- controlled internal Vibe Video upload/playback QA
- controlled internal image/event-cover/voice upload QA
- physical-device native media QA
- screenshot-led native visual parity
- Daily provider operational QA
- Resend/Twilio provider QA
- RevenueCat/native entitlement implementation if incomplete
