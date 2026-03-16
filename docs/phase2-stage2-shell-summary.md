# Phase 2 Stage 2 — Top-level shell refinement summary

**Goal:** Refine the native app shell around the dashboard so the top-level experience feels premium and web-consistent.

---

## 1. What was improved

| Area | Change |
|------|--------|
| **Safe-area handling** | Already in place: GlassHeaderBar uses insets.top; tab bar uses insets.bottom; ScreenContainer uses insets.top. No change. |
| **Status bar** | Default Expo/React Native treatment; no override. |
| **Top header spacing and hierarchy** | GlassHeaderBar already uses layout.headerPaddingTopExtra, headerPaddingBottom, containerPadding. Dashboard uses it. No change. |
| **Scroll container structure** | Dashboard scroll content uses layout.mainContentPaddingTop for top padding (breathing room below header). New constant so other tab screens can reuse. |
| **Section spacing rhythm** | Dashboard main already uses gap spacing['2xl'] (32px) and layout.containerPadding. Aligned with web space-y-8. No change. |
| **Tab bar spacing / visual weight** | Tab bar shadow reduced: shadowOpacity 0.2→0.12, shadowRadius 10→8, elevation 8→6. Less “heavy”; aligns with web’s subtle glass border. |
| **Shell background** | Screen root uses theme.background (dashboard and tab layout). No change. |
| **Card stack and breathing room** | layout.mainContentPaddingTop (24) used for scroll content and main; section gap 32px. Consistent. |
| **Horizontal gutters and padding** | layout.containerPadding (16) used for main and header; scroll bottom uses layout.scrollContentPaddingBottomTab. No change. |
| **Scaffold cues** | Softer tab bar shadow and glass-like card surfaces (Stage 1 fixes) reduce generic feel. |

---

## 2. Reusable shell primitives improved or introduced

| Primitive / token | Location | Use |
|-------------------|----------|-----|
| **layout.mainContentPaddingTop** | theme.ts | Top padding for main content below header (24px, web py-6). Use for scroll content or first section on tab screens. |
| **GlassHeaderBar** | ui.tsx | Already reusable; Dashboard, Events, Matches use it. Settings uses GlassSurface + ScreenHeader. |
| **layout.containerPadding, scrollContentPaddingBottomTab** | theme.ts | Already in use; dashboard now also uses mainContentPaddingTop from layout. |
| **Tab bar style** | (tabs)/_layout.tsx | Softer shadow; applies to all tab screens. |

No new wrapper component was added; constants and existing primitives were used.

---

## 3. Screens that inherit these changes

- **Dashboard:** Uses GlassHeaderBar, layout.mainContentPaddingTop, layout.containerPadding, scrollContentPaddingBottomTab; benefits from softer tab bar and glass-like cards.
- **Events, Matches:** Already use GlassHeaderBar and layout constants; they automatically benefit from the softer tab bar and can adopt layout.mainContentPaddingTop for their scroll content if desired.
- **Settings:** Uses GlassSurface + ScreenHeader; benefits from softer tab bar.
- **Profile:** Does not use GlassHeaderBar; can adopt it or mainContentPaddingTop in a later pass.

---

## 4. Files changed (Stage 2 only)

| File | Change |
|------|--------|
| `apps/mobile/constants/theme.ts` | layout.mainContentPaddingTop = spacing.xl. |
| `apps/mobile/app/(tabs)/index.tsx` | scrollContent and main use layout.mainContentPaddingTop. |
| `apps/mobile/app/(tabs)/_layout.tsx` | Tab bar shadowOpacity, shadowRadius, elevation reduced. |

Stage 1 fixes (Next Event / Discover glass-like and sizing) are in the same branch; see phase2-dashboard-parity-matrix.md.
