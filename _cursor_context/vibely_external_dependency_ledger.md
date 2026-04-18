# VIBELY — EXTERNAL DEPENDENCY LEDGER

**Date:** 2026-03-11  
**Baseline:** post-hardening  
**Purpose:** compact source-of-truth for dependencies that live partly or fully **outside the repo** and can block a rebuild even when the code is intact.

---

## 1. How to use this ledger

This document is not a replacement for the audited snapshot, runbook, or function manifest.

Its job is narrower and operationally critical:
- identify each external platform/provider
- record where Vibely touches it in code
- record what must exist outside the repo
- record the secrets/config expected by the code
- identify the known unknowns that must be verified during rebuild rehearsal

This is the document you check when asking:
- what do we depend on beyond Git?
- what dashboard/webhook/domain settings would break a rebuild?
- what secrets or app IDs are assumed to exist?

---

## 2. Dependency summary

### Core external systems in this baseline
- Supabase
- Stripe
- Bunny Stream / Bunny Storage / Bunny CDN
- Daily.co
- Twilio
- Resend
- OneSignal
- PostHog
- Sentry
- OpenStreetMap Nominatim
- production domain / DNS / CDN

### Highest-risk external dependencies
These are the systems most likely to cause a “code is fine but product is broken” rebuild failure:

1. Supabase project state and secrets  
2. Stripe checkout/webhook configuration  
3. Bunny video/storage credentials and webhook wiring  
4. Daily domain/account setup  
5. OneSignal app configuration and delivery identity  
6. DNS/domain/CDN assumptions around `vibelymeet.com` and `cdn.vibelymeet.com`

---

## 3. Dependency ledger

## A. Supabase

### Role in the system
Supabase is the primary backend platform.

It carries:
- database
- RLS and SQL functions
- storage buckets/policies
- auth context
- Edge Functions
- secrets store
- realtime publication state

### Repo touchpoints
- `supabase/config.toml`
- `supabase/functions/*`
- `supabase/migrations/*`
- `src/integrations/supabase/*`
- broad app usage across `src/`

### Known project identity in frozen baseline
- project ref: `schdyxcunwcvddlcshwd`

### Secrets/config expected by code
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- frontend also expects:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_PUBLISHABLE_KEY`

### Outside-repo state that must exist
- the intended Supabase project
- database object graph matching or compatible with the preserved baseline
- secrets populated in the project
- Edge Functions deployed
- bucket state and policies behaving as expected
- any provider webhook URLs pointing to the correct function endpoints

### Rebuild-critical notes (post-hardening)
- the frozen migration history is not clean schema-only history
- generated types expose at least two objects not created in the preserved migration set: `feedback`, `premium_history`
- all 28 functions are in `supabase/config.toml`; 21 JWT-at-gateway, 7 public-but-protected
- live Supabase storage buckets (project inventory): historically documented as `chat-videos` and `proof-selfies` among others; **inline chat / Vibe Clip video uploads** in current app code use **`upload-chat-video` → Bunny Storage** (path prefix `chat-videos/…`), not a Supabase upload for that pipeline — see `vibely_bunny_provider_sheet.md` §4
- required secrets: `PUSH_WEBHOOK_SECRET`, `UNSUB_HMAC_SECRET`, `CRON_SECRET`, `BUNNY_VIDEO_WEBHOOK_TOKEN` (plus existing)

### Verification tasks during rebuild
- confirm linked project ref is correct
- confirm all required secrets exist (including hardening secrets above)
- confirm all 28 Edge Functions are deployed with correct verify_jwt
- confirm live buckets still match project policy (e.g. `proof-selfies`); separately confirm **`upload-chat-video`** Bunny secrets/CDN for chat video sends
- run migration parity check before any remote migration operations:
  - `./scripts/check_migration_parity.sh`

---

## B. Stripe

### Role in the system
Stripe handles:
- premium subscriptions
- one-off credit purchases
- paid event checkout
- customer portal sessions
- webhook-driven subscription/payment state updates

### Repo touchpoints
**Functions**
- `create-checkout-session`
- `create-credits-checkout`
- `create-event-checkout`
- `create-portal-session`
- `stripe-webhook`
- `delete-account` (cleanup path)

**Frontend**
- `src/hooks/useSubscription.ts`
- `src/pages/Credits.tsx`
- `src/components/events/PaymentModal.tsx`
- `src/components/premium/PremiumSettingsCard.tsx`
- payment success/cancel routes

### Secrets/config expected by code
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_MONTHLY_PRICE_ID`
- `STRIPE_ANNUAL_PRICE_ID`

### Outside-repo state that must exist
- Stripe account
- valid products/prices corresponding to monthly and annual plan IDs
- valid credit-pack pricing if still represented by checkout logic
- webhook endpoint pointing to deployed `stripe-webhook`
- customer portal enabled/configured if required by account settings

### Rebuild-critical notes
- a rebuild can compile while checkout silently fails if price IDs are wrong
- webhook delivery is essential for subscription/credit/event payment state to settle correctly
- Stripe-side webhook registration is **not** recoverable from the repo alone

### Known unknowns to verify
- exact live webhook endpoint URL
- exact Stripe events subscribed on the webhook
- whether portal configuration requires any Stripe-dashboard-only settings beyond the API calls

---

## C. Bunny Stream / Bunny Storage / Bunny CDN

### Role in the system
Bunny handles:
- user vibe-video upload and processing
- vibe-video playback delivery
- image uploads
- event cover uploads
- voice-message media uploads
- CDN-backed media delivery

### Repo touchpoints
**Functions**
- `create-video-upload`
- `video-webhook`
- `delete-vibe-video`
- `upload-image`
- `upload-event-cover`
- `upload-voice`

**Frontend**
- `src/components/vibe-video/VibeStudioModal.tsx`
- profile/admin preview components using `VITE_BUNNY_STREAM_CDN_HOSTNAME`
- services for image/event-cover/voice upload

### Secrets/config expected by code
- `BUNNY_STREAM_LIBRARY_ID`
- `BUNNY_STREAM_API_KEY`
- `BUNNY_STREAM_CDN_HOSTNAME`
- `BUNNY_STORAGE_ZONE`
- `BUNNY_STORAGE_API_KEY`
- `BUNNY_CDN_HOSTNAME`
- `BUNNY_VIDEO_WEBHOOK_TOKEN` (for `video-webhook` URL token; required)
- frontend also expects:
  - `VITE_BUNNY_STREAM_CDN_HOSTNAME`
  - `VITE_BUNNY_CDN_HOSTNAME`

### Hardcoded runtime assumptions
- frontend TUS upload endpoint is hardcoded to `https://video.bunnycdn.com/tusupload`
- code references `cdn.vibelymeet.com`

### Outside-repo state that must exist
- Bunny Stream library
- Bunny Storage zone
- CDN hostname / pull zone / custom hostname mapping as required
- webhook registration from Bunny video processing to `video-webhook`
- any hostname/DNS linkage required for `cdn.vibelymeet.com`

### Rebuild-critical notes
- vibe-video flow is multi-stage: auth → upload-metadata function → direct Bunny upload → Bunny webhook → profile readiness state
- if webhook registration is missing, uploads may appear to work but videos never become ready
- media delivery depends on both Bunny config and DNS/CDN assumptions

### Known unknowns to verify
- exact Bunny dashboard mapping between storage zone, CDN hostname, and stream library
- exact webhook URL currently configured for processed video callbacks
- any dashboard-side CORS/origin settings beyond what the code implies

---

## D. Daily.co

### Role in the system
Daily powers live video rooms/tokens for event dates and match/video call flows.

### Repo touchpoints
**Function**
- `daily-room`

**Frontend**
- `src/hooks/useMatchCall.ts`
- `src/hooks/useVideoCall.ts`
- `src/pages/VideoDate.tsx`

### Secrets/config expected by code
- `DAILY_API_KEY`
- `DAILY_DOMAIN`

### Hardcoded runtime assumptions
- function falls back to `vibelyapp.daily.co` if `DAILY_DOMAIN` is absent

### Outside-repo state that must exist
- Daily account
- domain/subdomain owned by the account, expected to be `vibelyapp.daily.co` unless intentionally changed
- API key with room-management rights

### Rebuild-critical notes
- the fallback domain makes this dependency easy to miss because the app may appear configured even if env is incomplete
- if the account or domain ownership changed, the fallback becomes dangerous rather than helpful

### Known unknowns to verify
- whether `vibelyapp.daily.co` is still the intended production domain
- whether any Daily dashboard settings are required beyond API-key possession

---

## E. Twilio

### Role in the system
Twilio powers phone verification and optional line-type checks.

### Repo touchpoints
**Function**
- `phone-verify`

**Frontend**
- `src/components/PhoneVerification.tsx`

### Secrets/config expected by code
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_VERIFY_SERVICE_SID`

### Outside-repo state that must exist
- Twilio account
- Verify service configured and active
- any geo/country restrictions intentionally set in Twilio
- Lookup API availability if line-type checks are expected

### Rebuild-critical notes
- this is the only function explicitly configured with `verify_jwt = true` at the Supabase gateway
- operational correctness depends on both Twilio credentials and the existence of the configured Verify service SID

### Known unknowns to verify
- exact Verify service settings
- any fraud-control or country restrictions applied in dashboard

---

## F. Resend

### Role in the system
Resend powers transactional and engagement email sends.

### Repo touchpoints
**Functions**
- `email-verification`
- `event-notifications`
- `email-drip`

### Secrets/config expected by code
- `RESEND_API_KEY`

### Hardcoded runtime assumptions
- outbound sender examples include `Vibely <no-reply@vibelymeet.com>`
- templates include hardcoded links to `https://vibelymeet.com`

### Outside-repo state that must exist
- Resend account
- sending domain verification for the sender domain used in code
- any bounce/suppression behavior as configured in Resend dashboard

### Rebuild-critical notes
- even with a correct API key, email can fail if the sending domain is not verified
- unsubscribe and product links depend on production-domain correctness, not just email delivery success

### Known unknowns to verify
- whether `no-reply@vibelymeet.com` is the actual production sender identity in Resend
- whether additional sender aliases are used outside what appears in code

---

## G. OneSignal

### Role in the system
OneSignal powers push identity and delivery.

### Repo touchpoints
**Frontend**
- `src/lib/onesignal.ts`
- `PushPermissionPrompt`
- notification preference hooks/context/auth sync

**Functions**
- `send-notification`
- `push-webhook`
- `vibe-notification` (indirect notification involvement)

### Secrets/config expected by code
- `ONESIGNAL_APP_ID`
- `ONESIGNAL_REST_API_KEY`

### Hardcoded runtime assumptions
- OneSignal App ID is hardcoded in `src/lib/onesignal.ts`

### Outside-repo state that must exist
- OneSignal app
- platform configuration for web push at minimum
- any site origin/service-worker settings required by OneSignal
- REST API permissions aligned with send logic
- any callback/webhook configuration if external event ingestion is used alongside `push-webhook`

### Rebuild-critical notes
- because the App ID is hardcoded, changing environments or apps requires source awareness, not just env changes
- `push-webhook` is in config with `verify_jwt = false`; requires `PUSH_WEBHOOK_SECRET` (x-webhook-secret header)
- push identity also depends on how the frontend maps signed-in users to OneSignal external IDs

### Known unknowns to verify
- exact OneSignal dashboard configuration
- exact webhook source(s), if any, that should target `push-webhook`
- service-worker/origin requirements not captured directly in the repo

---

## H. PostHog

### Role in the system
PostHog handles product analytics.

### Repo touchpoints
- `src/main.tsx`
- `src/App.tsx`
- `src/lib/analytics.ts`

### Secrets/config expected by code
- `VITE_POSTHOG_API_KEY`

### Hardcoded runtime assumptions
- `api_host` is hardcoded to `https://eu.i.posthog.com`

### Outside-repo state that must exist
- PostHog project
- valid API key for that project
- if EU residency is intended, the project must match the EU host assumption

### Rebuild-critical notes
- host is not env-driven in this baseline
- changing PostHog region/project shape requires code awareness

### Known unknowns to verify
- whether EU cloud is intentionally canonical or just current state

---

## I. Sentry

### Role in the system
Sentry handles frontend error tracking.

### Repo touchpoints
- `src/main.tsx`
- `src/App.tsx`
- `src/lib/errorTracking.ts`
- several pages/hooks importing `@sentry/react`

### Secrets/config expected by code
- none via env in this baseline

### Hardcoded runtime assumptions
- Sentry DSN is hardcoded in `src/main.tsx`

### Outside-repo state that must exist
- Sentry project accepting events for the hardcoded DSN
- release/environment handling as expected by the project configuration

### Rebuild-critical notes
- this dependency is easy to overlook because there is no env setup step for it in the current baseline
- changing Sentry target requires code change, not just secret rotation

### Known unknowns to verify
- whether release/source-map handling is configured elsewhere outside the repo

---

## J. OpenStreetMap Nominatim

### Role in the system
Nominatim provides:
- reverse geocoding for user/event location flows
- forward geocoding for admin event location search

### Repo touchpoints
**Functions**
- `geocode`
- `forward-geocode`

### Secrets/config expected by code
- none for Nominatim directly

### Outside-repo state that must exist
- no account credentials implied by the code
- operational dependency is mostly policy/rate-limit tolerance and network access

### Rebuild-critical notes
- `forward-geocode` is in config with `verify_jwt = true` (JWT + admin + rate limit)
- this dependency can fail under rate-limit or policy changes even though no Nominatim key is required

### Known unknowns to verify
- whether a custom user-agent / acceptable-use posture is sufficient for expected traffic
- whether a paid/internal geocoder is planned as a later replacement

---

## K. Domain / DNS / CDN

### Role in the system
The production web identity is embedded into multiple parts of the system.

### Observed production-domain assumptions
- `vibelymeet.com`
- `cdn.vibelymeet.com`
- `vibelyapp.daily.co` (Daily subdomain fallback)

### Repo touchpoints
- legal pages
- referral links
- email templates
- frontend environment for CDN hostname
- runtime environment detection in `src/main.tsx`

### Outside-repo state that must exist
- DNS records for `vibelymeet.com`
- DNS/CDN records for `cdn.vibelymeet.com`
- hosting/deployment configuration for the web app
- TLS/certificate coverage
- any reverse-proxy/origin config backing the CDN hostname

### Rebuild-critical notes
- this baseline does not treat the domain as optional or future-state; it is already hard-referenced in code
- changing the domain is a code/content/email/link migration task, not merely a hosting toggle

### Known unknowns to verify
- exact hosting provider/path serving `vibelymeet.com`
- exact DNS ownership and CDN/origin mapping for `cdn.vibelymeet.com`

---

## 4. Webhook and callback ledger

These are the most important external callback-style dependencies to verify outside the repo.

### `stripe-webhook`
- provider: Stripe
- direction: Stripe → Supabase Edge Function
- secret involved: `STRIPE_WEBHOOK_SECRET`
- must verify: live endpoint URL and subscribed events

### `video-webhook`
- provider: Bunny Stream
- direction: Bunny → Supabase Edge Function
- secret involved: `BUNNY_VIDEO_WEBHOOK_TOKEN` (URL query param `?token=...`); fail-closed if missing
- must verify: callback URL in Bunny dashboard includes `?token=<BUNNY_VIDEO_WEBHOOK_TOKEN>`

### `push-webhook`
- provider: push provider / notification event source
- direction: external push event source → Supabase Edge Function
- secret involved: `PUSH_WEBHOOK_SECRET`
- must verify: who sends to it and whether the secret is actively enforced in production

### `unsubscribe`
- provider: user clicking email link generated by Vibely templates
- direction: public browser/email click → Supabase Edge Function
- secret involved: `UNSUB_HMAC_SECRET`
- must verify: token generation and link integrity across all email templates

### `email-drip`
- provider: scheduler/cron source
- direction: scheduler → Supabase Edge Function
- secret involved: `CRON_SECRET`
- must verify: who triggers it and on what cadence

---

## 5. External dependency risk matrix

### Tier 1 — System-breaking if missing
- Supabase
- Stripe
- Bunny
- Daily
- DNS/domain/CDN

### Tier 2 — Critical feature degradation if missing
- Twilio
- OneSignal
- Resend

### Tier 3 — Observability/analytics degradation if missing
- PostHog
- Sentry

### Tier 4 — Low-credential but operationally relevant
- Nominatim

---

## 6. What is still not encoded anywhere strongly enough

These items remain partially or fully outside recoverable repo truth and should be confirmed manually during the next hardening pass:

- exact Stripe webhook registration details
- exact Bunny webhook registration details
- exact OneSignal app/dashboard configuration
- exact scheduler source for `email-drip`
- exact DNS/CDN origin mappings
- exact hosting setup for `vibelymeet.com`
- exact Daily account/domain ownership state
- any Supabase dashboard-only settings not represented in migrations/config

---

## 7. Recommended next hardening move after this ledger

For each Tier 1 and Tier 2 dependency, create a one-page provider sheet with:
- owner/account location
- required dashboard objects
- required secrets
- callback URLs
- test procedure
- rotation/recovery notes

The highest-priority sheets should be:
1. Supabase  
2. Stripe  
3. Bunny  
4. Daily  
5. OneSignal

---

## 8. Bottom line

Vibely’s rebuild risk is not just in the codebase.

A significant portion of system truth lives in:
- provider dashboards
- webhook registrations
- app IDs
- sending-domain verification
- DNS/CDN routing
- secrets stores

This ledger is the compact map of that outside-the-repo dependency layer. It should be kept current alongside the rebuild pack whenever provider usage or deployment assumptions change.
