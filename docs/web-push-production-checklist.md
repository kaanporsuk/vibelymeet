# Web Push Production Verification Checklist

**Repo check (2026-04-11):** `public/OneSignalSDK.sw.js` delegates to the official **v16** CDN worker (`importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js")`), matching the “Code verification” section below.

## OneSignal Dashboard (manual)

- [ ] Site URL: `https://vibelymeet.com` (Settings → Platforms → Web)
- [ ] www redirect: `https://www.vibelymeet.com` also configured or redirects to non-www
- [ ] Safari Web Push: configured if targeting Safari (requires Apple Developer cert)
- [ ] Default notification icon: set and URL is reachable
- [ ] Notification click URL: defaults to site URL

## Vercel Environment Variables

- [ ] `VITE_ONESIGNAL_APP_ID` set in Vercel production env
- [ ] Value matches OneSignal dashboard App ID

## Supabase Edge Function Secrets

- [ ] `ONESIGNAL_APP_ID` matches dashboard
- [ ] `ONESIGNAL_REST_API_KEY` is valid REST API key (not User Auth key)
- [ ] `APP_URL` = `https://vibelymeet.com`

## Code verification

- [ ] `public/OneSignalSDK.sw.js` imports v16 SDK worker
- [ ] No competing service worker registrations for push scope
- [ ] `isOneSignalWebOriginAllowed()` includes vibelymeet.com
- [ ] No hardcoded App ID fallback in init code
- [ ] End-to-end test

## End-to-end test

- [ ] Visit `https://vibelymeet.com` logged in
- [ ] Accept push permission prompt
- [ ] Check `notification_preferences`: `onesignal_player_id` populated
- [ ] Send test notification from admin panel
- [ ] Push notification appears on desktop
- [ ] Click notification → deep link works
