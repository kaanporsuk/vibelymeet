# Media SDK Telemetry And Recovery

Phase 3 treats the SDK as the upload execution boundary, not just a state wrapper.

## Telemetry

Production SDK factories must pass both PostHog and Sentry sinks:

- Web: `src/lib/mediaSdk/sinks/*`
- Native: `apps/mobile/lib/mediaSdk/sinks/*`

Sinks are fail-isolated by `createMediaTelemetry`; exceptions thrown by analytics code cannot affect upload routing or task lifecycle. The SDK redacts telemetry fields at the emit boundary with an allowlist, then platform analytics layers apply their normal product-intelligence sanitizers.

Required upload-start events:

- `media_upload_started`
- `media_upload_sdk_flag_evaluated`

Required SDK lifecycle events:

- `media_sdk_initialized`
- `media_upload_pause_requested`
- `media_upload_resume_requested`
- `media_upload_queue_reconciled_terminal`
- `media_upload_queue_pruned`

`media_sdk_initialized` must include the Phase 7 background-upload no-go policy fields so operators can verify that foreground persistent recovery is the enforced production path:

- `background_upload_policy_phase`
- `background_upload_production_enabled`
- `background_upload_decided_at`
- `background_upload_review_after`
- `background_upload_source_of_truth`

Raw user ids, signed URLs, local file paths, auth headers, tokens, and arbitrary context payloads must not be emitted. Use `client_request_id`, `family`, `platform`, `state`, rollout fields, and `user_id_bucket`.

See [media-sdk-background-policy.md](./media-sdk-background-policy.md) for the Phase 7 runtime policy and review cadence.

## Recovery And Reconciliation

The persistent queue is foreground-resumable, not OS-background guaranteed. On auth session start and foreground/visibility activation, platform code calls SDK `reconcile()`:

1. Load queue rows in `created`, `uploading`, `paused`, `processing`, or recent `failed`.
2. Cross-check server upload-attempt tables for video families.
3. Remove queue rows when the server is terminal: `ready`, `failed`, or `superseded`.
4. Keep recent local failures for a short grace window so recovery sweeps can inspect them.
5. Nudge expired in-flight video attempts through the relevant sync function.

Chat Vibe Clip display readiness still flows through `messages` Realtime and `useMediaAsset`. That is intentional separation: the SDK owns upload execution and local recovery, while message rendering owns peer-visible display state.

## Vibe Video Schema Notes

`vibe_video_uploads.user_id` is the profile uploader id. `chat_vibe_clip_uploads.sender_id` is the chat sender id. They refer to the same auth id domain but keep different names because the profile and chat tables model different product entities.

`vibe_video_uploads.expires_at` mirrors the Bunny Stream TUS credential TTL used by `create-video-upload` (`EXPECTED_TUS_CREDENTIAL_TTL_MS`, currently one hour). Change both together.
