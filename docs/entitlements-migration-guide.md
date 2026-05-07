# Entitlements migration guide (tier capabilities)

This document lists premium/subscription gates and the backend-authoritative tier capability model used by **`useEntitlements`** from `@/hooks/useEntitlements`. It also records migration verification and a deployment checklist.

**Naming — do not confuse hooks**

- **Tier capabilities:** `useEntitlements()` from `@/hooks/useEntitlements` (web) or `apps/mobile/hooks/useEntitlements.ts` (`@/hooks/useEntitlements` on native). Fetches backend-resolved capabilities from `get_user_tier_capabilities`; realtime changes to `profiles.subscription_tier` and `tier_config_overrides` invalidate the client cache.
- **Pause / resume account:** `useAccountStatus()` from `@/contexts/AuthContext` — `{ pauseAccount, resumeAccount, isAdmin }`. This replaced the old Auth-context name `useEntitlements` to avoid clashing with the tier hook.

---

## Step 1 — Migration files (tier / premium work)

| File | Status | Notes |
|------|--------|--------|
| `supabase/migrations/20260331100000_premium_history_table_and_indexes.sql` | **VALID** | `CREATE TABLE IF NOT EXISTS`, `idx_premium_history_user_id`, `idx_premium_history_created_at`, admin RLS. No duplicate `CREATE TABLE` elsewhere in repo. |
| `supabase/migrations/20260331110000_stripe_credit_checkout_grants.sql` | **VALID** | Ledger table; `REVOKE ALL` on `PUBLIC`, `anon`, `authenticated` as required. |
| `supabase/migrations/20260331120000_check_premium_sync_profiles_get_visible_events.sql` | **VALID** | `check_premium_status`: two `EXISTS` branches ORed (no `COALESCE` scalar wrapper). `sync_profiles_is_premium_from_subscriptions`: keeps `is_premium` when `premium_until > now()`. `get_visible_events`: adds `v_profile_premium` into `v_can_premium_browse`. |
| `supabase/migrations/20260331130000_profiles_subscription_tier.sql` | **VALID** | `subscription_tier` column, backfill, `get_user_tier`, `protect_sensitive_profile_columns` extended for `subscription_tier`. |
| `supabase/migrations/20260331140000_tier_config_overrides.sql` | **VALID** | Overrides + audit + RPCs; realtime `ALTER PUBLICATION` wrapped in `DO $$ … EXCEPTION WHEN duplicate_object`. |
| `supabase/migrations/20260507190000_tier_config_backend_authority.sql` | **PENDING APPLY** | Canonical backend capability resolution, override validation, tier gates, monthly credit split, and `get_user_tier_capabilities` / `get_tier_capabilities`. |
| `supabase/migrations/20260312000000_subscriptions_provider_revenuecat.sql` | **Superseded (body)** | Still defines an older `check_premium_status`; migration **20260331120000** replaces it on `db push`. Do not edit the historical file in place. |

---

## Gate inventory — target: `useEntitlements()` from `@/hooks/useEntitlements`

Use subscription hooks for billing state only. Product access should read capability flags from `useEntitlements()` or server-side `get_user_tier_capabilities`.

### HIGH — user-facing product gates

| Feature | Location | Current | Target | Priority |
|--------|----------|---------|--------|----------|
| Who liked you (rail / blur) | `src/pages/Matches.tsx` | `useEntitlements().canSeeLikedYou` | Done — keep capability-based | DONE |
| Who liked you | `apps/mobile/app/(tabs)/matches/index.tsx` | `useEntitlements().canSeeLikedYou` | Done — keep capability-based | DONE |
| Who liked you CTA | `src/components/premium/WhoLikedYouGate.tsx` | No entitlement check (navigation only) | Optional: align CTA with `canSeeLikedYou` when parent uses entitlements | MEDIUM |
| Event city browse + filters | `src/pages/Events.tsx` | `useEntitlements().canCityBrowse` | Done — keep capability-based | DONE |
| Event filter bar locks | `src/components/events/EventsFilterBar.tsx` | Parent passes `canCityBrowse` from `useEntitlements()` | Done — keep capability-based | DONE |
| Event city browse (native) | `apps/mobile/app/(tabs)/events/index.tsx` | `useEntitlements().canCityBrowse` | Done — keep capability-based | DONE |
| Event filter sheet (native) | `apps/mobile/components/events/EventFilterSheet.tsx` | `canCityBrowse` prop from entitlements | Done — keep capability-based | DONE |
| Event visibility (premium/VIP registration) | `src/pages/EventDetails.tsx` / `apps/mobile/app/(tabs)/events/[id].tsx` | `canAccessPremiumEvents` / `canAccessVipEvents` from `useEntitlements()` | Done — keep Premium and VIP distinct | DONE |
| Visible events RPC param | `src/hooks/useVisibleEvents.ts` | `p_is_premium: false`; server infers capability via `get_visible_events` | Done — keep client hint non-authoritative | DONE |
| Events list / next event (native) | `apps/mobile/lib/eventsApi.ts` | `canCityBrowse` boolean through stack for request shape; server remains authoritative | Done — keep capability-based | DONE |
| Home / next event | `apps/mobile/app/(tabs)/index.tsx` | `useEntitlements().canCityBrowse` | Done — keep capability-based | DONE |

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
| Profile (legacy) | Removed in onboarding/auth closure (PR #163) | N/A | N/A | LOW |
| Account settings (native) | `apps/mobile/app/settings/account.tsx` | RevenueCat + copy | Billing vs tier display | MEDIUM |
| Profile tab legacy | Removed in onboarding/auth closure (PR #163) | N/A | N/A | LOW |

### LOW — admin / analytics / bootstrap

| Feature | Location | Current | Target | Priority |
|--------|----------|---------|--------|----------|
| Event visibility labels | `src/components/admin/AdminEventFormModal.tsx` (~L668) | Admin UI labels | No change (admin) | LOW |
| Bootstrap payload | `src/hooks/useAppBootstrap.ts` (~L68) | `is_premium` on user object | Add `subscription_tier` / capability snapshot if clients need it | LOW |
| ~~isPremiumFeature.ts~~ | ~~`src/utils/isPremiumFeature.ts`~~ | Deleted — was an unused stub | N/A | N/A |

---

## Server-side: tier, RPCs, and webhooks

| Area | File / object | Mechanism |
|------|----------------|-----------|
| Paid event checkout | `supabase/functions/create-event-checkout/index.ts` | Uses **`get_user_tier_capabilities`** for `accessibleEventTiers` and `monthlyEventJoins`; no inline access map. **Premium users cannot register for VIP-only events** unless the backend capability grants VIP access. |
| Date suggestion actions | `supabase/functions/date-suggestion-actions/index.ts` | Uses **`get_user_tier_capabilities`** for `canSuggestDate` and `canUseVibeSchedule`. |
| Premium geocode gate | `supabase/functions/forward-geocode/index.ts` | **`check_premium_status`** RPC + admin role via `user_roles`. |
| Account deletion cleanup | `supabase/functions/delete-account/index.ts` | Stripe cancel scoped to **`provider = 'stripe'`**; sets `is_premium: false` and `subscription_tier: 'free'` when cancel succeeds. |
| Stripe webhook | `supabase/functions/stripe-webhook/index.ts` | Subscriptions upsert (`provider: 'stripe'`); credit packs with **`stripe_credit_checkout_grants`** idempotency; `subscription_tier` on checkout / delete. |
| RevenueCat webhook | `supabase/functions/revenuecat-webhook/index.ts` | `subscriptions` upsert (`provider: 'revenuecat'`); `subscription_tier` on active / cancel / expire. |

UI and server paths should align with backend-resolved capability flags. `get_user_tier` and `check_premium_status` remain for legacy/billing-adjacent paths, not product access authority.

| RPC | Notes |
|-----|--------|
| `get_visible_events` | After migration **20260507190000**, uses backend capability helpers for city browsing and event-tier visibility. |
| `check_premium_status` | Two-`EXISTS` pattern after **20260331120000**. |
| `get_tier_capabilities` | Backend read model for canonical tier defaults plus admin overrides. |
| `get_user_tier_capabilities` | Backend read model for a user's resolved product capabilities; callable by the user themself, admins, and service role. |
| `get_user_tier` | Added in **20260331130000**; retained as a legacy tier-label helper. |

---

## Deployment checklist

Paste and run after merging; adjust project id if needed.

```
/*
 * DEPLOYMENT CHECKLIST (run manually or via deploy script)
 *
 * 1) supabase db push
 *    (applies pending migrations including premium_history, stripe_credit_checkout_grants,
 *     check_premium_status / sync_profiles / get_visible_events, subscription_tier,
 *     tier_config, and tier_config_backend_authority)
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
 *    - get_visible_events should reference backend tier capability helpers for city browsing and event visibility.
 *
 * 4) Redeploy Edge Functions:
 *    supabase functions deploy stripe-webhook
 *    supabase functions deploy revenuecat-webhook
 *    supabase functions deploy create-event-checkout
 *    supabase functions deploy date-suggestion-actions
 *    supabase functions deploy create-credits-checkout
 *    supabase functions deploy forward-geocode
 *    supabase functions deploy delete-account
 *
 * 5) Regenerate types:
 *    npm run regen:supabase-types
 *    (equivalent: npx supabase gen types typescript --project-id schdyxcunwcvddlcshwd --schema public, with header; see scripts/regen-supabase-types.sh)
 *
 * 6) Smoke queries:
 *    SELECT subscription_tier FROM profiles LIMIT 5;
 *    SELECT * FROM tier_config_overrides LIMIT 5;   -- expect empty until admin overrides
 *    SELECT proname FROM pg_proc
 *      WHERE proname IN ('check_premium_status','get_user_tier_capabilities','get_tier_capabilities','set_tier_config_override');
 */
```

---

## Afterword

- **Hooks shipped:** `src/hooks/useEntitlements.ts` and `apps/mobile/hooks/useEntitlements.ts` read backend-resolved capability JSON. Remaining work is migrating each UI gate row above from `useSubscription` / `usePremium` to capability flags as listed.
- **VIP vs Premium copy** on marketing pages must match `TIERS` (Premium does **not** include VIP events unless overridden in DB).
