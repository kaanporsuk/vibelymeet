# Chat Media — Current Solution & Rollback Reference

**Status:** Operative reference for private chat media delivery after the Bunny privacy closure.
The current production path prefers a **dedicated token-auth Bunny pull zone** for private chat
Storage media and keeps the **authorized Supabase Edge proxy** as the deterministic rollback path.

**Baseline commit:** `8f5950f6` ("Harden media permissions and profile photo swipes (#1121)", 2026-05-30) plus
branch `feat/chat-media-reliability-egress` (Tier 0 thumbnail reliability + Tier 1 cache/expo-image).

---

## 1. What the current solution is

Private chat media uses an **authorized resolver** for every URL issuance. For Bunny Storage
families, the resolver prefers a short-lived signed URL on the dedicated private chat pull zone
when `CHAT_MEDIA_DIRECT_CDN_ENABLED=true`; otherwise it falls back to the Edge proxy. Bunny Stream
families resolve to signed Stream URLs.

| Family | Provider | Delivery |
|---|---|---|
| Chat photo | `bunny_storage` | Signed private Bunny Storage CDN URL (`vibely-chat-storage-hot.b-cdn.net`) when enabled; Edge proxy fallback |
| Chat voice | `bunny_storage` | Signed private Bunny Storage CDN URL when enabled; Edge proxy fallback |
| Legacy/progressive chat video | `bunny_storage` | Legacy upload is gated off by default; existing active rows resolve through signed private CDN/proxy fallback |
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
5. `bunny_storage` with direct CDN enabled/configured → returns a 15-minute signed URL on
   `BUNNY_CHAT_STORAGE_CDN_HOSTNAME` using Bunny token authentication:
   ```json
   {
     "success": true,
     "url": "https://vibely-chat-storage-hot.b-cdn.net/<private-path>?token=…&expires=…&token_path=…",
     "playbackKind": "progressive",
     "provider": "bunny_storage",
     "expiresInSeconds": 900
   }
   ```
6. `bunny_storage` with direct CDN disabled or missing config → mints a 15-minute HMAC proxy token and returns:
   ```json
   {
     "success": true,
     "url": "https://<supabase>/functions/v1/get-chat-media-url?token=<token>",
     "playbackKind": "progressive",
     "provider": "bunny_storage",
     "expiresInSeconds": 900
   }
   ```
7. Client `GET …?token=…` on the proxy fallback → `handleProxy` verifies the token, fetches
   `https://storage.bunnycdn.com/${zone}/${path}` with the `AccessKey` header, and streams the body.
8. Proxy response headers (**current, after Tier 1**):
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

## 4. Required env / secrets

Base resolver/proxy secrets:

```
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
CHAT_MEDIA_PROXY_SECRET            # required in production for proxy-token signing
CHAT_MEDIA_PROXY_SECRET_ALLOW_SERVICE_ROLE_FALLBACK
                                   # local/test only; never enable in production
BUNNY_STORAGE_ZONE, BUNNY_STORAGE_API_KEY
BUNNY_ARCHIVE_STORAGE_ZONE / BUNNY_STORAGE_ARCHIVE_ZONE        # optional archive tier
BUNNY_ARCHIVE_STORAGE_API_KEY / BUNNY_STORAGE_ARCHIVE_API_KEY  # optional archive tier
BUNNY_CHAT_STREAM_CDN_HOSTNAME, BUNNY_CHAT_STREAM_TOKEN_SECURITY_KEY
BUNNY_STREAM_CDN_HOSTNAME, BUNNY_STREAM_TOKEN_SECURITY_KEY
```

### Direct private-chat CDN secrets

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
> Token Authentication enabled. Current production hostname: `vibely-chat-storage-hot.b-cdn.net`.

### Public CDN deny rule

The public CDN `cdn.vibelymeet.com` must keep a Bunny Edge Rule that blocks private path families:

- `https://cdn.vibelymeet.com/voice/*`
- `https://cdn.vibelymeet.com/chat-videos/*`
- `https://cdn.vibelymeet.com/photos/match-*`
- `https://cdn.vibelymeet.com/media/*`

Do not block broad `photos/*`; public profile/avatar images legitimately live there.

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
npm run probe:media-privacy
npm run test:chat-media-cache
npm run test:media-privacy-guard
npm run test:chat-media-direct-cdn
npm run test:vibe-clip-upload-contract
npm run test:chat-native-lifecycle
npm run typecheck
```

Functional (disposable pair, per CLAUDE.md): send + reopen a chat photo, a voice note, and a Vibe Clip.
- With direct CDN enabled, photo/voice `url` host is `vibely-chat-storage-hot.b-cdn.net` and removing token query params fails.
- With direct CDN disabled, photo/voice `url` host is **Supabase Functions**, not a Bunny CDN host.
- Proxy fallback: `curl -I "<issued url>"` shows `Cache-Control: private, max-age=…, immutable` and `Accept-Ranges: bytes`.
- A non-member / expired token receives `401`.
- Range requests (video scrubbing) succeed.
- Vibe Clip still resolves to signed Bunny Stream HLS.

The GitHub Actions workflow `.github/workflows/media-privacy-live-probe.yml` runs the read-only
probe on `main`, daily, and on demand. GitHub repository secrets required by that workflow:
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BUNNY_CDN_HOSTNAME`, and
`BUNNY_CHAT_STORAGE_CDN_HOSTNAME`. If archive direct-CDN delivery is enabled, also set
`BUNNY_CHAT_STORAGE_ARCHIVE_CDN_HOSTNAME` so archived private media is probed against the archive host.
