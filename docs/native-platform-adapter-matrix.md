# Native platform adapter matrix

Platform-specific integrations used by the native app. No provider swaps; these choices are locked.

| Platform concern | Provider | Web | Native | Notes |
|------------------|----------|-----|--------|------|
| **Payments / entitlements** | RevenueCat | — | iOS/Android in-app purchases; offerings, purchase, restore | Web uses Stripe. Backend reconciles via RevenueCat webhook + entitlement resolver. Bundle ID: `com.vibelymeet.vibely`. |
| **Push notifications** | OneSignal | Web SDK; player ID in `notification_preferences` | OneSignal native SDK; register player ID with same backend; `send-notification` targets all | Same app/config where possible; deep links to native routes (e.g. `/chat/:id`, `/ready/:id`). |
| **Video (live)** | Daily | daily-room EF; Web SDK | Daily React Native SDK; same `daily-room` EF for token | Same Supabase project and room naming; mobile-specific permissions/reconnect handled in client. |
| **Backend** | Supabase | Same project, anon key, RLS | Same project; publishable or anon key; SecureStore for session | No separate “mobile” project. |
| **Media (images/video)** | Bunny | Upload via Edge Functions (upload-image, upload-chat-video, etc.); CDN URLs in profiles/messages | Same upload endpoints and CDN host; optional `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME` | Same buckets and URLs for parity. |
| **Auth** | Supabase Auth | Email/password, magic link | Same; session persistence via AsyncStorage/SecureStore | Same project; same JWT/refresh semantics. |
| **Analytics** | PostHog | Web | Same events/properties where possible | Optional on native; align event names. |
| **Error monitoring** | Sentry | Web | Native SDK (Expo/Sentry) | Same project; source maps for native. |

---

## Env and config (native)

| Variable | Purpose | Required |
|----------|---------|----------|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Client key | Yes |
| `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME` | Bunny CDN for images | Optional |
| `EXPO_PUBLIC_ONESIGNAL_APP_ID` | OneSignal app ID | Yes for push |
| `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` / `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` / `EXPO_PUBLIC_REVENUECAT_API_KEY` | RevenueCat public keys | For in-app purchase UI |

Secrets (e.g. webhook auth) live in Supabase secrets / EAS secrets, not in client env.

---

## NPM / install workaround

`apps/mobile/.npmrc`: `legacy-peer-deps=true` is **documented and retained** until a real fix exists. Reason: `@daily-co/config-plugin-rn-daily-js` requires `expo@^54` while the app uses Expo 55; EAS cloud install would otherwise fail. Do not remove without verifying Daily publishes an Expo 55–compatible plugin or a documented fix. See `apps/mobile/README.md`.

---

## Bundle / package ID

- **iOS / Android:** `com.vibelymeet.vibely` (per project requirements). Used for RevenueCat, OneSignal, and store submissions.
