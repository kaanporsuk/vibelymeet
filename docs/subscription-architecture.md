# Subscription architecture (web + native)

## Single source of truth: `subscriptions` table

Both **Stripe** (web checkout) and **RevenueCat** (iOS/Android) write subscription state into the same Postgres table via Edge Functions:

| Path | Edge Function | Effect |
|------|---------------|--------|
| Web pays via Stripe | `stripe-webhook` | Upserts `subscriptions` (status, plan, `current_period_end`, `provider`, etc.) |
| Native pays via RevenueCat | `revenuecat-webhook` | Same table, typically `provider` indicating store |

## How clients read premium

- **Web** may use `check_premium_status` RPC and/or UI that reflects Stripe session state.
- **Native** uses `useBackendSubscription` (`apps/mobile/lib/subscriptionApi.ts`): loads `subscriptions` for the user (active/trialing wins), then falls back to `profiles.is_premium`.

Premium UI can use client entitlement hooks to show or hide city-browse controls, but **event visibility is enforced inside `get_visible_events`**. Web and native may pass `p_is_premium: false`; the RPC ignores that flag, binds `p_user_id` to `auth.uid()` for non-service callers, and derives city-browse access from Postgres subscription/profile/admin state.

## Cross-platform consistency

- A user who subscribes on **web** should show as premium on **native** once `stripe-webhook` has written `subscriptions`.
- A user who subscribes on **native** should show as premium on **web** once `revenuecat-webhook` has written the same table.
- Edge case: SDK-only checks without DB sync can drift — prefer reading **`subscriptions` (and RPCs derived from it)** for authoritative status.

## Secrets (reference)

- Stripe: `STRIPE_SECRET_KEY`, webhook secret, price IDs.
- RevenueCat: `REVENUECAT_WEBHOOK_AUTHORIZATION` on `revenuecat-webhook`.

## LOVABLE_API_KEY

Present in Supabase Edge secrets; **no references in `supabase/functions/`** source in this repo — likely platform/deploy hook. Safe to leave until confirmed unused; remove only after verifying nothing external calls it.
