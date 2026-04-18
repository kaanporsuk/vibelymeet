# VIBELY — BUNNY PROVIDER SHEET

**Date:** 2026-03-11  
**Baseline:** post-hardening (frozen golden: pre-native-hardening)  
**Priority:** Tier 1 / media-critical

---

## 1. Purpose

This sheet is the provider-specific operating reference for Bunny.

It is meant to answer:
- what Bunny does in Vibely
- which Bunny products are in use
- how the upload and playback flows actually work
- what is env-driven vs hardcoded
- what dashboard/webhook/CDN state must exist outside the repo
- what can silently fail during rebuild even when the UI looks healthy

This sheet is more detailed than the general External Dependency Ledger.

---

## 2. Why Bunny is high-risk

Bunny in Vibely is not a single integration. It is a **multi-surface media stack**.

It covers:
- Bunny Stream for vibe-video lifecycle
- Bunny Storage for image, event-cover, and voice uploads
- Bunny CDN / custom hostname delivery for media playback and display
- a webhook-driven processing completion path for vibe videos
- direct client-side tus upload for large video files

A rebuild can therefore fail in several distinct ways:
- upload authorization works but direct upload fails
- upload succeeds but webhook is missing so the video never becomes ready
- CDN hostnames are wrong so playback breaks
- Storage zone credentials are wrong so image/voice uploads fail
- Stream library ID is wrong so vibe-video creation/deletion fails
- custom hostname / DNS is wrong so generated URLs 404

---

## 3. What Bunny products Vibely uses

## A. Bunny Stream
Used for:
- vibe / intro video creation
- direct video upload via tus
- HLS playback of processed vibe videos
- deletion of prior vibe videos
- webhook-driven processing status updates

## B. Bunny Storage
Used for:
- profile image uploads
- event cover uploads
- voice-message uploads

## C. Bunny CDN / custom hostname delivery
Used for:
- profile image delivery via `VITE_BUNNY_CDN_HOSTNAME`
- event cover delivery via `BUNNY_CDN_HOSTNAME`
- voice-message delivery via `BUNNY_CDN_HOSTNAME`
- vibe-video HLS playback via `VITE_BUNNY_STREAM_CDN_HOSTNAME`

---

## 4. Important boundary: what Bunny does **not** own

Bunny is not the entire media layer.

### Chat inline / Vibe Clip video **is** on Bunny (not Supabase Storage upload)
The canonical send path uses the Edge Function `upload-chat-video`, which uploads to **Bunny Storage** using object paths prefixed with `chat-videos/…`. The CDN URL returned is persisted in `messages.video_url` with `message_kind = 'vibe_clip'` (see `supabase/migrations/20260329100000_vibe_clip_message_kind.sql`).

Do **not** confuse the **path prefix** `chat-videos/` on Bunny with a Supabase Storage bucket of the same name — the implementation in `supabase/functions/upload-chat-video/index.ts` targets Bunny.

### Why this matters
Do not assume “chat video = Supabase bucket.”

For this baseline:
- **Bunny** = profile vibe video (stream), images, event covers, voice, **inline chat / Vibe Clip video** (`upload-chat-video`)
- **Supabase storage** = residual buckets (e.g. `proof-selfies`) and legacy paths; not the active inline chat video upload pipeline

This split matters for rebuild, cleanup, CDN migration, and future native work.

---

## 5. Repo surfaces that touch Bunny

## Edge Functions
- `create-video-upload`
- `video-webhook`
- `delete-vibe-video`
- `upload-image`
- `upload-chat-video` (Bunny Storage; chat / Vibe Clip inline video)
- `upload-event-cover`
- `upload-voice`

## Frontend and service layer
- `src/components/vibe-video/VibeStudioModal.tsx`
- `src/services/imageUploadService.ts`
- `src/services/chatVideoUploadService.ts`
- `src/services/eventCoverUploadService.ts`
- `src/services/voiceUploadService.ts`
- `src/utils/imageUrl.ts`
- `src/components/ProfilePreview.tsx`
- `src/components/ProfileDetailDrawer.tsx`
- `src/components/admin/AdminProfilePreview.tsx`
- profile/wizard/storage helper surfaces using Bunny-backed image/video paths

## Database fields tied to Bunny
### `profiles`
- `bunny_video_uid`
- `bunny_video_status`
- `vibe_caption`

---

## 6. Bunny env/config surface

## Frontend variables
- `VITE_BUNNY_STREAM_CDN_HOSTNAME`
- `VITE_BUNNY_CDN_HOSTNAME`

## Edge Function variables
- `BUNNY_STREAM_LIBRARY_ID`
- `BUNNY_STREAM_API_KEY`
- `BUNNY_STREAM_CDN_HOSTNAME`
- `BUNNY_STORAGE_ZONE`
- `BUNNY_STORAGE_API_KEY`
- `BUNNY_CDN_HOSTNAME`
- `BUNNY_VIDEO_WEBHOOK_TOKEN` (required for `video-webhook`; URL query param; fail-closed if missing)

## Operator note
These are split across:
- frontend build/runtime env
- Supabase Edge Function secrets

A working frontend alone is not enough. The function secrets must also be correct.

---

## 7. Hardcoded Bunny assumptions in code

These are rebuild-sensitive because they are not fully env-driven.

### A. Hardcoded tus endpoint
`VibeStudioModal` uploads to:
- `https://video.bunnycdn.com/tusupload`

### B. Hardcoded Bunny API host patterns in Edge Functions
Functions call:
- `https://video.bunnycdn.com/library/...`
- `https://storage.bunnycdn.com/...`

### C. Custom CDN hostname assumption
The app assumes a custom CDN hostname pattern for non-video media:
- `cdn.vibelymeet.com`

### Rebuild implication
Changing provider shape, region, or hostname strategy is not purely an env change. Some paths are baked into source.

---

## 8. Vibe-video architecture

This is the most complex Bunny-backed flow in Vibely.

### Phase 1 — Client requests upload authorization
Frontend component:
- `src/components/vibe-video/VibeStudioModal.tsx`

Calls function:
- `create-video-upload`

### Phase 2 — Function creates Bunny video object
`create-video-upload`:
1. authenticates the user via bearer token  
2. loads current `profiles.bunny_video_uid`  
3. if an old video exists, tries to delete it from Bunny Stream  
4. creates a new Bunny Stream video object in the configured library  
5. computes a SHA-256 signature for Bunny tus upload auth  
6. updates `profiles` with:
   - `bunny_video_uid = <new video id>`
   - `bunny_video_status = "uploading"`
7. returns to the client:
   - `videoId`
   - `libraryId`
   - `expirationTime`
   - `signature`
   - `cdnHostname`

### Phase 3 — Client uploads directly to Bunny via tus
`VibeStudioModal` performs direct upload to:
- `https://video.bunnycdn.com/tusupload`

It does not stream the file through Supabase.

### Phase 4 — Client marks local/profile state as processing
After upload start/completion, the frontend updates profile state so the app knows a Bunny-backed video exists and is awaiting processing.

### Phase 5 — Bunny webhook finalizes processing state
Function:
- `video-webhook`

**Auth (post-hardening):** URL token required. Callback URL must include `?token=<BUNNY_VIDEO_WEBHOOK_TOKEN>`. Secret must be set in Supabase; function returns 503 if missing, 401 if token invalid.

It expects Bunny payload fields like:
- `VideoGuid`
- `Status`

It maps:
- `Status === 3` → `ready`
- `Status === 4` → `failed`
- otherwise → `processing`

And updates:
- `profiles.bunny_video_status`
where:
- `profiles.bunny_video_uid = VideoGuid`

### Phase 6 — Frontend polls profile state
`VibeStudioModal` polls `profiles.bunny_video_uid` and `profiles.bunny_video_status` until the video becomes:
- `ready`
- or `failed`

### Phase 7 — Playback uses HLS URL
Playback URL pattern:
- `https://${VITE_BUNNY_STREAM_CDN_HOSTNAME}/${bunny_video_uid}/playlist.m3u8`

Used in several preview/display surfaces.

---

## 9. Vibe-video deletion flow

Function:
- `delete-vibe-video`

### Behavior
1. authenticates the user via bearer token  
2. loads current `profiles.bunny_video_uid`  
3. if present, tries to delete the video from Bunny Stream  
4. regardless of remote delete outcome, clears local profile state:
   - `bunny_video_uid = null`
   - `bunny_video_status = "none"`
   - `vibe_caption = null`

### Important implication
The local database can be cleared even if Bunny remote deletion fails.

### Rebuild risk
This can create orphaned remote media if Stream credentials or deletion calls are broken.

---

## 10. Image upload architecture

### Client entry point
- `src/services/imageUploadService.ts`

### Function
- `upload-image`

### Behavior
1. authenticates user via bearer token  
2. validates image type  
3. validates max file size (10MB)  
4. writes to Bunny Storage at path pattern:
   - `photos/{userId}/{timestamp}.{ext}`
5. optionally deletes previous Bunny file if `old_path` is supplied and starts with `photos/`  
6. returns the relative storage path, not the full URL

### URL resolution behavior
Frontend helper `src/utils/imageUrl.ts` resolves Bunny image paths like:
- if path starts with `photos/` → serve from `https://${VITE_BUNNY_CDN_HOSTNAME}/...`
- if path is a legacy Supabase storage path → serve from Supabase storage URL

### Important implication
Image delivery is a **hybrid historical model**:
- newer Bunny-backed image paths
- older Supabase storage-style paths still supported

A migration or cleanup pass must preserve both until deliberately unified.

---

## 11. Event-cover upload architecture

### Client entry points
- `src/services/eventCoverUploadService.ts`
- admin event creation/edit surfaces

### Function
- `upload-event-cover`

### Behavior
1. authenticates user  
2. verifies admin role via `user_roles`  
3. validates image type and size (20MB max)  
4. uploads to Bunny Storage path:
   - `events/{eventId}/{timestamp}.{ext}`
   - or `events/covers/{timestamp}.{ext}` when no event ID is supplied
5. returns:
   - `path`
   - `url = https://${BUNNY_CDN_HOSTNAME}/${storagePath}`

### Important implication
Event covers depend on:
- admin auth working
- Bunny Storage credentials
- custom CDN hostname correctness

---

## 12. Voice-message upload architecture

### Client entry points
- `src/services/voiceUploadService.ts`
- chat UI voice send flow

### Function
- `upload-voice`

### Behavior
1. authenticates user  
2. validates audio file type  
3. validates max size (10MB)  
4. uploads to Bunny Storage path:
   - `voice/{conversationId}/{userId}_{timestamp}.{ext}`
   - or fallback `voice/{userId}/{timestamp}.{ext}`
5. returns:
   - `path`
   - `url = https://${BUNNY_CDN_HOSTNAME}/${storagePath}`

### Important implication
Voice-message persistence depends on Bunny Storage/CDN, but the metadata is then stored into the chat/message model separately.

---

## 13. What lives in Bunny dashboard / external state

The repo proves the code contracts, but not the full external setup.

### For Bunny Stream
The following must exist externally:
- correct Stream library corresponding to `BUNNY_STREAM_LIBRARY_ID`
- API key with permission to create/delete videos
- processing callback / webhook registration to `video-webhook`
- CDN/video hostname aligned with `BUNNY_STREAM_CDN_HOSTNAME`

### For Bunny Storage / CDN
The following must exist externally:
- correct Storage zone corresponding to `BUNNY_STORAGE_ZONE`
- API key with write/delete ability
- CDN or custom hostname aligned with `BUNNY_CDN_HOSTNAME`
- DNS/origin mapping if using `cdn.vibelymeet.com`

### The repo does **not** fully preserve
- actual Bunny dashboard objects
- exact webhook callback URL configured for video processing
- exact custom hostname configuration in Bunny dashboard
- exact DNS linkage for the custom hostname
- any dashboard-side access rules or optimizations outside the API calls

---

## 14. What the repo proves vs what it does not prove

## What the repo proves strongly
- required secret names and hostname vars
- direct upload flow for vibe videos
- Stream API use for create/delete
- webhook-driven readiness model
- storage path conventions for images/event covers/voice
- playback URL patterns for HLS and CDN images
- hybrid Bunny + legacy Supabase image resolution logic

## What the repo does not prove strongly
- exact live Bunny account or project/workspace
- exact current Stream library object and its settings
- exact current Storage zone and custom hostname mapping
- exact live `video-webhook` registration
- exact CDN pull-zone/custom-hostname configuration
- whether any dashboard-only media optimization settings matter to runtime behavior

---

## 15. Bunny-specific rebuild risks

## Risk 1 — Vibe-video upload is multi-step and can fail mid-chain
The chain is:
- auth
- create video object
- sign tus upload
- direct upload
- DB state update
- Bunny processing
- webhook callback
- frontend polling
- playback

Any missing step creates a partial failure.

## Risk 2 — Webhook absence creates silent non-readiness
If `video-webhook` is not registered, videos may upload successfully but stay stuck in:
- `uploading`
- `processing`

## Risk 3 — `video-webhook` auth (resolved in hardening)
The function now requires `BUNNY_VIDEO_WEBHOOK_TOKEN` as a URL query parameter. Bunny dashboard must be configured to call the webhook URL with `?token=<value>`. Fail-closed if secret is missing; 401 if token does not match.

## Risk 4 — CDN hostname mismatch breaks media even with successful uploads
If `BUNNY_CDN_HOSTNAME` or `VITE_BUNNY_STREAM_CDN_HOSTNAME` is wrong, upload can succeed but media retrieval fails.

## Risk 5 — Legacy image paths still exist
Image resolution intentionally supports both:
- Bunny `photos/...` paths
- legacy Supabase storage paths

A simplistic “move everything to Bunny” cleanup can break historical media rendering.

## Risk 6 — Deletion is best-effort remotely but definitive locally
`delete-vibe-video` clears DB state even if Bunny remote delete fails, which can leave orphaned media.

## Risk 7 — Mis-identifying the chat video provider
Inline chat / Vibe Clip video uploads go through **`upload-chat-video` → Bunny**. Rebuild or refactors that assume Supabase Storage for those sends will mis-handle behavior; verify the Edge Function and `messages.video_url` contract instead.

---

## 16. Minimum Bunny verification procedure

### Step 1 — Secret and hostname verification
Confirm presence and correctness of:
- `BUNNY_STREAM_LIBRARY_ID`
- `BUNNY_STREAM_API_KEY`
- `BUNNY_STREAM_CDN_HOSTNAME`
- `BUNNY_STORAGE_ZONE`
- `BUNNY_STORAGE_API_KEY`
- `BUNNY_CDN_HOSTNAME`
- `VITE_BUNNY_STREAM_CDN_HOSTNAME`
- `VITE_BUNNY_CDN_HOSTNAME`

### Step 2 — Vibe-video create/upload test
Verify:
- `create-video-upload` returns credentials successfully (JWT required at gateway)
- direct tus upload reaches Bunny
- profile row gets `bunny_video_uid`
- profile row moves through `uploading` / `processing`

### Step 3 — Webhook readiness test
Verify:
- `BUNNY_VIDEO_WEBHOOK_TOKEN` is set in Supabase secrets
- Bunny processing callback URL includes `?token=<BUNNY_VIDEO_WEBHOOK_TOKEN>`
- callback reaches `video-webhook` and is accepted
- `profiles.bunny_video_status` becomes `ready`
- failed-processing path can also be observed or simulated

### Step 4 — Vibe-video playback test
Verify HLS playback succeeds at:
- `https://${VITE_BUNNY_STREAM_CDN_HOSTNAME}/{uid}/playlist.m3u8`

### Step 5 — Deletion test
Verify:
- `delete-vibe-video` clears local profile state
- remote Bunny asset is actually deleted when credentials are valid

### Step 6 — Image upload test
Verify:
- `upload-image` returns `photos/...` path
- `getImageUrl()` resolves it correctly through `VITE_BUNNY_CDN_HOSTNAME`
- replacing an old image deletes the previous Bunny path when supplied

### Step 7 — Event-cover upload test
Verify:
- admin can upload cover
- returned URL resolves on `BUNNY_CDN_HOSTNAME`

### Step 8 — Voice upload test
Verify:
- chat voice upload returns CDN URL
- stored URL is playable in app

### Step 9 — Chat / Vibe Clip video upload test
Verify `upload-chat-video` stores under Bunny (`chat-videos/…` path prefix), `send-message` persists `message_kind = vibe_clip` + `video_url`, and playback uses the returned CDN URL.

---

## 17. Known unknowns to resolve in the next Bunny-focused audit

1. What is the exact live Bunny account/workspace for this baseline?  
2. What is the exact Stream library corresponding to `BUNNY_STREAM_LIBRARY_ID`?  
3. What is the exact webhook URL currently registered for processed video callbacks?  
4. What is the exact custom hostname / pull-zone setup behind `cdn.vibelymeet.com`?  
5. Are there any dashboard-side CORS/origin rules affecting direct tus upload or playback?  
6. Are there any legacy media objects still served from Supabase that should remain supported during native prep?  

---

## 18. Recommended next provider sheet after Bunny

The strongest next provider sheet is:

**VIBELY_DAILY_PROVIDER_SHEET.md**

Reason:
- Daily is the next most fragile live-session dependency
- it controls room creation and tokens for live calls
- it includes a fallback domain assumption that can hide misconfiguration

---

## 19. Bottom line

Bunny in Vibely is a multi-stage media subsystem, not a simple upload target.

To rebuild it correctly, you need more than the code:
- working Stream and Storage credentials
- the right library and zone
- correct CDN/custom hostname mapping
- a functioning processing webhook
- preservation of the hybrid media model where Bunny and Supabase storage coexist

This sheet is the provider-level control point for that reality.

