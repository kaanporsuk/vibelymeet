# Stage 1: Parity Audit of Visual Tokens and Primitives

**Scope:** Compare current web source-of-truth design language vs current `apps/mobile` implementation.  
**No code changes in this stage** — inspection and gap report only.

---

## Source-of-truth mapping

| Category | Web source | Mobile source |
|----------|------------|---------------|
| **Colors / CSS vars** | `src/index.css` (`:root`), `tailwind.config.ts` (theme.extend.colors) | `apps/mobile/constants/Colors.ts` |
| **Spacing / radii / typography / shadows / layout** | `tailwind.config.ts`, `src/index.css` (components) | `apps/mobile/constants/theme.ts` |
| **Buttons** | `src/components/ui/button.tsx` (cva variants) | `apps/mobile/components/ui.tsx` → `VibelyButton` |
| **Badges / chips** | `src/components/ui/badge.tsx` | `apps/mobile/components/ui.tsx` → `Chip` |
| **Cards / glass** | `src/index.css` (`.glass-card`), ad-hoc `glass-card` + `rounded-2xl` in pages | `apps/mobile/components/ui.tsx` → `Card`, `GlassSurface` |
| **Inputs** | Tailwind `border-input`, `rounded-xl`/`rounded-2xl`, `h-12`/`h-14` in forms | `apps/mobile/components/ui.tsx` → `VibelyInput`, `inputStyles` |
| **Screen shell / headers** | Sticky `glass-card border-b` headers in Dashboard, Matches, Settings, etc. | `ScreenContainer`, `ScreenHeader`, `GlassSurface` in screens |
| **Tab bar** | `src/components/BottomNav.tsx` (web) | `apps/mobile/app/(tabs)/_layout.tsx` (Tabs) |
| **Empty / loading / error** | `EmptyMatchesState`, ad-hoc loading/error UIs | `EmptyState`, `LoadingState`, `ErrorState` in ui.tsx |
| **Rows** | Ad-hoc list rows, settings-like rows | `SettingsRow`, `MatchListRow`, `DestructiveRow` |
| **Avatars** | `ProfilePhoto`, `EventCover` in `src/components/ui/ProfilePhoto.tsx` etc. | `Avatar` in ui.tsx |
| **Media tiles** | Event cards, discover cards (className patterns) | Ad-hoc in dashboard/events (no shared MediaTile) |

---

## Audit findings

### 1. What already aligns

- **Colors:** Background, foreground, card/surface, primary (tint), accent, muted-foreground (textSecondary), border, destructive (danger), neon violet/pink/cyan/yellow. Glass (glassSurface, glassBorder) and tintSoft are present and used.
- **Spacing scale:** `theme.ts` spacing (xs 4 → 3xl 40) matches Tailwind-style scale; screenPadding and contentWidth (512) align with web container/max-w.
- **Radii:** Base radius 1rem → `radius.lg` 16; rounded-2xl → `radius['2xl']` 24; pill → `radius.pill` 999. Card and chip use these.
- **Shadows:** `shadows.card` and `shadows.glowViolet`/`glowPink`/`glowCyan` exist; neon glow tokens are present.
- **Typography scale:** titleXL/LG/MD/SM, body, bodySecondary, caption, overline in theme; no font-family on mobile (system default) but scale is defined.
- **Screen containers:** `ScreenContainer` provides full-screen layout, optional title/headerRight/footer, safe-area top padding, max-width inner content.
- **Cards:** `Card` uses surface, border, radius 2xl, shadows.card; `GlassSurface` provides glass bar (header/tab bar).
- **Rows:** `SettingsRow` (icon, title, subtitle, right, onPress), `MatchListRow` (avatar, name, time, preview, unread, New badge), `DestructiveRow` — all present and used.
- **Buttons:** `VibelyButton` has primary (tint), secondary (surface + border), ghost; primary aligns with web default; no gradient/glass/neon variants on mobile.
- **Inputs:** `VibelyInput` + `inputStyles` (height 44, radius lg, border, padding); aligns with web h-12/rounded controls.
- **Badges/chips:** `Chip` exists with variants default, secondary, outline, accent; used in MatchListRow for “New”. Web Badge has default, secondary, destructive, outline — mobile has no destructive chip variant.
- **Empty/loading/error states:** `EmptyState`, `ErrorState`, `LoadingState` in ui.tsx with title, message, optional action; used on dashboard, matches, profile.
- **Headers:** `ScreenHeader` (back, title, right, insets) exists; used on Settings inside `GlassSurface`. Dashboard and Matches use custom header rows.
- **Avatars:** `Avatar` (size, image, fallbackInitials); used in MatchListRow, dashboard, profile.
- **Tab bar:** `(tabs)/_layout.tsx` uses glassSurface, glassBorder, tint/tintSoft, safe-area bottom, label style — aligned with web “glass” chrome.
- **Safe-area:** `useSafeAreaInsets()` used in tab layout, ScreenContainer (top), ScreenHeader (top), Settings, Dashboard header; scroll padding uses `layout.tabBarScrollPadding` where applicable.

### 2. What is visibly off

- **Button shape/size:** Web default is `h-12 rounded-2xl`; mobile uses `radius.lg` (16) not 2xl (24) for buttons — slightly smaller radius. Web also has explicit sizes (sm: h-10 rounded-xl, lg: h-14 rounded-2xl); mobile has one size.
- **Card vs glass-card:** Web uses `glass-card` (bg-card/60, backdrop-blur, border white/10, rounded-2xl) in many places; mobile `Card` is solid surface + border, no blur. Glass is separate via `GlassSurface` (bars only). So list/content cards on mobile look solid, not glass — visually different.
- **Empty state treatment:** Web `EmptyMatchesState` has gradient hero, feature pills (glass-card), gradient CTA; mobile `EmptyState` is plain title + message + secondary button. No gradient or pill strip — simpler.
- **Secondary color:** Web has `--secondary` 240 10% 14%; mobile uses `surface`/`surfaceSubtle` (8%/10%) but no named `secondary` token. Any web component using `bg-secondary` has no direct token match; mobile approximates with surface.
- **Fonts:** Web uses Inter (body) + Space Grotesk (headings); mobile uses system default. Type will look different until fonts are loaded on mobile.
- **Screen header consistency:** Matches and Events build their own header (icon + title + pill/tabs); only Settings uses `ScreenHeader`. So “screen header” pattern is not uniform across stack/tab screens.

### 3. What is missing in mobile

- **Gradient primitives:** Web has `--gradient-primary`, `--gradient-accent`, `gradient-text`, and Button variant `gradient`. Mobile has no gradient background or gradient button; CTAs are solid tint.
- **Neon / outline button variants:** Web has Button `neon` (border-accent, text-accent) and `glass`; mobile has only primary, secondary, ghost.
- **Destructive button variant:** Web Button has `destructive`; mobile has only DestructiveRow, no destructive `VibelyButton` variant.
- **Badge destructive variant:** Web Badge has `destructive`; mobile Chip has default, secondary, outline, accent — no destructive.
- **Shimmer / skeleton animation:** Web has `.shimmer-effect` and `.skeleton` (animate-pulse); mobile `Skeleton` is static placeholder (no pulse). Shimmer not present.
- **Shared media tile:** Web reuses patterns (e.g. `rounded-2xl overflow-hidden` + cover image + caption); mobile event/discover cards are inline in dashboard/events — no shared `MediaTile` or `EventCard` primitive.
- **Explicit “secondary” and “muted” tokens:** Web uses `--secondary` and `--muted` for surfaces; mobile uses surface/surfaceSubtle. Not missing in behavior but missing as named tokens for strict parity.
- **Backdrop blur:** Web glass-card uses `backdrop-blur-xl`; React Native has no built-in blur for arbitrary views (would need BlurView). So glass on mobile is opaque with similar color, not true blur.

### 4. What should be centralized into reusable primitives/tokens

- **Tokens:**  
  - Add `secondary` (and optionally `muted`) to `Colors.ts` if screens need to mirror web `bg-secondary`/`bg-muted` exactly.  
  - Keep a single source for “scroll padding above tab bar” (already `layout.tabBarScrollPadding`).  
  - Consider exporting a small “button sizes” map (sm/default/lg) from theme to align with web h-10/h-12/h-14.

- **Primitives:**  
  - **ScreenHeader:** Already a primitive; adopt on more screens (e.g. Matches, Events) so “back + title + right” and “title + right” are consistent.  
  - **Chip:** Already centralized; add destructive variant if needed for alerts.  
  - **VibelyButton:** Add optional `destructive` variant; consider `outline`/`neon` (border-accent) and size prop (sm/default/lg) for parity.  
  - **Card:** Optionally add a “glass” variant (e.g. translucent background + border) where RN allows, or document that mobile uses solid card.  
  - **Empty state:** Optional “rich” variant (illustration slot, pills, gradient CTA) for high-traffic screens like Matches.  
  - **Media tile:** Extract a reusable “image + overlay + caption” tile used by event cards and discover cards so layout and radii are consistent.

- **Hierarchy:**  
  - Standardize “stack screen with back” = `GlassSurface` + `ScreenHeader` (insets).  
  - Standardize “tab screen with custom header” = `GlassSurface` + (title row + optional tabs/search); consider using `ScreenHeader` for the title row with `onBack` undefined.

### 5. Smallest high-leverage implementation order for Phase 1

1. **Tokens only (low risk):**  
   - Add `secondary` (and optionally `muted`) to `Colors.ts` for parity.  
   - Add button size scale to `theme.ts` (e.g. `buttonHeight: { sm: 40, default: 48, lg: 56 }`) and use in VibelyButton.

2. **Button parity (high leverage):**  
   - VibelyButton: use `radius['2xl']` for default (match web rounded-2xl).  
   - Add size prop (sm/default/lg) using theme heights.  
   - Add `destructive` variant; optionally add `outline` (border primary) for secondary CTAs.

3. **Chip/Badge:**  
   - Add `destructive` variant to Chip so badges match web.

4. **Screen header adoption:**  
   - Use `ScreenHeader` on Matches (title “Matches”, right = count pill) and Events (title “Events”, optional right) so all “chrome” screens share one primitive.

5. **Card / glass (optional for Phase 1):**  
   - Either add a `variant="glass"` to Card (e.g. opacity + border only, no blur) or document “solid card on mobile” and defer glass cards.

6. **Empty state (optional):**  
   - Add optional illustration/pills slot to EmptyState for Matches/dashboard, or keep simple and defer “rich” empty to Phase 2.

7. **Defer:**  
   - Gradients (needs expo-linear-gradient or similar).  
   - Font loading (Inter/Space Grotesk).  
   - Shimmer/skeleton animation.  
   - Shared MediaTile (extract when a second screen needs the same tile).

---

## Recommended Phase 1 implementation order

1. **Theme/Colors** — Add `secondary` (and optionally `muted`) to `Colors.ts`; add button size map to `theme.ts`.  
2. **VibelyButton** — rounded-2xl, size prop, destructive (and optionally outline) variant.  
3. **Chip** — destructive variant.  
4. **ScreenHeader** — Use on Matches and Events for consistent chrome.  
5. **Screen scroll padding** — Ensure all tab screens use `layout.tabBarScrollPadding` (or equivalent) for bottom padding.  
6. **Card** — Document or add glass-style variant (solid-with-border only if no blur).  
7. **EmptyState** — Optional enhancement (illustration/pills); else leave as-is.

---

## Files likely to change

| File | Likely changes |
|------|----------------|
| `apps/mobile/constants/Colors.ts` | Add `secondary`, optionally `muted`. |
| `apps/mobile/constants/theme.ts` | Optional: button size map. |
| `apps/mobile/components/ui.tsx` | VibelyButton (radius, size, destructive/outline); Chip destructive; optional Card variant. |
| `apps/mobile/app/(tabs)/matches/index.tsx` | Replace custom header row with ScreenHeader (title + right). |
| `apps/mobile/app/(tabs)/events/index.tsx` | Use ScreenHeader for title row if applicable. |
| Other tab/stack screens | Use ScreenHeader where “back + title” or “title + right” is needed; use layout.tabBarScrollPadding for scroll content. |

---

## Risks / things not to touch in this phase

- **Backend / env / infra:** No API, env vars, or deployment changes.  
- **RevenueCat, OneSignal, Daily, Supabase:** No changes to provider integration.  
- **Navigation structure:** Do not change tab list, stack routes, or deep links.  
- **Auth flows:** Do not change sign-in/sign-up/onboarding logic.  
- **Font loading:** Do not add or change font loading in `_layout.tsx` unless Phase 1 explicitly includes “load Inter/Space Grotesk”; current SpaceMono is fine.  
- **New native dependencies:** Avoid adding packages (e.g. blur, gradient) unless agreed for Phase 1; gradient and blur can be deferred.  
- **Web codebase:** Audit only compares; do not change `src/` in this phase.  
- **Existing behavior:** Preserve all current functionality; only tokens and presentational primitives should change.

---

*Stage 1 audit complete. Use this document to drive Phase 1 implementation without scope creep.*
