# VIBELY — SUPABASE PROVIDER SHEET

**Date:** 2026-03-11  
**Baseline:** post-hardening (frozen golden: pre-native-hardening)  
**Priority:** Tier 1 / system-critical

---

## 1. Purpose

This sheet is the provider-specific operating reference for Supabase.

It is meant to answer, in one place:
- what Supabase owns in Vibely
- what the repo proves
- what may exist only in the dashboard/project state
- what must be restored or verified during rebuild
- what can silently drift even when the code looks fine

This document is intentionally more operational than the general External Dependency Ledger.

### Current-state addendum (2026-04-12)

The frozen baseline counts below are not the current repo/cloud totals.

- Current linked-project schema includes **45 public tables**.
- Current repo contains **244** migration files.
- Current repo contains **44** deployable Edge Functions plus `_shared`.
- Sprint 1 media lifecycle foundation adds `media_retention_settings`, `media_assets`, `media_references`, `media_delete_jobs`, and the `process-media-delete-jobs` worker.
- `verification_selfie` retention is seeded but intentionally disabled (`worker_enabled = false`).
- Chat media retention rows are intentionally seeded as `retain_until_eligible` with no active purge clock yet.

---

## 2. Why Supabase is the highest-risk provider

Supabase is not just a backend vendor in Vibely. It is the main application substrate.

Supabase carries all of the following simultaneously:
- database schema
- row-level security and SQL functions
- auth-linked user context
- storage buckets and policies
- Edge Functions
- project secrets
- realtime publication state
- deployment/runtime assumptions for most integrations

That means a rebuild can fail in multiple distinct ways even when the frontend code compiles:
- wrong project linked
- migrations partially applied
- missing secrets
- buckets/policies incorrect
- functions missing or deployed with wrong JWT posture
- dashboard-only state not restored

---

## 3. Canonical known project identity

### Frozen baseline project ref
- `schdyxcunwcvddlcshwd`

### Repo touchpoints proving this
- `supabase/config.toml`
- frontend integration under `src/integrations/supabase/`
- multiple function/runtime assumptions using the same project-backed architecture

### Operator note
This project ref should be treated as the canonical linked project for the frozen baseline unless there is an explicit migration plan to a different Supabase project.

---

## 4. What Supabase owns in Vibely

## A. Database object layer
From the frozen baseline and generated types, Supabase owns:
- 41 public tables
- 1 public view
- 22 typed public SQL functions / RPC surfaces
- 3 public enums
- 101 versioned SQL migration files in the repo

### Product systems sitting on this layer
- profiles and identity state
- events and registrations
- live matching / queueing / sessions
- matches and messaging
- daily drops
- moderation and admin systems
- subscriptions / credits / premium state
- notification preferences and notification logs
- account deletion flow
- verification/photo trust state

## B. Storage layer
**Live buckets (in use):** only `chat-videos` and `proof-selfies`.

Legacy / Bunny-migrated (not active Supabase buckets): `profile-photos`, `vibe-videos`, `event-covers`, `voice-messages`. Treat as legacy for rebuild; image/event/voice/vibe media are on Bunny.

## C. Edge Function layer
Deployable functions: **28**

Shared helper directory:
- `_shared`

### Function config (post-hardening)
All 28 functions are listed in `supabase/config.toml`. No config gaps. JWT-at-gateway: 21 functions. Public-but-protected (verify_jwt false): stripe-webhook, push-webhook, video-webhook, email-drip, unsubscribe, request-account-deletion, generate-daily-drops.

## D. Secrets/runtime layer
Supabase stores and exposes runtime secrets used by Edge Functions.

## E. Auth / identity context layer
Even where business logic is custom, many functions rely on Supabase bearer tokens and user resolution.

## F. Realtime layer
The migrations explicitly add selected tables to `supabase_realtime` publication.

---

## 5. What the repo proves vs what it does not prove

## What the repo proves strongly
- migration files preserved in version control
- function source preserved in version control
- bucket names and many storage policies represented in migrations
- generated type surface for the linked project
- linked project ref in config
- frontend/backend env names expected by source

## What the repo does not fully prove
- exact live dashboard settings
- exact currently deployed function set in the project
- exact secret values currently stored in Supabase
- exact current auth/provider settings in the dashboard
- exact state of buckets/policies after any manual edits
- exact JWT posture if functions were deployed manually outside config
- any project changes that were never captured into migrations

### Critical example
The generated type surface includes:
- `feedback`
- `premium_history`

But those objects are not created anywhere in the 101 frozen migration files.

That means the project state and the migration history are not guaranteed to be a perfect one-to-one reconstruction path.

---

## 6. Required Supabase project surfaces to verify during rebuild

## A. Project linkage
Verify:
- correct project ref
- correct project URL
- correct anon/publishable key
- correct service-role key in operator context

## B. Database schema parity
Verify:
- migrations applied in expected order
- public tables present
- public view present
- SQL functions present
- enums present
- any types-only-but-not-created objects are investigated

## C. Storage parity
Verify:
- live buckets `chat-videos` and `proof-selfies` exist and have correct policies
- bucket publicity/private state matches intended behavior
- RLS/storage policies behave correctly
- (other historical bucket names are legacy/Bunny-migrated; only these two are required for current flows)

## D. Edge Function parity
Verify:
- all 28 deployable functions are present and listed in config.toml
- `_shared` compiles into dependents correctly
- 21 functions deployed with JWT enforced; 7 public-but-protected with correct secrets/tokens set

## E. Secrets parity
Verify all required secrets exist before testing function flows.

## F. Realtime parity
Verify the intended tables are in publication if live update behavior matters.

---

## 7. Supabase secrets checklist

These are the backend/runtime secrets observed in function source.

### Core Supabase self-reference
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

### Integration secrets stored in Supabase for Edge Functions
- `APP_URL`
- `BUNNY_CDN_HOSTNAME`
- `BUNNY_STORAGE_API_KEY`
- `BUNNY_STORAGE_ZONE`
- `BUNNY_STREAM_API_KEY`
- `BUNNY_STREAM_CDN_HOSTNAME`
- `BUNNY_STREAM_LIBRARY_ID`
- `CRON_SECRET`
- `DAILY_API_KEY`
- `DAILY_DOMAIN`
- `ONESIGNAL_APP_ID`
- `ONESIGNAL_REST_API_KEY`
- `PUSH_WEBHOOK_SECRET`
- `RESEND_API_KEY`
- `STRIPE_ANNUAL_PRICE_ID`
- `STRIPE_MONTHLY_PRICE_ID`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_VERIFY_SERVICE_SID`
- `UNSUB_HMAC_SECRET`
- `BUNNY_VIDEO_WEBHOOK_TOKEN`

### Operator rule
Do not assume the checked-in root `.env` covers this set. It does not.

---

## 8. Supabase function deployment sheet (post-hardening)

### Function count
- 28 deployable functions; all listed in `supabase/config.toml`.

### JWT-at-gateway (`verify_jwt = true`)
phone-verify, forward-geocode, daily-room, verify-admin, admin-review-verification, create-checkout-session, create-portal-session, create-event-checkout, create-credits-checkout, delete-account, event-notifications, email-verification, vibe-notification, geocode, create-video-upload, delete-vibe-video, upload-image, upload-voice, upload-event-cover, cancel-deletion, send-notification.

### Public-but-protected (`verify_jwt = false`)
stripe-webhook, push-webhook, video-webhook, email-drip, unsubscribe, request-account-deletion, generate-daily-drops. These use provider secrets, URL tokens, or CRON_SECRET/admin JWT in code.

### Required secrets for hardened behavior
- `PUSH_WEBHOOK_SECRET`, `UNSUB_HMAC_SECRET`, `CRON_SECRET`, `BUNNY_VIDEO_WEBHOOK_TOKEN` (plus existing Stripe/Bunny/Daily/Resend/Twilio/OneSignal).

### Functions to review with extra care
- `stripe-webhook`, `video-webhook`, `push-webhook`, `email-drip`, `unsubscribe`, `generate-daily-drops`, `request-account-deletion`

---

## 9. Database reconstruction risks specific to Supabase

## Risk 1 — migration history is operational, not purely structural
The migration chain includes:
- destructive deletes
- test-event/test-session data
- hardcoded user UUID operations
- production-state backfills
- repeated policy hotfixes

So a cold replay into a fresh project is not guaranteed safe without review.

## Risk 2 — project state may exceed repo history
Because `feedback` and `premium_history` appear in generated types but not as CREATE TABLE migrations, the live/linked project may contain history not fully encoded in the preserved migration chain.

## Risk 3 — storage policy behavior evolved over time
Especially sensitive buckets:
- `profile-photos`
- `vibe-videos`

Their access model changed more than once.

## Risk 4 — policy correctness is as important as table existence
For Vibely, schema reconstruction without correct RLS/policies is not a real rebuild.

## Risk 5 — function deployment state can drift from repo config
Because functions can be deployed manually and two functions are missing from config listing, the project may diverge from what the checked-in config suggests.

---

## 10. Dashboard-only or partially dashboard-only areas to inspect

These are the Supabase areas most likely to contain meaningful state that is not fully encoded in the repo.

### Project settings
- general project settings
- auth-related settings that affect session/redirect behavior
- URL/origin settings if applicable to auth/email flows

### Database
- actual current object graph
- extensions, publications, policies, and functions as live state
- any manually created objects missing from migrations

### Storage
- bucket existence
- bucket publicity/private state
- per-bucket policies

### Edge Functions
- actual deployed function list
- current function logs/runtime behavior
- secrets presence
- whether missing-config functions were deployed with explicit flags

### Auth
- provider/redirect/email configuration if any dashboard-side settings matter to current flows

### Logs / observability
- recent function failures
- auth errors
- storage permission errors

---

## 11. Minimum Supabase verification procedure

This is the compact operational check before declaring Supabase healthy.

### Step 1 — Link check
Confirm the operator is pointed at the intended project:
- ref matches `schdyxcunwcvddlcshwd`
- `SUPABASE_URL` matches the linked project

### Step 2 — Secret check
Confirm all required secrets are present in the project.

### Step 3 — Schema check
Confirm:
- key tables exist
- key SQL functions exist
- key buckets exist
- the push admin view exists

### Step 4 — Function check
Confirm:
- all 28 functions deployed
- `phone-verify` JWT-enforced
- `forward-geocode` and `push-webhook` explicitly accounted for

### Step 5 — Product smoke check
Run at least:
- auth/login
- profile load
- event list/detail
- chat open
- vibe-video upload path
- payment session creation
- phone verification
- notification-related function call

### Step 6 — Storage check
Confirm uploads and fetches work for at least:
- profile photo
- vibe video
- event cover or voice upload

---

## 12. Supabase ownership and recovery sheet

### What must be controlled by the team
- project ownership/access
- service-role secret access
- CLI/project linking access
- ability to set Edge Function secrets
- ability to deploy functions
- ability to inspect database/storage/policies

### If Supabase access is lost
Rebuild is materially blocked because Vibely depends on Supabase for:
- schema
- auth context
- storage
- functions
- secrets

In that scenario, the rebuild pack helps reconstruct intent, but not all live project state or secret values.

---

## 13. Unknowns to resolve in the next Supabase-focused audit

These are the most important open questions still specific to Supabase:

1. Are `feedback` and `premium_history` live objects created outside the preserved migration chain?  
2. Are there any additional live buckets, policies, or helper functions not captured in the repo?  
3. (Resolved) All functions including `forward-geocode` and `push-webhook` are in config.toml with intended posture.  
4. Are there any dashboard-only auth/redirect settings required by current flows?  
5. Is the current linked project the sole canonical production project for this baseline, or one of several?  
6. Were any live objects created manually after the last preserved migration?  

---

## 14. Recommended next artifact after this sheet

The next strongest provider sheet after Supabase is:

**VIBELY_STRIPE_PROVIDER_SHEET.md**

Reason:
- Stripe is the next most operationally brittle dependency
- payment flows are central to premium/credits/events
- the code alone does not preserve webhook registration or product/price mapping truth

---

## 15. Bottom line

Supabase is the single most consequential external dependency in the Vibely pre-native-hardening baseline.

It is not enough to have the repo.
To truly rebuild Vibely, you need a Supabase project whose:
- schema
- policies
- buckets
- functions
- secrets
- deployment posture

all match the intended baseline closely enough to satisfy real product flows.

This sheet is the provider-level control point for that reality.
