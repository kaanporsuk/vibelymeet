# VIBELY — STRIPE PROVIDER SHEET

**Date:** 2026-03-10  
**Baseline:** pre-native-hardening frozen baseline  
**Priority:** Tier 1 / revenue-critical

---

## 1. Purpose

This sheet is the provider-specific operating reference for Stripe.

It is meant to answer:
- what Stripe does in Vibely
- which checkout flows exist
- what lives in code versus in Stripe dashboard state
- which secrets and IDs are required
- how webhook settlement changes product state
- what must be verified during rebuild

This sheet is deliberately more operational than the general External Dependency Ledger.

---

## 2. Why Stripe is high-risk

Stripe is not optional in this baseline. It controls three monetization paths:
- Premium subscriptions
- one-off credit-pack purchases
- paid event tickets

And it also controls:
- billing portal access
- webhook-driven entitlement settlement
- Stripe customer identity persistence in `subscriptions`
- subscription-linked profile premium state

A rebuild can therefore appear healthy while still being commercially broken if any of the following are wrong:
- API secret
- plan price IDs
- webhook secret
- webhook endpoint registration
- customer portal availability
- event/credits checkout assumptions

---

## 3. What Stripe powers in Vibely

## A. Premium subscriptions
User chooses monthly or annual premium from `/premium`.

### Code entry points
- `src/pages/Premium.tsx`
- `src/hooks/useSubscription.ts`
- `supabase/functions/create-checkout-session`
- `supabase/functions/stripe-webhook`
- `supabase/functions/create-portal-session`

### Resulting data surfaces
- `subscriptions`
- `profiles.is_premium`

## B. Credit packs
User purchases one-time credit packs from `/credits`.

### Code entry points
- `src/pages/Credits.tsx`
- `src/pages/CreditsSuccess.tsx`
- `supabase/functions/create-credits-checkout`
- `supabase/functions/stripe-webhook`

### Resulting data surfaces
- `user_credits`
- optional notification via `send-notification`

## C. Paid event tickets
User pays for an event from the event payment modal.

### Code entry points
- `src/components/events/PaymentModal.tsx`
- `src/pages/EventPaymentSuccess.tsx`
- `supabase/functions/create-event-checkout`
- `supabase/functions/stripe-webhook`

### Resulting data surfaces
- `event_registrations.payment_status`
- event registration row settlement after webhook receipt

## D. Billing portal
Premium user can manage billing from settings.

### Code entry points
- `src/components/premium/PremiumSettingsCard.tsx`
- `supabase/functions/create-portal-session`

---

## 4. Stripe-related repo surfaces

## Edge Functions
- `create-checkout-session`
- `create-credits-checkout`
- `create-event-checkout`
- `create-portal-session`
- `stripe-webhook`
- `delete-account` (subscription cancellation path)

## Frontend
- `src/pages/Premium.tsx`
- `src/hooks/useSubscription.ts`
- `src/pages/Credits.tsx`
- `src/pages/CreditsSuccess.tsx`
- `src/components/events/PaymentModal.tsx`
- `src/pages/EventPaymentSuccess.tsx`
- `src/components/premium/PremiumSettingsCard.tsx`

## Database objects
- `subscriptions`
- `profiles.is_premium`
- `event_registrations.payment_status`
- `user_credits`

---

## 5. Secrets and IDs required by code

### Required Stripe secrets / identifiers
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_MONTHLY_PRICE_ID`
- `STRIPE_ANNUAL_PRICE_ID`

### Where they are used
#### `STRIPE_SECRET_KEY`
Used by:
- `create-checkout-session`
- `create-credits-checkout`
- `create-event-checkout`
- `create-portal-session`
- `stripe-webhook`
- `delete-account`

#### `STRIPE_WEBHOOK_SECRET`
Used by:
- `stripe-webhook`

#### `STRIPE_MONTHLY_PRICE_ID`
Used by:
- `create-checkout-session`
- `stripe-webhook` fallback plan inference

#### `STRIPE_ANNUAL_PRICE_ID`
Used by:
- `create-checkout-session`
- `stripe-webhook` fallback plan inference

### Operator rule
A correct Stripe secret is not enough. Subscription checkout also depends on valid live price IDs matching the intended products in Stripe.

---

## 6. What lives in code vs what lives in Stripe

This is the most important structural distinction for Stripe in Vibely.

## A. Subscription plans depend on Stripe catalog objects
Premium subscription checkout uses **pre-existing Stripe price IDs**.

### Implication
The following must exist in Stripe dashboard:
- monthly subscription price matching `STRIPE_MONTHLY_PRICE_ID`
- annual subscription price matching `STRIPE_ANNUAL_PRICE_ID`
- associated product(s) and recurring billing setup

### Why this matters
If these prices are missing, archived, or mismatched, premium checkout breaks even if the code and webhook are correct.

## B. Credit packs are priced inline in code
Credit pack checkout uses `price_data` defined in the function itself, not stored Stripe price IDs.

### Hardcoded credit packs in code
- `extra_time_3` → €2.99
- `extended_vibe_3` → €4.99
- `bundle_3_3` → €5.99

### Implication
These purchases do **not** depend on pre-created Stripe Price IDs.
They depend on:
- working `STRIPE_SECRET_KEY`
- correct inline pack definitions in code
- webhook settlement working

### Rebuild consequence
Changing credit-pack pricing or composition is a **code change**, not just a Stripe dashboard change.

## C. Event tickets are priced inline per request
Event ticket checkout also uses inline `price_data` rather than stored Stripe Price IDs.

### Inputs passed from frontend
- `eventId`
- `eventTitle`
- `price`
- `currency` (defaults to `eur`)

### Implication
Event pricing truth is primarily in app/event data and frontend invocation, not in pre-created Stripe catalog prices.

### Rebuild consequence
Paid event checkout depends on:
- working `STRIPE_SECRET_KEY`
- valid event pricing flow in the app
- webhook settlement creating/updating `event_registrations`

---

## 7. Stripe customer model in Vibely

Vibely persists Stripe customer identity in the `subscriptions` table.

### Relevant columns
- `stripe_customer_id`
- `stripe_subscription_id`
- `status`
- `plan`
- `current_period_end`

### Observed behavior
For all three monetization flows, the code tries to:
1. read `subscriptions.stripe_customer_id` for the current user  
2. create a Stripe customer if missing  
3. reuse that customer for checkout or portal access

### Important implication
Even users without an active subscription may still end up using the `subscriptions` table as the canonical place where their Stripe customer ID is stored.

This makes the table both:
- a subscription-state table
- a cross-flow Stripe identity anchor

---

## 8. Webhook settlement behavior

The `stripe-webhook` function is the state-settlement engine.

### Webhook verification
It requires:
- request header: `stripe-signature`
- secret: `STRIPE_WEBHOOK_SECRET`

Without both, the function rejects the event.

## Events explicitly handled in code
- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`

## A. `checkout.session.completed`
This is polymorphic and branches on metadata.

### Subscription checkout path
Expected metadata includes:
- `supabase_user_id`
- `plan`

Behavior:
- retrieves Stripe subscription
- upserts `subscriptions`
- sets `profiles.is_premium = true`

### Credit-pack checkout path
Expected metadata includes:
- `type = credits_pack`
- `supabase_user_id`
- `pack_id`
- `extra_time_credits`
- `extended_vibe_credits`

Behavior:
- increments or creates `user_credits`
- logs a console message for purchase settlement
- attempts to send a `credits_subscription` notification via `send-notification`

### Event-ticket checkout path
Expected metadata includes:
- `type = event_ticket`
- `supabase_user_id`
- `event_id`

Behavior:
- upserts `event_registrations`
- sets `payment_status = paid`

## B. `customer.subscription.updated`
Behavior:
- upserts `subscriptions`
- derives `plan` from metadata if available, otherwise infers annual vs monthly using Stripe price ID match

## C. `customer.subscription.deleted`
Behavior:
- marks subscription row `status = canceled`
- sets `profiles.is_premium = false`

## D. `invoice.payment_failed`
Behavior:
- loads subscription from Stripe
- marks local `subscriptions.status = past_due`

### Important observation
The webhook is not just informative. It is the canonical source that finalizes entitlements and payment-linked state.

If the webhook is not registered or the secret is wrong:
- Premium status can fail to activate
- credits can fail to arrive
- paid event registration can fail to settle

---

## 9. Checkout flow details

## A. Premium checkout
### Source
- `/premium`

### User choices in frontend
- monthly
- annual

### Displayed pricing in UI
- monthly: `€14.99 / month`
- annual effective monthly: `€12.49 / month`
- annual billed amount shown: `€149.90 annually`

### Important note
These UI prices are presentation-layer values. The **actual charge authority** for subscriptions is the Stripe Price ID selected by:
- `STRIPE_MONTHLY_PRICE_ID`
- `STRIPE_ANNUAL_PRICE_ID`

### Return URLs
- success: `/subscription/success?session_id={CHECKOUT_SESSION_ID}`
- cancel: `/subscription/cancel`

## B. Credits checkout
### Source
- `/credits`

### Packs sold in UI and function
- `extra_time_3`
- `extended_vibe_3`
- `bundle_3_3`

### Return URLs
- success: `/credits/success?pack=<packId>`
- cancel: `/credits?cancelled=true`

### Important note
The success page refetches local credits state, but the real entitlement still depends on webhook completion.

## C. Event-ticket checkout
### Source
- event payment modal

### Guardrails before session creation
- user must be authenticated
- user must not already be registered for the event
- premium/vip visibility events require active/trialing subscription status

### Return URLs
- success: `/event-payment/success?event_id=<eventId>`
- cancel: `/events/<eventId>`

### Important note
The success page invalidates queries and shows success UI, but actual registration settlement depends on webhook completion.

---

## 10. Billing portal behavior

`create-portal-session`:
- requires authenticated user
- loads `subscriptions.stripe_customer_id`
- fails if no billing account exists
- creates a billing portal session with return URL `/settings`

### Outside-repo dependency
Stripe billing portal must be available/configured in the Stripe account.

### Rebuild implication
A user can be marked premium locally but still fail to open billing management if:
- no `stripe_customer_id` exists
- portal setup is not enabled/usable in Stripe

---

## 11. Account deletion interaction

`delete-account` contains Stripe cleanup logic.

### Observed behavior
If the user has an active/trialing subscription with `stripe_subscription_id`, the function attempts to cancel it directly against Stripe.

### Implication
Stripe is part of account-lifecycle correctness, not only checkout.

### Risk
If `STRIPE_SECRET_KEY` is missing or stale, account deletion can partially complete while Stripe cancellation fails.

---

## 12. What the repo proves vs what it does not prove

## What the repo proves strongly
- which functions call Stripe
- required secret names and price-ID names
- checkout metadata contracts
- local settlement behavior in `stripe-webhook`
- the schema fields used to persist Stripe state
- UI return paths and plan/pack labels

## What the repo does not prove strongly
- exact live Stripe account being used
- whether monthly/annual prices still exist and are active
- exact live webhook endpoint configured in Stripe
- which webhook event types are subscribed in dashboard
- whether billing portal is enabled/configured exactly as expected
- whether additional Stripe products/prices exist beyond what code references

---

## 13. Stripe-specific rebuild risks

## Risk 1 — Subscriptions depend on dashboard-managed price IDs
Premium checkout will fail or charge the wrong product if `STRIPE_MONTHLY_PRICE_ID` / `STRIPE_ANNUAL_PRICE_ID` drift.

## Risk 2 — Credits and events depend on code-defined pricing
These flows do not require pre-created Price IDs, but the pricing truth is partly embedded in code.

## Risk 3 — Webhook registration is essential
Without `stripe-webhook` registration and the correct `STRIPE_WEBHOOK_SECRET`, successful checkout does not translate into settled entitlements.

## Risk 4 — Success pages can create false confidence
The app redirects to success URLs immediately after Stripe Checkout, but final state changes still rely on webhook processing.

## Risk 5 — Customer identity is persisted in `subscriptions`
Corruption or absence of `stripe_customer_id` affects not only subscriptions but also credits/event checkout reuse and billing portal access.

## Risk 6 — Delete-account touches Stripe too
A missing or stale Stripe secret can leave a deleted user with a still-active Stripe subscription.

---

## 14. Minimum Stripe verification procedure

### Step 1 — Secret verification
Confirm presence and correctness of:
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_MONTHLY_PRICE_ID`
- `STRIPE_ANNUAL_PRICE_ID`

### Step 2 — Dashboard object verification
Confirm in Stripe:
- monthly price exists and is active
- annual price exists and is active
- billing portal is available if intended

### Step 3 — Webhook verification
Confirm:
- webhook endpoint points to deployed `stripe-webhook`
- secret matches `STRIPE_WEBHOOK_SECRET`
- required event types are subscribed

### Step 4 — Premium checkout test
Verify:
- checkout session opens
- webhook updates `subscriptions`
- `profiles.is_premium` becomes true
- manage-subscription portal opens successfully

### Step 5 — Credit-pack test
Verify:
- checkout session opens
- webhook increments `user_credits`
- success UI aligns with settled credits state

### Step 6 — Event-ticket test
Verify:
- checkout session opens
- webhook creates/updates paid `event_registrations`
- event success screen aligns with actual registration state

### Step 7 — Cancellation/failure test
Verify:
- subscription deletion updates local status and premium flag
- invoice failure marks `past_due`
- account deletion attempts Stripe cancellation when applicable

---

## 15. Known unknowns to resolve in the next Stripe-focused audit

1. What is the exact live Stripe account/workspace for this baseline?  
2. What are the exact monthly and annual Stripe price IDs currently active in production?  
3. Which webhook event types are subscribed on the live endpoint?  
4. Is the billing portal enabled and configured with any important dashboard-only settings?  
5. Are there any additional credit or event-related products in Stripe that are not used by current code?  
6. Are there any tax, currency, or locale settings in Stripe dashboard that materially affect checkout behavior?  

---

## 16. Recommended next provider sheet after Stripe

The strongest next provider sheet is:

**VIBELY_BUNNY_PROVIDER_SHEET.md**

Reason:
- Bunny is the next most fragile multi-surface integration
- it combines upload auth, storage, CDN delivery, video processing, and webhook settlement
- several critical pieces live outside the repo and fail silently when misconfigured

---

## 17. Bottom line

Stripe in Vibely is not just a payment button.

It is a state-transition system for:
- premium entitlements
- credit balances
- paid event registration settlement
- billing-account identity
- account-lifecycle cleanup

To rebuild it correctly, you need more than the code:
- working secrets
- valid plan price IDs
- a live webhook endpoint with matching secret
- a usable billing portal
- verification that webhook-settled state matches product expectations

This sheet is the provider-level control point for that reality.

