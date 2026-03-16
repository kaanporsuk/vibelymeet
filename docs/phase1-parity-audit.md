# Phase 1 — Shared Native Design Foundation: Parity Audit

**Source of truth:** Web (`src/index.css`, `tailwind.config.ts`, `src/components/ui/*`).  
**Target:** Native (`apps/mobile`: `constants/Colors.ts`, `constants/theme.ts`, `components/ui.tsx`).

---

## 1. Colors

| Token / usage        | Web | Mobile | Status |
|----------------------|-----|--------|--------|
| Background           | `--background` 240 10% 4% | `theme.background` hsl(240,10%,4%) | ✅ Aligned |
| Foreground / text    | `--foreground` 0 0% 98% | `theme.text` | ✅ Aligned |
| Card / surface       | `--card` 240 10% 8% | `theme.surface` | ✅ Aligned |
| Primary / tint       | `--primary` 263 70% 66% | `theme.tint` (vibelyPrimary) | ✅ Aligned |
| Accent               | `--accent` 330 81% 60% | `theme.accent` | ✅ Aligned |
| Muted foreground     | `--muted-foreground` 240 5% 60% | `theme.textSecondary` | ✅ Aligned |
| Border               | `--border` 240 10% 18% | `theme.border` | ✅ Aligned |
| Destructive          | `--destructive` 0 84% 60% | `theme.danger` | ✅ Aligned |
| Neon violet          | `--neon-violet` | `theme.neonViolet` | ✅ Aligned |
| Neon pink            | `--neon-pink` | `theme.neonPink` / `theme.accent` | ✅ Aligned |
| Neon cyan            | `--neon-cyan` 187 94% 43% | `theme.neonCyan` | ✅ Aligned |
| Neon yellow          | `--neon-yellow` 45 93% 58% | — | ⚠️ **Gap:** add to Colors |
| Secondary (surface)  | `--secondary` 240 10% 14% | Approx. via surfaceSubtle | ⚠️ Optional: add for strict parity |
| Glass bg             | `--glass-bg` 240 10% 10% / 0.6 | `theme.glassSurface` rgba(20,20,24,0.92) | ✅ Acceptable |
| Glass border         | `--glass-border` white/0.1 | `theme.glassBorder` | ✅ Aligned |

---

## 2. Gradients

| Token | Web | Mobile | Status |
|-------|-----|--------|--------|
| Primary gradient     | linear-gradient(135deg, violet → pink) | — | ⚠️ **Deferred:** no gradient primitive; hero/buttons use solid tint. Add in Phase 2 if needed. |
| Accent gradient      | pink → cyan | — | Deferred |

---

## 3. Typography

| Scale | Web | Mobile theme | Status |
|-------|-----|--------------|--------|
| Font families        | Inter (body), Space Grotesk (headings) | System default; SpaceMono for mono | ⚠️ **Deferred:** font loading (Inter/Grotesk) not in scope for Phase 1. |
| Title XL            | — | 28, 700 | ✅ |
| Title LG             | — | 22, 700 | ✅ |
| Title MD             | — | 18, 600 | ✅ |
| Title SM             | — | 16, 600 | ✅ |
| Body                 | — | 14 | ✅ |
| Body secondary       | — | 14, opacity 0.8 | ✅ |
| Caption              | — | 12, 0.75 | ✅ |
| Overline             | — | 11, 600, letterSpacing 1 | ✅ |

---

## 4. Spacing

| Scale | Web (Tailwind) | Mobile | Status |
|-------|----------------|--------|--------|
| xs    | 1 (4px) | 4 | ✅ |
| sm    | 2 (8px) | 8 | ✅ |
| md    | 3 (12px) | 12 | ✅ |
| lg    | 4 (16px) | 16 | ✅ |
| xl    | 6 (24px) | 24 | ✅ |
| 2xl   | 8 (32px) | 32 | ✅ |
| 3xl   | — | 40 | ✅ |

---

## 5. Radii

| Token | Web | Mobile | Status |
|-------|-----|--------|--------|
| --radius (base)      | 1rem (16) | radius.lg 16 | ✅ |
| rounded-lg           | var(--radius) | radius.lg | ✅ |
| rounded-xl           | — | radius.xl 20 | ✅ |
| rounded-2xl          | 1.5rem (24) | radius['2xl'] 24 | ✅ |
| rounded-3xl          | 2rem (32) | radius['3xl'] 32 | ✅ |
| pill / full          | rounded-full | radius.pill 999 | ✅ |

---

## 6. Shadows / elevation

| Token | Web | Mobile | Status |
|-------|-----|--------|--------|
| Card shadow          | — | shadows.card (offset 4, radius 12, elevation 5) | ✅ |
| Neon glow violet     | .neon-glow-violet (multi-layer) | shadows.glowViolet | ✅ |
| Neon glow pink/cyan  | .neon-glow-pink, .neon-glow-cyan | — | ⚠️ **Gap:** add glowPink, glowCyan to theme for parity |

---

## 7. Components & primitives

| Primitive | Web | Mobile | Status |
|-----------|-----|--------|--------|
| Screen container     | — | ScreenContainer (safe area, title, footer) | ✅ |
| Section header       | — | SectionHeader (title, subtitle, action) | ✅ |
| Primary button      | Button default / gradient | VibelyButton primary (tint) | ✅ |
| Secondary button    | Button secondary | VibelyButton secondary | ✅ |
| Ghost button        | Button ghost | VibelyButton ghost | ✅ |
| List row            | — | SettingsRow, MatchListRow | ✅ |
| Card                | .glass-card, card styles | Card (solid), GlassSurface | ✅ |
| Chip / badge        | Badge (default, secondary, destructive, outline) | Inline “New” / intent chip only | ⚠️ **Gap:** add reusable Chip/Badge |
| Avatar              | — | Avatar (size, image, fallbackInitials) | ✅ |
| Media tile           | — | Ad-hoc (event card, discover card) | ⚠️ Deferred: no shared MediaTile |
| Empty state         | — | EmptyState | ✅ |
| Error state         | — | ErrorState | ✅ |
| Loading state        | — | LoadingState | ✅ |
| Input               | border-input, rounded | VibelyInput + inputStyles | ✅ |
| Screen header (back + title) | — | Per-screen (Settings, Matches) | ⚠️ **Gap:** add ScreenHeader primitive |

---

## 8. Navigation chrome

| Item | Web | Mobile | Status |
|------|-----|--------|--------|
| Tab bar              | — | Glass surface, tint/tintSoft, safe area | ✅ |
| Screen headers       | — | GlassSurface + custom layout per screen | ✅; add ScreenHeader for consistency |
| Safe area            | .pb-safe, env(safe-area-inset-*) | useSafeAreaInsets in layout & screens | ✅ |
| Scroll bottom padding | — | paddingBottom ~80 + insets where needed | ✅ |

---

## 9. Summary: gaps to address in Phase 1

1. **Colors:** Add `neonYellow` to `Colors.ts`.
2. **Shadows:** Add `glowPink`, `glowCyan` to `theme.ts` (optional; neon parity).
3. **Primitives:** Add reusable **Chip** (badge) and **ScreenHeader** (back + title + optional right).
4. **Deferred (Phase 2+):** Gradient primitives, Inter/Space Grotesk fonts, shared MediaTile, secondary/muted as explicit tokens if needed.

---

*Audit complete. Proceeding to token normalization and primitive implementation.*
