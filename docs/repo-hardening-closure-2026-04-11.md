# Repo hardening closure — 2026-04-11

Purpose: record **repo truth**, **safe removals**, and **shared-module alignment** from the hardening pass (no silent deletes).

## Phase 1 — Email verification closure vs repo

| Claimed item | Repo state |
|--------------|------------|
| Canonical auth email / `resolveCanonicalAuthEmail` | **Present:** `supabase/functions/_shared/verificationSemantics.ts`; used by Edge `email-verification`, web ProfileStudio, AccountSettingsDrawer, native profile/settings. |
| Normalized verification semantics / `isCurrentEmailVerified` | **Present:** same module; aligns profile `verified_email` with canonical auth email. |
| Shared Supabase invoke error parsing | **Normalized:** implementation lives in **`shared/supabaseFunctionInvokeErrors.ts`**; web re-exports via `src/lib/supabaseFunctionInvokeErrors.ts`; native `EmailVerificationFlow` imports from `shared/`. |
| No inbox-first gating on in-app email verification | **Confirmed:** flows use `resolveCanonicalAuthEmail` + OTP via `email-verification/send` & `verify`; “check your inbox” copy elsewhere refers to **Supabase account email confirmation** (linked email provider), not a prerequisite for the profile trust OTP step. |

**Mismatch addressed:** Invoke error parser previously lived only under `src/lib/` while native reached into `src/` via a deep relative path; it is now a first-class **`shared/`** module per [`vibely-canonical-project-reference.md`](./vibely-canonical-project-reference.md).

`tsconfig.app.json` explicitly includes `supabase/functions/_shared/verificationSemantics.ts` for compile visibility.

## Phase 2 — Removed dead surfaces

| File removed | Why safe | Replaced by |
|--------------|----------|-------------|
| `src/pages/VideoLobby.tsx` | Zero imports and not routed in `App.tsx`. | No product feature used this page. |
| `src/pages/ReadyGate.tsx` | Not imported; `/ready/:readyId` mounts `ReadyRedirect` (see `App.tsx`). | Lobby **`ReadyGateOverlay`** + native `ready/[id].tsx` / **`useReadyGate`** for session UX. |

**Manifests updated:** `_cursor_context/vibely_machine_readable_inventory.json` (routes, `page_files`, `page_anomalies`). **Docs updated:** `docs/web-complete-sitemap.md`.

## Phase 3 — Tooling

- **`lovable-tagger` removed** from `package.json` and `vite.config.ts` — dev-only tagger not required for Vibely builds; avoids extra dependency and Lovable coupling.
- **Duplicate doc archived:** `_cursor_context/vibely_golden_snapshot_audited (1).md` → `docs/_archive/historical/` (see `active-doc-map.md`).

## Phase 5 — Operational notes

- **OneSignal web worker:** `public/OneSignalSDK.sw.js` remains a v16 CDN delegate — consistent with [`docs/web-push-production-checklist.md`](./web-push-production-checklist.md).
- **Rebuild rehearsal log:** [`rebuild-rehearsal-log.md`](./rebuild-rehearsal-log.md) updated with this pass (commands re-run; HEAD at time of pass).

## Phase 6 — Route / sitemap reconciliation (final closure pass)

| Artifact | Change |
|----------|--------|
| [`web-complete-sitemap.md`](./web-complete-sitemap.md) SECTION 1 | Added routes present in [`src/App.tsx`](../src/App.tsx) but missing from the table: `/entry-recovery`, `/invite`, `/event/:eventId` (short redirect), `/profile/preview`, `/settings/ticket/:id`; aligned ready route param with code: **`/ready/:readyId`**. |
| [`native-complete-sitemap.md`](./native-complete-sitemap.md) | **Auth:** Documented that there is **no** `/(auth)/sign-up` file — sign-up flows live on `sign-in`. **Settings:** Expanded table to match [`apps/mobile/app/settings/_layout.tsx`](../apps/mobile/app/settings/_layout.tsx) (`discovery`, `blocked-users`, `support`, `safety-center`, `submit-ticket`, `ticket-submitted`, `ticket/[id]`, `referrals`). **Root stack:** Documented `entry-recovery`, `delete-account`, `profile-preview`, `subscription-cancel`, `vibe-studio` as file-based routes. |

**Golden snapshot duplicate:** The ambiguous `_cursor_context/vibely_golden_snapshot_audited (1).md` was **archived** to [`docs/_archive/historical/vibely_golden_snapshot_audited_duplicate_2026-04-11.md`](./_archive/historical/vibely_golden_snapshot_audited_duplicate_2026-04-11.md); canonical rebuild reference remains [`_cursor_context/vibely_golden_snapshot_audited.md`](../_cursor_context/vibely_golden_snapshot_audited.md) (see [`active-doc-map.md`](./active-doc-map.md)).
