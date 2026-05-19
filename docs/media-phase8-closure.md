# Media Phase 8 Closure

Status: implemented as code-only follow-ons. Web/native builds, browser/device QA, rollout flags, and Supabase cloud mutations remain manual.

## 8.1 Bunny Storage Presign Investigation

Conclusion: Bunny Edge Storage does not expose an S3-style presigned direct-upload URL in the documented HTTP API. The documented upload contract is still server-authorized `PUT` to `https://storage.bunnycdn.com/{storageZoneName}/{path}/{fileName}` with the storage-zone `AccessKey` header. The documented authentication guidance also says Edge Storage uses the storage-zone password/API credential in `AccessKey`, not the account API key.

Decision: keep photos, voice notes, and event covers flowing through Edge Functions. This preserves checksum validation, server-side SHA-256, reserve/receipt idempotency, and keeps the storage credential off web/native clients.

References:
- https://docs.bunny.net/api-reference/storage
- https://docs.bunny.net/api-reference/storage/manage-files/upload-file
- https://docs.bunny.net/api-reference/authentication

## 8.2 Private Profile Vibe Video Signing

`get_profile_for_viewer()` now emits:
- `vibe_video_signed_playback_required`
- `vibe_video_playback_ref` in the form `profile_vibe_video:<profile_id>:<video_id>`

The flag is true for non-self, non-admin views where the target profile is accessible through an established/shared-event relationship but is not discoverable to that viewer. Public discovery-facing profiles keep the existing public Bunny Stream UID behavior.

`get-chat-media-url` now accepts authenticated `POST` requests with:

```json
{
  "mediaKind": "profile_vibe_video",
  "profileId": "<profile uuid>",
  "sourceRef": "profile_vibe_video:<profile uuid>:<bunny video id>"
}
```

The function rechecks `get_profile_for_viewer`, verifies the current profile video still matches the source ref, requires `bunny_video_status = 'ready'`, and returns signed Bunny Stream HLS and poster URLs using advanced directory token format.

Operational requirement: the Vibe Video Bunny Stream CDN/pull zone must have token authentication enabled and `BUNNY_STREAM_TOKEN_SECURITY_KEY` configured in Supabase Edge Function secrets. If token authentication is not enabled at Bunny, signed URLs still work as URLs, but public unsigned URLs are not actually blocked by Bunny.

Reference:
- https://docs.bunny.net/cdn/security/token-authentication/advanced

## 8.3 Chat Image Structured Payload

New chat image rows now keep the legacy text marker:

```text
__IMAGE__|photos/...
```

and also persist a forward-compatible structured payload:

```json
{
  "v": 2,
  "kind": "chat_image",
  "provider": "bunny_storage",
  "media_ref": "photos/...",
  "client_request_id": "<optional uuid>"
}
```

Web, native, conversation previews, chat page hydration, source-ref collection, and `chat-thread-page` now prefer the structured media ref while retaining the legacy marker fallback.
