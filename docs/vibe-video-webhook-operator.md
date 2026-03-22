# Vibe Video — Bunny webhook & operator guide

This document closes the **webhook / operator readiness** gap for Vibe Video (web + native share the same backend).

## Architecture (short)

1. Client calls **`create-video-upload`** (JWT) → Bunny Stream video object + TUS credentials; profile set to `uploading` then client finishes TUS upload.
2. Client calls **`saveVibeVideoToProfile`** (or equivalent) → profile `bunny_video_uid` + `processing`.
3. Bunny transcodes → sends **HTTP POST** to your **`video-webhook`** Edge Function.
4. **`video-webhook`** updates `profiles.bunny_video_status` to `ready` (Bunny status `3`) or `failed` (`4`).

If step 3–4 never happens, native and web stay on **`processing`** until timeout/poll gives up or an operator fixes the webhook.

---

## Exact webhook URL (Bunny dashboard)

**Target URL format:**

```text
https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/video-webhook?token=<BUNNY_VIDEO_WEBHOOK_TOKEN>
```

- **Path:** `/functions/v1/video-webhook` (Supabase Edge Function name: `video-webhook`).
- **Query parameter:** `token` — **required**. Must match the Supabase secret **`BUNNY_VIDEO_WEBHOOK_TOKEN`** exactly (constant-time compare in `video-webhook/index.ts`).
- **Method:** POST (Bunny default for Stream webhooks).
- **JWT:** Gateway **`verify_jwt = false`** for this function (`supabase/config.toml`) so Bunny can call without a Supabase user token. **Auth is only the `token` query param.**

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
| `Status`      | Bunny numeric status — **3** = transcoding complete → DB `ready`; **4** → DB `failed` |

Other statuses leave row as **`processing`** (until a later event or manual fix).

---

## Logs & symptoms — misconfiguration

| Symptom | Likely cause | First checks |
|--------|----------------|--------------|
| Supabase `video-webhook` logs: `BUNNY_VIDEO_WEBHOOK_TOKEN is not set` | Secret missing | Set secret; redeploy not required for secret-only change after set |
| Logs: `missing or invalid token` | URL typo, wrong token, missing `?token=` | Bunny webhook URL vs Supabase secret (character-by-character) |
| HTTP **401** from `video-webhook` | Bad token | Same as above |
| HTTP **503** from `video-webhook` | Token env empty at runtime | Secret name must be exactly `BUNNY_VIDEO_WEBHOOK_TOKEN` |
| No logs at all on upload complete | Webhook URL wrong project / not saved in Bunny | Bunny Stream → **Webhooks** UI; correct library |
| Profile stuck **`processing`** forever | Webhook not firing OR Bunny never sends Status 3 | Bunny library **encoding status**; Supabase **Functions → video-webhook** logs; DB `bunny_video_uid` matches Bunny GUID |

**Supabase:** Dashboard → **Edge Functions** → **video-webhook** → Logs (filter by `[video-webhook]`).

**Bunny:** Stream → your **library** → **Webhooks** — confirm URL, method POST, events for encode complete/fail.

---

## Native behavior when webhook never finalizes

- After upload, native **polls** `profiles.bunny_video_status` (see `apps/mobile/lib/vibeVideoPoll.ts`).
- User may see **“Still processing”** after max wait; **pull-to-refresh** and **AppState → active** invalidate `my-profile`.
- **Not a client bug** if DB stays `processing` with a valid `bunny_video_uid` — treat as **webhook / Bunny pipeline**.

---

## Engineering: app bug vs infra

| Observation | Lean toward |
|-------------|-------------|
| `create-video-upload` HTTP **401/503/502** | Auth or Bunny secrets on Edge — see function logs |
| Playback URL null, dev warns missing hostname | `EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME` / persisted hostname — see mobile runbook |
| HLS error / black player, hostname OK | Bunny **CDN hotlink / referrer / token** — compare browser vs app |
| Delete succeeds in UI but asset remains in Bunny | **`delete-vibe-video`**: profile cleared even if Bunny DELETE fails — check logs for `bunnyRemoteDeleteOk: false` and `possibleBunnyOrphan` |

---

## Deploy delta (this repo)

After changing Edge Function code:

```bash
supabase functions deploy create-video-upload --project-ref <ref>
supabase functions deploy delete-vibe-video --project-ref <ref>
# video-webhook unchanged unless edited separately
```

Secrets (no redeploy required for value-only updates, after initial deploy):

- `BUNNY_STREAM_LIBRARY_ID`, `BUNNY_STREAM_API_KEY`, `BUNNY_STREAM_CDN_HOSTNAME` — used by `create-video-upload` / `delete-vibe-video`.
- `BUNNY_VIDEO_WEBHOOK_TOKEN` — used only by `video-webhook`.

---

## Related docs

- `apps/mobile/docs/native-vibe-video-runbook.md` — native hostname, diagnostics codes, playback failures.
- `supabase/functions/video-webhook/index.ts` — source of truth for token and payload handling.
