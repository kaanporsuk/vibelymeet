# Vibe Video — Bunny webhook & operator guide

This document closes the **webhook / operator readiness** gap for Vibe Video (web + native share the same backend).

## Architecture (short)

1. Client calls **`create-video-upload`** (JWT) → Bunny Stream video object + TUS credentials; Sprint 2 also activates a current primary vibe-video row in lifecycle tables and mirrors `profiles.bunny_video_uid` / `bunny_video_status = 'uploading'`.
2. Client finishes TUS upload directly to Bunny Stream.
3. Bunny transcodes → sends **HTTP POST** to your **`video-webhook`** Edge Function.
4. **`video-webhook`** updates `draft_media_sessions`, `profile_vibe_videos.video_status`, and the current `profiles.bunny_video_status` to `ready` (Bunny status `3` or `4`) or `failed` (`5`).

Deletion behavior changed in Sprint 2:
- **`delete-vibe-video`** now clears the published profile snapshot immediately, releases the active lifecycle reference, and leaves physical Bunny deletion to `process-media-delete-jobs` after retention / manual promotion.

If step 3-4 never happens, native and web keep the video in the recoverable pipeline state. Fresh rows show **`processing`**; after the client stale threshold they show **`stale_processing`** with refresh/retry/re-upload guidance instead of "no video" or generic unavailable copy.

`profiles.bunny_video_uid`, `profiles.bunny_video_status`, and legacy `profiles.vibe_video_status` are backend-owned mirrors. Normal clients should not write UID/status directly; use `create-video-upload`, `video-webhook`, `delete-vibe-video`, or trusted server RPCs. `vibe_caption` remains user-editable.

Playback and score deliberately differ:

- **Vibe Score credit** remains tied to a non-empty `profiles.bunny_video_uid`, independent of `bunny_video_status`.
- **Playback readiness** requires resolver state `ready` plus a playable HLS URL. A UID with `uploading`, `processing`, null, unknown, or stale status is not playable.

---

## Exact webhook URL (Bunny dashboard)

**Current rollout URL format:**

```text
https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/video-webhook?token=<BUNNY_VIDEO_WEBHOOK_TOKEN>
```

- **Path:** `/functions/v1/video-webhook` (Supabase Edge Function name: `video-webhook`).
- **Query parameter:** `token` — legacy fallback supported by current dashboard setup. Must match Supabase secret **`BUNNY_VIDEO_WEBHOOK_TOKEN`** exactly (constant-time compare in `video-webhook/index.ts`).
- **Method:** POST (Bunny default for Stream webhooks). Other methods are rejected with **405**.
- **JWT:** Gateway **`verify_jwt = false`** for this function (`supabase/config.toml`) so Bunny can call without a Supabase user token.
- **Preferred auth:** Bunny Stream signature headers are validated against `BUNNY_STREAM_API_KEY` when present. A valid `Authorization: Bearer <BUNNY_VIDEO_WEBHOOK_TOKEN>` is also accepted. The query token remains as a legacy rollout fallback.
- **Library guard:** when Bunny includes `VideoLibraryId`, it must match Supabase secret `BUNNY_STREAM_LIBRARY_ID`; mismatches are rejected without DB mutation.

**Where the token comes from**

- Generate a long random secret (e.g. 32+ bytes hex).
- Set in Supabase: **Project Settings → Edge Functions → Secrets** as `BUNNY_VIDEO_WEBHOOK_TOKEN`.
- Paste the **same** value into the Bunny Stream webhook URL query string (not committed to git).

---

## Payload shape (implemented)

`supabase/functions/video-webhook/index.ts` expects JSON body fields:

| Field         | Meaning |
|---------------|---------|
| `VideoGuid`   | Bunny video GUID — matched to `profiles.bunny_video_uid` |
| `Status`      | Bunny numeric status — **3** or **4** → DB `ready`; **5** → DB `failed` |
| `VideoLibraryId` | Optional Bunny library id — validated against `BUNNY_STREAM_LIBRARY_ID` when present |

Other statuses leave row as **`processing`** (until a later event or manual fix).

---

## Logs & symptoms — misconfiguration

| Symptom | Likely cause | First checks |
|--------|----------------|--------------|
| Supabase `video-webhook` logs: `invalid_auth` with `has_webhook_token_configured=false` | `BUNNY_VIDEO_WEBHOOK_TOKEN` missing | Set secret; redeploy not required for value-only secret changes after initial deploy |
| Logs: `invalid_auth` | URL typo, wrong token, missing bearer/query token, or webhook token secret missing | Bunny webhook URL/header vs Supabase secret (character-by-character) |
| Logs: `invalid_signature` | Bunny signature headers are present but do not validate against `BUNNY_STREAM_API_KEY` | Confirm Stream API key, raw-body signing mode, and that no proxy rewrites body |
| Logs: `library mismatch` | Webhook points at the wrong Bunny Stream library or Supabase secret is wrong | Bunny library id vs `BUNNY_STREAM_LIBRARY_ID` |
| HTTP **405** from `video-webhook` | Bunny method is not POST | Bunny Stream webhook method/config |
| HTTP **401** from `video-webhook` | Bad auth | Signature/bearer/query token checks above |
| No logs at all on upload complete | Webhook URL wrong project / not saved in Bunny | Bunny Stream → **Webhooks** UI; correct library |
| Profile stuck **`processing`** forever | Webhook not firing OR Bunny never sends Status 3 | Bunny library **encoding status**; Supabase **Functions → video-webhook** logs; DB `bunny_video_uid` matches Bunny GUID |

**Supabase:** Dashboard → **Edge Functions** → **video-webhook** → Logs (filter JSON payloads with `"scope":"vibe_video"` and events such as `video_webhook_received`, `video_webhook_rejected`, `video_webhook_status_mapped`, `video_webhook_media_session_update_succeeded`, and `video_webhook_stale_legacy_profile_ignored`).

**Bunny:** Stream → your **library** → **Webhooks** — confirm URL, method POST, events for encode complete/fail.

---

## Client behavior when webhook never finalizes

- After upload, web and native run bounded polling against `profiles.bunny_video_status`.
- Returning to Vibe Studio/Profile Studio, refreshing, tab visibility, and native AppState foreground can resume polling for profile rows that still have a UID plus `uploading`/`processing`/unknown/missing status.
- Fresh pipeline copy: "Your video uploaded and is still processing. This can take a few minutes. We'll keep checking."
- Stale pipeline copy: "Still processing. You can refresh, try again later, or re-upload if it does not finish."
- User-facing refresh/retry actions refetch profile state and restart the bounded poll when safe.
- **Not a client bug** if DB stays `processing` with a valid `bunny_video_uid` — treat as **webhook / Bunny pipeline**.

The shared resolver threshold is `VIBE_VIDEO_STALE_PROCESSING_THRESHOLD_MS` (10 minutes). Operator repair helpers below use a longer default (45 minutes) to avoid marking slow but healthy transcodes as failed.

---

## Stuck-video SQL diagnostics

Read-only classifier (service role, SQL editor, or trusted admin session only):

```sql
select public.classify_stale_vibe_video_uploads(45, 100);
```

Direct profile mirror view for quick triage:

```sql
select
  p.id as user_id,
  p.bunny_video_uid as video_uid,
  coalesce(nullif(btrim(coalesce(p.bunny_video_status, '')), ''), 'processing') as status,
  p.updated_at,
  now() - p.updated_at as profile_age
from public.profiles p
where p.bunny_video_uid is not null
  and btrim(p.bunny_video_uid) <> ''
  and coalesce(nullif(btrim(coalesce(p.bunny_video_status, '')), ''), 'processing') in ('uploading', 'processing')
order by p.updated_at asc
limit 100;
```

Only after Bunny dashboard verification confirms the webhook/encoding path is broken or the video is terminally stuck, mark stale rows failed without deleting media or clearing score eligibility:

```sql
select public.mark_stale_vibe_video_uploads_failed(45, 100);
```

That repair preserves `bunny_video_uid` for score/history, updates profile/session status to `failed`, and lets users re-upload from the normal UI.

---

## Engineering: app bug vs infra

| Observation | Lean toward |
|-------------|-------------|
| `create-video-upload` HTTP **401/503/502** | Auth or Bunny secrets on Edge — see function logs |
| Playback URL null, dev warns missing hostname | `EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME` / persisted hostname — see mobile runbook |
| HLS error / black player, hostname OK | Bunny **CDN hotlink / referrer / token** — compare browser vs app |
| Delete succeeds in UI but asset remains in Bunny immediately afterward | **Expected in Sprint 2** when the asset is only soft-deleted/released. Check `media_assets` / `media_delete_jobs` and run `process-media-delete-jobs` manually if you are validating purge behavior before cron is enabled. |

---

## Telemetry and structured logs

Client product funnel events are emitted through web/native Vibe Video telemetry helpers and mirrored as Sentry breadcrumbs. Do not add raw signed URLs, auth headers, local file paths, or TUS signatures to event props.

Key client events:

- Upload funnel: `vibe_video_credentials_request_started`, `vibe_video_credentials_request_succeeded`, `vibe_video_credentials_request_failed`, `vibe_video_tus_upload_started`, `vibe_video_tus_upload_succeeded`, `vibe_video_tus_upload_failed`, `vibe_video_upload_stalled`
- Processing funnel: `vibe_video_processing_poll_started`, `vibe_video_processing_status_changed`, `vibe_video_stale_processing_observed`, `vibe_video_processing_stalled`, `vibe_video_ready_observed`, `vibe_video_failed_observed`
- Playback funnel: `vibe_video_playback_attempted`, `vibe_video_playback_succeeded`, `vibe_video_playback_failed`
- Management: `vibe_video_delete_requested`, `vibe_video_delete_succeeded_locally`, `vibe_video_replace_started`, `vibe_video_caption_preserved`, `vibe_video_caption_edited`, `vibe_video_caption_cleared`
- Trust-safety hook: `vibe_video_profile_report_submitted` when a native public profile report is submitted for a profile with a Vibe Video UID.

Edge Functions use structured JSON logs via `supabase/functions/_shared/vibe-video-logs.ts`:

- `create-video-upload`: request, auth, Bunny create, profile mirror write, media-session create, replacement/deferred cleanup.
- `video-webhook`: received, token/library validation, status mapping, media-session update, stale ignore, legacy fallback update.
- `delete-vibe-video`: requested, auth, profile clear, deferred delete worker handoff, orphan-risk state.

Full event map: `docs/branch-deltas/vibe-video-final-hardening-telemetry-qa.md`.

---

## Deploy delta (this repo)

After changing Edge Function code:

```bash
supabase functions deploy create-video-upload --project-ref <ref>
supabase functions deploy delete-vibe-video --project-ref <ref>
supabase functions deploy video-webhook --project-ref <ref>
```

Secrets (no redeploy required for value-only updates, after initial deploy):

- `BUNNY_STREAM_LIBRARY_ID`, `BUNNY_STREAM_API_KEY`, `BUNNY_STREAM_CDN_HOSTNAME` — used by `create-video-upload`.
- `BUNNY_VIDEO_WEBHOOK_TOKEN` — used only by `video-webhook`.

---

## Code ↔ provider contract (checklist)

These names are what **this repo’s Edge Functions and native app** expect. If your Bunny dashboard uses different zones or hostnames, playback and uploads will diverge.

| Variable / setting | Used where | Notes |
|--------------------|------------|--------|
| **`BUNNY_STREAM_LIBRARY_ID`** | `create-video-upload` | Stream library GUID from Bunny dashboard. |
| **`BUNNY_STREAM_API_KEY`** | `create-video-upload` | Stream **library** API key (not Storage password alone). |
| **`BUNNY_STREAM_CDN_HOSTNAME`** | `create-video-upload` response → native persists + builds HLS/thumb URLs | Must be the **Stream pull zone / CDN hostname** for the library (same as web `VITE_BUNNY_STREAM_CDN_HOSTNAME` / mobile `EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME`). |
| **`BUNNY_VIDEO_WEBHOOK_TOKEN`** | `video-webhook` bearer or legacy query `?token=` | Long random secret; must match Bunny webhook auth exactly. |
| **`BUNNY_STORAGE_ZONE`**, **`BUNNY_STORAGE_API_KEY`**, **`BUNNY_CDN_HOSTNAME`** | Not referenced by the three Vibe Video Edge Functions in this repo | If you use them elsewhere (e.g. image CDN), keep them separate from Stream hostnames. |

**Native HLS / hotlink / referrer**

- The app requests **`https://<BUNNY_STREAM_CDN_HOSTNAME>/<guid>/playlist.m3u8`** (and segments) with a normal mobile user-agent — not a browser referrer.
- If Bunny **hotlink protection** or **token authentication** is enabled on that pull zone, **Safari may still play** (different rules) while **expo-video fails** (black screen + `player.status_error`). Fix: allow app traffic for this hostname, adjust hotlink rules, or adopt signed URLs consistently (product + code change).
- **Thumbnails** may load while **HLS** is blocked, depending on rule scope — consistent with “upload OK, fullscreen black”.

**Manual verification (outside this repo)**

- Open `playlist.m3u8` on device (browser vs in-app) and compare HTTP status.
- Bunny Stream → **Webhooks**: POST URL points to `/functions/v1/video-webhook`; current rollout URL includes `token=` unless signature/bearer auth is configured in Bunny.
- Bunny **Encoding**: video reaches **Finished** and webhook sends **Status 3**.

---

## Related docs

- `apps/mobile/docs/native-vibe-video-runbook.md` — native hostname, diagnostics codes, playback failures.
- `supabase/functions/video-webhook/index.ts` — source of truth for token and payload handling.
