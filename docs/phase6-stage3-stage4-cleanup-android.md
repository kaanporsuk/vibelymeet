# Phase 6 Stage 3 & 4 — Cross-Screen Cleanup + Android Polish

## Stage 3: Cross-Screen Cleanup Sweep

### Goal
Remove placeholder/basic cues and visual inconsistencies across settings, profile, dashboard, matches, events, and premium-related surfaces without broad rewrites.

### Changes Made

| Screen / Area | Before | After |
|---------------|--------|--------|
| **Settings** | Alert title "Error", message "Could not open billing. Try again." | "Couldn't open billing" / "The billing portal couldn't be opened. Try again." (and catch: "Something went wrong. Try again.") |
| **Dashboard** | Empty "No upcoming events" with no message | Added message: "Discover events and register to see them here." |
| **Profile** | LoadingState "Loading profile…" only | Added message: "Just a sec…" |
| **Matches** | Error state returned raw `ErrorState` (no full-screen container) | Wrapped in `RNView` with `centeredError` (flex:1, justifyContent/alignItems center, padding, backgroundColor) so error state is centered and has correct background |
| **Matches** | `proTipCard` / `inviteCard` used `padding: spacing.md + 2` | Normalized to `padding: spacing.lg` for token consistency |
| **Shared** | DestructiveRow had no min height | `minHeight: 48` for reliable touch target (Android HIG) |

### Files Changed (Stage 3)

- `apps/mobile/app/settings/index.tsx` — billing Alert copy
- `apps/mobile/app/(tabs)/index.tsx` — dashboard empty state message
- `apps/mobile/app/(tabs)/profile/index.tsx` — LoadingState message
- `apps/mobile/app/(tabs)/matches/index.tsx` — error wrapper, `centeredError` style, proTipCard/inviteCard padding
- `apps/mobile/components/ui.tsx` — DestructiveRow minHeight

---

## Stage 4: Android-Specific Polish

### Goal
Tune for Android device-sized layouts: touch targets, tab bar feel, and consistent spacing without iOS regression.

### Changes Made

| Area | Change |
|------|--------|
| **Theme** | Added `layout.minTouchTargetSize: 48` for reference and use in list/tab touch targets |
| **Tab bar** | `tabBarItemStyle`: on Android, added `minHeight: layout.minTouchTargetSize` so each tab item meets 48dp touch target |
| **Settings rows** | `SettingsRow`: on Android, applied `minHeight: layout.minTouchTargetSize` to the inner row so each row is at least 48dp tall |
| **Destructive row** | `DestructiveRow`: `minHeight: 48` (shared; benefits Android especially) |

No change to: typography assets, safe-area logic, or scroll padding constants (already use `layout.scrollContentPaddingBottomTab`). No new architecture or provider changes.

### Files Changed (Stage 4)

- `apps/mobile/constants/theme.ts` — `layout.minTouchTargetSize: 48`
- `apps/mobile/app/(tabs)/_layout.tsx` — tab bar item `minHeight` on Android
- `apps/mobile/components/ui.tsx` — SettingsRow Android minHeight, DestructiveRow minHeight

---

## Remaining Rough Spots (Device Validation)

- **Typography weight hierarchy:** Font weights are consistent in code; actual rendering (especially on Android) should be checked on device for title vs body emphasis.
- **Tab bar shadow/elevation:** Current values (elevation 6, shadowOpacity 0.12) look good on many devices; confirm on target Android devices for any clipping or excess shadow.
- **Scroll end spacing:** Bottom padding uses `layout.scrollContentPaddingBottomTab`; confirm on devices with large gesture bars that content is not obscured.
- **Card/list density:** Section spacing and card padding use shared tokens; device check can confirm that list density feels right on smaller Android screens.

---

## Summary

- **Stage 3:** Product-grade copy (billing, empty states, loading), consistent padding tokens, full-screen error container for Matches, and a minimum touch target for destructive actions.
- **Stage 4:** 48dp minimum touch targets for tab items and settings-style rows on Android, plus a shared layout token for future use. No business logic or backend changes.
