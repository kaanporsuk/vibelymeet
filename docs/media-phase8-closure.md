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

The function rechecks `get_profile_for_viewer`, verifies the current profile video still matches the source ref, requires `bunny_video_status = 'ready'`, and returns signed Bunny Stream HLS and poster URLs using advanced directory token format. Ready public/self/admin profile responses may also include `vibe_video_playback_ref`; clients prefer signed playback when available and fall back to the raw public URL only when signed playback is not required.

Operational requirement: the Vibe Video Bunny Stream CDN/pull zone must have token authentication enabled and `BUNNY_STREAM_TOKEN_SECURITY_KEY` configured in Supabase Edge Function secrets. Production target is **key configured + Bunny token authentication enabled**. The Edge Function can verify the secret is present and exposes an admin/service health check, but Bunny dashboard token-auth status remains an operations prerequisite.

| `BUNNY_STREAM_TOKEN_SECURITY_KEY` | Bunny token auth | Outcome |
|---|---|---|
| Configured | Enabled | Target state: signed profile Vibe Video playback works and unsigned public URLs are blocked by Bunny. |
| Configured | Disabled | Signed URLs play, but unsigned public URLs also play; privacy depends only on not exposing raw UIDs. |
| Missing | Enabled | Private signed playback fails closed with `503`; public unsigned URLs are blocked. |
| Missing | Disabled | Signed playback fails and unsigned URLs may still work if a raw UID leaks; this closure masks raw UIDs for signed-required views. |

For signed-required private/non-discoverable views, `get_profile_for_viewer()` returns `bunny_video_uid = null` and `bunny_video_status = null`; `vibe_video_playback_ref` is the only client playback handle. For ready public/self/admin views, the same ref can be returned alongside raw UID/status so those clients keep the existing compatibility contract while also working after Bunny token authentication is enabled. The current ref format is `profile_vibe_video:<profile_id>:<video_id>` and is contract-tested as the Phase 8 v1 profile Vibe Video ref.

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
