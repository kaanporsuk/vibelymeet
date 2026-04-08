# Kaan — launch closure execution sheet (single page)

**Owner legend**

| Tag | Meaning |
|-----|--------|
| **KD** | Kaan — dashboard or store console |
| **KB** | Kaan — build/install (EAS or local) |
| **KV** | Kaan — device proof |
| **CF** | Cursor — repo/doc/code **only if** a defect is proven (not the default path) |

**Before anything:** repo root → `npm run launch:preflight` (must be `"ok": true`) → `npm run typecheck`. **CF** only if these fail for non-env reasons.

**Repo truth:** iOS bundle ID + Android package = `com.vibelymeet.vibely` (`apps/mobile/app.json`). EAS project id in `app.json` → `extra.eas.projectId`.

---

## 1. RevenueCat dashboard + store products (**KD**)

1. RevenueCat: project; add iOS + Android apps with IDs above.  
2. App Store Connect + Play Console: create **subscription** products; IDs must match what you link in RevenueCat.  
3. RevenueCat: Products linked, entitlement (e.g. `premium`), **default offering** with packages (monthly/annual as designed).  
4. Copy **public** SDK keys: `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` (or single fallback key per `apps/mobile/.env.example`).  

**Pass:** Offering shows packages in dashboard; keys stored in password manager.  
**Evidence:** Note in `docs/native-final-blocker-matrix.md` → RevenueCat dashboard row.

**Detail:** `docs/native-external-setup-checklist.md` §2.

---

## 2. Supabase webhook + secret (**KD**, terminal)

1. `openssl rand -hex 32` → store as `REVENUECAT_WEBHOOK_AUTHORIZATION` in Supabase Edge secrets.  
2. `supabase functions deploy revenuecat-webhook` (from repo, logged-in CLI).  
3. RevenueCat → Webhooks → URL: `https://<PROJECT_REF>.supabase.co/functions/v1/revenuecat-webhook` with **same** auth as the secret (match `revenuecat-webhook` function expectations).  

**Pass:** Purchase test shows 2xx in function logs / DB updates.  
**Evidence:** Blocker matrix row + optional screenshot of RevenueCat delivery.  

**If 401 / no DB update:** **CF** after confirming URL + header + deploy — not a dashboard-only fix.

**Detail:** Checklist §1–2.

---

## 3. OneSignal iOS + Android (**KD**)

1. OneSignal: iOS app `com.vibelymeet.vibely`; upload APNs (.p8 or cert) — **production** path for TestFlight/store.  
2. Android app same package; FCM configured per OneSignal wizard.  
3. Copy App ID → `EXPO_PUBLIC_ONESIGNAL_APP_ID` (same concept as web `VITE_ONESIGNAL_APP_ID` if shared project).  

**Pass:** Both platforms green in OneSignal; no blocking credential warnings.  
**Evidence:** Blocker matrix → OneSignal dashboard row.

**Note:** `app.config.js` uses **production** OneSignal mode for EAS `preview` and `production` profiles (`EAS_BUILD_PROFILE`).

**Detail:** Checklist §3.

---

## 4. EAS secrets (**KB** setup)

Set for **each** profile you use (`preview` / `production`), mirroring `apps/mobile/.env.example` names:

| Secret | Notes |
|--------|--------|
| `EXPO_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Or legacy anon if that is what the app consumes in your env |
| `EXPO_PUBLIC_ONESIGNAL_APP_ID` | From §3 |
| `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` | Public key |
| `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` | Public key |

Optional media parity: `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME`, `EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME`.

**Pass:** Secrets present for the profile you will install.  
**Evidence:** Note profile + date (no secret values in git).

**Detail:** `docs/native-sprint6-launch-closure-runbook.md` Phase 5–6; checklist §5.

---

## 5. EAS preview build (**KB**)

```bash
cd apps/mobile
eas build --profile preview --platform ios
eas build --profile preview --platform android   # if validating Android too
```

**Pass:** Build green; install internal artifact.  
**Evidence:** Build URL/id in blocker matrix.

---

## 6. Real device validation sequence (**KV**)

Use **preview** (or production) build with secrets from §4. Minimum order:

1. Cold launch → sign in.  
2. **Premium:** offerings load → sandbox (iOS) / license tester (Android) purchase → confirm app + **RevenueCat dashboard**.  
3. **Supabase:** `subscriptions` + `profiles.is_premium` for test user.  
4. **Restore:** reinstall or second device → Restore → still premium.  
5. **Push:** grant permission → `notification_preferences.mobile_onesignal_player_id` populated → OneSignal test message → **notification received on device**.  
6. **Smoke:** tabs, events, matches, chat, profile (photo + vibe path open), settings — no hard crash.  
7. Optional: Daily video date join/leave if environment available.

**Pass/fail:** Record each line in `docs/native-final-blocker-matrix.md` (Sprint 6 / Phase 7 test results).  
**If failure is clearly a **code** bug:** file **CF** with logs; do not block on guessing.

---

## 7. Production build + submit (**KB**, **KD**)

When preview is green: `eas build --profile production`; `eas submit` or console upload; App Store Connect / Play Console listings and IAP agreements — **KD**.

---

## Quick URLs / patterns

| Item | Pattern |
|------|--------|
| RevenueCat webhook | `https://<PROJECT_REF>.supabase.co/functions/v1/revenuecat-webhook` |
| OneSignal NSE bundle | `com.vibelymeet.vibely.OneSignalNotificationServiceExtension` |

`<PROJECT_REF>` = first label of host from `EXPO_PUBLIC_SUPABASE_URL`.

---

## Related docs (depth)

- `docs/native-external-setup-checklist.md` — provider steps, env tables  
- `docs/native-sprint6-launch-closure-runbook.md` — phased roles (Cursor vs Kaan)  
- `docs/phase7-stage5-release-readiness-and-go-nogo.md` — strict go/no-go matrix  
- `docs/native-release-readiness.md` — what is done vs blocked at product level  
- `docs/native-final-blocker-matrix.md` — **live blocker + test result log**
