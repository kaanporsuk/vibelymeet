# Chat media architecture (operative contract)

**Precedence:** This file is the **operative** source of truth for chat **media** (voice, Vibe Clip, legacy generic video) and how rows reach `messages`. Older audits and sitemaps may be historical; if they disagree, **trust this doc** and treat conflicting lines elsewhere as superseded unless they explicitly cite a newer decision.

**Supersedes / clarifies:** Stale claims in some inventory docs about `video-invite`, `VideoDateCard`, “reactions local-only”, or client-owned voice/video inserts.

---

## 1. Canonical new sends (server-owned)

All **new user-authored** chat media persistence goes through the **`send-message`** Edge Function after the appropriate upload EF:

| Medium | Upload | Persist (`send-message` body) |
|--------|--------|--------------------------------|
| **Text** | N/A | `match_id`, `content`, optional `client_request_id` |
| **Image** (URL in content) | `upload-image` | `match_id`, `content` (`__IMAGE__\|…` or URL), optional `client_request_id` |
| **Voice** | `upload-voice` | `message_kind: "voice"`, `audio_url`, `audio_duration_seconds`, **`client_request_id` (UUID, required)** |
| **Vibe Clip** | `upload-chat-video` | `message_kind: "vibe_clip"`, `video_url`, `duration_ms`, `client_request_id`, optional `thumbnail_url` / `aspect_ratio` |

**Clients must not** `insert` into `public.messages` for voice or Vibe Clip.

**Idempotency:** Voice and Vibe Clip use `structured_payload.client_request_id` (and the partial unique index on `(match_id, client_request_id)` for non–`vibe_game` rows). Retries must reuse the same UUID.

**DB `message_kind`:** Voice rows use `message_kind = 'voice'` (requires migration `20260330100000_messages_message_kind_voice.sql`). Older voice rows may still be `message_kind = 'text'` with `audio_url` set; rendering uses `inferChatMediaRenderKind` (audio URL wins).

---

## 2. Legacy generic video (read-only compatibility)

**Definition:** A message that **renders** as inline chat video but is **not** `message_kind = 'vibe_clip'` — typically `message_kind = 'text'` (or default) with `video_url` / `video_duration_seconds` populated, or historical variants.

**Policy (this sprint):**

- **Read:** Keep render support (`VideoMessageBubble` on web, native video path) for **existing** rows.
- **Write:** **No active client path** may create **new** legacy generic-video rows. New video must be **`vibe_clip`** via `send-message`.
- **Data migration:** Not in scope; do not bulk-rewrite historical rows without a dedicated migration + QA plan.
- **Future deprecation:** Removing renderers requires either migrating old rows to `vibe_clip` or accepting broken display for legacy data.

---

## 3. Vibe Clip (unchanged summary)

- Upload: `upload-chat-video` (returns `url`, `thumbnail_url`, `aspect_ratio`, …).
- Persist: `send-message` with `message_kind: "vibe_clip"`.
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

---

## 5. Related systems

- **`message_reactions`:** Persisted Postgres + RLS + realtime (not local-only).
- **Clip analytics:** `shared/chat/vibeClipAnalytics.ts` + `trackVibeClipEvent`.
- **Storage:** Chat uploads use Edge Functions → **Bunny**; legacy Supabase bucket names in old migrations do not define current app paths.

---

## 6. Deploy order (when shipping this sprint)

1. Apply migration **`20260330100000_messages_message_kind_voice.sql`** (adds `'voice'` to `message_kind` check).
2. Deploy **`send-message`** Edge Function (voice branch).

Deploying the function **before** the migration will cause voice inserts to fail with a constraint error until the migration runs.

---

## 7. Implementation map

| Area | Files |
|------|--------|
| Edge | `supabase/functions/send-message/index.ts` |
| Shared routing | `shared/chat/messageRouting.ts` (`voice` in DB kind; UI kind stays `text` via `toRenderableMessageKind`) |
| Web | `src/hooks/useMessages.ts`, `src/pages/Chat.tsx` |
| Native | `apps/mobile/lib/chatApi.ts`, `apps/mobile/lib/chatOutbox/execute.ts`, `apps/mobile/lib/chatMediaUpload.ts` (comment) |
