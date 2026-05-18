# Chat media architecture (operative contract)

**Precedence:** This file is the **operative** source of truth for chat **media** (voice, Vibe Clip, legacy generic video) and how rows reach `messages`. Older audits and sitemaps may be historical; if they disagree, **trust this doc** and treat conflicting lines elsewhere as superseded unless they explicitly cite a newer decision.

**Supersedes / clarifies:** Stale claims in some inventory docs about `video-invite`, `VideoDateCard`, “reactions local-only”, or client-owned voice/video inserts.

---

## 1. Canonical new sends (server-owned)

All **new user-authored** chat media persistence is server-owned. Text/image/voice still publish through **`send-message`** after the appropriate upload EF. Chat Vibe Clips use the dedicated Bunny Stream upload lifecycle below.

| Medium | Upload | Persist (`send-message` body) |
|--------|--------|--------------------------------|
| **Text** | N/A | `match_id`, `content`, optional `client_request_id` |
| **Image** (URL in content) | `upload-image` | `match_id`, `content` (`__IMAGE__\|…` or URL), optional `client_request_id` |
| **Voice** | `upload-voice` | `message_kind: "voice"`, `audio_url`, `audio_duration_seconds`, **`client_request_id` (UUID, required)** |
| **Vibe Clip** | Bunny Stream TUS via `create-chat-vibe-clip-upload` | `complete-chat-vibe-clip-upload` creates/updates `message_kind: "vibe_clip"` with Bunny Stream refs |

**Clients must not** `insert` into `public.messages` for voice, Vibe Clip, or **new** legacy generic video. Chat Vibe Clips must not use `send-message` directly; publish is owned by `complete-chat-vibe-clip-upload`.

**Idempotency:** Voice uses `structured_payload.client_request_id`. Chat Vibe Clip upload sessions use `chat_vibe_clip_uploads.sender_id + client_request_id`, then publish the same UUID into `messages.structured_payload`. Retries must reuse the same UUID.

**DB `message_kind`:** Voice rows use `message_kind = 'voice'` (requires migration `20260330100000_messages_message_kind_voice.sql`). Older voice rows may still be `message_kind = 'text'` with `audio_url` set; rendering uses `inferChatMediaRenderKind` (audio URL wins).

**Media URL validation:** `send-message` rejects canonical image/voice publishes with `invalid_media_url` when an image marker does not resolve under `/photos/` or a voice URL under `/voice/`. New Vibe Clip URL validation happens in the Bunny Stream upload functions and `get-chat-media-url`.

**CDN path prefixes:** Bunny Storage delivery may include an optional CDN path prefix for legacy storage-backed media. New Chat Vibe Clips use Bunny Stream signed HLS URLs from `get-chat-media-url`.

---

## 2. Legacy generic video (read-only compatibility)

**Definition:** A message that **renders** as inline chat video but is **not** `message_kind = 'vibe_clip'` — typically `message_kind = 'text'` (or default) with `video_url` / `video_duration_seconds` populated, or historical variants.

**Policy (this sprint):**

- **Read:** Keep render support (`VideoMessageBubble` on web, native video path) for **existing** rows.
- **Write:** **No client path** may create **new** legacy generic-video rows (removed: native `insertChatVideoMessageRow` / `useSendChatVideoMessage`). New Chat Vibe Clips upload through Bunny Stream TUS and are published by `complete-chat-vibe-clip-upload`.
- **Data migration:** Not in scope; do not bulk-rewrite historical rows without a dedicated migration + QA plan.
- **Future deprecation:** Removing renderers requires either migrating old rows to `vibe_clip` or accepting broken display for legacy data.

---

## 3. Vibe Clip

- Upload: client -> Bunny Stream TUS using `create-chat-vibe-clip-upload`.
- Persist: `complete-chat-vibe-clip-upload` creates/updates the `message_kind: "vibe_clip"` row idempotently.
- Repair: `video-webhook` and `sync-chat-vibe-clip-status` keep `processing_status` current. Bunny status `7` (`PresignedUploadFinished`) is allowed to publish a processing message if the client dies after TUS success but before `complete-chat-vibe-clip-upload`.
- Playback: `get-chat-media-url` returns Bunny Stream CDN URLs with path-based `token_path` auth for the video directory, using Bunny's HMAC-SHA256 Advanced CDN directory-token format so HLS playlists and segments inherit the same authorization.
- Payload shape: `VibeClipPayload` in `shared/chat/messageRouting.ts`.

---

## 4. Voice (post–sprint contract)

- Upload: `upload-voice` (unchanged; Bunny CDN URL).
- Persist: `send-message` with:
  - `message_kind: "voice"`
  - `audio_url` (trimmed string)
  - `audio_duration_seconds` (integer ≥ 1)
  - `client_request_id` (UUID)
- Inserted row: `content: "🎤 Voice message"`, `message_kind: "voice"`, `structured_payload: { v: 1, client_request_id }`.
- **Web:** `usePublishVoiceMessage` in `src/hooks/useMessages.ts` after `uploadVoiceToBunny`.
- **Native:** `invokePublishVoiceMessage` in `apps/mobile/lib/chatApi.ts` from `chatOutbox/execute.ts` after `uploadVoiceMessage`.

**Removed (replaced by above):**

- `insertVoiceMessageRow` — direct `messages.insert`; **replaced by** `invokePublishVoiceMessage`.
- `useSendVoiceMessage` — unused hook wrapping the old insert; **replaced by** outbox + `invokePublishVoiceMessage` on native, **`usePublishVoiceMessage`** on web.
- `insertChatVideoMessageRow` / `useSendChatVideoMessage` — client `messages.insert` for generic video; **removed**.
- `invokePublishVibeClip` — retired; Chat Vibe Clip publish now goes through `complete-chat-vibe-clip-upload`.

---

## 5. Related systems

- **`message_reactions`:** Persisted Postgres + RLS + realtime (not local-only).
- **Clip analytics:** `shared/chat/vibeClipAnalytics.ts` + `trackVibeClipEvent`.
- **Storage:** Chat uploads use Edge Functions → **Bunny**; legacy Supabase bucket names in old migrations do not define current app paths.

---

## 6. Deploy order (when shipping this sprint)

1. Apply migration **`20260330100000_messages_message_kind_voice.sql`** (adds `'voice'` to `message_kind` check).
2. Apply migration **`20260429132000_chat_media_cdn_path_prefix_normalize.sql`** when deploying prefix-aware media lifecycle normalization.
3. Deploy **`upload-voice`**, **`send-message`**, **`create-chat-vibe-clip-upload`**, **`complete-chat-vibe-clip-upload`**, **`sync-chat-vibe-clip-status`**, **`get-chat-media-url`**, and **`video-webhook`** together for Chat Vibe Clip Stream support.

Deploying the function **before** the migration will cause voice inserts to fail with a constraint error until the migration runs.

When `BUNNY_CDN_PATH_PREFIX` is non-empty, also run:

```sql
ALTER DATABASE postgres SET app.bunny_cdn_path_prefix = '<prefix>';
```

---

## 7. Media retention and cleanup

Chat media (voice, Vibe Clip, chat video, thumbnails) is tracked in the `media_assets` / `media_references` lifecycle model (migration `20260417100000_media_lifecycle_foundation.sql`).

**Current policy:** `retain_until_eligible` with `eligible_days = NULL`. This means **no automatic purge** runs for any chat media. Assets are retained indefinitely while at least one valid side still retains the chat.

**Purge eligibility (Sprint 3):** A chat media asset becomes purge-eligible only when:
- both parties deleted the chat, OR
- both parties deleted their accounts, OR
- one side deleted their account AND the other side deleted the chat

Until Sprint 3 wires the reference-release logic into message/match/account deletion flows, chat media is never purged by the worker.

---

## 8. Implementation map

| Area | Files |
|------|--------|
| Edge | `supabase/functions/send-message/index.ts`, `supabase/functions/upload-voice/index.ts`, `supabase/functions/create-chat-vibe-clip-upload/index.ts`, `supabase/functions/complete-chat-vibe-clip-upload/index.ts`, `supabase/functions/sync-chat-vibe-clip-status/index.ts`, `supabase/functions/get-chat-media-url/index.ts`, `supabase/functions/video-webhook/index.ts`, `supabase/functions/_shared/chat-vibe-clips.ts` |
| Shared routing | `shared/chat/messageRouting.ts` (`voice` in DB kind; UI kind stays `text` via `toRenderableMessageKind`) |
| Web | `src/hooks/useMessages.ts`, `src/pages/Chat.tsx`, `src/lib/webChatOutbox/execute.ts`, `src/services/chatVibeClipStreamUploadService.ts`, `src/lib/chatMediaResolver.ts`, `src/components/chat/VibeClipBubble.tsx`, `src/components/chat/ChatVideoLightbox.tsx` |
| Native | `apps/mobile/lib/chatApi.ts`, `apps/mobile/lib/chatOutbox/execute.ts`, `apps/mobile/lib/chatMediaUpload.ts`, `apps/mobile/lib/chatVibeClipStreamUpload.ts`, `apps/mobile/lib/chatMediaResolver.ts`, `apps/mobile/components/chat/VibeClipCard.tsx`, `apps/mobile/components/chat/ChatThreadMediaViewer.tsx` |
