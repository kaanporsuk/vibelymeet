# Media Privacy Architecture

Phase 9 separates discovery media from private chat media.

## Current Boundary

- Profile Vibe Videos are discovery/profile media. They remain server-processable, captioned, and protected by signed playback URLs where required.
- Private chat media access is gated by Supabase auth, RLS/message membership checks, short-lived signed/proxied URLs, and Bunny token security.
- Private chat Storage media must not be served by the public Bunny CDN. The public pull zone blocks `voice/*`, `chat-videos/*`, `photos/match-*`, and `media/*`; the dedicated private chat pull zone is `vibely-chat-storage-hot.b-cdn.net` with token authentication enabled.
- `npm run probe:media-privacy` is the repeatable acceptance gate. It samples active private media without printing paths, fails if `cdn.vibelymeet.com` serves private media, and also checks unsigned access to `BUNNY_CHAT_STORAGE_CDN_HOSTNAME` when that env var is set.
- Phase 9 adds schema support for client identity keys (`profiles.encryption_pub_key`), per-match conversation-key envelopes (`matches.encrypted_conversation_keys`), and per-asset encryption metadata (`media_assets.encryption_metadata`, chat upload `encrypted_media`).
- Runtime client-side encryption/decryption for private chat media is not active yet. Until that crypto path lands, chat media remains server-readable and protected by auth, RLS, and signed/proxied access rather than true E2EE.

## E2EE Target Contract

For true private chat media E2EE:

1. Each client generates a Curve25519 identity keypair on first sign-in.
2. Public keys are stored in `profiles.encryption_pub_key`.
3. Private keys stay device-local:
   - Native: OS secure storage.
   - Web: IndexedDB storage wrapped with WebCrypto-derived key material.
4. Each match owns a random 32-byte conversation key.
5. The conversation key is envelope-encrypted to both participant public keys and stored in `matches.encrypted_conversation_keys`.
6. Private chat media bytes are encrypted client-side before upload.
7. The server stores and hashes ciphertext only.
8. Encrypted chat video uses Bunny Storage object playback with client decrypt-to-blob. Bunny Stream transcoding is reserved for non-E2EE profile/discovery video.

## Operational Guardrails

- Do not send plaintext private media to Bunny Stream for an E2EE chat surface.
- Do not public-map chat Storage paths in web/native helpers. `photos/` and `events/` are public-media prefixes; chat-scoped paths such as `photos/match-*`, `voice/*`, `chat-videos/*`, and `media/*` must resolve through the authorized media resolver.
- Do not expose `BUNNY_CHAT_STORAGE_*` or token-auth keys through `VITE_*` or `EXPO_PUBLIC_*`; those values belong in Supabase Edge Function secrets and GitHub Actions secrets for the live probe.
- Do not log raw media refs, URLs, encryption keys, nonces, or decrypted bytes.
- Once runtime E2EE is enabled for a private encrypted surface, treat missing `encrypted_media` metadata as a hard validation failure.
- Profile Vibe Video captions use `vibe_video_uploads.captions`, `profile_vibe_videos.captions`, and `profiles.vibe_video_captions`; the short overlay remains `profiles.vibe_caption`.
