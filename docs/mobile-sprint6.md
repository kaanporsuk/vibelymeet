# Mobile — Sprint 6: RevenueCat Entitlements + Release Hardening

Sprint 6 adds native in-app purchases via RevenueCat, a canonical backend entitlement model shared with web (Stripe), and release-readiness documentation. Web billing is unchanged and remains fully functional.

## Repo contracts inspected

### Web billing today
- **Checkout:** `create-checkout-session` (monthly/annual), `create-credits-checkout` (credit packs), `create-portal-session` (customer portal). All use Stripe; look up `subscriptions.stripe_customer_id` by `user_id`.
- **Webhook:** `stripe-webhook` handles `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`; upserts `subscriptions`, previously updated `profiles.is_premium` directly.
- **Tables:** `subscriptions` (user_id, stripe_customer_id, stripe_subscription_id, status, plan, current_period_end); `profiles.is_premium`; `user_credits` for credit packs.
- **Web reads:** `useSubscription` (subscriptions), `usePremium` (profiles.is_premium, premium_until), `useCredits` (user_credits). `check_premium_status` RPC and `get_user_subscription_status` RPC.

### Credit/premium semantics
- **Subscription:** One row per user per provider (Stripe or RevenueCat); status active/trialing → premium. Plan (monthly/annual) and current_period_end.
- **Credits:** user_credits (extra_time, extended_vibe, super_vibe); Stripe credit-pack checkout → webhook adds to user_credits. No change in Sprint 6.
- **Feature gates:** Backend-owned; `profiles.is_premium` and subscription status drive premium features.

### RevenueCat
- Nothing was present in repo before Sprint 6. Premium screen was a placeholder. Backend had no RevenueCat path; now one subscription row per user with `provider = 'revenuecat'` and webhook sync.

## Canonical entitlement model implemented

- **subscriptions table extended:** `provider` (text, default `'stripe'`), unique on `(user_id, provider)`. Existing rows backfilled as `provider = 'stripe'`. Added `rc_product_id`, `rc_original_app_user_id` for RevenueCat rows.
- **Trigger:** `sync_profiles_is_premium_from_subscriptions` — on INSERT/UPDATE/DELETE of `subscriptions`, sets `profiles.is_premium` to true if any row for that user has `status IN ('active','trialing')`, else false. Single source of truth for premium flag from any provider.
- **RPCs:** `get_user_subscription_status` returns effective status (any active/trialing first). `check_premium_status` returns true if any subscription is active/trialing or profile.is_premium (admin grant).
- **Stripe webhook:** All upserts/updates now include `provider: 'stripe'`; conflict target `user_id,provider`; removed direct `profiles.is_premium` updates (trigger handles it). Deleted/failed updates filter by `provider = 'stripe'`.
- **Web:** `create-checkout-session`, `create-portal-session`, `create-credits-checkout` query `subscriptions` with `.eq('provider', 'stripe')` so only Stripe customer id is used for web flows. `useSubscription` fetches all rows for user and derives isPremium/plan from any active/trialing row.

## RevenueCat mobile integration implemented

- **SDK:** `react-native-purchases` in `apps/mobile`. Wrapper in `lib/revenuecat.ts`: `initRevenueCat(apiKey)`, `setRevenueCatUserId(userId)`, `getOfferings()`, `purchasePackage(pkg)`, `restorePurchases()`. Initialization in `_layout.tsx` and on premium screen; `setRevenueCatUserId` when user is logged in and opening premium.
- **Env:** `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` and/or `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` (preferred), or `EXPO_PUBLIC_REVENUECAT_API_KEY` (fallback for both). If all unset, premium screen shows backend state and “In-app purchases are not configured” instead of packages.
- **Premium screen** (`app/premium.tsx`): Reads canonical state via `useBackendSubscription` (subscriptions + profiles). If RevenueCat configured, loads offerings and shows packages; purchase and restore call SDK then `refetch` backend. Handles loading, already premium, no offerings, and not-configured states without faking success.

## Backend sync / reconciliation implemented

- **revenuecat-webhook Edge Function:** New function at `supabase/functions/revenuecat-webhook/index.ts`. Verifies `Authorization` header against `REVENUECAT_WEBHOOK_AUTHORIZATION`. Parses RevenueCat event (app_user_id = Supabase user id), maps:
  - `INITIAL_PURCHASE`, `RENEWAL`, `UNCANCELLATION`, `SUBSCRIPTION_EXTENDED`, `TEMPORARY_ENTITLEMENT_GRANT` → upsert `subscriptions` with `provider = 'revenuecat'`, status active/trialing, plan from product_id, current_period_end from expiration_at_ms.
  - `CANCELLATION`, `EXPIRATION` → update row to canceled/inactive.
  - `BILLING_ISSUE` → past_due.
  - `TEST` → no-op.
- **Idempotency:** Upsert on `(user_id, provider)`; duplicate events overwrite same row.
- **External configuration required:** In RevenueCat dashboard: set webhook URL to `https://<project>.supabase.co/functions/v1/revenuecat-webhook` and set the same secret as `REVENUECAT_WEBHOOK_AUTHORIZATION` in Supabase Edge Function secrets. Not done in repo.

## Release hardening completed

- **App config:** No new native config beyond existing (Daily, OneSignal). RevenueCat SDK works with existing Expo dev builds.
- **Env documentation:** `.env.example` and `README.md` list `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`, and `EXPO_PUBLIC_REVENUECAT_API_KEY` (fallback); README lists all required env vars and “Release readiness” section.
- **Dev build vs Expo Go:** README states that video and in-app purchases require a development build (prebuild or EAS); Expo Go not supported for these features.
- **External dashboards:** Documented: RevenueCat (project, apps, products, offerings, webhook URL + auth header); Supabase (deploy revenuecat-webhook, set webhook secret). Store submission and final dashboard setup are out of scope for Sprint 6.

## Backend/shared changes made

| Change | Web impact |
|--------|------------|
| Migration `20260312000000_subscriptions_provider_revenuecat.sql` | Additive. Existing rows get `provider = 'stripe'`. Trigger syncs `is_premium`; no breaking change. |
| Stripe webhook: provider in upserts, conflict `user_id,provider`, no direct profile update | Trigger now owns `is_premium`; behavior unchanged for Stripe-only users. |
| create-checkout-session, create-portal-session, create-credits-checkout: filter `.eq('provider', 'stripe')` | Ensures web always uses Stripe row; safe. |
| useSubscription: fetch all rows, derive isPremium/plan from any active | Supports multiple rows; existing single-row behavior preserved. |
| Supabase types: subscriptions Row/Insert/Update + provider, rc_* | Type safety only. |
| New Edge Function revenuecat-webhook | None; called by RevenueCat only. |

## Web impact

None. All changes are backward-compatible. Web continues to use Stripe; premium and subscription state are derived from the same `subscriptions` and `profiles.is_premium` with trigger.

## Checks executed

- `npm run typecheck:core` (root)
- `npm run build` (root)
- `./scripts/run_golden_path_smoke.sh` (root)
- `cd apps/mobile && npm run typecheck`

## Checks not executed

- Migration applied against a real Supabase project (no `supabase db push` in this run).
- RevenueCat webhook delivery (dashboard and secret not configured in repo).
- Real device purchase/restore (requires RevenueCat dashboard and store config).
- EAS Build or store submission.

## Remaining gaps after Sprint 6

- RevenueCat dashboard: create project, link iOS/Android apps, create products and offerings, configure webhook URL and authorization header.
- Supabase: deploy `revenuecat-webhook`, set `REVENUECAT_WEBHOOK_AUTHORIZATION` secret.
- Credit packs on mobile: not implemented; backend and Stripe webhook support them for web only. Can be added later via RevenueCat or separate flow.
- App Store / Play Store submission and store-specific configuration (e.g. signing, store listings) are out of scope.

## Recommended next step

1. Merge `sprint-6-revenuecat-release` into main.
2. Apply migration to target Supabase project; deploy `revenuecat-webhook` and set webhook secret.
3. Configure RevenueCat dashboard (apps, products, offerings, webhook).
4. Run a dev build and validate premium screen (offerings, purchase, restore) and backend sync (webhook → subscriptions → is_premium).
5. Proceed to store submission and production configuration when ready.
