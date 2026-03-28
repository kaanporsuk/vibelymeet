# Entitlements migration guide (tier capabilities)

This document lists **current** premium/subscription gates and the **target** pattern once `useEntitlements` (merged `tiers.ts` + `tier_config_overrides`) is wired everywhere. It also records **Step 1 migration verification** and a **deployment checklist**.

---

## Step 1 — Migration files (tier / premium work)

| File | Status | Notes |
|------|--------|--------|
| `supabase/migrations/20260331100000_premium_history_table_and_indexes.sql` | **VALID** | `CREATE TABLE IF NOT EXISTS`, `idx_premium_history_user_id`, `idx_premium_history_created_at`, admin RLS. No duplicate `CREATE TABLE` elsewhere in repo. |
| `supabase/migrations/20260331110000_stripe_credit_checkout_grants.sql` | **VALID** | Ledger table; `REVOKE ALL` on `PUBLIC`, `anon`, `authenticated` as required. |
| `supabase/migrations/20260331120000_check_premium_sync_profiles_get_visible_events.sql` | **VALID** | `check_premium_status`: two `EXISTS` branches ORed (no `COALESCE` scalar wrapper). `sync_profiles_is_premium_from_subscriptions`: keeps `is_premium` when `premium_until > now()`. `get_visible_events`: adds `v_profile_premium` into `v_can_premium_browse`. |
| `supabase/migrations/20260331130000_profiles_subscription_tier.sql` | **VALID** | `subscription_tier` column, backfill, `get_user_tier`, `protect_sensitive_profile_columns` extended for `subscription_tier`. |
| `supabase/migrations/20260331140000_tier_config_overrides.sql` | **VALID** | Overrides + audit + RPCs; realtime `ALTER PUBLICATION` wrapped in `DO $$ … EXCEPTION WHEN duplicate_object`. |
| `supabase/migrations/20260312000000_subscriptions_provider_revenuecat.sql` | **Superseded (body)** | Still defines an older `check_premium_status`; migration **20260331120000** replaces it on `db push`. Do not edit the historical file in place. |

---

## Gate inventory — target: `useEntitlements()` from `@/hooks/useEntitlements`

Until that hook exists in this branch, use **`useSubscription().isPremium`** (Stripe subscription) or **`usePremium().isPremium`** (`profiles.is_premium` / admin grants) as noted.

### HIGH — user-facing product gates

| Feature | Location | Current | Target | Priority |
|--------|----------|---------|--------|----------|
| Who liked you (rail / blur) | `src/pages/Matches.tsx` (~L69, L459–472) | `useSubscription().isPremium` | `useEntitlements().canSeeLikedYou` | HIGH |
| Who liked you | `apps/mobile/app/(tabs)/matches/index.tsx` (~L106, L820–822) | `useBackendSubscription().isPremium` | `useEntitlements().canSeeLikedYou` | HIGH |
| Who liked you CTA | `src/components/premium/WhoLikedYouGate.tsx` | No entitlement check (navigation only) | Optional: align CTA with `canSeeLikedYou` when parent uses entitlements | MEDIUM |
| Event city browse + filters | `src/pages/Events.tsx` (~L170, L183–204, L374) | `useSubscription().isPremium` | `useEntitlements().canCityBrowse` | HIGH |
| Event filter bar locks | `src/components/events/EventsFilterBar.tsx` (~L71, L384–411) | `isPremium` prop from parent | Parent passes `canCityBrowse` from `useEntitlements()` | HIGH |
| Event city browse (native) | `apps/mobile/app/(tabs)/events/index.tsx` (~L633–691, L911) | `useBackendSubscription().isPremium` | `useEntitlements().canCityBrowse` | HIGH |
| Event filter sheet (native) | `apps/mobile/components/events/EventFilterSheet.tsx` (~L73–101, L335–374) | `isPremium` prop | `canCityBrowse` from entitlements | HIGH |
| Event visibility (premium/VIP registration) | `src/pages/EventDetails.tsx` (~L51, L504) | `useSubscription().isPremium`; blocks both `premium` and `vip` with same flag | `canAccessPremiumEvents` / `canAccessVipEvents` from `useEntitlements()` | HIGH |
| Visible events RPC param | `src/hooks/useVisibleEvents.ts` (~L105) | `p_is_premium: false` (server now infers browse via subs + profile) | Keep `false` or pass client hint only if product needs it; **server** `get_visible_events` uses `v_profile_premium` | MEDIUM |
| Events list / next event (native) | `apps/mobile/lib/eventsApi.ts` (~L117–205, L337–418) | `isPremium` boolean through stack | Derive from `canCityBrowse` / tier for RPC params naming | HIGH |
| Home / next event | `apps/mobile/app/(tabs)/index.tsx` (~L126–132) | `useBackendSubscription().isPremium` | Entitlements for city browse if surfaced | MEDIUM |

### MEDIUM — billing / display / settings

| Feature | Location | Current | Target | Priority |
|--------|----------|---------|--------|----------|
| Premium paywall page | `src/pages/Premium.tsx` | `useSubscription()` | Subscription purchase flow stays; feature bullets should match `TIERS` / marketing | LOW |
| Premium (native) | `apps/mobile/app/premium.tsx` | `useBackendSubscription()` | Same | LOW |
| Premium settings card | `src/components/premium/PremiumSettingsCard.tsx` (~L12) | `useSubscription().isPremium` | Keep for **billing** state; optional second line from `useEntitlements().tierLabel` | MEDIUM |
| Settings premium copy | `src/pages/Settings.tsx` (~L46, L101) | `usePremium()` | Display: `tierLabel` / badge from entitlements; billing from subscription | MEDIUM |
| Account drawer | `src/components/settings/AccountSettingsDrawer.tsx` (~L79, L440, L461–474) | `usePremium()` | Same split | MEDIUM |
| Profile badge (web) | `src/pages/Profile.tsx` (~L282, L680) | `usePremium().isPremium` | `useEntitlements().hasBadge` + `getUserBadge` / tier | MEDIUM |
| Profile Studio | `src/pages/ProfileStudio.tsx` (~L324, L858) | `usePremium().isPremium` | Feature-gated studio tools → capability flags | MEDIUM |
| Profile (legacy) | `src/pages/Profile.legacy.tsx` | `usePremium()` | Same as Profile | LOW |
| Account settings (native) | `apps/mobile/app/settings/account.tsx` | RevenueCat + copy | Billing vs tier display | MEDIUM |
| Profile tab legacy | `apps/mobile/app/(tabs)/profile/index.legacy.tsx` | `is_premium` / `premium_until` | `useEntitlements()` + subscription | LOW |

### LOW — admin / analytics / bootstrap

| Feature | Location | Current | Target | Priority |
|--------|----------|---------|--------|----------|
| Event visibility labels | `src/components/admin/AdminEventFormModal.tsx` (~L668) | Admin UI labels | No change (admin) | LOW |
| Bootstrap payload | `src/hooks/useAppBootstrap.ts` (~L68) | `is_premium` on user object | Add `subscription_tier` / capability snapshot if clients need it | LOW |
| Stub | `src/utils/isPremiumFeature.ts` | Stub | Replace with registry keys or remove | LOW |

---

## Server-side: still boolean / subscription-oriented

These should eventually align with `subscription_tier`, `check_premium_status`, or tier-capability checks:

| Area | File / object | Current mechanism |
|------|----------------|-------------------|
| Paid event checkout | `supabase/functions/create-event-checkout/index.ts` | `subscriptions.status` → `isPremium` for premium-only events |
| Premium geocode gate | `supabase/functions/forward-geocode/index.ts` | `subscriptions` active/trialing + admin role (no `profiles.is_premium` / `premium_until`) |
| Account deletion cleanup | `supabase/functions/delete-account/index.ts` | Sets `is_premium: false` |
| Stripe webhook | `supabase/functions/stripe-webhook/index.ts` | Subscriptions upsert; credit packs (optional: `stripe_credit_checkout_grants` idempotency not wired in snippet reviewed) |
| RevenueCat webhook | `supabase/functions/revenuecat-webhook/index.ts` | `subscriptions` upsert |
| RPC | `get_visible_events` | After migration **20260331120000**, uses `v_sub_active`, `v_is_admin`, **`v_profile_premium`** |
| RPC | `check_premium_status` | Two-`EXISTS` pattern after **20260331120000** |
| RPC | `get_user_tier` | Added in **20260331130000** |

---

## Deployment checklist

Paste and run after merging; adjust project id if needed.

```
/*
 * DEPLOYMENT CHECKLIST (run manually or via deploy script)
 *
 * 1) supabase db push
 *    (applies pending migrations including premium_history, stripe_credit_checkout_grants,
 *     check_premium_status / sync_profiles / get_visible_events, subscription_tier, tier_config)
 *
 * 2) Verify in SQL editor:
 *    - Indexes: SELECT indexname FROM pg_indexes WHERE tablename = 'premium_history';
 *      (expect idx_premium_history_user_id, idx_premium_history_created_at)
 *    - SELECT to_regclass('public.stripe_credit_checkout_grants');
 *    - SELECT column_name FROM information_schema.columns
 *      WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'subscription_tier';
 *    - SELECT to_regclass('public.tier_config_overrides');
 *    - SELECT to_regclass('public.tier_config_audit');
 *
 * 3) Verify function bodies:
 *    - SELECT proname, prosrc FROM pg_proc WHERE proname = 'check_premium_status';
 *      (expect OR of two EXISTS-style branches, not COALESCE(scalar subquery))
 *    - get_visible_events should reference v_profile_premium (in prosrc) after migration.
 *
 * 4) Redeploy Edge Functions:
 *    supabase functions deploy stripe-webhook
 *    supabase functions deploy revenuecat-webhook
 *    supabase functions deploy create-event-checkout
 *    supabase functions deploy create-credits-checkout
 *    supabase functions deploy forward-geocode
 *    supabase functions deploy delete-account
 *
 * 5) Regenerate types:
 *    npx supabase gen types typescript --project-id schdyxcunwcvddlcshwd --schema public > src/integrations/supabase/types.ts
 *
 * 6) Smoke queries:
 *    SELECT subscription_tier FROM profiles LIMIT 5;
 *    SELECT * FROM tier_config_overrides LIMIT 5;   -- expect empty until admin overrides
 *    SELECT proname FROM pg_proc WHERE proname IN ('check_premium_status','get_user_tier','set_tier_config_override');
 */
```

---

## Afterword

- **Do not** migrate UI gates in this doc until `src/hooks/useEntitlements.ts` and `apps/mobile/hooks/useEntitlements.ts` exist and import merged config from `supabase/functions/_shared/tiers.ts` (`@shared/tiers`).
- **VIP vs Premium copy** on marketing pages must match `TIERS` (Premium does **not** include VIP events unless overridden in DB).
