# Video Date Provider Runtime Scope

This note defines the provider boundary for the Vibe Video Date runtime so audits, incident reviews, and launch checks classify dependencies consistently.

## Direct `/date/:id` Runtime Providers

The direct Video Date runtime exchanges are Supabase, Daily, OneSignal, Sentry, and PostHog.

- Supabase owns canonical session, registration, Ready Gate, provider outbox, realtime, RPC, and Edge Function state.
- Daily owns room creation, room lookup, meeting tokens, call objects, participant media, and room cleanup checks.
- OneSignal owns notification delivery and push-open routing that can enter or recover the Video Date journey.
- Sentry owns runtime exception capture, breadcrumbs, and provider failure diagnostics.
- PostHog owns product analytics for user journey and operational event visibility.

## Adjacent Journey Providers

Stripe, RevenueCat, Twilio, Resend, and Bunny are adjacent app systems for this flow, not direct `/date/:id` runtime providers.

- Stripe and RevenueCat can influence eligibility, entitlement, credits, or upgrade journeys around the date experience.
- Twilio and Resend can influence authentication, account recovery, verification, and operational communication before or after the date.
- Bunny can influence profile, chat, event, and media surfaces that shape user readiness or trust, but the Video Date runtime itself uses Daily for live video.

Treat these adjacent providers as part of the wider user journey and release readiness matrix, but do not count them as direct Video Date runtime exchanges unless a specific `/date/:id` path introduces a runtime call to that provider.
