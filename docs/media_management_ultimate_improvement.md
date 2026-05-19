# Vibely — Media Architecture & UX (v8 canonical)

> **Status:** v8 is the single source of truth. Earlier "Tightenings" layers (v3–v7) have been folded into the normative text below. The version-history note at the bottom records what changed across revisions; it is non-normative.

---

## Context

Vibely's media stack today is a mix of "modern done right" (Vibe Video, Chat Vibe Clip — both Bunny Stream TUS direct, server-owned finalization, webhook + poll, short-TTL signed HLS) and "legacy patterns we tolerate" (profile photo, chat photo, voice note — bytes relayed through Supabase Edge Functions with no client compression, no idempotency receipts, no atomic uniqueness, and a `media_assets.status` that contradicts the schema's own comment). The user-reported "Chat Video does not work at all" is a runtime regression of the existing Chat Vibe Clip pipeline — not a missing pipeline. [docs/chat-video-vibe-clip-architecture.md](../docs/chat-video-vibe-clip-architecture.md) is the operative contract: Chat Vibe Clip is the canonical "new video" path; legacy generic chat video stays read-only.

This plan answers the two original questions:
- **(a) Best architecture** — Part A.
- **(b) Perfect UX** — Part B.

It then derives a staged implementation strategy and an exhaustive PR manifest.

### Constraints carried in
- Provider stack locked at Supabase + Bunny (workspace `.claude/CLAUDE.md` and repo [AGENTS.md](../AGENTS.md)).
- No migration of legacy rows; new schema is additive and nullable where needed.
- Bunny **Stream** is TUS-resumable; Bunny **Storage** stays HTTP `PUT` with the `Checksum` header.
- Web SW root owned by OneSignal; native lacks background-upload deps today — both are Phase-7 prerequisites.
- Disposable-pair smoke discipline applies to every production touchpoint.
- DB hardening migrations are forward-only; client behaviour is flag-revertable.

### Reliability targets
- Upload success per family ≥ 99 %.
- p50 time-to-ready ≤ 45 s; p95 ≤ 90 s for ≤ 30 s clips.
- Playback start failure ≤ 0.5 %.
- Signed-URL refresh failure ≤ 0.1 %.

### Live foundations the plan reuses intact
- `media_assets` / `media_references` / `media_retention_settings` / `media_delete_jobs` and worker RPCs (`enqueue_media_delete`, `release_media_reference`, `claim_media_delete_jobs`, `complete_media_delete_job`, `promote_purgeable_assets`) — [20260417100000_media_lifecycle_foundation.sql](../supabase/migrations/20260417100000_media_lifecycle_foundation.sql).
- `chat_vibe_clip_uploads` with `(sender_id, client_request_id)` idempotency — [20260518120000_chat_vibe_clip_bunny_stream.sql](../supabase/migrations/20260518120000_chat_vibe_clip_bunny_stream.sql).
- `chatVibeClipPayload v:3` and `bunny_stream:<uuid>` ref scheme — [chat-vibe-clips.ts](../supabase/functions/_shared/chat-vibe-clips.ts).
- `video-webhook` Bunny callback URL — **must not be renamed** (provider URL is registered).
- Vibe Video controllers [heroVideoUploadController.ts](../src/lib/heroVideo/heroVideoUploadController.ts) / [nativeHeroVideoUploadController.ts](../apps/mobile/lib/nativeHeroVideoUploadController.ts), the Hermes/Base64 guard in [vibeVideoApi.ts](../apps/mobile/lib/vibeVideoApi.ts), canonical state semantics in [vibeVideoSemantics.ts](../shared/vibeVideoSemantics.ts).
- `messages` is in `supabase_realtime` (since `20251218002545`, reaffirmed `20260218135136`) with match-participant RLS — peer state rides on it.
- `send-message` → `ensureMessageMediaOrRollback` → `syncChatMessageMedia` rollback path at [send-message:91-115](../supabase/functions/send-message/index.ts) — **must not be bypassed**.

---

## Part A — Architecture

### A.1 — Domain model (already live, extended by an upload-attempt layer + receipts)

```
┌────────────────────┐    ┌──────────────────┐
│ media_upload_      │    │ chat_vibe_clip_  │   (existing — TUS sessions)
│   receipts (new)   │    │   uploads        │
│ — Storage families │    │ vibe_video_      │
│                    │    │   uploads (new)  │   ← Phase 3
└───────┬────────────┘    └────────┬─────────┘
        │                          │
        │ 1..*                     │ 1..*
        ▼                          ▼
┌──────────────────────────────────────────────┐    *..1   ┌──────────────────────┐
│              media_assets                    │ ────────► │ media_retention_     │
│  (provider, media_family, content_sha256,    │           │   settings            │
│   status ∈ uploading|uploaded|active|        │           └──────────────────────┘
│            soft_deleted|purge_ready|         │
│            purging|purged|failed)            │
│  (+ new 'uploaded' status — A.11)            │
└─────────────────┬────────────────────────────┘
                  │ 1..*
                  ▼
┌──────────────────────────┐    enqueues   ┌────────────────────┐
│   media_references       │ ─────────────►│ media_delete_jobs  │
│  (polymorphic links;     │               │  (worker queue)    │
│   active-unique index    │               └────────────────────┘
│   per (asset_id, ref_*)) │
└──────────────────────────┘
```

The four shapes the plan formalises:
- **Upload-attempt rows** (`chat_vibe_clip_uploads`, new `vibe_video_uploads`): per-attempt state for TUS Stream families. Idempotent by `(user_id, client_request_id)`.
- **Upload receipts** (new `media_upload_receipts`): per-attempt ledger for Storage families. Stronger than the deterministic-path heuristic alone — survives MIME / extension changes under the same `client_request_id` and produces an explicit `409 conflict_request_reuse` server-side.
- **Physical assets** (`media_assets`): one row per Bunny object. Unique on `(provider, provider_object_id)` and `(provider, provider_path)`.
- **References** (`media_references`): polymorphic links from product entities to assets. Unique active reference per `(asset_id, ref_type, ref_table, ref_id, coalesce(ref_key,''))`.

### A.2 — Two transport tiers (do not unify)

| Family | Transport | Why |
|---|---|---|
| Vibe Video, Chat Vibe Clip | Bunny **Stream** TUS direct (5 MiB chunks) | Large, encoded media; resumable. Already implemented. |
| Profile Photo, Chat Photo, Event Cover | Edge Function `PUT` → Bunny **Storage**, with server-side SHA-256 verification | Small files after client resize. Bunny Storage has no public TUS today; HTTP `PUT` with `Checksum` header is the documented integrity path. |
| Voice Note | Same `PUT` path | Small files after capture-time mono AAC encoding. |

Rule: **TUS for large encoded media; `PUT` for small transcoded media**. Both tiers share the SDK, state machine, telemetry, and display layers; they diverge only at the wire.

### A.3 — Server-owned, idempotent finalization

The two-phase pattern Chat Vibe Clip already uses:
1. `create-*-upload` — auth + scope check + provider routing + signature + attempt row insert; idempotent by `(user_id, client_request_id)`.
2. Direct TUS to Bunny Stream.
3. `complete-*-upload` — idempotent finalization. Side effects: insert/update `messages` row (chat families), call `attach_media_reference()` RPC (A.11), advance attempt status.

For Storage families the same shape **with reserve-before-PUT** (A.11):
1. EF authenticates, validates scope, sniffs bytes, **computes SHA-256 server-side** (the authoritative hash).
2. EF calls `reserve_media_upload()` RPC — atomically inserts/looks up a `media_upload_receipts` row keyed by `(owner_user_id, media_family, scope_key, client_request_id)` and a paired `media_assets(status='uploading')` row keyed by `(provider, provider_path)`. Returns one of:
   - `already_uploaded` (hash + scope match) → EF returns the existing asset without touching Bunny.
   - `reserved` (new) → EF proceeds to PUT.
   - `conflict_request_reuse` (hash, MIME, or bytes differ for the same receipt) → EF returns `409` without touching Bunny.
3. EF PUTs to Bunny with `Checksum: <UPPERCASE_HEX_SHA256>` header (per [Bunny Storage HTTP](https://docs.bunny.net/storage/http)). Bunny verifies integrity.
4. EF promotes the asset `uploading → uploaded` and records `content_sha256`, `mime_type`, `bytes` on both `media_assets` and `media_upload_receipts`.
5. Reference attachment is **always** via `attach_media_reference()` RPC (A.11) — either inline (event cover) or downstream (`syncChatMessageMedia` for chat photo/voice).

Deterministic provider path template (scoped to prevent cross-context collisions):

```
${family-root}/${scope-segments}/${owner_user_id}/req-${hash_b32(client_request_id):16}.${ext}

profile_photo  → photos/{user_id}/slot-{slot}/req-J4K7H2P5N9Q1HXR3.jpg
chat_photo     → photos/match-{match_id}/{user_id}/req-J4K7H2P5N9Q1HXR3.jpg
event_cover    → events/{event_id}/req-J4K7H2P5N9Q1HXR3.jpg
voice_note     → voice/match-{match_id}/{user_id}/req-J4K7H2P5N9Q1HXR3.m4a
```

`client_request_id` policy: one ID = one local source for one scope. The SDK binds the ID to the local queue row alongside the file handle and the client-computed SHA-256 (used only for local binding; the server hash is authoritative). Choosing a different file regenerates the ID.

### A.4 — Webhook-first state, bounded poll fallback

`video-webhook` (keep this name) is the primary state-transition driver. It flips `*_uploads.status` to `ready` / `failed`, promotes `media_assets` to the next state, and updates the parent `messages` row for chat families (the `messages` UPDATE reaches peers via Realtime — see A.5). Bounded poll (5 s × 36) in the SDK is the safety net for sender state.

### A.5 — Realtime split (messages-only)

- **Peer state** rides on `messages` (already in `supabase_realtime`, match-participant RLS already enforced). `chat-vibe-clips.ts:289` `ensureChatVibeClipMessage` writes `messages.structured_payload.processing_status` on transition; the publication propagates it.
- **Sender state** is direct SELECT on the user's own `chat_vibe_clip_uploads` / `vibe_video_uploads` rows + bounded poll + manual `sync-*` nudge on app foreground / thread mount. The upload-attempt tables are **not** in `supabase_realtime` (sender-only RLS already permits the direct query; publication would force a match-participant RLS change on sensitive sender data).

These are the only two state channels.

### A.6 — Client Media SDK (`shared/media-sdk/`, path-imported)

The repo root is a Vite app with no `workspaces` field; promoting to a real npm workspace is out of scope. The SDK lives at `shared/media-sdk/` and is imported as `@clientShared/media-sdk` via the existing `@clientShared/*` alias in [tsconfig.json](../tsconfig.json) (`@clientShared/*` → `./shared/*`), [apps/mobile/tsconfig.json](../apps/mobile/tsconfig.json) (`@clientShared/*` → `../../shared/*`), and resolved by Metro at [apps/mobile/metro.config.js](../apps/mobile/metro.config.js). **No new alias, no bundler change.**

API:

```ts
mediaSdk.video.upload({ family: 'vibe_video' | 'chat_vibe_clip', source, context, options });
mediaSdk.photo.upload({ family: 'profile_photo' | 'chat_photo' | 'event_cover', source, context, options });
mediaSdk.voice.upload({ family: 'voice_note', source, context });
// Each returns { on(event, cb), pause(), resume(), cancel(), retry() }.
// States: 'created' | 'uploading' | 'processing' | 'ready' | 'failed' | 'cancelled'.
```

Adapters:
- **WebMediaAdapter** — `File` / `Blob`, IndexedDB queue (`vibely.upload-queue`) for crash recovery within session, canvas / WebCodecs for transcode.
- **NativeMediaAdapter** — `expo-file-system` URIs (preserving the [vibeVideoApi.ts:6-12](../apps/mobile/lib/vibeVideoApi.ts) Hermes/Base64 guard), `AsyncStorage` queue, `expo-image-manipulator` for photo resize, `expo-audio` for voice recording configuration. Repo deliberately excludes `expo-av`.

OS-level background is **Phase 7**, not part of the SDK's initial shape.

### A.7 — Display hook (`useMediaAsset`)

Replaces today's per-component URL fetching ([VibePlayer.tsx](../src/components/vibe-video/VibePlayer.tsx), [VibeClipBubble.tsx](../src/components/chat/VibeClipBubble.tsx), [chatMediaResolver.ts](../src/lib/chatMediaResolver.ts)). Responsibilities:
- Resolve URLs per **A.10 privacy posture** — chat families always go through `get-chat-media-url`; profile / event / discovery media use public CDN.
- For chat families: subscribe to Realtime on the parent `messages` row; read `structured_payload.processing_status` to flip `processing → ready`.
- For Vibe Video and sender-side recovery: bounded poll on the upload-attempt row.
- Refresh signed URL within 5 min of expiry.
- Cap concurrent buffering `<video>` elements at 4 on iOS (IntersectionObserver / onViewableItemsChanged).
- Fall back to legacy `messages.content` parsing only for historical rows (chat-media doc §2).

### A.8 — Feature-flag rollout

```sql
client_feature_flags (flag_key PK, enabled, rollout_bps 0..10000, description, updated_by, updated_at);
client_feature_flag_user_overrides (flag_key, user_id, enabled, reason);
evaluate_client_feature_flag(p_flag, p_user) → boolean  -- override → bps bucket → default false
```

`useFeatureFlag` hook backed by a 60 s in-memory TTL cache, refreshed on `visibilitychange` (web) / `AppState 'active'` (native). SDK consults the flag at upload-start and picks legacy vs new path. Default off; ramp by `rollout_bps`; kill switch via `enabled=false`. Propagation: ≤ 60 s for foregrounded clients; immediate on next foreground.

"No dual writes in data" means: forbidden to fork the upload path so the same media publishes twice. **Allowed**: writing legacy backend-compat mirror columns (e.g. `profiles.bunny_video_uid`) from the new Vibe Video path — single writes to compat columns are not parallel uploads.

### A.9 — Observability

Every state transition emits a PostHog event (`media_upload_*`, `media_playback_*`) tagged `family`, `provider`, `client_platform`, `client_request_id`, `bytes`, `duration_ms`, `retry_count`, `webhook_latency_ms`, `time_to_ready_ms`, `error_code`. Failed transitions attach Sentry breadcrumb chains. SLO dashboard alarms on the four reliability targets in Context.

### A.10 — Privacy posture (per-family contract)

| Family | URL surface | Mechanism | Rule |
|---|---|---|---|
| Chat photo / video / voice / Vibe Clip | Short-TTL signed URL (15 min default, HS256) | EF [get-chat-media-url](../supabase/functions/get-chat-media-url/index.ts) authenticates the caller, checks match participation, returns a Bunny-readable signed URL (Stream uses `bcdn_token` directory-token; Storage uses an HMAC token). Bytes do **not** proxy through the EF; the URL itself is the auth gate. | **Forbidden to regress to public.** |
| Profile photo | Public Bunny Storage CDN | Unguessable per-user-per-slot path (`req-{hash16}`). Accepted tradeoff after the `20251229004756 → 20260217070547` oscillation; revisit in Phase 8 if abuse signals emerge. | Public, with mitigation. |
| Event cover | Public Bunny Storage CDN | Discovery-facing; public is intended. | Public. |
| Vibe Video | Public Bunny Stream CDN | Discovery-facing; public is intended. | Public. Phase 8 may sign for private-mode profiles. |

This table is canonical. Any new family or posture change must update this table in the same PR.

### A.11 — Atomic idempotency: receipts, uniqueness, and reference attachment

Three coordinated DB changes (one migration in Phase 5):

**A.11.1 — `media_upload_receipts` (new table)**

```sql
CREATE TABLE public.media_upload_receipts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  media_family        text NOT NULL REFERENCES public.media_retention_settings(media_family),
  scope_key           text NOT NULL,                  -- 'match:<uuid>' | 'event:<uuid>' | 'slot:<n>' | 'global'
  client_request_id   uuid NOT NULL,
  provider            text NOT NULL,
  provider_path       text,
  media_asset_id      uuid REFERENCES public.media_assets(id) ON DELETE SET NULL,
  content_sha256      text,                            -- uppercase hex; nullable until PUT verified
  mime_type           text,
  bytes               bigint,
  status              text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved','uploaded','active','failed','superseded')),
  error_detail        text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  UNIQUE (owner_user_id, media_family, scope_key, client_request_id)
);
```

Plus a `reserve_media_upload(...)` SECURITY DEFINER RPC that performs the atomic reserve-or-return-existing-or-conflict logic inside one transaction.

**A.11.2 — Atomic `media_assets` uniqueness**

```sql
DROP INDEX idx_ma_provider_object;
CREATE UNIQUE INDEX idx_ma_provider_object_uniq
  ON public.media_assets (provider, provider_object_id)
  WHERE provider_object_id IS NOT NULL;

DROP INDEX idx_ma_provider_path;
CREATE UNIQUE INDEX idx_ma_provider_path_uniq
  ON public.media_assets (provider, provider_path)
  WHERE provider_path IS NOT NULL;

ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS content_sha256 text;

ALTER TABLE public.media_assets
  DROP CONSTRAINT ma_status_check_v0,  -- name TBD; replace whatever CHECK ships today
  ADD CONSTRAINT ma_status_check_v1 CHECK (status IN (
    'uploading','uploaded','active','soft_deleted','purge_ready','purging','purged','failed'
  ));
```

Pre-migration dedupe pass: identify any duplicate `(provider, provider_object_id)` / `(provider, provider_path)` rows; delete later duplicates by `created_at`; **fail loud** if a genuine semantic duplicate exists (per the project's "no silent removals" rule). A `registerMediaAsset` rewrite uses an explicit `INSERT … ON CONFLICT (...) WHERE ...` SQL RPC (not Supabase JS `.upsert()`, which does not target partial indexes reliably).

**A.11.3 — `attach_media_reference()` RPC**

```sql
CREATE UNIQUE INDEX idx_mref_active_unique
  ON public.media_references (asset_id, ref_type, ref_table, ref_id, COALESCE(ref_key, ''))
  WHERE is_active = true;
```

Plus an RPC `attach_media_reference(p_asset_id, p_ref_type, p_ref_table, p_ref_id, p_ref_key)` that:
1. INSERTs (or reactivates) the reference idempotently.
2. Promotes `media_assets.status` from `uploaded → active` in the same transaction.
3. Returns `{success, reference_id, asset_status, created}`.

All paths that create media references — `syncChatMessageMedia`, `upload-event-cover`, `publish_photo_set`, every other reference writer — call this RPC instead of inserting directly.

### A.12 — `media_assets.status` lifecycle (corrected)

The schema today defines `'active' = "at least one active reference exists"`. v8 adds `'uploaded'` meaning "physically present at provider, awaiting first reference":

| Family | After PUT/TUS complete | After first reference | After last reference released |
|---|---|---|---|
| Profile photo | `uploaded` (EF) | `active` (via `publish_photo_set` → `attach_media_reference`) | `soft_deleted` |
| Chat photo | `uploaded` (EF) | `active` (via `syncChatMessageMedia` → `attach_media_reference`) | `soft_deleted` |
| Voice note | `uploaded` (EF) | `active` (via `syncChatMessageMedia` → `attach_media_reference`) | `soft_deleted` |
| Event cover | `uploaded` then `active` (same EF, single transaction via `attach_media_reference`) | `active` | `soft_deleted` |
| Chat Vibe Clip | `uploading → processing → ready/active` (existing) | `active` | `soft_deleted` |
| Vibe Video | `uploading → processing → ready/active` (existing) | `active` | `soft_deleted` |

### A.13 — Event-cover stale-overwrite guard

`upload-event-cover` accepts an optional `expected_current_cover_asset_id` (or revision token). The EF locks the event row, compares the current cover, and if the client is stale returns `409 stale_cover_update` **before** releasing any existing reference. The new cover only replaces the old when the caller has read-after-write of the previous cover. Pure retries (same `client_request_id`) produce zero net `media_references` deltas via the unique active-reference index.

### A.14 — Orphan cleanup for unreferenced `uploaded` assets

Extends the existing `media-lifecycle-worker` with a new pass:
- Chat photo / voice / event cover: enqueue purge for any `media_assets.status = 'uploaded'` with zero active references after 24 h.
- Profile photo drafts: enqueue purge after 7 d if not linked to an active `draft_media_sessions` row.
- All purges flow through the existing `media_delete_jobs` queue.

Without this, the new `uploaded` state could accumulate forever under the `retain_until_eligible` chat-media retention policy.

---

## Part B — Perfect UX

### B.1 — Universal UX laws

1. **Optimistic-first.** Local file plays/displays the instant the user confirms. CDN URL swaps in on `ready`.
2. **Never block the surrounding flow.** A pending upload does not block sending text, reactions, or other media.
3. **Always reachable retry.** Failed uploads surface in-place retry in the same surface (bubble, card, tile). No buried dialogs.
4. **State visible, never silent.** `Uploading n %` → `Processing` → `Live`, per family.
5. **Recoverable across navigation.** Module-level singleton (web) / generation-counter (native) patterns. SDK generalises.
6. **Pre-warmed playback, resource-aware.** Pre-fetch next 3 visible items subject to: skip when `navigator.connection.saveData` or `effectiveType ∈ {'slow-2g','2g'}`; skip when `battery.level < 0.20` and not charging (where API available); ≤ 10 MB per-session cap; pause + `preload="none"` on `<video>` after 2 s offscreen.
7. **Adaptive quality.** HLS adaptive bitrate. iOS Safari native HLS; everything else hls.js.
8. **Self-healing signed URLs.** Refresh proactively at 5 min from expiry; mid-playback expiry triggers seamless re-fetch.

### B.2 — Per-family UX rules

| Family | Send-time UX | Failure UX | Pre-warm |
|---|---|---|---|
| Vibe Video | Local poster + "Processing 0–100 %" overlay on profile card. Survives navigation. | In-card retry; never deletes Bunny videoId (preserves Vibe Score credit per [vibe_video_backend_contract_repair.sql](../supabase/migrations/20260501123000_vibe_video_backend_contract_repair.sql)). | Prefetched HLS manifest for own + match profiles. |
| Chat Vibe Clip | Bubble appears immediately, plays local URI, in-bubble progress, state chip `Uploading → Processing → Live`. Thread unblocked. | In-bubble retry; tap to remove. Optimistic message reconciled with server `messages` row on `ready`; rollback path resurfaces in-bubble retry. | Next 3 visible clips. |
| Chat Photo | Lightbox-ready local preview; background upload swaps `src` on `ready`. EXIF stripped client-side. | In-bubble retry. | Next 3 visible photos. |
| Profile Photo | Drag-reorder uses local URI; commit on `publish_photo_set` RPC. | Tile retry pill; blocks save until resolved. | Avatar pre-resolved on match-list render. |
| Voice Note | Waveform from local buffer; playable immediately. | Bubble retry. | Voice URL pre-resolved on thread mount. |
| Event Cover | Cover card swaps from local URI to CDN on `ready`. | Banner retry in editor. | Event detail prefetches cover at swipe-deck render. |

### B.3 — Stuck-upload recovery loop (Chat Vibe Clip)

The "Chat Video does not work at all" symptom maps to three states the current UI fails to surface:
1. App killed mid-TUS — row stuck `uploading` past `expires_at`, no recovery CTA.
2. Webhook missed — row stuck `processing`, no poll fallback firing.
3. `complete-chat-vibe-clip-upload` raced — message row never created or stuck.

On app launch and chat thread mount, the SDK queries the user's own `chat_vibe_clip_uploads` rows in `uploading|processing` older than 60 s and, for each:
1. Call `sync-chat-vibe-clip-status` to nudge.
2. Consult the SDK's **local queue** for that `client_request_id`. If no usable local source handle → "Discard + send again" and stop.
3. If `expires_at > now()` → "Resume upload"; resume TUS at last byte offset against existing `provider_object_id`.
4. If `expires_at ≤ now()` → call `create-chat-vibe-clip-upload` with the same `client_request_id` (idempotent; returns same `provider_object_id` with fresh credentials). Resume at last offset, or from byte 0 if Bunny GC'd the partial. If the EF refuses to reissue → "Discard + send again".

Plus: on webhook miss > 60 s after TUS complete → auto-trigger poll. On `complete-*-upload` race → re-issue `complete-*-upload` with same `client_request_id` (idempotent).

### B.4 — Resumability & durability tiers

| Tier | Capability | Phase |
|---|---|---|
| Same session | Survives navigation, modal close, screen unmount | Today (Vibe Video); generalised in Phase 3. |
| App restart (foreground) | Persistent queue (IndexedDB / AsyncStorage) reconnects on app start | Phase 4. |
| App close / device sleep | OS-scheduled background completion (best-effort) | **Phase 7** (spike), prerequisites apply. |

---

## Implementation strategy (summary)

| Phase | Theme | Weeks | Flag |
|---|---|---|---|
| 1 | Stabilise Chat Vibe Clip (instrument → repro → fix → UX) | 1 | none |
| 2 | Feature-flag mechanism | 1 (parallel) | self-bootstrap |
| 3 | `vibe_video_uploads` + SDK scaffolding | 2–3 | `media_v2_video` off |
| 4 | Cut video callers to SDK; ramp `media_v2_video` | 3–4 | `media_v2_video` ramp |
| 5 | Photo/voice client transcode + EF idempotency + receipts + uniqueness + `uploaded` + `attach_media_reference` | 4–5 | `media_v2_photo` / `media_v2_voice` |
| 6 | `useMediaAsset` display unification | 5–6 | `media_v2_video` (continuation) |
| 7 | OS-level background uploads (research spike) | later | n/a |
| 8 | Optional follow-ons (Bunny presign, Vibe Video signing, etc.) | later | n/a |

---

## PR Manifest

Every PR below is independently revertable. Branch names are illustrative. Each phase's PRs may run in parallel except where ordering is called out.

### Phase 1 — Stabilise Chat Vibe Clip (Week 1)

| PR | Branch | Scope | Exit |
|---|---|---|---|
| 1.1.a | `feat/cvc-p1-logs-create-complete` | Structured `client_request_id`+`provider_object_id` logs in [create-chat-vibe-clip-upload](../supabase/functions/create-chat-vibe-clip-upload/index.ts) and [complete-chat-vibe-clip-upload](../supabase/functions/complete-chat-vibe-clip-upload/index.ts). Zero behaviour change. | Logs visible in Supabase Functions dashboard within 5 min of deploy. |
| 1.1.b | `feat/cvc-p1-logs-sync-webhook` | Structured logs in [sync-chat-vibe-clip-status](../supabase/functions/sync-chat-vibe-clip-status/index.ts) and [video-webhook](../supabase/functions/video-webhook/index.ts). Sentry transaction tracing on the webhook handler. | Webhook spans visible in Sentry. |
| 1.1.c | `feat/cvc-p1-logs-shared` | Structured logs in `chat-vibe-clips.ts` (`ensureChatVibeClipMessage`, retention-reference helpers). | Logs visible. |
| 1.2 | `test/cvc-p1-smoke-matrix` | Playwright smoke (web) + Detox/Maestro smoke (iOS, Android) for Chat Vibe Clip happy path + 4G throttle + kill-mid-TUS + webhook-delayed cases. Runs in CI per PR; nightly against staging. | All matrix rows green on staging. |
| 1.3 | `fix/cvc-p1-targeted-server-fix` | Targeted server-side fix for whichever of the 5 suspects (TUS failure / complete race / webhook miss / signed URL / UI hydration) the smoke + logs reveal. **Scope is intentionally TBD until P1.1 + P1.2 land.** | 7-day rolling Chat Vibe Clip success ≥ 99 %. |
| 1.4.a | `feat/cvc-p1-recovery-ui-web` | Web stuck-upload recovery loop in [VibeClipBubble.tsx](../src/components/chat/VibeClipBubble.tsx) per B.3. "Resume upload" vs "Discard + send again" based on local-queue truth. Auto-nudge `sync-chat-vibe-clip-status` on mount. | Smoke matrix row "Stuck `processing` row on app launch — auto-nudged within 5 s" passes on web. |
| 1.4.b | `feat/cvc-p1-recovery-ui-native` | Native parallel — same recovery loop in the native equivalent component. | Same matrix row passes on iOS + Android. |

### Phase 2 — Feature flags (Week 1, parallel)

| PR | Branch | Scope | Exit |
|---|---|---|---|
| 2.1 | `feat/flags-schema` | Migration `<ts>_client_feature_flags.sql` — `client_feature_flags`, `client_feature_flag_user_overrides`, `evaluate_client_feature_flag` RPC. Seed `media_v2_video`, `media_v2_photo`, `media_v2_voice` with `enabled=false, rollout_bps=0`. | Migration applied; RPC callable from authenticated. |
| 2.2 | `feat/flags-hook-web` | `useFeatureFlag` hook (web) with 60 s TTL + `visibilitychange` refresh. | Returns correct values for seeded test users; flip propagates within 60 s. |
| 2.3 | `feat/flags-hook-native` | Same hook (native) with `AppState 'active'` refresh. | Same exit on iOS + Android. |

### Phase 3 — `vibe_video_uploads` + SDK scaffolding (Weeks 2–3)

| PR | Branch | Scope | Exit |
|---|---|---|---|
| 3.1 | `feat/vibe-video-uploads-table` | Migration `<ts>_vibe_video_uploads.sql` — table modelled on `chat_vibe_clip_uploads` (same RLS, indexes, trigger; add `superseded` status). | Migration applied; sender-only RLS verified. |
| 3.2.a | `feat/vibe-video-uploads-create-sync` | Extend [create-video-upload](../supabase/functions/create-video-upload/index.ts) and [sync-vibe-video-status](../supabase/functions/sync-vibe-video-status/index.ts) to dual-write `vibe_video_uploads`. Legacy `profiles.bunny_video_uid` writes continue. | Every new Vibe Video upload materialises a row. |
| 3.2.b | `feat/vibe-video-uploads-delete-webhook` | Extend [delete-vibe-video](../supabase/functions/delete-vibe-video/index.ts) to mark `superseded`/`failed`; extend [video-webhook](../supabase/functions/video-webhook/index.ts) to update the new table alongside its existing chat-vibe-clip + profile updates. | Webhook updates both attempt tables atomically. |
| 3.3 | `feat/media-sdk-scaffold` | Create `shared/media-sdk/` with `core/state-machine.ts`, `core/queue.ts` (interface), `core/telemetry.ts`, `core/flag-gate.ts`. API surface from A.6. Unit tests for the state machine. | `npm run test -- media-sdk` green. |
| 3.4.a | `feat/media-sdk-adapter-web` | `adapters/web.ts` — File/Blob, IndexedDB queue impl, canvas/WebCodecs hooks (stubs for Phase 5). Delegates to existing controllers initially. | SDK can drive a Vibe Video upload end-to-end in a unit harness. |
| 3.4.b | `feat/media-sdk-adapter-native` | `adapters/native.ts` — `expo-file-system` URIs + Hermes/Base64 guard, AsyncStorage queue, `expo-image-manipulator` / `expo-audio` hooks. Delegates to existing controllers initially. | Same exit on native. |
| 3.5 | `feat/media-sdk-telemetry` | SDK-level PostHog + Sentry plumbing per A.9. | All state transitions emit events in dev console. |

### Phase 4 — Cut video callers to SDK behind `media_v2_video` (Weeks 3–4)

| PR | Branch | Scope | Exit |
|---|---|---|---|
| 4.1 | `feat/sdk-cut-vibe-video-web` | Web Vibe Video callers ([VibeVideoStep.tsx](../src/pages/onboarding/steps/VibeVideoStep.tsx), `VibeStudioModal.tsx`) call `mediaSdk.video.upload({ family: 'vibe_video' })` when `media_v2_video` is on. | Behaviour identical to legacy in shadow. |
| 4.2 | `feat/sdk-cut-vibe-video-native` | Native Vibe Video callers ([vibe-video-record.tsx](../apps/mobile/app/vibe-video-record.tsx), [vibe-studio.tsx](../apps/mobile/app/vibe-studio.tsx)) same. | Same. |
| 4.3 | `feat/sdk-cut-chat-vibe-clip-web` | Web Chat Vibe Clip composer calls `mediaSdk.video.upload({ family: 'chat_vibe_clip' })`. | Same. |
| 4.4 | `feat/sdk-cut-chat-vibe-clip-native` | Native Chat Vibe Clip composer same. | Same. |
| 4.5 | `ops/flag-media-v2-video-10` | Flag flip to 10 % rollout (operations). | 24 h matches legacy SLOs. |
| 4.6 | `ops/flag-media-v2-video-50-100` | Ramp 50 % → 100 %. | SLOs hold throughout; kill switch armed. |

### Phase 5 — Photo/voice transcode + atomic idempotency (Weeks 4–5)

Ordering matters within this phase. Migrations land first; helpers and EFs next; client transcode last; then ramp.

| PR | Branch | Scope | Exit |
|---|---|---|---|
| 5.1 | `feat/media-assets-atomic-idempotency` | Migration `<ts>_media_assets_atomic_idempotency.sql` — adds `content_sha256` column, extends status CHECK with `'uploaded'`, dedupe pass on duplicates, drops/replaces partial indexes as **unique** partial indexes on `(provider, provider_object_id)` and `(provider, provider_path)`. Fails loud on semantic duplicates per "no silent removals". | Migration applied; uniqueness verified via test inserts. |
| 5.2 | `feat/media-upload-receipts` | Migration `<ts>_media_upload_receipts.sql` — `media_upload_receipts` table per A.11.1, plus `reserve_media_upload()` SECURITY DEFINER RPC that performs the atomic reserve-or-return-or-conflict logic. | Migration applied; RPC unit tests pass for all four return states. |
| 5.3 | `feat/attach-media-reference-rpc` | Migration `<ts>_attach_media_reference.sql` — unique active-reference partial index on `media_references` per A.11.3, plus `attach_media_reference()` RPC. Updates `syncChatMessageMedia` ([media-lifecycle.ts:229](../supabase/functions/_shared/media-lifecycle.ts)) to call it. | Reference inserts go through the RPC; `uploaded → active` promotion observable. |
| 5.4 | `refactor/register-media-asset-onconflict` | Rewrite [registerMediaAsset](../supabase/functions/_shared/media-lifecycle.ts) to call a new SQL RPC `upsert_media_asset(provider, provider_object_id, provider_path, ...)` that uses explicit `INSERT … ON CONFLICT (...) WHERE ...` against the new unique partial indexes. **Not** Supabase JS `.upsert()`. Concurrent-EF race test added. | Concurrent-EF race test produces exactly one row. |
| 5.5 | `feat/upload-image-idempotent` | Update [upload-image](../supabase/functions/upload-image/index.ts) — accept `client_request_id` + optional client `content_sha256`, compute authoritative SHA-256 server-side, call `reserve_media_upload`, PUT with `Checksum:` header, register as `'uploaded'`. Return `409 conflict_request_reuse` on hash mismatch. Response now includes `asset_id`, `provider_path`, `content_sha256`, `status`. | Smoke: same ID + same bytes returns same asset; same ID + different bytes returns 409. |
| 5.6 | `feat/upload-voice-idempotent` | Same shape applied to [upload-voice](../supabase/functions/upload-voice/index.ts). | Same exits. |
| 5.7 | `feat/upload-event-cover-idempotent` | Same shape applied to [upload-event-cover](../supabase/functions/upload-event-cover/index.ts), plus A.13 stale-overwrite guard: accept `expected_current_cover_asset_id`, lock event row, return `409 stale_cover_update` on stale; call `attach_media_reference` inline. | Smoke: A then B with stale A finishing last does not replace B. |
| 5.8 | `feat/sync-chat-message-media-attach` | Update [syncChatMessageMedia](../supabase/functions/_shared/media-lifecycle.ts) and any other reference writer to call `attach_media_reference` instead of inserting into `media_references` directly. Preserves the `send-message` rollback contract verbatim. | Invariant: no message with chat-photo/voice content lacks an active reference. |
| 5.9 | `feat/sdk-photo-transcode-web` | Web `mediaSdk.photo` adds canvas / WebCodecs resize to max-edge 2048 px, EXIF strip, JPEG q85 (HEIC → JPEG via heic2any fallback when needed). | Photo upload bytes drop ≥ 60 % at p50. |
| 5.10 | `feat/sdk-photo-transcode-native` | Native `mediaSdk.photo` adds `expo-image-manipulator` resize/EXIF/encode. HEIC → JPEG on iOS. | Same exit on native. |
| 5.11 | `feat/sdk-voice-record-web` | Web `mediaSdk.voice` uses `MediaRecorder` with `audioBitsPerSecond ≈ 96000` and device-best codec at capture time. No post-capture transcode. | Voice file size budget met. |
| 5.12 | `feat/sdk-voice-record-native` | Native `mediaSdk.voice` uses `expo-audio` recording configuration to capture mono AAC/M4A at ~96 kbps. No `expo-av`. | Same exit. |
| 5.13 | `feat/sdk-cut-photo-voice-callers` | Switch [imageUploadService](../src/services/imageUploadService.ts), [uploadImage](../apps/mobile/lib/uploadImage.ts), [chatMediaUpload](../apps/mobile/lib/chatMediaUpload.ts), [photoBatchController](../apps/mobile/lib/photoBatchController.ts) to `mediaSdk.photo` / `mediaSdk.voice` behind flags. | Shadow against legacy 24 h matches SLOs. |
| 5.14 | `feat/orphan-cleanup-uploaded` | Extend `media-lifecycle-worker` with the A.14 pass — 24 h orphan purge for chat photo / voice / event cover with status `uploaded` and zero active references; 7 d for profile photo drafts. | Smoke: an abandoned `uploaded` row is purged via `media_delete_jobs` within 25 h. |
| 5.15 | `ops/flag-media-v2-photo-voice-ramp` | Flag flip — `media_v2_photo` then `media_v2_voice`, 10 → 50 → 100 %. | SLOs hold; EF 413 rate ≤ 0.05 %. |

### Phase 6 — Display unification via `useMediaAsset` (Weeks 5–6)

| PR | Branch | Scope | Exit |
|---|---|---|---|
| 6.1 | `feat/use-media-asset-hook-web` | `useMediaAsset` hook lives in `src/hooks/`. Resolves URL per A.10 (chat → `get-chat-media-url`; public families → CDN), subscribes to `messages` Realtime for chat families, polls `*_uploads` for sender state, refreshes signed URL near expiry, caps concurrent buffering on iOS. | Unit tests cover all four resolution paths. |
| 6.2 | `feat/use-media-asset-hook-native` | Same on native. | Same. |
| 6.3 | `refactor/vibe-player-onto-hook` | [VibePlayer.tsx](../src/components/vibe-video/VibePlayer.tsx) refactored onto `useMediaAsset`. HLS-attach, IntersectionObserver, signed-URL refresh move into the hook. | Visual + perf parity. |
| 6.4 | `refactor/vibe-clip-bubble-onto-hook` | [VibeClipBubble.tsx](../src/components/chat/VibeClipBubble.tsx) refactored. | Parity. |
| 6.5 | `refactor/native-vibe-video-player-onto-hook` | [VibeVideoPlayer.tsx](../apps/mobile/components/video/VibeVideoPlayer.tsx) refactored. | Parity. |
| 6.6 | `chore/retire-chat-media-resolver` | After ramp, retire [chatMediaResolver.ts](../src/lib/chatMediaResolver.ts) and per-component fetchers. | Codebase has one resolver. |

### Phase 7 — OS-level background uploads (research spike)

| PR | Branch | Scope | Exit |
|---|---|---|---|
| 7.1 | `spike/web-bg-uploads` | Prototype-only path: non-root SW under `/media/` + Background Sync evaluation. Probe scope-control limits with OneSignal root SW present. | **NO-GO research-only** until browser matrix + measured floors in [media-background-upload-phase7-decision.md](./media-background-upload-phase7-decision.md) pass. |
| 7.2 | `spike/native-bg-uploads` | Prototype-only path: native iOS URLSession/BGProcessing and Android `WorkManager` / foreground-service evaluation. Requires native rebuild + store binary. | **NO-GO research-only** until real-device matrix + measured floors in [media-background-upload-phase7-decision.md](./media-background-upload-phase7-decision.md) pass. |
| 7.3 | `decision/bg-uploads-go-no-go` | Decision document; defines product gate if go. | Phase 7 closed as **NO-GO research-only**; foreground persistent queue remains production source of truth. |

### Phase 8 — Optional follow-ons (code-complete)

| PR | Branch | Scope | Exit |
|---|---|---|---|
| 8.1 | `explore/bunny-storage-presign` | Investigate any Bunny Storage direct-upload presign mechanism. If available, prototype retiring EF `PUT` for photos / voice. | Closed: no documented Storage presign; keep EF-mediated uploads. See [media-phase8-closure.md](./media-phase8-closure.md). |
| 8.2 | `feat/vibe-video-signed-urls` | If product wants private-mode profiles, route Vibe Video playback through `get-chat-media-url`-equivalent signing. | Closed: private/non-discoverable profile Vibe Videos resolve through signed HLS refs. Bunny token auth remains an ops prerequisite. |
| 8.3 | `feat/chat-image-structured-payload` | New forward-compatible structured chat-image marker on `messages` (alongside existing `content` text marker for legacy rendering). No retro-fit. | Closed: new sends write structured payload and renderers prefer it with legacy fallback. |

---

## Critical files

### Reuse unchanged
- [supabase/migrations/20260417100000_media_lifecycle_foundation.sql](../supabase/migrations/20260417100000_media_lifecycle_foundation.sql)
- [supabase/migrations/20260518120000_chat_vibe_clip_bunny_stream.sql](../supabase/migrations/20260518120000_chat_vibe_clip_bunny_stream.sql)
- [supabase/migrations/20260501123000_vibe_video_backend_contract_repair.sql](../supabase/migrations/20260501123000_vibe_video_backend_contract_repair.sql)
- [supabase/functions/_shared/chat-vibe-clips.ts](../supabase/functions/_shared/chat-vibe-clips.ts)
- [supabase/functions/_shared/bunny-stream-webhook.ts](../supabase/functions/_shared/bunny-stream-webhook.ts)
- [supabase/functions/_shared/bunny-media.ts](../supabase/functions/_shared/bunny-media.ts)
- [supabase/functions/_shared/media-upload-sniffing.ts](../supabase/functions/_shared/media-upload-sniffing.ts)
- [docs/chat-video-vibe-clip-architecture.md](../docs/chat-video-vibe-clip-architecture.md)
- [shared/vibeVideoSemantics.ts](../shared/vibeVideoSemantics.ts)
- [apps/mobile/lib/vibeVideoApi.ts](../apps/mobile/lib/vibeVideoApi.ts) — Hermes/Base64 guard

### Modify in place (additive, flag-gated where applicable)
- All five Chat Vibe Clip EFs + `chat-vibe-clips.ts` — structured logs (P1.1).
- [create-video-upload](../supabase/functions/create-video-upload/index.ts), [sync-vibe-video-status](../supabase/functions/sync-vibe-video-status/index.ts), [delete-vibe-video](../supabase/functions/delete-vibe-video/index.ts), [video-webhook](../supabase/functions/video-webhook/index.ts) — dual-write `vibe_video_uploads` (P3).
- [upload-image](../supabase/functions/upload-image/index.ts), [upload-voice](../supabase/functions/upload-voice/index.ts), [upload-event-cover](../supabase/functions/upload-event-cover/index.ts) — receipts, server-side SHA-256, deterministic paths, `'uploaded'` status, `attach_media_reference` (P5).
- [media-lifecycle.ts](../supabase/functions/_shared/media-lifecycle.ts) — `registerMediaAsset` → SQL `ON CONFLICT` RPC; `syncChatMessageMedia` → `attach_media_reference` (P5).
- [get-chat-media-url](../supabase/functions/get-chat-media-url/index.ts) — unchanged in posture; minor extension to resolve Vibe Video signed URLs in P8 if pursued.
- [VibePlayer.tsx](../src/components/vibe-video/VibePlayer.tsx), [VibeClipBubble.tsx](../src/components/chat/VibeClipBubble.tsx), [VibeVideoPlayer.tsx](../apps/mobile/components/video/VibeVideoPlayer.tsx) — refactor onto `useMediaAsset` (P6).
- All five client uploaders ([heroVideoUploadController.ts](../src/lib/heroVideo/heroVideoUploadController.ts), [nativeHeroVideoUploadController.ts](../apps/mobile/lib/nativeHeroVideoUploadController.ts), [chatVibeClipStreamUploadService.ts](../src/services/chatVibeClipStreamUploadService.ts), [chatVibeClipStreamUpload.ts](../apps/mobile/lib/chatVibeClipStreamUpload.ts), [photoBatchController.ts](../apps/mobile/lib/photoBatchController.ts)) — wrapped by SDK then absorbed.

### Add new
- `supabase/migrations/<ts>_client_feature_flags.sql` (P2.1).
- `supabase/migrations/<ts>_vibe_video_uploads.sql` (P3.1).
- `supabase/migrations/<ts>_media_assets_atomic_idempotency.sql` (P5.1).
- `supabase/migrations/<ts>_media_upload_receipts.sql` (P5.2).
- `supabase/migrations/<ts>_attach_media_reference.sql` (P5.3).
- `shared/media-sdk/` — TS module, path-imported as `@clientShared/media-sdk` via the existing alias (P3.3 onward).
- `docs/architecture/media.md` — ADR linked from [AGENTS.md](../AGENTS.md) (and workspace `.claude/CLAUDE.md` when refreshed).

### Explicitly NOT changed
- Legacy chat video renderer paths and historical rows (chat-media doc §2).
- `media_assets` / `media_references` / `media_retention_settings` / `media_delete_jobs` core schema (only additive columns + index promotions).
- `chat_vibe_clip_uploads` schema.
- Bunny webhook URL / route name (`video-webhook`).
- Bunny Storage transport (stays HTTP `PUT`).
- Legacy `messages.content` image markers (no backfill).

---

## Verification

### Phase-1 reproduce-and-fix gate (must hold green before any consolidation PR)

| Step | Web | iOS | Android |
|---|:-:|:-:|:-:|
| Record 5 s clip, send in chat, peer plays | ✓ | ✓ | ✓ |
| Same with 4G throttling (1 Mbps) | ✓ | ✓ | ✓ |
| Kill app mid-TUS, reopen, "Resume upload" / "Discard + send again" per local-truth | n/a | ✓ | ✓ |
| Webhook delayed 60 s — poll fallback delivers `ready` | ✓ | ✓ | ✓ |
| Signed URL expires mid-playback — seamless refresh | ✓ | ✓ | ✓ |
| Stuck `processing` row on app launch — auto-nudged to terminal within 5 s | ✓ | ✓ | ✓ |

### Per-phase exit criteria

- **P1.1 (logs)**: structured logs visible in Supabase Functions dashboard within 5 min of deploy.
- **P1.2 (smoke)**: failure mode classified to one of the five suspects.
- **P1.3 (fix)**: smoke turns green; no behavioural change on happy path.
- **P1.4 (UX)**: stuck-upload CTA appears within 60 s of staleness; CTA toggles correctly based on local source availability.
- **P1 exit**: 7-day rolling Chat Vibe Clip success ≥ 99 %, p95 time-to-ready ≤ 90 s, zero open P0/P1 Sentry against `chat_vibe_clip`.
- **P2**: `useFeatureFlag` returns correct values; flip propagates within 60 s on foregrounded clients.
- **P3**: every new Vibe Video upload materialises a `vibe_video_uploads` row; legacy `profiles.bunny_video_uid` write still happens.
- **P4**: 10 % rollout matches legacy SLOs over 24 h; ramp to 50 → 100 %. Kill switch on breach.
- **P5**: concurrent-EF race produces exactly one `media_assets` row; same `client_request_id` + different SHA-256 returns `409`; `attach_media_reference` short-circuits on duplicate; photo bytes ↓ ≥ 60 % at p50; EF 413 rate ≤ 0.05 %.
- **P6**: playback start failure ≤ 0.5 % under unified hook.
- **P7 (spike acceptance)**: documented decision per prototype + measured success-rate floor + go/no-go.

### Test suite

- `npm run test -- media-sdk` — state-machine fuzzer, idempotency tests (same ID + same hash; same ID + different hash; different ID + same hash), queue reconciliation, concurrent-EF race simulation.
- Extend `npm run test:media-upload-sniffing` with: `409 conflict_request_reuse` on SHA-256 mismatch; cross-scope-collision case; **concurrent-EF race** producing exactly one row; A.13 stale-cover guard returning `409 stale_cover_update`.
- Extend `npm run test:chat-media-cache` with reference-idempotency case (retry → 0 net deltas; cover swap → 1 release + 1 insert).
- New `npm run test -- media-lifecycle` — `uploaded → active` promotion via `attach_media_reference`; assert no `media_references` ever points at a `uploading` asset.
- New `npm run test -- media-receipts` — `reserve_media_upload` returns the four states correctly under concurrency; receipt expiry triggers re-reservation.
- Playwright e2e covering Chat Vibe Clip + Vibe Video flows.
- Detox / Maestro covering same on iOS + Android.
- `supabase test db` invariants:
  - No `vibe_video_uploads.ready` without a `media_assets` row.
  - No orphan `media_references`.
  - No `chat_vibe_clip_uploads.published_message_id` pointing at a missing message.
  - No `messages` row with chat-photo/voice content lacking an active reference (the `send-message` rollback invariant holds in steady state).
  - No `media_references` pointing at an asset in `uploading`.
  - No duplicate `media_assets` rows for the same `(provider, provider_path)` / `(provider, provider_object_id)` — enforced by the unique partial indexes.
  - No `media_assets.status = 'uploaded'` older than the A.14 thresholds without an active `media_delete_jobs` row.

### Production smoke (disposable-pair discipline)

Per workspace `.claude/CLAUDE.md` + repo [AGENTS.md](../AGENTS.md). Fresh `media-rebuild-smoke-YYYYMMDD-<ts>` pair exercises every family with real RPCs + bearer token. Read-only verification of receipts / assets / references integrity. Tag-scoped cleanup proves zero residuals.

### Rollback plan

- All new client paths sit behind `media_v2_video` / `media_v2_photo` / `media_v2_voice`. Flip `enabled=false` → legacy uploaders restored within one session.
- DB migrations are forward-only and additive — no schema rollback needed; the legacy code path simply ignores new tables/columns.
- New tables (`client_feature_flags`, `client_feature_flag_user_overrides`, `vibe_video_uploads`, `media_upload_receipts`) are additive; leaving them populated after rollback is harmless.
- Bunny webhook URL unchanged → no provider rollback.
- The `'uploaded'` status is additive to the CHECK constraint; legacy readers seeing it ignore unrecognised states.

---

## Summary

**Best architecture.** Keep what's already correct (the media-lifecycle model, Bunny Stream TUS direct, two-phase server-owned commit, Realtime via `messages`, sender-poll for upload-attempt state) and add five load-bearing pieces:
1. A sibling `vibe_video_uploads` attempt table.
2. A `media_upload_receipts` ledger for Storage families with `reserve_media_upload()` RPC.
3. Atomic uniqueness on `media_assets` + `content_sha256` column + `'uploaded'` status + `attach_media_reference()` RPC.
4. One Client Media SDK on top of every uploader (`shared/media-sdk/`, `@clientShared/media-sdk`).
5. One `useMediaAsset` hook on top of every renderer, respecting the per-family privacy table in A.10.

All gated behind a real `client_feature_flags` mechanism with deterministic per-user bucketing.

**Perfect UX.** Optimistic-first, never-blocking, always-retryable, state-visible, navigation-surviving, pre-warmed playback under a resource policy, self-healing signed URLs, and a stuck-upload recovery loop that classifies local-source availability before offering "Resume upload" vs "Discard + send again." Full reliability in the foreground tier immediately; OS-level background as a Phase-7 spike with explicit prerequisites.

Week 1 ships the production fix (P1 Chat Vibe Clip stabilisation + P2 feature flags) without any architectural commitment. Every subsequent week is independently revertable behind a flag. No legacy data migration; no provider stack change; no webhook URL rename; no Bunny Storage TUS promise; no background-task promise before its prerequisites are met.

---

## Appendix — version history (non-normative)

- **v1** (clean-sheet rewrite, discarded): under-credited the existing media-lifecycle model; proposed Bunny Storage TUS (not supported); over-promised OS-level background uploads.
- **v2 → v3** (staged consolidation): kept the live schema; added flag mechanism; Realtime split between `messages` (peer) and upload-attempt tables (sender).
- **v4** (contract gaps): purged Realtime contradictions; locked `shared/media-sdk/` + `@clientShared/*`; replaced `expo-av` with `expo-audio`; reframed Phase 7 as research; reconciled `CLAUDE.md` / `AGENTS.md`.
- **v5** (retry/idempotency): deterministic provider paths from `client_request_id`; `'active'` after PUT (later corrected to `'uploaded'` in v7); TUS credential renewal rule; pre-warm budgets; spike acceptance criteria for P7.
- **v6** (final hardening): product-scoped paths; `client_request_id` reuse policy; `send-message` rollback preserved; event-cover reference idempotency.
- **v7** (self-critique): atomic DB uniqueness; `content_sha256` column; `'uploaded'` status with per-family lifecycle table; declared per-family privacy posture in A.10.
- **v8** (this document): receipts table for Storage families; server-side authoritative SHA-256; `attach_media_reference()` RPC with unique active-reference index; event-cover stale-overwrite guard; corrected privacy wording (auth-checked EF + short-TTL signed URLs, not "public" or "native Bunny signed"); orphan cleanup for unreferenced `uploaded` assets; full PR manifest.
