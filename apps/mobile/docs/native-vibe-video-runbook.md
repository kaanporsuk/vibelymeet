# Native Vibe Video — engineering runbook

## Cross-repo operator doc

**Bunny webhook URL, token, and stuck-`processing` triage:** see repo root  
[`docs/vibe-video-webhook-operator.md`](../../../docs/vibe-video-webhook-operator.md).

## Relevant native modules

| Module | Role |
|--------|------|
| `lib/vibeVideoPlaybackUrl.ts` | **Canonical** CDN hostname resolution + `getVibeVideoPlaybackUrl` / `getVibeVideoThumbnailUrl` |
| `lib/vibeVideoState.ts` | **`resolveVibeVideoState()`** — single resolver for all native UI (`none` / `uploading` / `processing` / `ready` / `failed` / `error`) |
| `lib/vibeVideoStatus.ts` | `normalizeBunnyVideoStatus` (shared normalization; avoid ad-hoc status branches in screens) |
| `components/video/VibeVideoPlayer.tsx` | **Canonical** expo-video playback (preview + fullscreen HLS) |
| `lib/vibeVideoApi.ts` | create-video-upload, cache-file normalize + TUS upload, delete-vibe-video (robust JSON + HTTP status) |
| `lib/vibeVideoPoll.ts` | Abortable post-upload polling with superseded detection |
| `lib/vibeVideoDiagnostics.ts` | `vibeVideoDiagVerbose` (__DEV__), `vibeVideoDiagProdHint` (sparse prod signals) |

## Hostname policy

1. If `EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME` is set → all HLS/thumbnail URLs use it (aligned with web build).
2. Otherwise → use persisted `bunny_stream_cdn_hostname` from `create-video-upload`.
3. If env and persisted values differ → **`__DEV__` warns** (`CDN hostname mismatch`). Production still prefers env when present.

No invented hostnames in code.

## Failure classes → how to tell them apart

| Class | User-visible hint | Engineering signal |
|-------|-------------------|-------------------|
| **Missing stream hostname** | Fullscreen / card “Video unavailable”; no thumbnail URL | Console `[VibeVideo] Cannot build playback URL` / `No stream CDN hostname`; `resolveVibeVideoStreamHostnameSync().source === 'none'` |
| **Env vs persisted mismatch** | Playback may 403 if wrong zone | `__DEV__` `[VibeVideo] CDN hostname mismatch` |
| **Bunny 403 / hotlink / referrer** | Fullscreen playback error + “Try again”; HLS error | `vibeVideoDiagVerbose('player.status_error')` (context `fullscreen`); test same URL in Safari vs app |
| **Manifest missing / 404** | Same as playback failure | Network trace to `.../playlist.m3u8`; Bunny library video state |
| **Thumbnail missing** | Placeholder / “Thumbnail unavailable” (drawer, preview, studio) | Image `onError` or null URL with valid uid |
| **Stuck processing (webhook)** | Processing card / poll timeout alert | DB `bunny_video_status` + `bunny_video_uid`; see webhook operator doc |
| **TUS / upload auth expiry** | “Upload session expired” style message | `vibeVideoDiagVerbose('tus.auth_or_expiry')` |
| **Remote delete failed (orphan risk)** | Profile clears (UX success); Bunny may still hold asset | Prod `vibeVideoDiagProdHint('delete-vibe-video.profile_cleared_bunny_orphan_risk')`; Edge JSON `possibleBunnyOrphan`, `bunnyRemoteDeleteOk` |

## Typical failure signatures (quick)

| Symptom | Likely cause | Where to look |
|--------|----------------|---------------|
| Thumbnail/playback URL always null | Missing env + no prior upload to persist hostname | `.env`, `initStreamCdnHostname`, logs `[VibeVideo] No stream CDN hostname` |
| 403 / black player / manifest error | Bunny CDN hotlink / referrer / token rules | Bunny dashboard; compare Safari vs app UA |
| Status stuck `processing` | Webhook not firing or Bunny pipeline slow | `docs/vibe-video-webhook-operator.md`; `profiles` row |
| Poll `superseded` | User replaced video mid-poll | Expected; refetch profile |
| Delete: UI OK but Stream still has file | Bunny DELETE non-OK | Supabase `delete-vibe-video` logs; `bunnyRemoteDeleteOk` |

## Fullscreen playback surfaces (native)

**`FullscreenVibeVideoModal`** wraps **`VibeVideoPlayer`** (expo-video, shared poster + `player.status_error` diagnostics). Profile / record preview use the same component.

- `app/(tabs)/profile/ProfileStudio.tsx` (`USE_PROFILE_STUDIO === true`)
- `app/(tabs)/profile/index.tsx` — legacy branch (`USE_PROFILE_STUDIO === false`)
- `app/vibe-video-record.tsx` — post-capture preview

On iOS silent mode, audio may be muted until a future native rebuild adds audio-session configuration.

## Rebuild / deploy delta

- **Mobile JS:** EAS / OTA as usual; no extra native rebuild for these changes alone.
- **Env:** `EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME` should match web `VITE_BUNNY_STREAM_CDN_HOSTNAME`.
- **Edge Functions** (after edits in `supabase/functions/`):

  ```bash
  supabase functions deploy create-video-upload delete-vibe-video video-webhook --project-ref <ref>
  ```

## Backend / shared contract (closure pass)

| Function | Success | Hard failures |
|----------|---------|----------------|
| `create-video-upload` | **200** + `{ success: true, videoId, libraryId, expirationTime, signature, cdnHostname }` | **401** auth, **503** `missing_bunny_secret`, **409** `profile_missing`/`profile_incomplete`, **502** Bunny create failed, **500** `profile_row_mismatch`/`profile_update_failed`/internal — body includes `{ success: false, error, code? }` |
| `delete-vibe-video` | **200** + `{ success: true, hadVideoToDelete, dbProfileCleared, bunnyRemoteDeleteOk, bunnyRemoteDeleteHttpStatus, possibleBunnyOrphan? }` | **401**, **503**, **500** with `{ success: false, error, code? }` |

- **Web** `VibeStudioModal` uses `!credResponse.ok || !creds.success` so both legacy 200-errors and new status codes work.
- **Native** `vibeVideoApi.ts` already branches on `res.ok` and parses JSON for all paths.
- **Profile columns** unchanged: `bunny_video_uid`, `bunny_video_status`, `vibe_caption`.
