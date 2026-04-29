# Native Vibe Video — engineering runbook

## Cross-repo operator doc

**Bunny webhook URL, token, and stuck-`processing` triage:** see repo root  
[`docs/vibe-video-webhook-operator.md`](../../../docs/vibe-video-webhook-operator.md).

## Relevant native modules

| Module | Role |
|--------|------|
| `lib/vibeVideoPlaybackUrl.ts` | **Canonical** CDN hostname resolution + `getVibeVideoPlaybackUrl` / `getVibeVideoThumbnailUrl` |
| `lib/vibeVideoState.ts` | **`resolveVibeVideoState()`** — single resolver for all native UI (`none` / `processing` / `stale_processing` / `ready` / `failed` / `error`; live local upload progress belongs to the upload controller) |
| `lib/vibeVideoStatus.ts` | `normalizeBunnyVideoStatus` (shared normalization; avoid ad-hoc status branches in screens) |
| `components/video/VibeVideoPlayer.tsx` | **Canonical** expo-video playback (preview + fullscreen HLS) |
| `lib/vibeVideoApi.ts` | create-video-upload, cache-file normalize + TUS upload, delete-vibe-video (robust JSON + HTTP status) |
| `lib/vibeVideoPoll.ts` | Abortable post-upload polling with superseded detection |
| `lib/vibeVideoDiagnostics.ts` | `vibeVideoDiagVerbose` (__DEV__), `vibeVideoDiagProdHint` (sparse prod signals) |

### Score vs playback (backend contract)

- **Vibe Score / incomplete-actions list:** treat the vibe-video task as satisfied when `bunny_video_uid` is non-empty (`calculate_vibe_score` awards on uid, not only `ready`).
- **Playback and “live on profile” UX:** still driven by `resolveVibeVideoState()` — a UID plus `uploading`, `processing`, null, or unknown status renders as processing, and becomes `stale_processing` after the shared stale threshold when timestamps are available. `canPlay` requires normalized `ready` plus a resolvable HLS hostname/URL.

`bunny_video_uid` / `bunny_video_status` are **not** client-written; `create-video-upload`, webhooks, and `delete-vibe-video` own the snapshot.

## Hostname policy

1. If `EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME` is set → all HLS/thumbnail URLs use it (aligned with web build).
2. Otherwise → use persisted `bunny_stream_cdn_hostname` from `create-video-upload`.
3. If neither exists → return `null` playback/thumbnail URLs and emit diagnostics. Do not mask missing config with a hardcoded Stream hostname.
4. If env and persisted values differ → **`__DEV__` warns** (`CDN hostname mismatch`). Production still prefers env when present.

Missing-hostname state is telemetry-visible: `resolveVibeVideoStreamHostnameSync()` emits a sparse production diagnostic hint and `vibe_video_cdn_hostname_fallback_used` with `kind: "cdn_hostname_missing"`. Treat any production hit as a release/provider configuration issue.

## Failure classes → how to tell them apart

| Class | User-visible hint | Engineering signal |
|-------|-------------------|-------------------|
| **Missing configured stream hostname** | Ready videos show playback unavailable instead of playing | `resolveVibeVideoStreamHostnameSync().source === 'missing'`; `playback.hostname.missing`; `vibe_video_cdn_hostname_fallback_used` with `kind: "cdn_hostname_missing"` |
| **Env vs persisted mismatch** | Playback may 403 if wrong zone | `__DEV__` `[VibeVideo] CDN hostname mismatch` |
| **Bunny 403 / hotlink / referrer** | Fullscreen playback error + “Try again”; HLS error | `vibeVideoDiagVerbose('player.status_error')` (context `fullscreen`); test same URL in Safari vs app |
| **Manifest missing / 404** | Same as playback failure | Network trace to `.../playlist.m3u8`; Bunny library video state |
| **Thumbnail missing** | Placeholder / “Thumbnail unavailable” (drawer, preview, studio) | Image `onError` or null URL with valid uid |
| **Stuck processing (webhook)** | Processing card first, then “Still processing” stale copy with refresh/retry/re-upload guidance | DB `bunny_video_status` + `bunny_video_uid` + `updated_at`; `vibe_video_stale_processing_observed`; see webhook operator doc |
| **TUS / upload auth expiry** | “Upload session expired” style message | `vibeVideoDiagVerbose('tus.auth_or_expiry')` |
| **Delete deferred to lifecycle worker** | Profile clears immediately; Bunny asset may remain until purge is processed | Expected in Sprint 2; inspect `media_assets` / `media_delete_jobs` rather than treating immediate remote presence as an error |

## Typical failure signatures (quick)

| Symptom | Likely cause | Where to look |
|--------|----------------|---------------|
| Thumbnail/playback URL always null | Missing env + no prior upload to persist hostname | `.env`, `initStreamCdnHostname`, logs `[VibeVideo] Cannot build playback URL: missing Stream CDN hostname` |
| 403 / black player / manifest error | Bunny CDN hotlink / referrer / token rules | Bunny dashboard; compare Safari vs app UA |
| Status stuck `processing` | Webhook not firing or Bunny pipeline slow | `docs/vibe-video-webhook-operator.md`; `profiles` row; stale classifier SQL |
| Poll `superseded` | User replaced video mid-poll | Expected; refetch profile |
| Delete: UI OK but Stream still has file right away | Expected deferred delete in Sprint 2 | Confirm profile snapshot cleared, then inspect lifecycle queue / worker state |

## Fullscreen playback surfaces (native)

**`FullscreenVibeVideoModal`** wraps **`VibeVideoPlayer`** (expo-video, shared poster + `player.status_error` diagnostics). `Vibe Studio` and the record preview use the same component.

- `app/vibe-studio.tsx` — dedicated Vibe Studio management surface
- `app/vibe-video-record.tsx` — post-capture preview

On iOS silent mode, audio may be muted until a future native rebuild adds audio-session configuration.

## Telemetry and trust-safety hooks

Native Vibe Video telemetry lives in `apps/mobile/lib/vibeVideoTelemetry.ts` and emits PostHog events plus Sentry breadcrumbs. Event props are sanitized; do not add local file paths, auth headers, signed URLs, or tokens.

Native emits upload, processing, stale-processing, playback, delete, replace, caption, CDN-missing, and profile-report events. `vibe_video_stale_processing_observed` includes user id, video uid, normalized status, age, status timestamp, platform, and surface after sanitization. The native public profile report flow passes `reportedHasVibeVideo` into `ReportFlowModal`; successful reports for profiles with a Vibe Video UID emit `vibe_video_profile_report_submitted`.

Foreground/profile-load recovery:

- `vibe-studio` resumes polling when AppState returns to active and the resolver is still `processing` or `stale_processing`.
- Profile Studio resumes polling on profile load for existing UID pipeline rows.
- Stale copy must never become “no video”; playback stays disabled until resolver `ready` and `canPlay`.

Vibe Video display for other users must continue to use `fetchUserProfile()` / `get_profile_for_viewer` or authorized match surfaces so block/report/privacy rules are preserved. There is no automated video scanning in this sprint; moderator review still happens through existing user report/admin profile tooling.

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
| `delete-vibe-video` | **200** + `{ success: true, hadVideoToDelete, dbProfileCleared, bunnyRemoteDeleteOk: null, bunnyRemoteDeleteHttpStatus: null, possibleBunnyOrphan: true, deleteDeferredToWorker: true, remoteDeleteState: "deferred_to_media_delete_worker" }` when a remote delete is queued/deferred | **401**, **500** with `{ success: false, error, code? }` |

- **Web** `VibeStudioModal` uses `!credResponse.ok || !creds.success` so both legacy 200-errors and new status codes work.
- **Native** `vibeVideoApi.ts` already branches on `res.ok` and parses JSON for all paths.
- **Profile columns** unchanged: `bunny_video_uid`, `bunny_video_status`, `vibe_caption` remain the compatibility mirror even though Sprint 2 now stores canonical vibe-video history in `profile_vibe_videos` + `media_assets` / `media_references`.
