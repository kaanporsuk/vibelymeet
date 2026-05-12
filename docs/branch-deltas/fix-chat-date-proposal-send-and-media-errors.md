# fix/chat-date-proposal-send-and-media-errors

## Rebuild Delta

- Routes changed: web `/chat/:matchId`; native `apps/mobile/app/chat/[id].tsx`.
- Edge Functions changed: `date-suggestion-actions`, `get-chat-media-url`.
- Schema/RPC changes: one RPC-only migration, `20260512170000_date_suggestion_send_payload_shape_guard.sql`; no table shape change. The legacy `date_suggestion_apply` wrapper remains non-executable by direct authenticated clients.
- Storage/media behavior changes: existing Bunny chat media stays canonical; signed chat media URLs can be refreshed and `get-chat-media-url` retries media lifecycle sync once before `media_not_found`.
- Env/secrets changes: none.
- Provider/dashboard changes: none.

## Replay Risk

- Migration class: operational/RPC-only.
- Replay risk: low; it replaces `public.date_suggestion_apply(text, jsonb)` wrapper behavior and preserves the existing legacy dispatch for non-normalization paths.

## Manual Smoke Left

- Web: open `/chat/:matchId`, choose Walk, This weekend, Near you, note "Easy walk, good company.", send, verify no scalar extraction error and a pending date suggestion appears.
- Native/mobile: run the same date suggestion flow.
- Chat audio: open a thread with a voice message and verify playback without `get-chat-media-url` load errors.
