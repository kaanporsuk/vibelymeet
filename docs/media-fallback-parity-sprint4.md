# Media fallback parity Sprint 4

## Scope

Sprint 4 keeps the existing shared resolver/cache/signing path. It does not introduce a new Bunny media component, signing endpoint, RPC, or backend system.

## Audited Surfaces

| Surface | Shared path | Fallback behavior |
| --- | --- | --- |
| Web profile vibe video | `useMediaAsset` + `profile_vibe_video` refs | Signed URL failures resolve to shared copy, refresh is exposed when recoverable, HLS auth still refreshes before visible error. |
| Native profile vibe video | `useMediaAsset` + `profile_vibe_video` refs | Ready-but-unplayable and fullscreen playback states use shared copy and retry labels. |
| Web chat video messages | `useMediaAsset` + chat media refs | Playback/resolve failures use shared copy and retry only when recoverable. |
| Native chat video messages | `useMediaAsset` + chat media refs | Inline and fullscreen failures use shared copy without provider detail leakage. |
| Web/native vibe clips | `useMediaAsset` + `vibe_clip` / `thumbnail` refs | Poster failures fall back to placeholders; playback failures refresh once, then show shared copy. |
| Lobby/profile preview media | Existing profile prewarm + profile detail playback | Existing prewarm path is preserved; full profile playback surfaces own the visible fallback. |

## Privacy And Telemetry

Fallback reasons are limited to `auth_expired`, `asset_deleted`, `provider_unreachable`, `poster_unavailable`, `hls_auth_failed`, and `unknown`. Shared copy and telemetry-facing reasons do not include signed URLs, provider paths, raw provider errors, user IDs, profile IDs, message IDs, partner IDs, or asset IDs.

## Native Audio Output Parity

Web video dates can expose audio output selection through browser sink APIs where supported. Native mobile audio routing remains OS-controlled; users switch speakers/headphones through iOS or Android system controls. This is intentionally documented as OS-limited parity, not a missing Sprint 4 implementation item.
