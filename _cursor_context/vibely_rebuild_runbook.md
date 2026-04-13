# VIBELY — REBUILD RUNBOOK

> **Canonical for frozen web rebuild only.** This file is not the native launch-closure runbook. For current launch execution, use `docs/active-doc-map.md`.
>
> **2026-04-11:** Repo hardening removed unrouted `VideoLobby.tsx` and legacy `ReadyGate.tsx`; `/ready/:readyId` uses `ReadyRedirect`. Mentions of those files below are **historical**. Production hosting is **not** Lovable-first — see root `README.md` and `docs/vibely-canonical-project-reference.md`.
>
> **2026-04-13:** Repo current-state addendum: the repo now contains **253 migrations** and **44 deployable Edge Functions**. Sprint 1 foundation, Sprint 2 profile-media wiring, and Sprint 3 chat/account cleanup are live. Chat media and account-deletion retention now dual-write into lifecycle tables, but `process-media-delete-jobs` cron remains **disabled**.

**Version:** post-hardening  
**Date:** 2026-03-11  
**Repository baseline:** `vibelymeet-pre-native-hardening-golden-2026-03-10.zip` (codebase now reflects auth hardening)  
**Supabase project ref in frozen code:** `schdyxcunwcvddlcshwd`

---

## 1. Purpose

This runbook explains how to stand up, verify, and redeploy the frozen Vibely web baseline in a way that is reproducible.

This is a rebuild guide for the audited web codebase immediately before native-build hardening. It is **not** a native app build guide.

This runbook assumes you have the code archive, access to the required third-party accounts, and permission to manage the linked Supabase project.

---

## 2. What this runbook covers

- local checkout and install
- frontend environment setup
- Supabase linkage
- database migration application
- Edge Function secret setup
- Edge Function deployment
- local and hosted smoke validation
- known weak points that are not safely inferable from the repo alone

---

## 3. Canonical baseline inputs

You should treat the following as the canonical rebuild set for this frozen state:

1. frozen repo ZIP  
2. audited golden snapshot  
3. this rebuild runbook  
4. discrepancy report  
5. schema appendix  
6. Edge Function manifest  
7. migration manifest  
8. machine-readable inventory JSON

Do **not** rebuild from the generic `README.md` in the repo. It is insufficient.

### Current-state addendum (2026-04-13)

For current backend verification and deploy work, supplement this frozen runbook with:

1. `docs/media-lifecycle-sprint1-report.md`
2. `docs/supabase-cloud-deploy.md`
3. `_cursor_context/vibely_schema_appendix.md`
4. `_cursor_context/vibely_migration_manifest.md`
5. `_cursor_context/vibely_edge_function_manifest.md`
6. `_cursor_context/vibely_machine_readable_inventory.json`

Sprint 1 media lifecycle foundation is additive to the frozen rebuild baseline:
- migration `20260417100000_media_lifecycle_foundation.sql`
- Edge Function `process-media-delete-jobs`
- cron intentionally still disabled
- dry-run preview intentionally non-mutating and limited to already-queued jobs

Sprint 3 media lifecycle rollout adds:
- migrations `20260419100000_media_lifecycle_chat_account_cleanup.sql` and `20260419103000_chat_retention_user_wrappers.sql`
- migration `20260419110000_account_deletion_grace_media_fix.sql`
- no new Edge Function slugs, but updated deployments for `upload-image`, `upload-chat-video`, `upload-voice`, `send-message`, `send-game-event`, `request-account-deletion`, `delete-account`, and `cancel-deletion`
- chat media now remains retained while either participant still retains the conversation
- pending deletion requests now create only a reversible grace-window hold; they do not count as final deletion for chat eligibility
- final `account_deleted` chat release and owned profile/vibe cleanup now happen only when the deletion request is marked `completed`; physical deletes remain worker-driven later

**Stage 1 / Stream 1 (2026-04-18):** apply `20260418120000_tighten_promote_ready_gate_helper.sql` on the target Supabase project (`supabase db push --linked` when linked) so remote promotion behavior matches repo SQL. Web/native hydration for active session vs ready-gate routes ships in application code on branch `stage1/stream1-backend-promotion-and-hydration`; details are summarized in `_cursor_context/vibely_migration_manifest.md` (Stage 1 / Stream 1 addendum). This stream does **not** add a durable notification outbox.

---

## 4. Rebuild strategy

For this baseline, the safest strategy is:

1. restore the repo exactly as frozen  
2. restore or link the intended Supabase project  
3. push all migrations in order  
4. restore Edge Function secrets  
5. deploy all Edge Functions  
6. restore frontend env values  
7. verify critical flows

The app is tightly coupled to Supabase, Stripe, Bunny, Daily, OneSignal, PostHog, Sentry, Resend, and Twilio. A successful code checkout alone is **not** enough.

---

## 5. Prerequisites

### Local tooling

Install and verify:

- Git
- Node.js LTS
- npm
- Supabase CLI
- Docker Desktop or equivalent container runtime for local Supabase workflows

### Access you need

You need working access to:

- the code archive
- Supabase project `schdyxcunwcvddlcshwd`
- Stripe account and webhook configuration
- Bunny Stream and Bunny Storage credentials
- Daily.co account/domain
- OneSignal app and REST API key
- Resend account/API key
- Twilio Verify credentials
- production domain and DNS management for `vibelymeet.com` / `cdn.vibelymeet.com`

If any of the above are unavailable, the rebuild may compile but still fail operationally.

---

## 6. Unpack and prepare the repo

```bash
unzip vibelymeet-pre-native-hardening-golden-2026-03-10.zip
cd vibelymeet-pre-native-hardening-golden-2026-03-10
```

Sanity-check expected structure:

```bash
ls
# package.json
# src/
# public/
# supabase/
```

Expected major surfaces:

- `src/`
- `public/`
- `supabase/functions/`
- `supabase/migrations/`
- `src/integrations/supabase/`

---

## 7. Package manager choice

The repo contains all of the following:

- `package-lock.json`
- `bun.lock`
- `bun.lockb`

For rebuild reproducibility, use **npm as the canonical installer** because `package-lock.json` is present and unambiguous.

Install dependencies (including devDependencies, which are required for `vite` to be available in scripts):

```bash
npm ci
```

Run local dev server:

```bash
npm run dev
```

Build production bundle locally:

```bash
npm run build
```

Preview production bundle locally:

```bash
npm run preview
```

---

## 8. Frontend environment setup

The checked-in root `.env` file is **not** a reliable environment manifest. It is partial and contains malformed non-standard entries.

Create a clean frontend env file for local use.

### Required frontend variables actually referenced by source

See root **`.env.example`** for the canonical list. Use `KEY=value` with no spaces around `=`.

- **Required:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (or legacy `VITE_SUPABASE_ANON_KEY` as fallback).
- **Optional:** `VITE_BUNNY_STREAM_CDN_HOSTNAME`, `VITE_BUNNY_CDN_HOSTNAME`, `VITE_POSTHOG_API_KEY`, `VITE_POSTHOG_HOST`, `VITE_SENTRY_DSN`, `VITE_ONESIGNAL_APP_ID` (each has in-code fallback or is optional).

### Notes

- Do **not** put server secrets in `VITE_*` (e.g. Twilio auth token, Resend API key, Supabase project ID). They are browser-exposed.
- `VITE_SUPABASE_PROJECT_ID` is not required by the app runtime.
- OneSignal App ID is now **env-backed with fallback** via `VITE_ONESIGNAL_APP_ID`; if unset, the historical App ID is used.
- Sentry DSN is now **env-backed with fallback** via `VITE_SENTRY_DSN`; if unset, the historical DSN is used.
- PostHog host is now **env-backed with fallback** via `VITE_POSTHOG_HOST`; if unset, it defaults to the EU cloud host.

Recommended local file:

```bash
cp .env .env.backup-from-frozen || true
```

Then replace with a clean file using only valid `KEY=value` lines.

---

## 9. Required static assets for notifications

For OneSignal web push (v16), the site must serve a OneSignal service worker script **from the domain root**:

- `https://vibelymeet.com/OneSignalSDK.sw.js`

The repo provides a shim at:

- `public/OneSignalSDK.sw.js`

which delegates to the official OneSignal CDN worker. A successful rebuild/deploy **must** ensure this file is published at the root so that requests like:

- `https://vibelymeet.com/OneSignalSDK.sw.js?appId=97e52ea2-6a27-4486-a678-4dd8a0d49e94&sdkVersion=...`

do **not** 404 and OneSignal’s service worker can register correctly. OneSignal health still depends on the provider-side app/origin/service-worker configuration in the OneSignal dashboard.

---

## 9. Link to Supabase

The frozen repo already includes `supabase/config.toml` with:

- project ref: `schdyxcunwcvddlcshwd`

Authenticate CLI and link the repo:

```bash
supabase login
supabase link --project-ref schdyxcunwcvddlcshwd
```

If you need database-aware validation during link, provide the DB password when prompted.

---

## 10. Local database workflow

Use local Supabase only if you want full migration rehearsal or local function testing.

Start local stack:

```bash
supabase start
```

Reset and apply all local migrations into the local stack:

```bash
supabase db reset
```

This is the best rehearsal path when checking that all 101 migrations still apply cleanly.

### Important note

The repo does **not** provide a clean, complete seed baseline for business data. A local database reset validates schema and policies, not production content.

---

## 11. Remote database migration procedure

Dry-run mentally first by checking current project state, then push the repo migrations.

### Parity-first rule (required before any db push/pull/repair)

Before running **any** of the following against a linked remote project:
- `supabase db push`
- `supabase db pull`
- `supabase migration repair`

You must first run the repo’s **read-only migration parity checker** to confirm what kind of drift exists:

```bash
./scripts/check_migration_parity.sh
```

If parity drift is detected, do **not** proceed with push/pull/repair in an ad-hoc way. Treat it as a dedicated workstream:
- determine whether drift is **systematic timestamp mismatch** (common) vs genuinely missing migrations
- only then decide on a repair strategy

#### 11.1 Current production-linked migration state (post-repair)

As of 2026-03-11, a dedicated **metadata-only** migration-repair lane has been run against the linked production project:
- remote vs local migration history was reconciled via `supabase migration repair` status flips only; **no historical SQL bodies were re-executed**
- two legacy remote-only artifacts are now represented by **no-op local placeholder migrations**:
  - `20260309000534_legacy_remote_artifact.sql`
  - `20260309005543_legacy_remote_artifact.sql`
- migration `20260311000000_chat_videos_anon_read.sql` (chat-videos anon-read policy) was marked **applied** in history because its logic had already been executed manually
- `./scripts/check_migration_parity.sh` now reports **parity OK** (no missing local or remote versions)
- `supabase db push --linked --dry-run` reports the remote database as **up to date**

Future operators must still respect the parity-first rule above before making any new migration changes.

Canonical command:

```bash
supabase db push --linked
```

If you want a preview first:

```bash
supabase db push --linked --dry-run
```

### Rules

- do not skip migrations
- do not reorder migrations
- do not edit historical migration files during rebuild
- if remote migration history is broken, repair it deliberately before continuing

### Expected migration set

- count: **101** SQL migration files
- frozen range: `20251218002545_...sql` through `20260310124838_...sql`

### Storage-related migrations to watch carefully

**Live Supabase buckets (in use):** only `chat-videos` and `proof-selfies`. Validate these two after migrations.

Other bucket names may appear in migrations but are legacy or Bunny-migrated; image/event/voice/vibe media are on Bunny. Do not assume all six historical buckets are active.

---

## 12. Edge Function secrets

Edge Function runtime secrets must be set separately from frontend Vite variables.

### Required Edge Function environment variables referenced in code

```env
APP_URL=
BUNNY_CDN_HOSTNAME=
BUNNY_STORAGE_API_KEY=
BUNNY_STORAGE_ZONE=
BUNNY_STREAM_API_KEY=
BUNNY_STREAM_CDN_HOSTNAME=
BUNNY_STREAM_LIBRARY_ID=
CRON_SECRET=
DAILY_API_KEY=
DAILY_DOMAIN=
ONESIGNAL_APP_ID=
ONESIGNAL_REST_API_KEY=
PUSH_WEBHOOK_SECRET=
RESEND_API_KEY=
STRIPE_ANNUAL_PRICE_ID=
STRIPE_MONTHLY_PRICE_ID=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_URL=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_VERIFY_SERVICE_SID=
UNSUB_HMAC_SECRET=
BUNNY_VIDEO_WEBHOOK_TOKEN=
```

Prepare a dedicated secrets file that is **not committed**.

Example:

```env
# .env.functions.production
APP_URL=https://vibelymeet.com
SUPABASE_URL=https://schdyxcunwcvddlcshwd.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
STRIPE_MONTHLY_PRICE_ID=...
STRIPE_ANNUAL_PRICE_ID=...
RESEND_API_KEY=...
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_VERIFY_SERVICE_SID=...
DAILY_API_KEY=...
DAILY_DOMAIN=vibelyapp.daily.co
BUNNY_STREAM_LIBRARY_ID=...
BUNNY_STREAM_API_KEY=...
BUNNY_STREAM_CDN_HOSTNAME=...
BUNNY_STORAGE_ZONE=...
BUNNY_STORAGE_API_KEY=...
BUNNY_CDN_HOSTNAME=cdn.vibelymeet.com
ONESIGNAL_APP_ID=...
ONESIGNAL_REST_API_KEY=...
PUSH_WEBHOOK_SECRET=...
CRON_SECRET=...
UNSUB_HMAC_SECRET=...
BUNNY_VIDEO_WEBHOOK_TOKEN=...
```

Push secrets to the linked Supabase project:

```bash
supabase secrets set --env-file .env.functions.production
```

List secrets to confirm presence:

```bash
supabase secrets list
```

---

## 13. Edge Function inventory to deploy

Deploy all function directories except `_shared`:

> Historical baseline note: the explicit list below predates later function additions. For exact current repo inventory, prefer `find supabase/functions -mindepth 1 -maxdepth 1 -type d` and the machine-readable inventory. For Sprint 2 media lifecycle rollout, the targeted function deploy set is `create-video-upload`, `delete-vibe-video`, and `upload-image` after applying migration `20260417110000_media_lifecycle_profile_media_wiring.sql`.

- `account-pause`
- `account-resume`
- `admin-review-verification`
- `cancel-deletion`
- `create-checkout-session`
- `create-credits-checkout`
- `create-event-checkout`
- `create-portal-session`
- `create-video-upload`
- `daily-room`
- `delete-account`
- `delete-vibe-video`
- `email-drip`
- `email-verification`
- `event-notifications`
- `forward-geocode`
- `generate-daily-drops`
- `geocode`
- `phone-verify`
- `push-webhook`
- `request-account-deletion`
- `send-notification`
- `send-message`
- `stripe-webhook`
- `swipe-actions`
- `daily-drop-actions`
- `unsubscribe`
- `upload-event-cover`
- `upload-image`
- `upload-voice`
- `verify-admin`
- `vibe-notification`
- `video-webhook`

### Deploy strategy

Preferred approach:

```bash
supabase functions deploy --project-ref schdyxcunwcvddlcshwd
```

If you deploy functions individually, do so deliberately and preserve JWT behavior.

### JWT behavior (post-hardening)

`supabase/config.toml` configures **all 30** baseline functions shown in this historical section. No gaps at that snapshot.

- **23 functions** have `verify_jwt = true` (JWT enforced at gateway): account-pause, account-resume, phone-verify, forward-geocode, daily-room, verify-admin, admin-review-verification, create-checkout-session, create-portal-session, create-event-checkout, create-credits-checkout, delete-account, event-notifications, email-verification, vibe-notification, geocode, create-video-upload, delete-vibe-video, upload-image, upload-voice, upload-event-cover, cancel-deletion, send-notification.
- **7 functions** have `verify_jwt = false` (public-but-protected by secret/token in code): stripe-webhook, push-webhook, video-webhook, email-drip, unsubscribe, request-account-deletion, generate-daily-drops.

### Required secrets for hardened behavior

- `PUSH_WEBHOOK_SECRET`, `UNSUB_HMAC_SECRET`, `CRON_SECRET`, `BUNNY_VIDEO_WEBHOOK_TOKEN` (plus all existing Stripe/Bunny/Daily/Resend/Twilio/OneSignal vars).

### Deploy strategy

Deploy with project ref; config.toml drives verify_jwt per function. No need to pass `--no-verify-jwt` for the 7 public functions if deploying from repo with current config.

```bash
supabase functions deploy --project-ref schdyxcunwcvddlcshwd
```

### Recommended operator rule

After deployment, verify in the Supabase dashboard that JWT behavior matches config and that required secrets are set.

---

## 14. Optional local function serving

For local function work:

```bash
supabase functions serve --env-file .env.functions.local
```

For local public/webhook testing where the function should skip JWT verification:

```bash
supabase functions serve stripe-webhook --env-file .env.functions.local --no-verify-jwt
```

Use separate local and production secrets files. Do not mix them.

---

## 15. Frontend application validation

After `npm run dev`, validate that the app boots without missing-env failures.

### Minimum page smoke test

Public:

- `/`
- `/auth`
- `/reset-password`
- `/how-it-works`
- `/privacy`
- `/terms`
- `/delete-account`
- `/premium`
- `/subscription/success`
- `/subscription/cancel`

Authenticated:

- `/dashboard`
- `/events`
- `/events/:id`
- `/event/:eventId/lobby`
- `/matches`
- `/chat/:id`
- `/profile`
- `/settings`
- `/date/:id`
- `/ready/:readyId` — **`ReadyRedirect`** (session/event resolution → event lobby); not a standalone ready-gate page (see `docs/repo-hardening-closure-2026-04-11.md`)
- `/schedule`
- `/credits`
- `/credits/success`
- `/event-payment/success`
- `/user/:userId`

Admin:

- `/kaan`
- `/kaan/dashboard`
- `/admin/create-event`

### Route caveats

- **`src/pages/VideoLobby.tsx` — removed 2026-04-11** (was unrouted dead surface; see `docs/repo-hardening-closure-2026-04-11.md`). **Do not expect this file** in a fresh checkout.
- `/vibe-studio` is a dedicated studio surface (web + native) and should be treated as a first-class management route.
- **`/vibe-feed` / `VibeFeed`** — named in older audits; **not present** in current `src/App.tsx` / `src/pages/`. Treat mock-feed references as **historical** unless the route is re-added.

---

## 16. Critical end-to-end smoke tests

Run these after migrations, secrets, and function deployments are complete.

### Auth and onboarding

- sign up / sign in
- session persistence across refresh
- onboarding completion
- profile load after onboarding

### Profile and media

- upload profile photo
- view profile photo from an allowed viewer state
- upload vibe video
- confirm Bunny processing completes
- confirm HLS playback loads in profile
- delete vibe video

### Events and lobby

- events page loads
- event details loads
- event registration flow works
- event lobby opens
- ready gate behavior is functional

### Matching and messaging

- matches page loads
- chat thread opens
- plain text message send works
- voice upload flow works
- chat video flow works if enabled by product logic

### Payments

- premium checkout session creation works
- credits checkout session creation works
- event checkout session creation works
- Stripe success pages resolve correctly
- Stripe webhook updates expected subscription / credit state
- customer portal session creation works

### Notifications

- OneSignal init does not crash app boot
- push subscription state can be written to profile/preferences
- notification send function executes cleanly
- webhook handlers accept expected external payloads

### Contact / verification / re-engagement

- phone verification send/check works
- email verification flow works
- unsubscribe links resolve correctly
- event notification / drip emails render without broken URLs

### Golden-path regression runbook (post-hardening)

For a repeatable regression pass over the hardened web baseline (auth/onboarding gating, pause/resume, Ready Gate, video-date, Daily Drop, chat send + notifications, swipe/match notifications, premium/credits, admin), use:

- **Runbook:** `docs/golden-path-regression-runbook.md` — step-by-step PASS/fail checklist for each flow.
- **Static smoke script:** `scripts/run_golden_path_smoke.sh` — runs `npm run typecheck:core` and `npm run build`; run this first, then follow the runbook for manual/browser steps.

No Playwright/Cypress is installed; the runbook is manual/scriptable. Add E2E automation later if desired.

---

## 17. Hardcoded values that can break rebuilds if overlooked

These are rebuild-sensitive because they are embedded in source rather than cleanly centralized.

### Hardcoded production domain references

`vibelymeet.com` is referenced in multiple frontend pages and functions.

If domain changes, you must audit at least:

- email templates
- unsubscribe links
- referral links
- redirect URLs
- legal text
- notification deep links

### Hardcoded runtime config

- OneSignal App ID in `src/lib/onesignal.ts`
- Sentry DSN in `src/main.tsx`
- PostHog host in `src/main.tsx`
- Daily fallback domain `vibelyapp.daily.co` in `daily-room`
- Bunny upload endpoint `video.bunnycdn.com/tusupload`

A rebuild that changes providers or domains must patch these intentionally.

---

## 18. Known gaps that are not fully recoverable from the repo alone

The frozen repo is structurally strong, but it does **not** fully encode every operational dependency.

Manual confirmation may still be required for:

- Stripe webhook endpoint registration
- Bunny webhook destination configuration
- Daily domain/account ownership
- OneSignal app/dashboard settings
- Resend sending-domain verification
- Twilio service configuration
- domain / DNS records for `vibelymeet.com` and `cdn.vibelymeet.com`
- any Supabase dashboard-only settings not represented in migrations

---

## 19. Suggested rebuild order for a clean remote recovery

1. unpack repo  
2. `npm ci`  
3. create clean frontend env file  
4. `supabase login`  
5. `supabase link --project-ref schdyxcunwcvddlcshwd`  
6. prepare `.env.functions.production`  
7. `supabase secrets set --env-file .env.functions.production`  
8. `supabase db push --linked`  
9. deploy all Edge Functions  
10. verify JWT settings for public functions  
11. run smoke tests  
12. fix any provider-side webhook or dashboard mismatches  
13. build frontend with `npm run build`

---

## 20. Rehearsal checklist for a future operator

A rebuild should not be considered complete until all of the following are true:

- app installs cleanly with `npm ci`
- frontend boots with no missing-env crash
- all migrations apply cleanly
- all expected buckets exist with expected access behavior
- all 28 Edge Functions are deployed
- JWT behavior matches config (21 JWT-at-gateway, 7 public-but-protected); required secrets set
- Bunny upload + playback works
- Stripe checkout + webhook works
- phone verification works
- admin routes are reachable by intended admins
- notification stack does not crash startup
- no route in `src/App.tsx` 404s unexpectedly

---

## 21. Operator notes

- Prefer **rebuild by preservation**, not opportunistic cleanup.
- **`VideoLobby.tsx` was removed in 2026-04-11** after documentation (`docs/repo-hardening-closure-2026-04-11.md`) — the old “unrouted but keep” warning applied **before** that removal; do not reintroduce without product need.
- All 28 functions are in config.toml (post-hardening); no exceptions.
- Treat the root `.env` as historical artifact, not source of truth.
- After any successful rebuild, immediately generate updated manifests and a rebuild delta so the next operator is not relying on memory.
