# Stage 3: Primitive Component Pass — Summary

**Goal:** Implement or refine reusable native primitives so later screen work can reuse them cleanly. All primitives use Stage 2 tokens.

---

## 1. Primitives created vs refined

| Primitive | Status | Change |
|-----------|--------|--------|
| **Screen container** | Refined | Uses `layout.containerPadding` for horizontal padding (web 1rem). Same API. |
| **Section header** | Refined | JSDoc added; already used typography + spacing tokens. No API change. |
| **Primary button** | Refined | Uses `button.height` and `button.radius` from theme; `size` prop (sm / default / lg); label uses `theme.primaryForeground`; `border.width.thin`. |
| **Secondary button** | Refined | Same VibelyButton with `variant="secondary"`; uses theme.surface and theme.border. |
| **List row** | Created + Refined | **ListRow** created (generic left/right/onPress). **SettingsRow** refined: icon container uses `theme.secondary`. **MatchListRow** unchanged; uses `border.width.hairline` for divider. |
| **Card** | Refined | `variant` prop added: `'default' | 'glass'` (glass = surfaceSubtle bg); uses `border.width.thin` from theme. |
| **Chip/badge** | Refined | **destructive** variant added; default label uses `theme.primaryForeground`; secondary uses `theme.secondary` / `theme.secondaryForeground`; border uses `border.width.thin`. |
| **Avatar** | Refined | Image container background uses `theme.muted` (was surfaceSubtle). Fallback unchanged. |
| **Media tile** | Created | **MediaTile**: rounded-2xl container, optional caption overlay, optional aspectRatio and onPress. For event cards, discover cards, profile covers. |
| **Text styles / typography** | Created | **VibelyText**: applies `typography[variant]` + theme text color; optional color override. Variant = keyof typography (titleXL, titleLG, titleMD, body, caption, etc.). |
| **Empty state** | Refined | Optional **illustration** prop for future use; EmptyState/ErrorState/LoadingState pass `size="default"` to VibelyButton. |
| **Error state** | Refined | Uses theme.danger for title; button uses VibelyButton with size. |
| **Loading state** | Refined | Uses theme.tint for ActivityIndicator; no API change. |

---

## 2. Files changed

| File | Changes |
|------|--------|
| `apps/mobile/components/ui.tsx` | Import `border`, `button` from theme. **VibelyText** added. **inputStyles** use `radius.input`, `border.width.thin`. **ScreenContainer** styles use `layout.containerPadding`. **Card** variant + `border.width.thin`. **VibelyButton** size prop, destructive variant, `button.*` tokens, `primaryForeground`. **Chip** destructive variant, `primaryForeground`, `secondary`/`secondaryForeground`, `border.width.thin`. **Avatar** image bg `theme.muted`. **MediaTile** added. **ListRow** added. **SettingsRow** icon bg `theme.secondary`. **MatchListRow** divider `border.width.hairline`. **EmptyState** illustration prop, button size. **ErrorState** / **LoadingState** button size. New styles: mediaTile, mediaTileCaption, listRowInner, listRowLeft, listRowRight. |
| `docs/phase1-stage3-primitives-summary.md` | New. This summary. |

---

## 3. How to reuse in later phases

- **ScreenContainer** — Use as root for full-screen layouts (with or without title/headerRight/footer). Horizontal padding and max content width come from theme; wrap scroll content inside.
- **SectionHeader** — Above cards or lists: pass title, optional subtitle, optional action (e.g. “See all” link). Use one per section.
- **VibelyButton** — Primary/secondary/ghost/destructive; size sm/default/lg. Use primary for main CTAs, secondary for secondary actions, destructive for delete/danger, ghost for low emphasis. Prefer `size="default"` unless design specifies sm/lg.
- **ListRow** — Generic row: pass `left` and optional `right` (and optional `onPress`). Use for custom list rows that don’t need the Settings icon+title+subtitle pattern.
- **SettingsRow** — Rows with leading icon, title, optional subtitle, optional right (default chevron). Use in settings, account, and any “list of options” screens.
- **MatchListRow** — Conversation list row (avatar, name, time, preview, New badge, unread dot). Use in matches/chat list only.
- **Card** — Content blocks with padding, border, shadow. Use `variant="default"` for main content, `variant="glass"` for lighter blocks. Optional `onPress` for tappable cards.
- **Chip** — Badges/pills: default (primary), secondary, outline, accent, destructive. Use for tags, status, “New” labels, etc.
- **Avatar** — Circular image or initials. Use for profile, matches, lists. Pass `image` (e.g. `<Image source={{ uri }} />`) or `fallbackInitials`.
- **MediaTile** — Image area with optional bottom caption overlay. Use for event covers, discover cards, profile hero. Pass children (image), optional caption (e.g. title + subtitle), optional aspectRatio and onPress.
- **VibelyText** — Themed text: pass `variant` (e.g. titleLG, body, caption) and optional `color`. Use instead of manual `typography.X` + color in new screens.
- **EmptyState / ErrorState / LoadingState** — Full-block states: title, optional message, optional CTA. EmptyState supports optional `illustration` for future rich empty UIs. Use when a screen has no data, an error, or is loading.

---

*Stage 3 complete. Primitives are token-driven and ready for screen-level work in later phases.*
