# Stage 4: Navigation Chrome Pass — Summary

**Goal:** Tab bar, screen headers, spacing rules, safe-area handling, and top-level shell hierarchy brought to Vibely parity. Route structure and navigation behavior unchanged.

---

## 1. What changed in the app shell

### Theme (layout constants)

- **Shell layout constants** in `theme.ts`: `tabBarContentHeightIos` (56), `tabBarContentHeightAndroid` (52), `tabBarPaddingTop` (8), `tabBarPaddingBottomAndroid` (10), `headerPaddingTopExtra` (spacing.sm), `headerPaddingBottom` (spacing.md), and `scrollContentPaddingBottomTab` (tabBarScrollPadding + spacing.xl) for consistent scroll bottom padding on tab screens.

### Tab bar

- **`(tabs)/_layout.tsx`**: Tab bar height uses `layout.tabBarContentHeightIos` / `layout.tabBarContentHeightAndroid`; top padding uses `layout.tabBarPaddingTop`; bottom padding uses `insets.bottom` on iOS and `Math.max(insets.bottom, layout.tabBarPaddingBottomAndroid)` on Android. Top border uses `border.width.thin`. No change to tabs, icons, or routes.

### Screen headers and gutters

- **Unified header padding**: All tab screens with a glass header now use:
  - **Top:** `insets.top + layout.headerPaddingTopExtra`
  - **Bottom:** `layout.headerPaddingBottom`
  - **Horizontal:** `layout.containerPadding`
- **Dashboard (`(tabs)/index.tsx`)**: Glass header uses the constants above.
- **Events (`(tabs)/events/index.tsx`)**: Same header padding and gutters.
- **Matches (`(tabs)/matches/index.tsx`)**: `matchesHeader` uses `layout.containerPadding`, `headerPaddingTopExtra`, `headerPaddingBottom`; removed `borderRadius: 20` so the bar matches other headers.
- **Settings (`settings/index.tsx`)**: Uses `GlassSurface` + `ScreenHeader`; removed redundant `paddingBottom` from the header wrapper so only `ScreenHeader`’s padding applies.
- **ScreenHeader (ui.tsx)**: Row uses `layout.containerPadding` and `layout.headerPaddingBottom`; top padding uses `insets.top + layout.headerPaddingTopExtra`.

### Safe-area handling

- **Tab bar**: Already respected `useSafeAreaInsets().bottom`; now uses layout constants for content height and bottom padding.
- **Headers**: All tab headers use `insets.top + layout.headerPaddingTopExtra` (or, for Matches, `headerPaddingTopExtra` only, since `ScreenContainer` already applies top inset).
- **ScreenContainer**: Unchanged; still applies `insets.top` when not web. No change to stack screens’ safe-area usage.

### Vertical rhythm and gutters

- **Page gutters**: Header horizontal and screen content horizontal both use `layout.containerPadding` (16) so gutters are consistent.
- **Scroll bottom**: Dashboard and Settings already use `layout.tabBarScrollPadding` + spacing; new constant `scrollContentPaddingBottomTab` is available for future tab screens.

---

## 2. Screens that automatically benefit

- **Dashboard (Home)** — Header padding and gutters come from layout constants; feels aligned with other tab screens.
- **Events** — Same; header bar and content gutters aligned.
- **Matches** — Header bar padding and no rounded corners; same chrome language as other tabs.
- **Settings** — Uses `ScreenHeader` with shared padding; no double bottom padding.
- **Any screen using `ScreenHeader`** — Back + title + right now use the same horizontal and bottom padding as the rest of the shell.

---

## 3. Shell inconsistencies that must wait for later phases

- **Stack screens (Chat, Premium, Credits, Account, Notifications, etc.)**: Still use their own header layout and padding (e.g. `insets.top + spacing.sm`, `paddingHorizontal: spacing.lg`). They can be updated to use `layout.headerPaddingTopExtra`, `layout.headerPaddingBottom`, and `layout.containerPadding` when each screen is touched in later phases.
- **Profile tab**: No glass header bar; content starts under the status bar with its own hero/avatar. Adopting a shared “tab with header” pattern would be a deliberate design change and is left for a later phase.
- **Matches empty state**: Uses `ScreenContainer` + custom header row (icon + “Matches”); not using `ScreenHeader`. Functionally fine; visual parity with a single “title + right” header can be done when refining the Matches screen.
- **Events filter bar**: Sits below the header with its own padding; not part of the glass header. No change in this pass; can be refined with the rest of the Events screen.
- **Scroll content padding**: Dashboard and Settings use explicit `spacing.xl + layout.tabBarScrollPadding` (or `spacing['2xl'] + …`). Other tab screens (Matches list, Events content) use their own styles. Standardizing all to `layout.scrollContentPaddingBottomTab` can be done screen-by-screen later.

---

## 4. Files changed

| File | Changes |
|------|--------|
| `apps/mobile/constants/theme.ts` | Added shell layout: `tabBarContentHeightIos/Android`, `tabBarPaddingTop`, `tabBarPaddingBottomAndroid`, `headerPaddingTopExtra`, `headerPaddingBottom`, `scrollContentPaddingBottomTab`. |
| `apps/mobile/app/(tabs)/_layout.tsx` | Tab bar height and padding use layout constants; top border uses `border.width.thin`. |
| `apps/mobile/components/ui.tsx` | `ScreenHeader` row uses `layout.containerPadding`, `layout.headerPaddingBottom`, and `layout.headerPaddingTopExtra` for top padding. |
| `apps/mobile/app/(tabs)/index.tsx` | Dashboard header uses `layout.headerPaddingTopExtra`, `layout.headerPaddingBottom`, `layout.containerPadding`. |
| `apps/mobile/app/(tabs)/events/index.tsx` | Events header uses same layout constants. |
| `apps/mobile/app/(tabs)/matches/index.tsx` | Import `layout`; `matchesHeader` uses layout constants, removed `borderRadius: 20`. |
| `apps/mobile/app/settings/index.tsx` | Header wrapper style: removed `paddingBottom` (handled by `ScreenHeader`). |
| `docs/phase1-stage4-navigation-chrome-summary.md` | New. This summary. |

---

*Stage 4 complete. Shell uses shared layout constants; tab bar and tab headers are aligned. Stack screens and profile can adopt the same rules in later screen phases.*
