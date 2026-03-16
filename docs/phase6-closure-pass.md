# Phase 6 Final Closure Pass

## Scope

Re-audit of Phase 6 surfaces against web, monetization cue consistency, and Android visual feel. Only small, high-confidence UI refinements; no new sprint, no broad refactor, no provider/backend/app-structure changes.

---

## 1. Re-audit (Phase 6 surfaces vs web)

| Surface | Audit result |
|--------|----------------|
| **Premium screen** | GlassHeaderBar, hero (“Unlock Your Full Vibe”), features glass card, entitlement card (active), package cards + “Get Premium”, unavailable state + “Back”, loading/restore copy. Aligned with web Premium page intent. |
| **Settings premium entry** | Stateful card: active → “✦ Vibely Premium” + “Manage Subscription”; free → SettingsRow “Upgrade to Premium” / “Unlock all features” → `/premium`. Matches web PremiumSettingsCard. |
| **Profile premium chip** | Sparkles + “Premium” when `is_premium` in identity block. Consistent with web. |
| **Events** | Empty state “Go Premium to explore” → `/premium`. “Happening Elsewhere” upsell: **closure change** — card now `variant="glass"` + `theme.glassBorder`, CTA is `VibelyButton` “Explore with Premium →” for consistent touch target and visual cue. |
| **Dashboard** | No dedicated premium CTA; “No upcoming events” + “Discover events…” + “Browse Events”. Appropriate for home. |
| **Matches** | No premium-specific block; empty state drives to events. OK. |

---

## 2. Monetization cue consistency

- **Premium screen:** Glass cards, VibelyButton “Get Premium” / “Back” / “Go Home”. Single source for paywall.
- **Settings:** Same glass card language; “Manage Subscription” (VibelyButton) vs “Upgrade to Premium” (row).
- **Events:** “Happening Elsewhere” now uses same glass card + VibelyButton primary CTA as other premium entry points.
- **Profile:** Chip only; no CTA on profile (upgrade via Settings or Events). Consistent.

---

## 3. Android visual feel (review only)

- **Typography:** Scale and weights use theme tokens; no code change. Device check for weight rendering remains recommended.
- **Spacing:** `layout.mainContentPaddingTop`, `scrollContentPaddingBottomTab`, `spacing.lg` etc. used; no change.
- **Card density:** Glass cards and shared primitives; Events upsell card aligned to same treatment in this pass.
- **Safe-area / scroll-end:** Scroll content uses `layout.scrollContentPaddingBottomTab`; no change.
- **Press/touch:** Tab bar and SettingsRow have 48dp min height on Android; Events upsell now uses VibelyButton (consistent target). No further code change.

---

## 4. Changes made in this closure pass

| File | Change |
|------|--------|
| `apps/mobile/app/(tabs)/events/index.tsx` | (1) Import `VibelyButton`. (2) “Happening Elsewhere” premium card: `Card variant="glass"`, `borderColor: theme.glassBorder`. (3) CTA: replace custom `Pressable` with `VibelyButton` label="Explore with Premium →" variant="primary" size="sm" style={premiumCardCta}. (4) Styles: `premiumCard` padding only; `premiumCardCta` → `alignSelf: 'flex-start'`; remove unused `premiumCardCtaLabel`. |

No other files changed.

---

## 5. Closure verdict

**Phase 6 is ready to close.**

- Premium, Settings, Profile, and Events premium entry points are aligned with web and with each other (glass cards, VibelyButton CTAs where applicable).
- Loading, active, free, unavailable, restore, and manage states are covered; copy is product-grade.
- One refinement was made in this pass (Events “Happening Elsewhere” card + CTA). No remaining UI work is required for closure from an Android visual/product perspective.

---

## 6. Why Phase 6 is now closable

- **Surfaces:** Premium screen, Settings premium card, Profile chip, and Events (empty + Happening Elsewhere) are audited and consistent with web and shared primitives.
- **Monetization:** Same card and button language across screens; no stray custom CTAs.
- **Android:** Touch targets (tab, settings rows, buttons) and scroll padding are in place; any further nuance is device validation, not code.
- **Scope:** All work is UI-only; no provider, backend, or app-structure changes.

---

## 7. What would block closure (none remaining)

- No open UI gaps that require code changes for closure.
- RevenueCat/store setup, OneSignal, Daily, and real-device checks are outside Phase 6 scope and do not block closing the phase.

---

**Branch:** `feat/mobile-phase6-premium-android-parity`  
**Closure pass:** Single refinement in Events; verdict: **Ready to close Phase 6.**
