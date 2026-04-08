# Native launch-closure — master runbook

Date: 2026-04-08  
Branch baseline: `feat/native-sprint6-launch-closure-execution` (canonical execution order; older phase docs are deep references)

This is the **single canonical execution order** for moving from **current No-Go (submission)** to **provider-complete + device-proven** state. Use it instead of hopping between older phase docs alone.

**Fast path for operators:** read `docs/kaan-launch-closure-execution-sheet.md` first (one-page compressed checklist), then use this file for criteria and escalation.

---

## 0. Repo identity (do not drift)

| Field | Value | Source |
|-------|--------|--------|
| iOS bundle ID | `com.vibelymeet.vibely` | `apps/mobile/app.json` |
| Android application ID | `com.vibelymeet.vibely` | `apps/mobile/app.json` |
| Expo scheme | `com.vibelymeet.vibely` | `apps/mobile/app.json` |
| Apple Team ID | `W38S57AM55` | `apps/mobile/app.json` |

---

## 1. Stage 0 — Repo preflight (Cursor / Kaan, ~5 min)

| Step | Action | Pass | Fail |
|------|--------|------|------|
| 0.1 | From repo root: `npm run launch:preflight` | JSON `"ok": true` | Fix reported missing files/config; if app.json/eas drift, stop and reconcile |
| 0.2 | `npm run typecheck` | Exits 0 | Fix TypeScript before shipping native builds |

**Nothing in Stage 0 requires dashboards or devices.** If preflight passes, repo-side config/docs are aligned for Kaan to start provider work.

---

## 2. What repo / browser proof already closed (not Kaan dashboard work)

- **Supabase / backend:** Shared project with web; migrations and Edge Functions documented in `docs/native-external-setup-checklist.md`.
- **Web browser/runtime proof (evidence-backed):** Schedule, Referrals, OneSignal worker + subscription + `notification_preferences` sync, Vibe Studio route health, fresh smoke bootstrap — see `docs/browser-auth-runtime-proof-results.md` and `docs/fresh-smoke-proof-bootstrap.md`. **Manual-only gap:** human notification permission outcome and tap-through on a delivered web notification (automation cannot own).
- **Native app code:** Premium (RevenueCat), push registration (OneSignal), vibe video pipeline — implemented; blocked only by dashboard secrets and device proof.

---

## 3. Deterministic execution order (Kaan-owned)

Complete in order. **Do not** skip RevenueCat webhook + Supabase deploy before declaring purchase proof.

| Order | Stage | Primary doc |
|-------|-------|----------------|
| 1 | RevenueCat dashboard + store products | `docs/kaan-launch-closure-execution-sheet.md` § 1 → detail in `docs/native-external-setup-checklist.md` §2 |
| 2 | Supabase `revenuecat-webhook` + `REVENUECAT_WEBHOOK_AUTHORIZATION` + RevenueCat webhook URL | Same § 2 |
| 3 | OneSignal iOS + Android (APNs, FCM) | Sheet § 3 → checklist §3 |
| 4 | EAS secrets (mirror `apps/mobile/.env.example` names) | Sheet § 4 |
| 5 | EAS preview builds + install | Sheet § 5 → `docs/native-sprint6-launch-closure-runbook.md` Phases 5–6 |
| 6 | Real device validation (iOS + Android) | Sheet § 6 |
| 7 | Production build + submit (when ready) | Checklist §6–7; runbook Phase 6 |

Phased narrative with Cursor/Kaan roles: `docs/native-sprint6-launch-closure-runbook.md`.  
Strict matrix: `docs/phase7-stage5-release-readiness-and-go-nogo.md`.

---

## 4. Pass / fail criteria (by stage)

| Stage | Pass | Fail |
|-------|------|------|
| Preflight | `launch:preflight` ok | Missing app.json / eas.json / required launch docs |
| RevenueCat dashboard | Offering shows packages; public API keys copied | "No offerings" in app; wrong or empty product IDs |
| Webhook + purchase | Sandbox/test purchase; `subscriptions` + `profiles.is_premium` updated | 401 on webhook; DB stale; deploy/secret mismatch |
| OneSignal mobile | `notification_preferences` mobile player id; test push **received** | No player row; push never arrives |
| EAS preview | Build succeeds; installable artifact | Missing secret; credentials error |
| Device validation | Sheet §6 complete with notes/screenshots as needed | Crash, auth loop, broken premium/push — log in `docs/native-final-blocker-matrix.md` |
| Submission | Artifacts in TestFlight / Play internal | Store rejection — operator/console |

---

## 5. Evidence — where to record

- **Primary:** `docs/native-final-blocker-matrix.md` → section **Sprint 6 / Phase 7 test results** (pass/fail per phase).
- **Optional:** Internal release ticket or wiki; **do not** commit raw secrets or API keys.

---

## 6. Escalation paths

| Symptom | Likely layer | Next step |
|---------|--------------|-----------|
| Premium: "No offerings" | RevenueCat / store product IDs | Checklist §2; Kaan dashboard |
| Purchase OK; DB not premium | Webhook URL, `REVENUECAT_WEBHOOK_AUTHORIZATION`, EF not deployed | Supabase function logs; Kaan + Cursor if function bug proven |
| No push player id in DB | App ID missing in build, permission denied | EAS secrets; Kaan |
| Push queued; device silent | APNs/FCM misconfigured | OneSignal dashboard; Kaan |
| EAS build fails on env | Missing EAS secret | Kaan |
| Web proof regression | App or Supabase deploy | **Cursor** — not fixed in dashboards |

---

## 7. Go / No-Go (submission)

**No-Go** until:

1. RevenueCat: dashboard + webhook + real-device purchase + restore + DB sync proven.  
2. OneSignal mobile: dashboard + test push **received** on **both** iOS and Android test devices (minimum).  
3. At least one full **iOS** and one **Android** device validation pass (sheet §6).  
4. Optional: OneSignal **web** interactive permission + notification tap (manual).  
5. Blocker matrix updated with dates and build IDs.

Repo-side proof and green typecheck **do not** replace mobile IAP or mobile push evidence.
