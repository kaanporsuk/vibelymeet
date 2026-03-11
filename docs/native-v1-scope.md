## Vibely Native v1 Scope

This document captures the **explicit scope** for the first‑cut native app (v1) based on the current web route/feature surface and the remediation plan (Stream 0A).

Classification buckets:
- **In v1**: required for the first native release.
- **Deferred (v1.1+)**: important but can ship in a follow‑up release.
- **Web‑only**: stays web‑only for now (admin, legal, marketing, some purchase flows).

Route inventory is taken from `src/App.tsx` and the audited rebuild pack.

---

### 1. Core auth and shell

- `/` – **Landing / marketing**
  - **Native v1**: **Deferred** (v1.1+). Native entry is app‑centric; a full marketing landing page is web‑first.
- `/auth` – **Sign in / sign up**
  - **Native v1**: **In v1** (auth is required).
- `/reset-password` – **Password reset**
  - **Native v1**: **In v1** (or equivalent OTP/password reset UX).
- `/onboarding` – **Onboarding flow**
  - **Native v1**: **In v1** (explicitly in Stream 0A baseline).
- `/dashboard` / `/home` – **Main logged‑in home**
  - **Native v1**: **In v1** (home/feed for events, matches, and calls to action).

---

### 2. Events and lobbies

- `/events` – **Events list**
  - **Native v1**: **In v1** (events are core).
- `/events/:id` – **Event details**
  - **Native v1**: **In v1** (users must be able to inspect event details).
- `/event/:eventId/lobby` – **Event lobby**
  - **Native v1**: **In v1** (lobby is explicitly included in Stream 0A).
- `/event-payment/success` – **Event payment success (web)**
  - **Native v1**: **Web‑only** for now (Stripe Checkout is web, and native may wrap web for payments initially).

---

### 3. Matching, dates, and post‑date flows

- `/matches` – **Matches list**
  - **Native v1**: **In v1** (core).
- `/chat/:id` – **Chat thread**
  - **Native v1**: **In v1** (core – messaging).
- `/date/:id` – **Video date room**
  - **Native v1**: **In v1** (explicitly in Stream 0A).
- `/ready/:id` – **Ready Gate**
  - **Native v1**: **In v1** (explicitly in Stream 0A).
- `/match-celebration` – **Match celebration screen**
  - **Native v1**: **Deferred** (v1.1+). Nice to have, but v1 can show a simpler confirmation.

Post‑date survey UX today is embedded inside the video/date flow and shared components; there is no standalone route, but the **post‑date survey feature** is considered **In v1** as part of the `VideoDate` experience.

---

### 4. Profile, settings, and verification

- `/profile` – **Profile view/edit**
  - **Native v1**: **In v1** (explicitly in Stream 0A).
- `/settings` – **Settings (notifications, account, etc.)**
  - **Native v1**: **In v1** (explicitly in Stream 0A).
- `/user/:userId` – **Public user profile**
  - **Native v1**: **Deferred** (v1.1+). Useful for deep linking and social, but not required for first cut.

Verification flows (photo/phone/email) are routed through profile, onboarding, and edge functions rather than dedicated routes; they are implicitly **In v1** as part of profile/onboarding.

---

### 5. Premium, credits, and billing

- `/premium` – **Premium upsell / pricing**
  - **Native v1**: **Deferred** (v1.1+). Native v1 should support premium state, but the upsell screens can be simplified or deferred; web handles full pricing layout.
- `/subscription/success`, `/subscription/cancel` – **Subscription result pages**
  - **Native v1**: **Web‑only** (Stripe hosted; native may open them in a web view rather than recreating them).
- `/credits` – **Buy/use credits**
  - **Native v1**: **Deferred** (v1.1+). Credits are important but second‑order for the first native cut.
- `/credits/success` – **Credits purchase success**
  - **Native v1**: **Web‑only** (same rationale as subscription success).

Native v1 should be able to **respect premium/credits state** (e.g. read‑only), but the full purchase and success‑page UX can be web‑first initially.

---

### 6. Vibes, feeds, schedule, referrals (explicitly deferred)

- `/vibe-studio` – **Vibe Studio (create vibe videos)**
  - **Native v1**: **Deferred** (v1.1+). Complex media UX; explicitly deferred by Stream 0A.
- `/vibe-feed` – **Vibe Feed**
  - **Native v1**: **Deferred** (v1.1+). Explicitly deferred in the remediation plan.
- `/schedule` – **User schedule / calendar**
  - **Native v1**: **Deferred** (v1.1+). Explicitly deferred.

Referrals and similar growth surfaces are currently woven through profile/settings and backend; any dedicated referral UX would be **Deferred** until server ownership and measurement are fully proven.

---

### 7. Legal, marketing, and support flows

- `/how-it-works` – **How Vibely works**
  - **Native v1**: **Deferred / web‑only**. Can be linked out to web; not a core in‑app view for v1.
- `/privacy` – **Privacy policy**
  - **Native v1**: **Web‑only** (link out).
- `/terms` – **Terms of service**
  - **Native v1**: **Web‑only** (link out).
- `/delete-account` – **Account deletion (web)**
  - **Native v1**: **Deferred**. First cut can route to the web page or provide a simplified inline UI later.
- `/community-guidelines` – **Community guidelines**
  - **Native v1**: **Web‑only** (link out).

Native clients should **link to** these legal/support surfaces, but do not need to duplicate their content in v1.

---

### 8. Admin and internal tooling

- `/admin/create-event` – **Admin event creation**
  - **Native v1**: **Web‑only**. Admin surface stays on web.
- `/kaan`, `/kaan/dashboard` – **Admin login + dashboard**
  - **Native v1**: **Web‑only**. Internal operator/admin flows are out of scope for native v1.

Admin and telemetry views should remain web‑only for the foreseeable future.

---

### 9. Summary by bucket

**In native v1 (core):**
- Auth & shell:
  - `/auth`, `/reset-password`, `/onboarding`, `/dashboard`, `/home`
- Events:
  - `/events`, `/events/:id`, `/event/:eventId/lobby`
- Matching & dates:
  - `/matches`, `/chat/:id`, `/date/:id`, `/ready/:id`
  - Post‑date survey as part of the VideoDate experience
- Profile & settings:
  - `/profile`, `/settings`

**Deferred to v1.1+ (candidate follow‑ups):**
- Visual/celebratory:
  - `/match-celebration`
- Growth / social:
  - `/user/:userId` (public profile)
  - full referrals UX (wherever it lands)
- Premium / credits UX:
  - `/premium`, `/credits`
- Vibes / feed / schedule:
  - `/vibe-studio`, `/vibe-feed`, `/schedule`
- Native‑level delete account UX (vs web):
  - `/delete-account` equivalent

**Web‑only (for now):**
- Marketing / legal:
  - `/`, `/how-it-works`, `/privacy`, `/terms`, `/community-guidelines`
- Checkout result / billing pages:
  - `/subscription/success`, `/subscription/cancel`
  - `/credits/success`
  - `/event-payment/success` (Stripe callback UX)
- Admin / internal:
  - `/admin/create-event`
  - `/kaan`, `/kaan/dashboard`

---

### 10. Ambiguities / founder decisions needed

- **Premium and credits**:  
  Native v1 should **respect** premium/credits state, but the exact timing for:
  - in‑app upsell flows,
  - native checkout entrypoints, and
  - native‑first “success” screens  
  needs an explicit product call (how much of this is web‑view vs native in v1).

- **Delete account UX**:  
  For compliance and UX, we likely want a native “delete account” surface eventually; whether that is **v1** or **v1.1** is a product decision.

- **Referrals and growth surfaces**:  
  Some flows (referrals, growth campaigns) are present in backend and analytics but not as first‑class routes. Founder decision is needed on whether to:
  - include a minimal referrals entrypoint in v1, or
  - ship without it and treat it as a post‑v1 growth stream.

