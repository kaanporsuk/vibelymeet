# Premium Credits Observability

Branch: `fix/premium-credits-observability`

## Problem

Streams 1-8 closed the Event Lobby and Ready Gate backend safety work. Stream 9 hardens the revenue-linked paths so Stripe checkout, webhook delivery, credit settlement, event-ticket settlement, and subscription lifecycle changes are duplicate-safe and durably traceable without changing pricing, pack IDs, plan IDs, or entitlement semantics.

## Audit Note

Audited:

- `supabase/functions/stripe-webhook/index.ts`
- `supabase/functions/create-checkout-session/index.ts`
- `supabase/functions/create-credits-checkout/index.ts`
- `supabase/functions/create-event-checkout/index.ts`
- `supabase/functions/create-portal-session/index.ts`
- `supabase/functions/delete-account/index.ts`
- `supabase/functions/_shared/creditPacks.ts`
- subscription / credit / event-ticket settlement migrations
- web premium, credits, and event payment success surfaces
- native RevenueCat references for scope awareness only

Findings:

- Stripe signature verification already used the raw request body and remains unchanged.
- Credit-pack settlement already had checkout-session idempotency through `stripe_credit_checkout_grants`.
- Paid-event settlement already had checkout-session idempotency through `stripe_event_ticket_settlements` and `settle_event_ticket_checkout`.
- Stripe event IDs were not durably recorded, so replay/duplicate webhook deliveries could not be globally audited or skipped before settlement.
- Checkout and portal creation paths did not write durable safe operational events.

## SQL Changes

Migration:

- `supabase/migrations/20260501220000_premium_credits_observability.sql`

Adds:

- `public.stripe_webhook_events`
  - primary key: `stripe_event_id`
  - statuses: `received`, `processing`, `processed`, `failed`, `duplicate_skipped`, `ignored`
  - safe context columns for event type, checkout session, Stripe customer/subscription IDs, Supabase user, paid event, pack, plan, result, and error code
- `public.payment_observability_events`
  - append-only safe operational ledger for checkout, portal, webhook, and settlement outcomes

Security posture:

- RLS enabled on both tables
- all access revoked from `PUBLIC`, `anon`, and `authenticated`
- `service_role` gets only the internal privileges needed by Edge Functions
- no raw Stripe payloads, card/payment-method details, checkout URLs, customer emails, secrets, or message/media payloads are stored

## Edge Function Changes

Changed functions:

- `stripe-webhook`
- `create-checkout-session`
- `create-credits-checkout`
- `create-event-checkout`
- `create-portal-session`

Shared helper:

- `supabase/functions/_shared/paymentObservability.ts`

No change to:

- pricing
- Stripe product or price IDs
- credit pack definitions
- event ticket pricing behavior
- RevenueCat/native IAP implementation
- Ready Gate, swipe, or realtime behavior
- environment variables

## Webhook Idempotency Behavior

`stripe-webhook` now:

- verifies the Stripe signature before idempotency or settlement
- treats `event.id` as the webhook idempotency key
- inserts/claims `stripe_webhook_events` before settlement
- skips already processed/ignored/in-flight duplicate deliveries with a Stripe-friendly success response
- allows controlled retry for previously `failed` or `received` ledger rows
- records settlement success, failure, duplicate skip, ignored event type, and metadata rejection outcomes

Duplicate already-processed events do not re-run:

- credit increments
- subscription/profile settlement
- paid-event registration settlement
- credit-settlement notification sends

## Settlement Observability

Durable events now cover:

- checkout session created
- checkout session failed
- portal session created
- portal session failed
- webhook received / processing started
- webhook duplicate/replay skipped
- webhook settlement succeeded
- webhook settlement failed
- webhook ignored due unsupported type
- invalid or missing metadata
- premium subscription checkout settled
- subscription updated / canceled / past due
- credit pack settled
- credit pack duplicate checkout grant skipped
- event-ticket settlement result
- credit-settlement notification failure

## Duplicate-Safety Summary

Credits:

- global Stripe event replay is skipped by `stripe_webhook_events`
- checkout-session replay remains protected by `stripe_credit_checkout_grants`
- credit balance updates happen only after the checkout-session idempotency insert succeeds

Paid events:

- global Stripe event replay is skipped by `stripe_webhook_events`
- event ticket settlement remains protected by `stripe_event_ticket_settlements`
- `settle_event_ticket_checkout` remains the canonical registration/payment settlement path

Subscriptions:

- subscription checkout/update/delete/payment-failed paths remain upsert/update based and traceable
- `subscriptions` and profile tier semantics are preserved

## Tests Added

- `shared/matching/premiumCreditsObservability.test.ts`

Coverage:

- Stream 9 migration sorts after Stream 7
- validation SQL is catalog-only/read-only
- payment observability tables are internal-only
- raw-body Stripe signature verification remains before idempotency and settlement
- Stripe event ID idempotency is present
- duplicate processed webhooks skip settlement
- credit settlement cannot obviously double-increment on processed replay
- event-ticket settlement remains RPC-idempotent
- subscription lifecycle paths remain present
- metadata rejection and unsupported event paths are observable
- checkout/portal functions write durable observability
- helper sanitizes context and avoids raw Stripe payloads/secrets
- credit pack definitions and Stripe env names remain unchanged
- Streams 1-8 artifacts remain present

## Deploy Requirements

- Supabase migration deploy: required
- Edge Function deploys required:
  - `stripe-webhook`
  - `create-checkout-session`
  - `create-credits-checkout`
  - `create-event-checkout`
  - `create-portal-session`
- Environment variables: none
- Docker/local Supabase: not used

## Production Validation Procedure

After merge:

1. Verify linked project is `schdyxcunwcvddlcshwd / MVP_Vibe`.
2. Run `supabase db push --linked --dry-run`.
3. Continue only if the dry-run shows exactly `20260501220000_premium_credits_observability.sql`.
4. Run `supabase db push --linked`.
5. Run read-only validation SQL:
   - `supabase/validation/premium_credits_observability.sql`
6. Deploy only changed functions individually.

Do not create real checkout sessions or mutate production payment rows for validation.

## Remaining Deferred Work

- Physical-device Ready Gate/native QA
- Full native video-date polish beyond Ready Gate handoff
- Screenshot-led native visual parity
- Broader notification/provider operational QA
- RevenueCat/native entitlement production proof if not already captured outside this stream
