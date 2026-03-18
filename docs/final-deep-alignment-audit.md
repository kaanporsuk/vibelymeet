# Final Deep Web vs Native Alignment Audit

## Summary

Code-level comparison of onboarding, auth, lobby cards, and cross-cutting issues against web source of truth. Fixes applied; items requiring manual screenshot review are listed below.

---

## Fixes Applied

### AREA 1 — Onboarding

| File | Fix |
|------|-----|
| `apps/mobile/app/(onboarding)/index.tsx` | **Welcome step (step 0):** Added full Welcome screen matching web: "Welcome to Vibely" title, subtitle "Find your vibe. Make real connections through live video events.", three bullet points (Match by vibe / Live video speed dating / Curated events), "Let's Go" button. |
| Same | **Progress bar + Back:** Fixed progress bar at top with gradient fill; Back (chevron) shown when step > 0. `TOTAL_STEPS = 3` (Welcome, Identity, Details+Complete). |
| Same | **Step renumbering:** Step 0 = Welcome, Step 1 = Identity (name + "Continue"), Step 2 = Details (gender, tagline, job, about, web fallback) + "Complete Profile" / "Creating Profile...". |
| Same | **Button labels:** Step 0 "Let's Go", Step 1 "Continue", Step 2 "Complete Profile" / "Creating Profile..." when loading. |
| Same | **Back button:** On step 2, Back goes to step 1 (not step 0). |
| Same | **Input styling:** Input border radius 16 (rounded-2xl parity), minHeight 56; gender buttons padding 14, borderRadius 16. |
| Same | **Styles:** Added progressWrap, progressRow, backBtnTop, progressBarBg, progressBarFill, welcomeBlock, welcomeIcon, welcomeTitle, welcomeSub, welcomeBullets, welcomeBullet, bulletIcon, bulletEmoji, bulletText. |

**Note:** Web has 8 steps (Welcome, Identity, Location, Details, About Me, Vibes & Lifestyle, Looking For, Photos & Video). Native keeps 3-step flow (Welcome, Identity, Details+Complete) with "Add photos & more on web" card; full 8-step parity would require new steps (DOB, location, height, about 10–140 chars, vibes ≥3, relationship intent, photo grid).

---

### AREA 2 — Auth screens

| File | Fix |
|------|-----|
| `apps/mobile/app/(auth)/sign-in.tsx` | **Input/button styling:** Input minHeight 48 (h-12), padding 14, borderRadius 16; button minHeight 56 (h-14), paddingVertical 16, borderRadius 16, button text fontSize 18. |
| Same | **Password placeholder:** "Password" → "••••••••" to match web. |
| Same | **Button label:** "Sign in" → "Sign In" (capital I). |
| Same | **Footer:** Added "By continuing, you agree to our Terms & Privacy Policy" (footer + footerText styles). |
| Same | Removed unused `radius`, `layout` from theme import. |
| `apps/mobile/app/(auth)/sign-up.tsx` | **Input/button styling:** Same as sign-in (minHeight 48/56, borderRadius 16, fontSize 18). |
| Same | **Button label:** "Sign up" → "Create Account" to match web. |
| Same | **Footer:** Same Terms & Privacy footer. |
| Same | Removed unused `layout` from theme import. |

---

### AREA 3 — Event cards

No code changes in this pass. Native events list already has FeaturedEventCard with countdown, badges, and filter chips; card layout and date format were not modified.

---

### AREA 4 — Lobby profile cards

| File | Fix |
|------|-----|
| `apps/mobile/app/event/[eventId]/lobby.tsx` | **Vibe tags:** Web shows 3 tags + "+N" overflow; native showed 5 + "+N". Changed to `slice(0, 3)` and "+N" when `vibeLabels.length > 3`. |

---

### AREA 5 — Matches "New Vibes" rail

No code changes. Native already has "New Vibes" title and "{n} new connection(s)" subtitle; structure matches web.

---

### AREA 6–9 — Video Date, Ready Gate, Daily Drop, Premium

- **Video Date / Ready Gate / Daily Drop:** Not modified in this pass; comparison was done at structural level; any remaining differences need visual/screenshot review.
- **Premium:** Hero ("Unlock Your Full Vibe", "Meet people worth meeting — in real life.") and feature list already match web; no changes.

---

### AREA 10 — Cross-cutting

| File | Fix |
|------|-----|
| `apps/mobile/components/events/WhosGoingSection.tsx` | **HTML entity:** "Who&apos;s Going" → "Who's Going". |
| (none) | **Color concatenation:** Grep found no `theme.X + 'YY'` patterns; no fix. |
| (reported only) | **console.log:** `apps/mobile/lib/imageUrl.ts` has 2x `console.log` for URL tracing; not removed (report only). |
| (reported only) | **localhost/127.0.0.1:** None found. |
| (reported only) | **TODO/FIXME:** None found in app/components/lib. |

---

## Manual Screenshot Review Recommended

1. **Onboarding:** Confirm Welcome step layout (icon size, bullet spacing, "Let's Go" button) and progress bar visibility on small/large devices.
2. **Auth:** Confirm gradient/aurora background difference (web has animated gradients; native uses solid theme.background unless a background component is added).
3. **Event cards:** Confirm featured card aspect ratio and countdown position vs web.
4. **Lobby cards:** Confirm 3:4 aspect ratio and name/age overlay position vs web.
5. **Ready Gate:** Native has no countdown ring or "Waiting for [Name]..." state; web has 30s ring and waiting state. Consider adding if product parity required.
6. **Daily Drop:** All states (no drop, unopened, viewed, opener sent, etc.) — compare copy and layout per state.
7. **Video Date screen:** HandshakeTimer, VibeCheckButton, IceBreakerCard, ConnectionOverlay, PostDateSurvey, KeepTheVibe, controls bar — compare stroke widths, colors, and animation intensity.

---

## TODO / FIXME / console.log

- **TODO/FIXME:** None found in `apps/mobile/app/`, `apps/mobile/components/`, `apps/mobile/lib/`.
- **console.log:** `apps/mobile/lib/imageUrl.ts` lines 60 and 67 — URL debug logs; consider wrapping in `__DEV__` or removing for production.

---

## Verification

- `npx tsc --noEmit` from `apps/mobile`: **passed** (0 errors).
- Lint: no new issues reported.
