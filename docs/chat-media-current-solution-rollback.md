# Chat Media — Current Solution & Rollback Reference

**Status:** Operative rollback reference for private chat media delivery. This documents the
**authorized Supabase Edge proxy** delivery path so we can deterministically roll back to it if
the Tier-2 signed direct-CDN path (see [media_management_ultimate_improvement.md §A.10](./media_management_ultimate_improvement.md))
is ever disabled or reverted.

**Baseline commit:** `8f5950f6` ("Harden media permissions and profile photo swipes (#1121)", 2026-05-30) plus
branch `feat/chat-media-reliability-egress` (Tier 0 thumbnail reliability + Tier 1 cache/expo-image).

---

## 1. What the current solution is

Private chat media uses an **authorized resolver + Edge proxy for Bunny Storage media**, and
**signed Bunny Stream URLs for Stream media**. Bytes for Storage families stream **through** the
Edge Function; Stream families resolve to a signed CDN URL the client fetches directly.

| Family | Provider | Delivery |
|---|---|---|
| Chat photo | `bunny_storage` | Edge proxy (`get-chat-media-url?token=…`) → streams from `storage.bunnycdn.com` |
| Chat voice | `bunny_storage` | Edge proxy (same) |
| Legacy/progressive chat video | `bunny_storage` | Edge proxy (same) |
| Chat Vibe Clip | `bunny_stream` | Signed Bunny Stream HLS + poster (`bcdn_token` directory token) |
| Profile Vibe Video (private) | `bunny_stream` | Signed Bunny Stream HLS + poster |

Public/non-chat media (profile photos, event covers) is **separate** — direct public Bunny CDN via
[`src/utils/imageUrl.ts`](../src/utils/imageUrl.ts) / [`apps/mobile/lib/imageUrl.ts`](../apps/mobile/lib/imageUrl.ts).
It is **not** part of this rollback path.

## 2. Server flow — [`supabase/functions/get-chat-media-url/index.ts`](../supabase/functions/get-chat-media-url/index.ts)

1. Client `POST /functions/v1/get-chat-media-url` with the user's bearer token.
2. Function validates the Supabase user, then checks message/match participation.
3. Resolves the `media_assets` row for the message.
4. `bunny_stream` → returns signed Bunny Stream `playlist.m3u8` + `thumbnail.jpg` URLs (`signBunnyStreamDirectoryUrl`).
5. `bunny_storage` → mints a 15-minute HMAC proxy token and returns:
   ```json
   {
     "success": true,
     "url": "https://<supabase>/functions/v1/get-chat-media-url?token=<token>",
     "playbackKind": "progressive",
     "provider": "bunny_storage",
     "expiresInSeconds": 900
   }
   ```
6. Client `GET …?token=…` → `handleProxy` verifies the token, fetches
   `https://storage.bunnycdn.com/${zone}/${path}` with the `AccessKey` header, and streams the body.
7. Proxy response headers (**current, after Tier 1**):
   ```http
   Cache-Control: private, max-age=<remaining_token_seconds − 15>, immutable   # capped at 900
   Accept-Ranges: bytes
   ```
   > Tier 1 replaced the previous fixed `private, max-age=60`. The header is now token-aligned so a
   > repeat view within the ~15-minute token window is a local cache hit instead of a re-stream.
   > `TOKEN_TTL_SECONDS = 900`, `PROXY_CACHE_SAFETY_SECONDS = 15`.

## 3. Client cache — `mediaAssetResolver.ts` (web + native)

- In-memory LRU (200 entries) of resolved/signed URLs.
- Persisted: web `sessionStorage` key `vibely.media-url-cache.v1:<userId>`; native `AsyncStorage` (same key).
- Effective TTL: `expiresInSeconds − 15s` (~14:45 for a 900s token).
- Failure cooldown: exponential 8s → 5m. In-flight identical requests are de-duplicated (`mediaUrlInFlightRequests`).
- Web prewarms images via `new Image()` and HLS playlist/first-segment via `fetch(cache:"force-cache")`.
- Native chat media renders through `expo-image` (`cachePolicy="memory-disk"`) after Tier 1.

## 4. Required env / secrets (current proxy path)

No `BUNNY_CHAT_STORAGE_CDN_*` is required by the current path:

```
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
CHAT_MEDIA_PROXY_SECRET            # optional; falls back to service role key
BUNNY_STORAGE_ZONE, BUNNY_STORAGE_API_KEY
BUNNY_ARCHIVE_STORAGE_ZONE / BUNNY_STORAGE_ARCHIVE_ZONE        # optional archive tier
BUNNY_ARCHIVE_STORAGE_API_KEY / BUNNY_STORAGE_ARCHIVE_API_KEY  # optional archive tier
BUNNY_CHAT_STREAM_CDN_HOSTNAME, BUNNY_CHAT_STREAM_TOKEN_SECURITY_KEY
BUNNY_STREAM_CDN_HOSTNAME, BUNNY_STREAM_TOKEN_SECURITY_KEY
```

### Tier-2 direct-CDN secrets (new — default OFF, optional)

These gate the signed direct-CDN path. While `CHAT_MEDIA_DIRECT_CDN_ENABLED` is unset/false or
the hostname/key are absent, delivery uses the proxy exactly as documented above (zero behavior change):

```
CHAT_MEDIA_DIRECT_CDN_ENABLED                 # "true"/"1" to enable; default off → proxy
BUNNY_CHAT_STORAGE_CDN_HOSTNAME               # token-auth pull zone over the HOT chat storage zone
BUNNY_CHAT_STORAGE_TOKEN_SECURITY_KEY
BUNNY_CHAT_STORAGE_ARCHIVE_CDN_HOSTNAME       # optional, archive tier
BUNNY_CHAT_STORAGE_ARCHIVE_TOKEN_SECURITY_KEY # optional, archive tier
```

> Infra prerequisite: a **dedicated** Bunny pull zone (NOT the public `BUNNY_CDN_HOSTNAME`) with
> Advanced Token Authentication enabled and its cache key configured to ignore `token`/`expires`.

## 5. Rollback procedure (disable Tier-2 signed direct CDN)

The Tier-2 direct-CDN path is **flag-gated and additive**; the proxy remains the fallback. To roll
back to proxy-only delivery:

1. Set the kill flag: `CHAT_MEDIA_DIRECT_CDN_ENABLED=false` (or unset) in Supabase Function secrets.
   - With the flag off (or `BUNNY_CHAT_STORAGE_CDN_*` absent), `handleIssueUrl` already returns the
     proxy URL for `bunny_storage` — **no redeploy strictly required**, only a config change.
2. If a full code revert is needed: `git revert` the direct-CDN commit(s), confirm `handleIssueUrl`
   returns the `…/functions/v1/get-chat-media-url?token=…` proxy URL for `bunny_storage` and that
   `handleProxy` streams from `storage.bunnycdn.com`, then redeploy:
   ```bash
   npx supabase functions deploy get-chat-media-url
   ```
3. New Bunny chat-storage CDN secrets may remain configured but unused.
4. Clients require no change — the resolver consumes whatever `url` the function returns.

## 6. Rollback verification

```bash
npm run test:chat-media-cache
npm run test:vibe-clip-upload-contract
npm run test:chat-native-lifecycle
npm run typecheck
```

Functional (disposable pair, per CLAUDE.md): send + reopen a chat photo, a voice note, and a Vibe Clip.
- Photo/voice `url` host is **Supabase Functions**, not a Bunny CDN host.
- `curl -I "<issued url>"` shows `Cache-Control: private, max-age=…, immutable` and `Accept-Ranges: bytes`.
- A non-member / expired token receives `401`.
- Range requests (video scrubbing) succeed.
- Vibe Clip still resolves to signed Bunny Stream HLS.
