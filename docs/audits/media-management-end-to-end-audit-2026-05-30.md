# Media Management End-to-End Audit

Date: 2026-05-30
Mode: read-only investigation, validation, and verification
Repo: `/Users/kaanporsuk/Documents/Vibely/Git/vibelymeet`
Linked Supabase project checked: `MVP_Vibe` (`schdyxcunwcvddlcshwd`, `eu-west-1`)

## Executive Summary

This audit traced Vibe Video, Profile Photos, Chat Voice Messages, Chat Video Clips, and Photos shared in Chat from capture or selection through upload, lifecycle rows, provider storage, message/profile publication, load, playback, retry, recovery, deletion, and observability.

The modern media architecture is much stronger than a typical early-stage media stack: it has a shared media SDK, client request IDs, upload receipts, `media_assets`, `media_references`, service-role-only lifecycle RPCs, RLS, Bunny Stream for HLS video, proxy/signed URL issuance for chat media, provider health cron, delete worker cron, idempotent message publication, and broad contract tests. Static and local verification are green.

However, I cannot certify the system as bulletproof. The largest blocker is a privacy boundary issue: live read-only CDN checks showed active private chat storage media objects can be fetched unauthenticated from the public Bunny Storage CDN when the object path is known. That bypasses the intended `get-chat-media-url` authorization/proxy layer. This does not prove easy enumeration, but it does prove the protection boundary currently depends on path secrecy rather than access control for some chat photos/voice storage media.

Top launch blockers and hardening priorities:

| Severity | Finding | Impact |
| --- | --- | --- |
| P0/P1 | Private chat storage media is reachable through public Bunny CDN if path is known | Chat photos, voice, and legacy storage video privacy relies on unguessable paths instead of enforced authorization |
| P1 | Mobile public env contains a RevenueCat key named as public but shaped like a secret/server key | If it is actually secret, it is bundled into the native app and must be rotated |
| P1 | Vibe Video TUS upload lacks stale credential refresh/resume recovery | Long/background uploads can fail after credential expiry while Chat Vibe Clips already handle this better |
| P1 | Vibe Video web polling stops after 3 minutes | Delayed Bunny processing/webhook can leave users in a stalled UI even when processing later succeeds |
| P1/P2 | Legacy `upload-chat-video` function remains deployed and active | Older clients can still use a lower-reliability, public-CDN, 8 MB storage-video path |
| P2 | Web Vibe Clip recorder does not catch `MediaRecorder` constructor/start exceptions | Unsupported browser/runtime states can break the modal instead of producing a controlled error |
| P2 | Outbox persistence trusts parsed arrays without item schema validation | Corrupt/legacy local storage can poison pending media queue state |
| P2 | Processing-failed media fallback copy maps to "deleted" | Users/operators get misleading recovery signals |
| P2 | Event lobby deck media validation SQL has drift | Live function shape is OK, but validator falsely fails on `search_path=public, pg_catalog` |

## Verification Performed

No uploads, deletes, webhook replays, provider mutations, payment operations, database writes, migrations, or application code changes were performed. The only repo change from this audit is this Markdown report.

### Local Static And Contract Verification

All requested local checks passed:

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npm run test:media-sdk` | Pass |
| `npm run test:vibe-video-contract` | Pass |
| `npm run test:vibe-clip-upload-contract` | Pass |
| `npm run test:chat-media-cache` | Pass |
| `npm run test:chat-media-direct-cdn` | Pass |
| `npm run test:media-upload-sniffing` | Pass |
| `npm run test:media-idempotency` | Pass |
| `npm run test:media-phase8` | Pass |
| `npm run test:media-phase9` | Pass |
| `npm run test:web-vibe-video-trust` | Pass |
| `npm run test:admin-media-lifecycle` | Pass |
| `bash scripts/run_chat_vibe_clip_smoke_matrix.sh --dry-run` | Pass |
| `cd apps/mobile && npm run typecheck` | Pass |

The smoke matrix covers web, iOS, and Android dry-run scenarios: happy path, 4G throttle, kill mid-TUS, delayed webhook, signed URL mid-expiry, and stuck-processing nudge on app launch.

Only non-failing noise observed: Node `DEP0205 module.register()` deprecation warnings.

### Supabase Live Read-Only Verification

Supabase CLI: `2.101.0` with update notice to `2.102.0`.

Linked project:

| Field | Value |
| --- | --- |
| Project | `MVP_Vibe` |
| Ref | `schdyxcunwcvddlcshwd` |
| Region | `eu-west-1` |
| Health | `ACTIVE_HEALTHY` |

Read-only SQL connection succeeded as `postgres` against the linked database.

Validation and catalog checks:

| Check | Result |
| --- | --- |
| Media Phase 5 validation | `media_phase5_bulletproof_closure_ok` |
| Media Phase 9 validation | `media_phase9_completion_ok` |
| Phase 8 validation SQL | Not run, because the script creates/updates test rows |
| Vibe Video validation SQL | Not run, because the scripts create/update/delete validation users/profiles |
| `get_profile_for_viewer(uuid)` masking | Live definition includes `vibe_video_playback_ref` and masking around Bunny video UID |
| Media lifecycle RPC grants | Service-role/postgres only for reserve/complete/attach/release/delete-worker/classifier functions |
| Event deck payload media shape | Live result type has required media columns; validation SQL has stale `search_path` predicate |

RLS snapshot for core media tables:

| Table | RLS | Notable policies |
| --- | --- | --- |
| `media_assets` | Enabled | Service role full access; users can read own `owner_user_id` assets |
| `media_references` | Enabled | Service role full access; users can read references linked to their own media asset |
| `media_upload_receipts` | Enabled | Service-role-only access |
| `chat_vibe_clip_uploads` | Enabled | Service role full access; users can read own sender uploads |
| `vibe_video_uploads` | Enabled | Service role full access; users can select own upload rows |
| `messages` | Enabled | Message access mediated by match/user policies and service functions |
| `profiles` | Enabled | Profile visibility is constrained by RLS/RPCs |
| `media_delete_jobs` | Enabled | Service-role operational surface |

Live aggregate media state, with no PII, URLs, or paths retained in this report:

| Table | Count |
| --- | ---: |
| `media_assets` | 220 |
| `media_references` | 436 |
| `media_delete_jobs` | 33 |
| `media_upload_receipts` | 29 |
| `chat_vibe_clip_uploads` | 18 |
| `vibe_video_uploads` | 9 |
| `bunny_cdn_health_state` | 2 |

Media asset status snapshot:

| Family | Provider | Tier | Status | Count |
| --- | --- | --- | --- | ---: |
| `chat_image` | Bunny Storage | hot | active | 35 |
| `chat_image` | Bunny Storage | hot | purged | 3 |
| `chat_video` | Bunny Storage | hot | active | 20 |
| `chat_video` | Bunny Storage | hot | purged | 1 |
| `chat_video` | Bunny Storage | hot | uploading | 1 |
| `chat_video` | Bunny Stream | hot | active | 18 |
| `chat_video_thumbnail` | Bunny Storage | hot | active | 15 |
| `chat_video_thumbnail` | Bunny Storage | hot | purged | 1 |
| `chat_video_thumbnail` | Bunny Storage | hot | uploading | 1 |
| `event_cover` | Bunny Storage | hot | active | 3 |
| `event_cover` | Bunny Storage | hot | soft_deleted | 2 |
| `profile_photo` | Bunny Storage | hot | active | 33 |
| `profile_photo` | Bunny Storage | hot | purged | 20 |
| `profile_photo` | Bunny Storage | hot | soft_deleted | 10 |
| `vibe_video` | Bunny Stream | hot | active | 7 |
| `vibe_video` | Bunny Stream | hot | purged | 7 |
| `vibe_video` | Bunny Stream | hot | soft_deleted | 15 |
| `voice_message` | Bunny Storage | hot | active | 27 |
| `voice_message` | Bunny Storage | hot | purged | 1 |

Upload receipts:

| Status | Families |
| --- | --- |
| `uploaded` | `chat_image` 11, `event_cover` 1, `profile_photo` 9, `voice_message` 8 |

Delete jobs:

| Provider | Reason | Status | Count |
| --- | --- | --- | ---: |
| Bunny Storage | `account_delete` | completed | 2 |
| Bunny Storage | `purge` | completed | 24 |
| Bunny Stream | `account_delete` | completed | 4 |
| Bunny Stream | `purge` | completed | 3 |

Processing/recovery snapshots:

| Area | Result |
| --- | --- |
| Chat Vibe Clip uploads | 18 `ready`; all 18 have messages; 0 stale unpublished over 10 minutes |
| Vibe Video uploads | 2 `ready`, 7 `superseded`; no live stuck processing in the snapshot |
| Active assets without active refs | No rows returned for uploaded/active/purge-ready/delete-failed/deleted criteria |

Cron:

| Job | Schedule | Recent health |
| --- | --- | --- |
| `bunny-cdn-health-minutely` | Every minute | 1440 succeeded in last 24h |
| `media-delete-worker-every-15m` | Every 15 minutes | 96 succeeded in last 24h |

Supabase functions relevant to media are deployed and active, including `upload-image`, `upload-voice`, `create-video-upload`, `video-webhook`, `sync-vibe-video-status`, `delete-vibe-video`, `create-chat-vibe-clip-upload`, `complete-chat-vibe-clip-upload`, `dismiss-chat-vibe-clip-upload`, `sync-chat-vibe-clip-status`, `get-chat-media-url`, `process-media-delete-jobs`, `check-bunny-cdn-health`, `send-message`, and the legacy `upload-chat-video`.

### Bunny Live Read-Only Verification

No Bunny Stream API read key was available locally, so I did not query Bunny Stream metadata directly.

Using only active referenced Bunny Storage assets from Supabase and the configured public CDN hostname, I performed `HEAD` and range checks against one existing object from each sampled family. I did not retain URLs or provider paths in this report.

| Family | HEAD | Range GET | Content type | Cache/range readiness |
| --- | --- | --- | --- | --- |
| `chat_image` | 200 | 206 | `image/jpeg` | Cache headers and content length present |
| `event_cover` | 200 | 206 | `image/png` | Cache headers and content length present |
| `profile_photo` | 200 | 206 | `image/jpeg` | Cache headers and content length present |
| `voice_message` | 200 | 206 | `audio/mpeg` | Cache headers and content length present |

This proves good CDN availability/range behavior for sampled storage media. It also proves the privacy issue for active chat image and voice objects: they were reachable via unauthenticated public CDN URL when the path was known.

### Sentry And PostHog Live Verification

`SENTRY_AUTH_TOKEN` was not configured, so I could not list recent production Sentry issues/events. Static Sentry and PostHog instrumentation exists across web, native, and Edge functions, including media SDK sinks and media/video breadcrumbs, but live dashboards and recent production issue volume remain unverified.

## End-to-End Flow Maps

### Profile Photo

| Step | Web | Native | Backend/provider |
| --- | --- | --- | --- |
| Select/capture | Onboarding/Profile Studio uses `src/services/imageUploadService.ts` and photo UI | Expo picker/camera normalized in `apps/mobile/lib/imageAssetNormalize.ts` and uploaded via `apps/mobile/lib/uploadImage.ts` | N/A |
| Local preprocessing | Web creates JPEG derivatives when browser can decode the image; skips HEIC/HEIF | Native transcodes HEIC/HEIF profile images to JPEG and creates derivatives | N/A |
| Upload request | Multipart to `upload-image` with stable client request ID and context | Multipart to `upload-image` with mobile metadata | `supabase/functions/upload-image/index.ts` |
| Validation | Client size/type prechecks plus backend byte sniffing | Client normalization plus backend byte sniffing | Backend validates bytes, MIME, context, match/profile ownership |
| Reservation/idempotency | `reserve_media_upload` with content SHA256 and client request ID | Same contract | `media_upload_receipts`, `media_assets` |
| Provider write | N/A | N/A | Bunny Storage PUT for canonical and derivatives |
| Completion | `complete_profile_photo_media_upload` and presentation metadata | Same | `media_assets` active/uploaded, profile photo refs |
| Publication | Profile photos/avatar updated through profile flow | Same | Profile rows and media lifecycle references |
| Load | `getImageUrl`, derivative memory map, public CDN | Native `imageUrl.ts`, public CDN | Bunny public CDN |
| Deletion/replacement | Replaced paths and lifecycle refs | Same | `media_delete_jobs`, delete worker cron |

Strong points:

- Backend byte sniffing is present.
- Upload reservation/receipt flow gives idempotency and lifecycle auditability.
- Derivatives and placeholders improve perceived speed.
- Native HEIC/HEIF transcode closes a major iOS camera-library edge case.

Residual risks:

- Web HEIC/HEIF can upload canonical media but skips derivative generation, so display reliability depends on downstream support or original rendering.
- Public CDN config is a single point of display failure for Bunny-backed photos.
- Profile photos are intentionally public-ish display media, but path logging should still be minimized.

### Vibe Video

| Step | Web | Native | Backend/provider |
| --- | --- | --- | --- |
| Capture/select | `VibeStudioModal`, `heroVideoUploadController` | `app/vibe-video-record.tsx`, `useNativeHeroVideoUpload`, `vibeVideoApi.ts` | N/A |
| Credential creation | Calls `create-video-upload` | Calls `create-video-upload` | Creates Bunny Stream video/session, records `vibe_video_uploads` |
| Upload | Direct TUS to Bunny Stream | Direct TUS to Bunny Stream | Bunny Stream receives bytes |
| Completion | Client polls `sync-vibe-video-status` after TUS success | Native polls via vibe video poll utilities | `video-webhook` and sync functions update status |
| Activation | Ready video attached to profile | Same | `activate_profile_vibe_video`, `profile_vibe_videos`, `profiles.vibe_video_playback_ref` |
| Load/playback | `VibePlayer`, `attachHlsPlayback`, signed playback ref resolution | `VibeVideoPlayer`, fullscreen modal | Bunny Stream HLS via CDN/signed playback |
| Thumbnail | Bunny Stream thumbnail playback refs | Same | Stream thumbnail references |
| Replace/delete | `delete-vibe-video`, supersede and purge jobs | Same | Soft delete, purge worker, Bunny Stream delete |
| Recovery | Web poll/visibility resume; backend stale classifiers | Native polling and status sync | Cron/manual sync classify stale processing |

Strong points:

- Profile Vibe Video uses Bunny Stream, not storage video, which is right for HLS playback and CDN speed.
- Server-side profile view masks Bunny UID and exposes playback refs through controlled structures.
- Lifecycle tables track active, superseded, soft-deleted, and purged states.
- Live database snapshot showed no stuck processing rows requiring action.

Residual risks:

- Web and native upload paths do not refresh stale TUS credentials mid-upload.
- Web upload polling stops after 3 minutes, while provider processing can be longer or webhook delivery can be delayed.
- Bunny Stream API live metadata was not independently verified because no local read key was available.

### Chat Voice Messages

| Step | Web | Native | Backend/provider |
| --- | --- | --- | --- |
| Record | `VoiceRecorder.tsx` | Native chat composer/player components | N/A |
| Upload | `voiceUploadService.ts` to `upload-voice` | Mobile media SDK/native upload | Bunny Storage via Edge function |
| Validation | Client checks plus backend byte sniffing | Same | Sniffing and lifecycle registration |
| Publish | `send-message` with `message_kind=voice`, `audio_url`, duration, client request ID | Same | Idempotent insert and `ensureMessageMediaOrRollback` |
| Notification | Push body says "Sent a voice message"; no media URL | Same | OneSignal via `send-notification` |
| Load/playback | Resolver issues authorized URL/proxy token | Native resolver/player | `get-chat-media-url`, proxy or signed direct private CDN when configured |
| Retry | Client retry/outbox depending surface | Native outbox/pending send | Idempotent publish by client request ID |
| Deletion/retention | Message/media refs release lifecycle | Same | Delete worker purges unreferenced objects |

Strong points:

- Notification preview does not leak media URL.
- Message publication is idempotent.
- Authorized resolver path exists and supports progressive/range playback.

Residual risks:

- Live CDN sample proved a voice object is reachable from the public CDN by path. That defeats the intended chat resolver boundary.
- Duration/waveform metadata reliability depends on client-provided values; backend can clamp duration but does not derive waveform.

### Chat Photos

| Step | Web | Native | Backend/provider |
| --- | --- | --- | --- |
| Select/capture | `Chat.tsx`, image upload service | `chatMediaUpload.ts`, image normalization | N/A |
| Upload | `upload-image` with `context=chat` and match scope | Same | Bunny Storage and lifecycle receipt |
| Publish | `send-message` image marker/text routing | Same | `ensureMessageMediaOrRollback` attaches refs |
| Notification | Push preview uses "Photo" and strips URLs | Same | OneSignal no URL payload |
| Load/viewer | Chat media resolver/lightbox | Native chat media viewer | `get-chat-media-url` issues proxy/signed URL |
| Cache | Browser/native cache through media resolver | Native cache and viewer state | CDN/proxy range support |
| Retention/deletion | Message/media refs and delete worker | Same | Lifecycle jobs |

Strong points:

- Chat image notifications intentionally avoid leaking transport URLs.
- Lifecycle receipts and references exist.
- CDN range and cache behavior are healthy for sampled storage objects.

Residual risks:

- Active chat image object was reachable via public CDN by path.
- Public image helpers still classify `media/` and `voice/` as public Bunny Storage prefixes, which can normalize private-looking refs into public URLs if called with those paths.

### Chat Video Clips / Vibe Clips

| Step | Web | Native | Backend/provider |
| --- | --- | --- | --- |
| Capture | `VideoMessageRecorder.tsx` and web outbox | Native camera/composer and native outbox | N/A |
| Create upload | `create-chat-vibe-clip-upload` | Same | Bunny Stream session and `chat_vibe_clip_uploads` |
| Upload | Direct TUS to Bunny Stream | Direct TUS to Bunny Stream | Bunny Stream receives bytes |
| Stale credential recovery | Implemented: re-create credentials, require same upload/video IDs, resume | Implemented in shared/native flow | Good pattern |
| Complete/publish | `complete-chat-vibe-clip-upload` | Same | Creates/updates message, media asset/reference |
| Webhook/sync | `video-webhook`, `sync-chat-vibe-clip-status` | Same | Processing status and thumbnail/playback refs |
| Dismiss/recover | `dismiss-chat-vibe-clip-upload`, outbox recovery | Same | Upload row lifecycle |
| Playback | `VideoMessageBubble`, `VibeClipBubble`, HLS playback refs | Native clip card/viewer | Bunny Stream HLS |

Strong points:

- This is the best-developed upload flow in the system.
- It has explicit stale TUS credential recovery, unpublished-upload recovery, idempotent completion, and dry-run smoke coverage for app kill/background and delayed webhook.
- Live DB showed no stale unpublished clips.

Residual risks:

- Server can validate declared MIME/size before direct TUS, but cannot sniff bytes before Bunny accepts them.
- Web `MediaRecorder` construction/start is not wrapped in `try/catch`.
- Outbox storage trusts parsed arrays without schema validation and IndexedDB blob storage has no global TTL/orphan cleanup.

## Findings

### P0/P1 - Private Chat Storage Media Is Publicly Reachable By Path

Evidence:

- Live read-only Bunny CDN checks returned unauthenticated `HEAD 200` and range `206` for active `chat_image` and `voice_message` Bunny Storage objects.
- `get-chat-media-url` correctly enforces auth and message/profile scope before issuing a URL or proxy token: `supabase/functions/get-chat-media-url/index.ts:683`.
- The same function says direct chat CDN delivery must use a dedicated token-auth zone and never reuse the public `BUNNY_CDN_HOSTNAME`: `supabase/functions/get-chat-media-url/index.ts:964`.
- Web and native public URL helpers include private-looking prefixes in public CDN mapping: `src/utils/imageUrl.ts:16`, `src/utils/imageUrl.ts:132`, `apps/mobile/lib/imageUrl.ts:27`, `apps/mobile/lib/imageUrl.ts:135`.

Root cause:

The application has an authorization layer for resolving chat media, but the underlying Bunny Storage public CDN still serves at least some active chat objects directly. That makes authorization dependent on object path secrecy.

Impact:

- Anyone who obtains a provider path through logs, device cache, screenshots, browser devtools, error payloads, analytics, database exposure, or a recipient forwarding it can fetch the media without Supabase auth.
- This affects privacy-sensitive media families: chat photos and voice messages. Legacy storage chat video is also in this risk class.
- Unguessable paths reduce enumeration risk but do not satisfy private media access control.

Recommendation:

- Move private chat storage media to a storage zone/pull zone that cannot be served through the public CDN.
- Require Bunny token-auth or Edge proxy for chat storage media at the provider layer, not only in app code.
- Remove `voice/` and generic `media/` from public image URL helper prefixes unless each prefix is proven public.
- Add a CI/live read-only privacy probe that samples active private media refs and asserts public CDN returns 401/403/404 without a valid token.
- Rotate or re-key exposed private object paths after provider access control is corrected.
- Scrub provider paths from logs and analytics before rotating paths.

### P1 - Mobile RevenueCat Public Env May Contain A Secret Key

Evidence:

- `apps/mobile/.env` contains `EXPO_PUBLIC_REVENUECAT_API_KEY` with a `sk_...` shape. The value is not reproduced here.
- The file also contains platform public keys (`EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`).
- `apps/mobile/lib/revenuecat.ts` uses public Expo env values for client SDK initialization.

Root cause:

A key named `EXPO_PUBLIC_*` is bundled into the mobile app. A `sk_` shape strongly suggests a secret/server key, though this audit did not call RevenueCat to classify it.

Impact:

If it is a secret key, it is exposed to every installed native app bundle and must be considered compromised.

Recommendation:

- Confirm the key class in RevenueCat dashboard.
- If it is a secret key, rotate it immediately.
- Remove `EXPO_PUBLIC_REVENUECAT_API_KEY` if platform keys are sufficient.
- Add an env-lint rule that blocks `EXPO_PUBLIC_*` values with known secret prefixes.

### P1 - Vibe Video Upload Does Not Refresh Stale TUS Credentials

Evidence:

- Web `heroVideoUploadController` requests credentials once, then starts TUS with those headers: `src/lib/heroVideo/heroVideoUploadController.ts:579`, `src/lib/heroVideo/heroVideoUploadController.ts:685`.
- Native rejects expired/signature failures with "Upload session expired. Please try uploading again.": `apps/mobile/lib/vibeVideoApi.ts:379`.
- Chat Vibe Clip has the stronger pattern: detect 401/403/410, re-create credentials, require same upload/video ID, and resume: `src/services/chatVibeClipStreamUploadService.ts:262`, `src/services/chatVibeClipStreamUploadService.ts:335`.

Root cause:

The mature stale-credential recovery was implemented for Chat Vibe Clips but not ported back to Profile Vibe Video.

Impact:

Slow uploads, backgrounded mobile uploads, network stalls, or large files can cross credential TTL and fail after significant user effort. The user must manually retry, and orphaned provider/upload state depends on cleanup.

Recommendation:

- Port the Chat Vibe Clip stale-credential recovery pattern to Vibe Video web and native.
- Preserve upload ID/video ID on refresh and refuse mismatched targets.
- Add contract tests for Vibe Video 401/403/410 recovery and app background/resume.

### P1 - Vibe Video Web Polling Stops After 3 Minutes

Evidence:

- `POLL_MAX_ATTEMPTS = 36` and interval is 5 seconds: `src/lib/heroVideo/heroVideoUploadController.ts:84`.
- On timeout, state becomes `stalled` with "refresh later or replace it": `src/lib/heroVideo/heroVideoUploadController.ts:305`.

Root cause:

The client has a fixed short poll budget instead of a durable processing subscription/recovery model.

Impact:

Bunny processing or webhook delays longer than 3 minutes can leave the user staring at a stalled state even when provider processing later succeeds.

Recommendation:

- Continue low-frequency polling beyond 3 minutes, or persist a durable processing state and resume automatically on navigation/app launch.
- Show a clear "still processing" state with retry/status refresh, not just replace/refresh copy.
- Alert on backend rows that exceed expected processing SLO.

### P1/P2 - Legacy `upload-chat-video` Remains Active

Evidence:

- Function comment says it is legacy and new Chat Vibe Clips should use Bunny Stream TUS: `supabase/functions/upload-chat-video/index.ts:15`.
- It uses Bunny Storage and has an 8 MB cap due Edge body size: `supabase/functions/upload-chat-video/index.ts:17`, `supabase/functions/upload-chat-video/index.ts:107`.
- It returns HTTP 200 for auth, validation, forbidden, provider, and unexpected errors: `supabase/functions/upload-chat-video/index.ts:42`, `supabase/functions/upload-chat-video/index.ts:57`, `supabase/functions/upload-chat-video/index.ts:94`, `supabase/functions/upload-chat-video/index.ts:173`, `supabase/functions/upload-chat-video/index.ts:258`.
- It registers media assets as `uploading` but returns `processing_status: "ready"`: `supabase/functions/upload-chat-video/index.ts:204`, `supabase/functions/upload-chat-video/index.ts:253`.
- It logs user ID, match ID, and provider path on lifecycle registration failures: `supabase/functions/upload-chat-video/index.ts:217`.
- Live DB still has `chat_video` Bunny Storage active rows and one uploading row.

Root cause:

Legacy endpoint is still deployed and reachable for older clients or accidental callers.

Impact:

Lower reliability, lower privacy, lower observability, and confusing lifecycle states for any client still using it.

Recommendation:

- Gate or retire the function after confirming no supported clients call it.
- If it must remain, make it return proper HTTP statuses, route delivery through private media resolver only, update lifecycle status semantics, and add idempotency.

### P2 - Web Vibe Clip Recorder Has Uncaught Runtime Exceptions

Evidence:

- `new MediaRecorder(stream, options)` and `recorder.start(100)` are not inside a `try/catch`: `src/components/chat/VideoMessageRecorder.tsx:338`, `src/components/chat/VideoMessageRecorder.tsx:375`.

Root cause:

The getUserMedia path is guarded, but MediaRecorder constructor/start failures are assumed not to throw.

Impact:

Unsupported MIME/runtime state/device browser bugs can crash the recorder UI rather than showing a recoverable error.

Recommendation:

- Wrap constructor and start in `try/catch`.
- Stop tracks and reset caption capture on failure.
- Emit a sanitized telemetry event with browser/mime support metadata.

### P2 - Web And Native Outbox Storage Need Schema Validation And Orphan Cleanup

Evidence:

- Web localStorage loads JSON arrays and casts directly: `src/lib/webChatOutbox/store.ts:9`.
- Native AsyncStorage does the same: `apps/mobile/lib/chatOutbox/store.ts:10`.
- Web IndexedDB blob store has put/get/delete by ID but no global TTL or orphan GC: `src/lib/webChatOutbox/blobIdb.ts:19`.

Root cause:

Persistence layer trusts shape once JSON parses as an array.

Impact:

Corrupt or legacy queue data can poison retries, cause stuck pending UI, or leak orphaned local blobs/temp files.

Recommendation:

- Validate each item with a versioned schema.
- Drop or quarantine invalid queue items.
- Add TTL/orphan cleanup for IndexedDB blobs and native temp files.

### P2 - Processing-Failed Fallback Copy Is Misleading

Evidence:

- `media_asset_processing_failed` maps to `asset_deleted`: `shared/media/mediaFallbackCopy.ts:91`.

Root cause:

Fallback reason mapping conflates failed processing with deletion.

Impact:

Users see "media is no longer available" when the real action may be retry/resend or provider recovery.

Recommendation:

- Add a distinct `processing_failed` reason and copy.
- Preserve provider failure class for support/operator dashboards.

### P2 - Web Profile Photo HEIC/HEIF Handling Is Incomplete

Evidence:

- Web derivative creation explicitly skips HEIC/HEIF: `src/services/imageUploadService.ts:44`.
- Native profile-photo upload transcodes HEIC/HEIF to JPEG: `apps/mobile/lib/imageAssetNormalize.ts:236`.

Root cause:

HEIC handling is solved on native but not web.

Impact:

Web users can upload HEIC canonical files if backend accepts them, but derivatives/placeholders may be missing and browser rendering can be inconsistent.

Recommendation:

- Add web-side HEIC transcode where supported, or make `upload-image` produce server-side JPEG display derivatives.

### P2 - Log Redaction Is Not Strong Enough For Private Media Paths

Evidence:

- `upload-image` logs user ID and provider path on reserve/session repair failures: `supabase/functions/upload-image/index.ts:324`, `supabase/functions/upload-image/index.ts:375`.
- `upload-chat-video` logs user ID, match ID, and path on lifecycle registration failure: `supabase/functions/upload-chat-video/index.ts:217`.
- `get-chat-media-url` logs message/profile/requester IDs around URL issuance: `supabase/functions/get-chat-media-url/index.ts:739`, `supabase/functions/get-chat-media-url/index.ts:939`.

Root cause:

Operational logs optimize for debugging but include stable IDs and provider paths.

Impact:

With the public CDN issue, provider paths in logs become bearer-like access material for chat media.

Recommendation:

- Hash or truncate provider paths and user IDs in logs.
- Never log direct private media paths in application logs.
- Keep a service-role-only lookup path for operators when needed.

### P2 - HTTP Status Semantics Are Inconsistent

Evidence:

- Legacy `upload-chat-video` returns HTTP 200 for auth/validation/forbidden/provider/unexpected errors.
- `send-message` media paths return HTTP 200 with `{ success: false }` for invalid media URL, insert failure, and media sync failure: `supabase/functions/send-message/index.ts:440`, `supabase/functions/send-message/index.ts:507`, `supabase/functions/send-message/index.ts:514`.
- Some modern functions use proper 4xx/5xx.

Root cause:

Historical client compatibility kept error transport status as 200.

Impact:

Infra-level alerting, retry classification, and generic HTTP clients cannot distinguish failures without parsing bodies.

Recommendation:

- Normalize modern media functions to correct HTTP status codes.
- If legacy 200 responses must remain, add explicit `code`, `retryable`, and `user_action` fields everywhere.

### P2 - `sync-vibe-video-status` Env Naming Is Confusing

Evidence:

- Static review found the sync function uses `BUNNY_WEBHOOK_SIGNING_KEY` as a read-key fallback before `BUNNY_STREAM_API_KEY`.

Root cause:

An env var name used for webhook HMAC also appears in provider read-path config.

Impact:

Operators can configure signing but not provider read access, causing manual sync failures or confusing dashboard state.

Recommendation:

- Use a dedicated `BUNNY_STREAM_API_KEY` for provider reads.
- Keep webhook HMAC signing env separate.
- Add startup/config validation for read-path functions.

### P2 - `CHAT_MEDIA_PROXY_SECRET` Falls Back To Supabase Service Role Key

Evidence:

- `get-chat-media-url` token signing falls back to `SUPABASE_SERVICE_ROLE_KEY`: `supabase/functions/get-chat-media-url/index.ts:721`, `supabase/functions/get-chat-media-url/index.ts:992`.

Root cause:

Convenience fallback couples proxy-token signing to the database service-role key.

Impact:

Service-role key rotation invalidates media proxy tokens and proxy-token compromise has a larger blast radius.

Recommendation:

- Require a dedicated `CHAT_MEDIA_PROXY_SECRET`.
- Fail closed if absent in production.

### P2 - Event Deck Media Validation Drift

Evidence:

- Live `get_event_deck` returns expected media columns, including `primary_photo_path`, `photo_verified`, `premium_badge`, `availability_state`, and `media_version`.
- Live function uses `search_path=public, pg_catalog`.
- `supabase/validation/event_lobby_deck_payload_media.sql` checks `proconfig @> array['search_path=public']`, so it falsely fails the safe payload shape check when `pg_catalog` is also present.

Root cause:

Validation SQL did not evolve with a later safer function `search_path`.

Impact:

Operators can see a red validation result even though the payload shape itself is correct.

Recommendation:

- Update validation to accept `search_path=public, pg_catalog` or parse `proconfig` semantically.

## Edge-Case Matrix

| Scenario | Current posture | Gap/risk | Priority |
| --- | --- | --- | --- |
| Offline before upload | Client errors/retries; outbox for chat clips | Web/native outbox schema weak | P2 |
| Offline during direct TUS | TUS retry configured | Vibe Video lacks credential refresh; Chat Clips handle stale credentials | P1 |
| App killed mid-TUS | Chat Clip matrix covers dry-run recovery | Vibe Video recovery less mature | P1 |
| Backgrounded long upload | TUS may resume | Vibe Video credentials can expire | P1 |
| Duplicate tap/retry | Client request IDs and receipts cover many paths | Legacy `upload-chat-video` lacks modern idempotency | P1/P2 |
| Delayed Bunny webhook | Sync functions and polling exist | Web Vibe Video stalls after 3 minutes | P1 |
| Lost webhook | Manual/status sync exists | Live Bunny Stream metadata not verified in audit | Cannot prove |
| Signed URL expiry during playback | Resolver can reissue; tests cover direct CDN | Need real device/browser long-playback proof | Cannot prove |
| CDN failure | Bunny health cron active and healthy | No provider fallback for public/private media | P2 |
| MIME spoofing | Storage uploads sniff bytes | Bunny Stream direct TUS can only prevalidate declared MIME/size before provider processing | P2 |
| Huge files | Size caps and Edge limits enforced | Legacy video capped at 8 MB and returns HTTP 200 failures | P1/P2 |
| Permission denied camera/mic | Most capture surfaces have user copy | Web MediaRecorder constructor/start gap | P2 |
| RLS denial | Service-role lifecycle RPCs and authenticated select policies present | Need ongoing policy drift tests for every new table/function | P2 |
| Deleted user/match | Lifecycle/delete jobs exist | Public CDN private media makes retained paths risky | P0/P1 |
| Privacy boundary | Resolver/proxy designed correctly | Provider public CDN bypass for chat storage media | P0/P1 |
| Cross-device parity | Broad web/native code and tests | Web HEIC and Vibe Video stale TUS parity gaps | P1/P2 |
| Local cache corruption | Some parse fallback exists | No per-item schema validation or blob TTL | P2 |
| Push notification media leakage | Push body strips/abstracts media URLs | Good; continue testing | OK |
| Provider API outage | Sentry/PostHog hooks and health cron exist | Live Sentry/PostHog not verified | Cannot prove |

## Reliability And Speed Review

Positive:

- Bunny CDN storage samples returned cache headers, content length, and byte-range support.
- Chat Vibe Clip direct TUS avoids Edge Function body limits and supports large video uploads better than legacy storage video.
- Upload receipts, content SHA256, client request IDs, and idempotent publish paths reduce duplicate and retry damage.
- Media lifecycle cron and Bunny CDN health cron are active and recently healthy.
- Profile photo derivatives and blurhash/dominant placeholders improve display speed.
- HLS playback through Bunny Stream is appropriate for Vibe Video and Chat Vibe Clips.

Gaps:

- No measured p50/p95 upload latency, time-to-first-frame, first audio byte, or HLS startup latency was available from live telemetry in this audit.
- Vibe Video lacks stale TUS credential refresh.
- Web Vibe Video has a short fixed processing poll window.
- CDN failure has health detection but no user-facing fallback provider.
- Local outbox/cache cleanup should be hardened to avoid quota and orphan issues.

Recommended speed SLOs:

| Metric | Target to instrument |
| --- | --- |
| Profile photo upload complete | p50, p95 by platform/network/file size |
| Chat photo send to visible bubble | p50, p95 and failure class |
| Voice upload to playable bubble | p50, p95, duration mismatch rate |
| Vibe Video TUS upload | p50, p95, credential refresh rate |
| Bunny processing to ready | p50, p95, webhook delay |
| Playback time to first frame/audio | p50, p95 by media family/provider |
| Resolver issued URL failure rate | 4xx/5xx split by reason |
| Public CDN private-media probe | Must be denied for private families |

## Security And Privacy Review

Positive:

- Core lifecycle RPCs are service-role-only.
- RLS is enabled on core media tables.
- Chat media resolver checks authenticated user and message/profile scope before issuing URL/proxy token.
- Notifications for chat photos, voice, and Vibe Clips do not include media URLs.
- Generated Supabase types include current event deck media fields.

Critical gaps:

- Provider-level access control is not enforced for sampled private chat storage media on the public Bunny CDN.
- Public URL helpers normalize `voice/` and `media/` prefixes as public CDN paths.
- Private provider paths appear in some logs.
- `CHAT_MEDIA_PROXY_SECRET` should not fall back to the Supabase service-role key.
- Potential RevenueCat secret in public mobile env must be verified and likely rotated.

## Provider And Adjacent Exchange Review

| Provider | Media role | Verified | Gaps |
| --- | --- | --- | --- |
| Supabase | Auth, Edge Functions, DB/RLS, lifecycle tables, cron | Static, tests, live read-only SQL, live function inventory | Phase 8/Vibe validation scripts were mutating and not run |
| Bunny Storage | Profile photos, event covers, chat photos, voice, legacy storage video | Live HEAD/range for existing objects | Public CDN serves sampled private chat objects |
| Bunny Stream | Vibe Video and Chat Vibe Clips | Static code/tests and DB rows | No live Stream API metadata read key available |
| OneSignal | Chat/media notifications and deeplinks | Static review: no media URLs in message pushes | Live OneSignal dashboard/delivery not queried |
| Sentry | Media/video error telemetry | Static code present | `SENTRY_AUTH_TOKEN` unset, no live issue/event query |
| PostHog | Product/media funnel telemetry | Static code/tests present | No live dashboard/API verification |
| Daily | Camera/mic/video-date adjacent, not stored media upload | Static code review | Live provider/dashboard not queried |
| Twilio | Phone trust/verification adjacent | Static code/tests only | No live provider query |
| Resend | Email trust/ops alerts adjacent | Static code/tests only | No live provider query |
| Stripe | Web payments/credits and entitlement-adjacent gates | Static code only | No live payment operations or provider query |
| RevenueCat | Native subscription entitlement-adjacent | Static env/code review | Public-key concern needs dashboard confirmation |

## Cannot Prove

This audit maximizes confidence without mutation, but it cannot honestly certify literal 100% uptime or failure impossibility. Specifically, I could not prove:

- Real iOS/Android device capture, background upload, app kill, and playback behavior without running device sessions.
- Real production Sentry issue volume because `SENTRY_AUTH_TOKEN` is unset.
- Real PostHog funnel data and privacy-safe event payloads from the live dashboard/API.
- Bunny Stream provider metadata/status because no local Stream API read key was available.
- Phase 8 and Vibe Video validation SQL end-to-end because those scripts mutate production-like rows.
- OneSignal, Daily, Twilio, Resend, Stripe, and RevenueCat dashboard state because read-only provider credentials were not available.
- Provider failure behavior under actual regional CDN outage, DNS issue, webhook loss, API throttling, or payment/entitlement outage.
- Literal no-failure behavior under all possible external provider, network, device, browser, and OS conditions.

## Recommended Hardening Roadmap

Immediate launch blockers:

1. Enforce provider-level private access for chat storage media. Public CDN must deny unauthenticated access to private chat families.
2. Verify and rotate the suspicious public RevenueCat key if it is a secret/server key.
3. Retire or gate `upload-chat-video`, or harden it to current lifecycle/privacy/idempotency standards.
4. Port Chat Vibe Clip stale TUS credential recovery to Vibe Video.

Near-term reliability:

1. Extend Vibe Video processing recovery beyond the 3-minute web poll limit.
2. Add schema validation and TTL cleanup to web/native outbox storage.
3. Wrap web `MediaRecorder` construction/start and add controlled fallback UX.
4. Split `processing_failed` fallback copy from deleted/unavailable copy.
5. Normalize HTTP error statuses or add explicit `retryable`/`user_action` fields.

Operational hardening:

1. Add live read-only private-CDN-denial checks to the media operations runbook.
2. Add p50/p95 media funnel dashboards for upload, processing, resolver, and playback.
3. Require dedicated `CHAT_MEDIA_PROXY_SECRET`.
4. Redact provider paths and stable IDs in media logs.
5. Fix event deck media validation drift.

Best-in-class target state:

- Private media cannot be fetched without authorization even if the object path is known.
- Every upload has durable idempotency, resumability, stale credential refresh, and cleanup.
- Every processing state has a recovery path and operator visibility.
- Every playback path has re-auth, retry, range support, and clear fallback UX.
- Every media family has privacy-safe telemetry with enough tags to debug failures without exposing user content, object paths, or secrets.
