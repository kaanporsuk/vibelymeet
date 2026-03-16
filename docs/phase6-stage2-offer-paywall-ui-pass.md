# Phase 6 Stage 2 — Offer / Paywall UI Pass

## Summary

Stage 2 focused on making the premium / upgrade / monetization surface intentionally designed and Vibely-branded, with resilient handling when RevenueCat offerings are missing or unavailable. No billing architecture or provider logic was changed.

---

## Implemented

### 1. Premium surface hierarchy

- **Header:** Replaced `GlassSurface` with `GlassHeaderBar` (back + "Premium") for consistency with the rest of the app.
- **Hero (free user):** Larger icon (80px circle, sparkles in `tintSoft`), title "Unlock Your Full Vibe" (28px, weight 800), subtitle "Meet people worth meeting — in real life." Aligned with web Premium page.
- **Feature callouts:** Moved into a single glass card ("What you get") with checkmark circles and the same four bullets as web: Unlimited swipes & matches, See who liked you, Priority in event lobbies, Exclusive premium-only events.
- **Pricing/offerings:** Package cards use `Card variant="glass"` and `theme.glassBorder`; primary CTA label "Get Premium" with `size="lg"` and full width.

### 2. Entitlement state handling

- **Active premium:** Dedicated "entitlement" card with sparkles icon, "You're already Premium 🎉", plan (Annual/Monthly), renews date, short thank-you copy, and "Go Home" secondary CTA. Card uses `variant="glass"`.
- **Free user:** Hero + features card + offerings or unavailable block.
- **Purchase-disabled / no offerings:** Treated as a single "unavailable" state (see below).

### 3. RevenueCat state UX

- **Loading subscription:** Message set to "Checking subscription…" / "Just a sec…".
- **Loading offerings:** "Loading plans…" / "Checking what's available." in a dedicated block so layout doesn’t jump.
- **No offerings or not configured:** Single product-grade state:
  - Card with icon (card-outline), title "Premium isn't available here yet", body "Subscribe on the web to unlock premium, or check back later for in-app options.", and "Back" secondary CTA. No technical RevenueCat/config copy.
- **Restore:** Shown only when RevenueCat is configured; ghost-style "Restore purchases" link below the main block. Success alert: "Your Premium subscription is restored."
- **Purchase success:** Alert copy "You're Premium ✨" / "Enjoy unlimited swipes, who liked you, and more."

### 4. Upgrade entry points

- **Settings:** Existing Premium card (stateful: Premium status + Manage Subscription vs "Upgrade to Premium" / "Unlock all features" → `/premium`) left as-is; already aligned with web intent.
- **Profile:** Premium chip in identity block when `is_premium`; no change.
- **Events:** Empty state "Go Premium to explore" already product-grade; no change.
- **Premium screen:** Only screen modified in this pass.

### 5. General quality

- Scroll content uses `layout.scrollContentPaddingBottomTab` and `layout.mainContentPaddingTop`.
- Error bar uses a light border for clarity (`theme.danger + '40'`).
- Unused `typography` import removed. All new styles use spacing/radius/layout tokens.

---

## Files changed

| File | Changes |
|------|--------|
| `apps/mobile/app/premium.tsx` | GlassHeaderBar; hero sizing/copy; features in glass card; entitlement card (glass); package cards (glass, "Get Premium" lg CTA); single unavailable state and copy; loading/restore/success copy; layout tokens. |

---

## UI decisions

- **Single “unavailable” state:** Whether RevenueCat is unconfigured or has no offerings, we show one friendly message and one "Go to web" action to avoid technical jargon and support a single recovery path.
- **One primary CTA label:** All packages use "Get Premium" to match web and keep the action clear; price and period (e.g. "/year") remain on the card.
- **Restore as ghost link:** Restore stays secondary and only when RevenueCat is configured, to avoid cluttering the main flow.

---

## Unresolved provider-truth blockers

- **None.** All changes are UI/copy only. Premium state continues to come from the backend (`useBackendSubscription`); purchase flow still uses existing RevenueCat APIs. When offerings are missing or disabled, the app shows a polished unavailable state instead of failing or showing config messages.

---

## Branch

`feat/mobile-phase6-premium-android-parity`
