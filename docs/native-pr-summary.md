# PR Summary: Native App Foundation, Parity Flows & Release-Readiness

Concise merge/PR summary for the Sprint 1–6 native tranche.

---

## What this tranche includes

- **apps/mobile:** Full Expo (React Native + TypeScript + Expo Router) app with:
  - Auth (Supabase, session persistence, route guards), onboarding, tabs (events, matches, profile).
  - Events list/detail/register/lobby, attendee deck, swipe actions (vibe/pass/super vibe) via shared backend.
  - Matches and chat (send-message, realtime); Daily Drop and Ready Gate screens; video date (Daily.co); premium screen (RevenueCat); settings.
- **Shared backend (additive):**
  - Migrations: `notification_preferences` mobile player ID columns; `subscriptions.provider` + `(user_id, provider)` unique, trigger for `profiles.is_premium`, RevenueCat columns.
  - Edge Functions: `send-notification` (multi-device player IDs); `stripe-webhook` + Stripe-related functions (provider filter, trigger-driven `is_premium`); **new** `revenuecat-webhook`.
  - Web: `useSubscription` and Supabase types updated for multi-provider subscriptions; no breaking changes.
- **Docs:** Architecture plan update, mobile-sprint1–6, launch-readiness, external-setup checklist, manual test matrix, deployment-validation sequence, this PR summary.

---

## Backend / shared changes

- **DB:** Two migrations only; both additive (new columns, new constraint, trigger, RPCs).
- **Edge Functions:** Existing Stripe/send-notification logic updated for provider-aware subscriptions and multi-device push; new `revenuecat-webhook` for RevenueCat events.
- **Web:** Subscription read path and types extended; behavior remains backward-compatible.

---

## Web compatibility

- Web continues to use Stripe; subscription status is derived from all providers (Stripe + RevenueCat). No breaking API or schema change for web.
- Golden path runbook and smoke script unchanged; run `npm run typecheck:core`, `npm run build`, `./scripts/run_golden_path_smoke.sh` to confirm.

---

## Known external follow-ups

- Apply migrations and deploy Edge Functions (including `revenuecat-webhook`) to target Supabase project; set `REVENUECAT_WEBHOOK_AUTHORIZATION`.
- Configure RevenueCat (project, apps, products, offerings, webhook); OneSignal (iOS/Android); Expo/EAS; App Store Connect / Play Console per `docs/native-external-setup-checklist.md` and `docs/native-deployment-validation-sequence.md`.
- Validate on real device: session restore, push delivery, video date, RevenueCat purchase/restore and webhook sync.

---

## Key reviewer focus areas

- **Backend:** Migrations (notification_preferences, subscriptions provider + trigger); `revenuecat-webhook` auth and idempotency; Stripe webhook/checkout/portal use of `provider = 'stripe'`.
- **Web:** `useSubscription` and types for multi-provider; no regressions in existing billing flows.
- **Mobile:** Auth/session and route guards; use of shared RPCs/Edge Functions (no direct table writes for business logic); env and config documented.
