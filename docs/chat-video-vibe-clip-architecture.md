# Chat video & Vibe Clips — architecture (source of truth)

Internal contract summary. Last aligned with repo audit **2026-03-27**.

## Verdict: canonical product shape

- **New chat video** is **canonical `vibe_clip`**: `messages.message_kind = 'vibe_clip'`, `video_url`, `video_duration_seconds`, and `structured_payload` v2 per `shared/chat/messageRouting.ts` (`VibeClipPayload`).
- **Legacy generic video** remains supported for **existing rows**: `message_kind = 'text'` (or older patterns) with `video_url` set — UI maps these to render kind `"video"` and uses `VideoMessageBubble` (web) / non–Vibe Clip video path (native). No new sends should use this path.

There is **no separate “video-invite”** product path in code; that name was documentation drift only.

## Publish & upload flow (web + native)

1. **Upload** — `POST /functions/v1/upload-chat-video` (multipart: `file`, `match_id`, optional `thumbnail`, optional `aspect_ratio`).
2. **Response** — JSON includes `url`, `thumbnail_url`, `poster_source`, `aspect_ratio`, `processing_status`, `upload_provider` (not URL-only).
3. **Persist message** — `POST /functions/v1/send-message` with `message_kind: "vibe_clip"`, `video_url`, `duration_ms`, `client_request_id` (UUID), optional `thumbnail_url` / `aspect_ratio`.

Implementations:

- **Web:** `uploadChatVideoToBunny` → `usePublishVibeClip` (`src/hooks/useMessages.ts`).
- **Native:** `uploadChatVideoMessage` → `invokePublishVibeClip` (`apps/mobile/lib/chatApi.ts`) from outbox `execute.ts`.

**Voice** and **legacy native video insert** are out of scope for this doc: voice still uses direct `messages.insert` on native (and web equivalent patterns); only **Vibe Clip** is required to go through `send-message`.

## Duration cap

Single constant: `VIBE_CLIP_MAX_DURATION_SEC` in `shared/chat/vibeClipCaptureCopy.ts` (currently **30s**). Web recorder and native picker/camera both reference it.

## Reactions

`message_reactions` is a **real persisted** table (see `supabase/migrations/20260329150000_message_reactions.sql`) with web/native hooks (`useMessageReactions`). Not local-only.

## Clip analytics

PostHog events live in `shared/chat/vibeClipAnalytics.ts` and `trackVibeClipEvent` wrappers under `src/lib/` and `apps/mobile/lib/`.

## Storage / buckets

Chat media uploads go through Edge Functions to **Bunny** (e.g. `chat-videos/…`, `photos/…` for `upload-image`). The legacy Supabase **`voice-messages`** bucket name may still exist in old migrations; **current app code does not store chat images there** — chat images use `upload-image`.

## Obsolete artifacts

- **`VideoDateCard`** — not present in the repo (removed or never landed); inventory docs were wrong.
- **`useSendChatVideoMessage` / `insertChatVideoMessageRow`** — were dead code (direct insert generic video); **removed** in favor of outbox + `invokePublishVibeClip`.

## Alignment checklist

| Layer | Vibe Clip publish | Legacy `video_url` render |
|-------|-------------------|---------------------------|
| Backend | `send-message` vibe branch + migration `message_kind` | Existing rows only |
| Web | `usePublishVibeClip` | `VideoMessageBubble` branch in `Chat.tsx` |
| Native | Outbox + `invokePublishVibeClip` | `inferChatMediaRenderKind` → video UI |

## Remaining gaps (not closed in audit pass)

- **Voice** still bypasses `send-message` on native (`insertVoiceMessageRow`) — intentional scope boundary unless product wants server-owned voice.
- **Web voice** may still use direct insert in `Chat.tsx` — same note.
- Funnel instrumentation nuances (e.g. native `thread_bucket` on some events) — see `docs/vibe-clips-phase10-funnel-review.md`.
