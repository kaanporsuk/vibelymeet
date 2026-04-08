# Native Deployment & Validation Sequence

> **Superseded for active launch closure.** Use `docs/active-doc-map.md` plus the execution-sheet/master-runbook chain instead. This file is retained for historical rollout context and contains stale branch-specific provenance.

Ordered execution guide for merging the native tranche, rolling out backend changes, configuring external providers, and validating before TestFlight/Play and production. No new product features—deployment and validation only.

---

## A. Merge sequence

- **Branch containing the full native tranche:** `sprint-6-revenuecat-release`
- **Commit:** One merge-ready commit containing apps/mobile, shared backend changes (migrations, Edge Functions, web subscription updates), and launch-readiness docs. Preceding commit `483e282` on the same branch adds the architecture plan and golden-path runbook/smoke script.
- **What to merge:** The full branch into `main` (the native tranche commit + the prior docs commit). Nothing is split; the native work is one logical tranche.
- **Recommended merge approach:** Single PR from `sprint-6-revenuecat-release` into `main`. Review backend changes (migrations, stripe-webhook, revenuecat-webhook, send-notification, useSubscription) and apps/mobile. Merge as one so web and mobile stay on the same backend contract. If your process prefers multiple PRs, split only by clearly documented scope (e.g. backend-only first, then mobile app) and ensure no partial state leaves web and mobile out of sync.

---

## B. Backend rollout sequence

Execute in this order after merge (or before, if you deploy backend first and then release clients).

1. **Migrations (in order)**  
   - Apply `supabase/migrations/20260311200000_notification_preferences_mobile_player.sql` (adds `mobile_onesignal_player_id`, `mobile_onesignal_subscribed` to `notification_preferences`).  
   - Apply `supabase/migrations/20260312000000_subscriptions_provider_revenuecat.sql` (adds `subscriptions.provider`, unique `(user_id, provider)`, trigger `sync_profiles_is_premium_from_subscriptions`, RevenueCat columns, updated RPCs).  
   - **How:** `supabase db push` for linked project, or run the SQL files in order against the target database.

2. **Edge Functions (deploy/update in any order)**  
   - Deploy/update: `send-notification` (multi-device player IDs), `stripe-webhook` (provider filter, trigger-driven `is_premium`), `create-checkout-session`, `create-portal-session`, `create-credits-checkout` (provider filter for Stripe).  
   - Deploy **new** function: `revenuecat-webhook`.  
   - Example: `supabase functions deploy send-notification`, `supabase functions deploy stripe-webhook`, … `supabase functions deploy revenuecat-webhook`.

3. **Secrets**  
   - Set `REVENUECAT_WEBHOOK_AUTHORIZATION` for the Supabase project (same value as the Authorization header configured in RevenueCat webhook).  
   - Ensure existing secrets remain set: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and any OneSignal/Daily keys used by Edge Functions.

4. **Web-impact notes**  
   - Web continues to use Stripe; `useSubscription` now reads all `subscriptions` rows and derives effective status (active/trialing from any provider). No breaking change.  
   - RLS and API contracts unchanged for web; new columns and RPCs are additive.

5. **Rollback**  
   - To roll back migrations you would need down-migrations (not in repo). Prefer deploying backend first in a staging project and validating before production.  
   - To disable RevenueCat sync: remove or pause the RevenueCat webhook; Stripe and existing `subscriptions` rows continue to work.  
   - To revert Edge Function changes: redeploy previous versions from version control.

---

## C. External dashboard setup sequence

Use this order so dependencies are available when needed.

1. **RevenueCat**  
   - Create or use project; add iOS and Android apps (bundle ID / package name match Expo app).  
   - Create products in App Store Connect / Play Console; create entitlement(s) (e.g. `premium`) and offerings in RevenueCat.  
   - Configure webhook: URL `https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/revenuecat-webhook`, Authorization header = `REVENUECAT_WEBHOOK_AUTHORIZATION` value.  
   - Copy public API key(s) for mobile: `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`, or `EXPO_PUBLIC_REVENUECAT_API_KEY` (fallback).

2. **OneSignal**  
   - Ensure web app already configured; add iOS app (APNs) and Android app (FCM) in same or linked OneSignal project.  
   - No repo code changes; mobile registers `mobile_onesignal_player_id` and `send-notification` targets it.

3. **Daily**  
   - Web already uses Daily; same domain/API key work for mobile.  
   - Confirm `daily-room` Edge Function and domain/keys are correct for production if needed.

4. **Expo / EAS**  
   - Link EAS project; configure build profiles (development, preview, production).  
   - Set EAS secrets for mobile: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `EXPO_PUBLIC_SUPABASE_ANON_KEY` as legacy fallback), `EXPO_PUBLIC_ONESIGNAL_APP_ID`, RevenueCat keys (`EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` / `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` or `EXPO_PUBLIC_REVENUECAT_API_KEY`), optionally `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME`.  
   - Credentials: iOS (distribution cert, provisioning profile), Android (keystore); EAS can manage.

5. **App Store Connect**  
   - Create app record (bundle ID matches Expo/RevenueCat); create In-App Purchases (subscriptions); configure signing/capabilities.  
   - Use EAS or Xcode to upload builds for TestFlight.

6. **Play Console**  
   - Create app (package name matches Expo/RevenueCat); create in-app products/subscriptions; configure signing.  
   - Upload build to internal testing track.

Placeholders: use your actual Supabase project ref, RevenueCat project/app IDs, and OneSignal app ID where required.

---

## D. Dev-build validation sequence

High-level order for validating the native app (dev build on simulator or real device). Assumes Supabase migrations and Edge Functions are applied and env vars are set.

1. **Auth / session restore**  
   Sign in; kill app; reopen. Confirm session persists and user remains logged in; route guards send unauthenticated users to auth.

2. **Onboarding / profile**  
   New or incomplete profile: complete onboarding (name, gender, optional fields). Load profile screen; edit and save; confirm backend update.

3. **Events / discovery / swipes**  
   Open events list → event detail → register → lobby. Open attendee deck; perform vibe/pass/super vibe; confirm backend-owned swipe flow and any match creation.

4. **Chat / realtime**  
   Open matches list; open a conversation; load message history; send a message via `send-message`; confirm realtime (or poll) update and backend-owned notification side effects.

5. **Push registration and delivery**  
   Confirm OneSignal initializes and mobile player ID is stored in backend (`notification_preferences.mobile_onesignal_player_id`). Trigger a notification (e.g. match or message) from backend; confirm delivery on real device (background/foreground).

6. **Daily Drop**  
   Open Daily Drop; load current candidate; perform opener/reply or pass; confirm backend transition and any notifications.

7. **Ready Gate**  
   Open Ready Gate for a match; mark ready / snooze / forfeit; confirm backend state and navigation to date when applicable.

8. **Video date**  
   Enter date route; join Daily room; confirm local/remote video (or placeholder if permissions missing); end/leave call; confirm `video_date_transition` and session state on backend; confirm partner experience if testing two clients.

9. **Premium / offerings / purchase / restore / backend sync**  
   Open premium screen; load RevenueCat offerings (if configured). Run sandbox purchase and restore; confirm RevenueCat webhook fires and `subscriptions` + `profiles.is_premium` update; confirm mobile UI reflects backend state.

Detailed steps: see `docs/native-manual-test-matrix.md`.

---

## E. Release gates

- **Before TestFlight / Play internal testing**  
  - All migrations applied to target Supabase project.  
  - All Edge Functions deployed (including `revenuecat-webhook`) and `REVENUECAT_WEBHOOK_AUTHORIZATION` set.  
  - RevenueCat webhook configured and verified (e.g. test event).  
  - OneSignal iOS/Android apps configured; push received on real device.  
  - Daily video join/leave and backend state verified on real device or simulator.  
  - Dev-build validation sequence (D) run for auth, onboarding, events, lobby, swipes, matches, chat, Daily Drop, Ready Gate, video date, premium (where applicable).  
  - Web golden path still passes: `npm run typecheck:core`, `npm run build`, `./scripts/run_golden_path_smoke.sh`.

- **Before production**  
  - All of the above.  
  - RevenueCat production API keys and production webhook; App Store / Play Store production IAP.  
  - OneSignal production credentials; Daily production domain/keys if different.  
  - Store compliance (privacy, permissions, etc.) and final review per platform.

---

## F. Known remaining limitations

- **Onboarding completeness:** Mobile may treat “profile row exists” as complete; web may require more (e.g. photos). Documented; no enforced alignment in this tranche to avoid breaking existing flows.
- **Photo upload on mobile:** Profile photo upload/capture not implemented on mobile; users can view existing photos; upload deferred.
- **RevenueCat / OneSignal / Daily:** Require external dashboard and (for push/video/purchase) real-device validation; not asserted as “done” until configured and tested.
- **Expo Go:** Video (Daily) and possibly other native modules require a dev build; Expo Go is not sufficient for full parity testing.
- **Store submission:** App Store Connect and Play Console submission and review are out of scope for this repo; follow platform guidelines and checklists separately.
