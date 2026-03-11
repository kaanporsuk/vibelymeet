# VIBELY — REBUILD RUNBOOK

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

Install dependencies:

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

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_BUNNY_STREAM_CDN_HOSTNAME=
VITE_BUNNY_CDN_HOSTNAME=
VITE_POSTHOG_API_KEY=
```

### Notes

- `VITE_SUPABASE_PROJECT_ID` appears in the checked-in `.env` but is not required by the app runtime.
- OneSignal App ID is **hardcoded** in `src/lib/onesignal.ts`.
- Sentry DSN is **hardcoded** in `src/main.tsx`.
- PostHog host is **hardcoded** to EU cloud; only the API key is env-driven.

Recommended local file:

```bash
cp .env .env.backup-from-frozen || true
```

Then replace with a clean file using only valid `KEY=value` lines.

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
- `stripe-webhook`
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

`supabase/config.toml` configures **all 28** functions. No gaps.

- **21 functions** have `verify_jwt = true` (JWT enforced at gateway): phone-verify, forward-geocode, daily-room, verify-admin, admin-review-verification, create-checkout-session, create-portal-session, create-event-checkout, create-credits-checkout, delete-account, event-notifications, email-verification, vibe-notification, geocode, create-video-upload, delete-vibe-video, upload-image, upload-voice, upload-event-cover, cancel-deletion, send-notification.
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
- `/ready/:id`
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

- `src/pages/VideoLobby.tsx` exists but is **not** routed.
- `/vibe-studio` is effectively a redirect path to `/profile`, not a separate studio surface.
- `/vibe-feed` contains mock/sample media and is not evidence of a production-wired feature.

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
- Do not remove files like `VideoLobby.tsx` merely because they are unrouted; document first, then decide.
- All 28 functions are in config.toml (post-hardening); no exceptions.
- Treat the root `.env` as historical artifact, not source of truth.
- After any successful rebuild, immediately generate updated manifests and a rebuild delta so the next operator is not relying on memory.

