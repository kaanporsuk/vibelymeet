# Vibe Video Final Hardening - Telemetry and QA Delta

Branch: `fix/vibe-video-final-hardening-telemetry-qa`

## Scope

This pass closes the remaining repo-side Vibe Video hardening gaps after PR #540/#541:

- privacy-safe client telemetry on web and native
- structured Edge Function logs
- backend-owned profile video-field guardrails
- HLS/native playback regression tests
- explicit Bunny Stream CDN fallback behavior
- moderation/trust-safety audit notes

No deploys were performed from this branch.

## Telemetry Event Map

All client events include `platform` through the web/native telemetry helpers. Event props are sanitized to avoid tokens, auth headers, signed URLs, file paths, and raw private URIs.

| Event | Web emitters | Native emitters |
| --- | --- | --- |
| `vibe_video_credentials_request_started` | `heroVideoUploadController` | `nativeHeroVideoUploadController` |
| `vibe_video_credentials_request_succeeded` | `heroVideoUploadController` | `nativeHeroVideoUploadController` |
| `vibe_video_credentials_request_failed` | `heroVideoUploadController` | `nativeHeroVideoUploadController` |
| `vibe_video_tus_upload_started` | `heroVideoUploadController` | `nativeHeroVideoUploadController` |
| `vibe_video_tus_upload_succeeded` | `heroVideoUploadController` | `nativeHeroVideoUploadController` |
| `vibe_video_tus_upload_failed` | `heroVideoUploadController` | `nativeHeroVideoUploadController` |
| `vibe_video_upload_stalled` | `heroVideoUploadController` | `nativeHeroVideoUploadController` |
| `vibe_video_processing_poll_started` | `heroVideoUploadController` | `nativeHeroVideoUploadController` |
| `vibe_video_processing_status_changed` | `heroVideoUploadController` | `nativeHeroVideoUploadController` |
| `vibe_video_processing_stalled` | `heroVideoUploadController` | `nativeHeroVideoUploadController` |
| `vibe_video_ready_observed` | `heroVideoUploadController` | `nativeHeroVideoUploadController` |
| `vibe_video_failed_observed` | `heroVideoUploadController` | `nativeHeroVideoUploadController` |
| `vibe_video_playback_attempted` | `VibePlayer`, `VibeVideoFullscreenPlayer` | `VibeVideoPlayer` |
| `vibe_video_playback_succeeded` | `VibePlayer`, `VibeVideoFullscreenPlayer` | `VibeVideoPlayer` |
| `vibe_video_playback_failed` | `VibePlayer`, `VibeVideoFullscreenPlayer` | `VibeVideoPlayer` |
| `vibe_video_cdn_hostname_fallback_used` | N/A | hostname fallback resolver |
| `vibe_video_delete_requested` | `VibeStudio` | `vibe-studio` |
| `vibe_video_delete_succeeded_locally` | `VibeStudio` | `vibe-studio` |
| `vibe_video_replace_started` | `VibeStudioModal`, `heroVideoUploadController` | `vibe-video-record`, `nativeHeroVideoUploadController` |
| `vibe_video_caption_preserved` | `VibeStudioModal` | `vibe-video-record` |
| `vibe_video_caption_edited` | `VibeStudio`, `VibeStudioModal` | `vibe-studio`, `vibe-video-record` |
| `vibe_video_caption_cleared` | `VibeStudio`, `VibeStudioModal` | `vibe-studio`, `vibe-video-record` |
| `vibe_video_profile_report_submitted` | `ReportWizard` when the selected/reported match profile has a Vibe Video UID | `ReportFlowModal` when invoked from native public profile with a reported profile that has a Vibe Video UID |

## Edge Function Logs

`supabase/functions/_shared/vibe-video-logs.ts` writes structured JSON with `scope: "vibe_video"` and sanitized fields.

- `create-video-upload`: request received, auth resolved, Bunny config, Bunny create result, profile UID/status write result, media-session create result, replacement/deferred cleanup paths.
- `video-webhook`: received, rejected reason, token/library validation, status mapping, media-session update success/failure, stale/out-of-order ignored, legacy fallback update success/failure.
- `delete-vibe-video`: requested, auth resolved, profile clear success/failure, deferred remote delete worker handoff, orphan-risk state.

## Backend-Owned Field Model

`profiles.bunny_video_uid`, `profiles.bunny_video_status`, and legacy `profiles.vibe_video_status` are backend-owned compatibility mirrors. Normal authenticated clients may still update safe profile metadata, including `profiles.vibe_caption`, but cannot directly write arbitrary Vibe Video UID/status values.

The additive migration `20260501120000_vibe_video_backend_owned_field_guardrails.sql` installs a trigger guard. It permits service-role Edge Functions, trusted security-definer RPCs, and explicit trusted GUC paths used by onboarding/Vibe Video server writes.

Validation SQL: `supabase/validation/vibe_video_final_hardening.sql`.

## CDN Fallback Behavior

Native playback hostname priority is:

1. `EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME`
2. project-scoped persisted hostname returned by `create-video-upload`
3. explicit last-resort fallback `vz-5585ddfc-604.b-cdn.net`

Fallback use is intentionally visible through a production diagnostic hint and `vibe_video_cdn_hostname_fallback_used`. Web does not use a hardcoded Stream fallback; it requires `VITE_BUNNY_STREAM_CDN_HOSTNAME`.

## Moderation And Trust-Safety

Vibe Video display surfaces use the existing profile visibility path (`get_profile_for_viewer`) or already-authorized match/profile data; this preserves block/report/privacy filtering from the profile RPC and discovery policies. Vibe Video does not introduce a separate public bypass.

Existing report/block surfaces remain user-level, not asset-level. Native public profile reports now emit `vibe_video_profile_report_submitted` when the reported profile has a Vibe Video UID. Automated NSFW/video scanning is not implemented in this sprint.

Operational gap:

- Reports can identify the reported user, but not a specific video asset or timestamp.
- Moderators can review reported users via existing admin reports/profile tools, but there is no queue-level automated video moderation signal.
- If automated scanning is added later, store provider verdicts against the canonical media asset/session rows rather than overloading profile mirror fields.

## Manual QA Still Required

- Real Bunny Stream upload reaches TUS and produces a valid Stream GUID.
- Bunny webhook posts to the deployed `video-webhook` URL with `?token=`.
- Bunny dashboard library id matches `BUNNY_STREAM_LIBRARY_ID`.
- Ready and failed webhook events move DB state correctly.
- Chrome HLS playback uses hls.js; Safari/native HLS still plays.
- Native iOS and Android play HLS through `expo-video` without `expo-av`.
- Bunny hotlink/token rules allow app user agents and browsers.
- Report/block from a profile containing a Vibe Video hides future visibility as expected.

## Rebuild Delta

- Web JS rebuild required after client telemetry/player changes.
- Native JS update required after mobile telemetry/player/report changes.
- No native binary dependency was added.
- No native binary rebuild is required by these changes alone.
- Edge Function deploy is required for new structured logs.
- Supabase migration deploy is required for backend-owned field guardrails.

## Backend Contract Repair Delta

Additional repo-side hardening now lives in:

- `supabase/migrations/20260501123000_vibe_video_backend_contract_repair.sql`
- `supabase/validation/vibe_video_backend_contract_repair.sql`

Contract changes:

- `public.calculate_vibe_score(uuid)` is reasserted as UID-only for Vibe Video credit: any non-empty `profiles.bunny_video_uid` gives +15, regardless of `bunny_video_status`.
- Existing profiles with non-empty `bunny_video_uid` are backfilled through the reasserted scorer so persisted `profiles.vibe_score` catches up after deploy.
- `public.classify_stale_vibe_video_uploads(int, int)` gives service-role operators a read-only list of stale current-profile Vibe Video upload states before repair.
- `public.mark_stale_vibe_video_uploads_failed(int, int)` now uses the same conservative candidate rules, marks stale `created` / `uploading` / `processing` sessions and profile mirrors as `failed`, preserves `bunny_video_uid` for score/history, and does not delete Bunny media.
- `create-video-upload` now requires a durable `draft_media_sessions` row before returning TUS credentials. If session creation fails, the freshly-created Bunny Stream object is cleaned up and the credential request fails with `media_session_create_failed`.
- `video-webhook` now checks for any existing Vibe Video `draft_media_sessions` row before using the legacy profile fallback after `session_not_found`. Modern terminal/stale session events are logged as `video_webhook_session_not_found_modern_asset_ignored` instead of silently hiding lifecycle gaps.

Deploy impact:

- Deploy the new Supabase migration before relying on stale repair helpers.
- Redeploy `create-video-upload` and `video-webhook` after the migration is applied.
- No Supabase cloud deploy was performed from this working copy.
