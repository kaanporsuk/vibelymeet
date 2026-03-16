# Stage 2: Design Token Normalization — Summary

**Scope:** Native theme constants, type scale, spacing, radii, elevation/shadow, and color usage brought into alignment with web (Stage 1 audit). No screen redesign; no provider/backend changes.

---

## 1. Files changed

| File | Changes |
|------|--------|
| `apps/mobile/constants/Colors.ts` | Reordered and expanded to match web `:root` semantics; added `secondary`, `secondaryForeground`, `muted`, `mutedForeground`, `primaryForeground`, `input`, `ring`, `popover`, `popoverForeground`; added comments mapping to web tokens. |
| `apps/mobile/constants/theme.ts` | Normalized radii to web (sm/md/lg from Tailwind); added `radius.base`, `radius.button`, `radius.input`; added `border.width`; added `layout.containerPadding`; added `button.height` and `button.radius`; added `gradient.primary` and `gradient.accent` (color-stop arrays for future use). |
| `docs/phase1-stage2-token-normalization-summary.md` | New. This summary. |

**No other files modified.** Components (e.g. `ui.tsx`) still consume the same theme keys; they now receive web-aligned values. Radii used in `(tabs)/index.tsx`, `(tabs)/events/index.tsx`, and `(tabs)/profile/index.tsx` now use the new `radius.sm` / `radius.md` values (12 and 14).

---

## 2. Token mismatches corrected

| Area | Before (native) | After (web-aligned) |
|------|------------------|---------------------|
| **Palette / colors** | Missing semantic tokens for secondary, muted, primary/secondary foreground, input, ring, popover. | Added `secondary` (240 10% 14%), `muted` (240 10% 16%), `primaryForeground`, `secondaryForeground`, `mutedForeground`, `input`, `ring`, `popover`, `popoverForeground` in `Colors.ts`. |
| **Radii** | `radius.sm = 8`, `radius.md = 12` (no web mapping). | `radius.sm = 12` (web rounded-sm), `radius.md = 14` (web rounded-md), `radius.lg = 16` (web rounded-lg); added `radius.base = 16`, `radius.button = 24`, `radius.input = 16`. |
| **Borders** | No central border width tokens. | Added `border.width.hairline`, `thin`, `medium` for consistent usage. |
| **Layout** | No explicit container padding token. | Added `layout.containerPadding = 16` (web 1rem). |
| **Buttons** | No shared size/radius scale. | Added `button.height.sm/default/lg` (40/48/56) and `button.radius.sm/default/lg` (16/24/24) for future component use. |
| **Gradients** | No gradient representation. | Added `gradient.primary` and `gradient.accent` as color-stop arrays (no runtime gradient in Stage 2). |

---

## 3. Web tokens that could not be expressed directly (native equivalent chosen)

| Web token / concept | Limitation | Native approach |
|----------------------|------------|------------------|
| **`--gradient-primary` / `--gradient-accent`** | No CSS linear-gradient in RN; no new dependency in Stage 2. | Defined as `gradient.primary` and `gradient.accent` arrays of hex/hsl strings for future use (e.g. `expo-linear-gradient`). No gradient applied in UI this stage. |
| **`backdrop-blur-xl` (glass-card)** | React Native has no built-in backdrop blur for arbitrary views. | Glass surfaces use opaque `glassSurface` / `glassBorder` in `Colors.ts`; same visual intent, no blur. |
| **`--radius` as CSS variable** | N/A. | Exposed as `radius.base` and `radius.lg` (16). |
| **Font family (Inter, Space Grotesk)** | Not in Stage 2 scope; fonts not loaded on mobile. | Typography scale (fontSize, weight, letterSpacing) unchanged; font family left to later phase. |
| **Tailwind `rounded-full`** | N/A. | Kept as `radius.pill = 999`. |

---

## 4. Backward compatibility and behavior

- **Existing keys kept:** `text`, `textSecondary`, `background`, `surface`, `surfaceSubtle`, `border`, `tint`, `accent`, `danger`, `tabIconDefault`, `tabIconSelected`, `tintSoft`, `glassSurface`, `glassBorder`, `neonViolet`, `neonPink`, `neonCyan`, `neonYellow` (and success/dangerSoft) remain; new semantic names added alongside.
- **Radii:** Only `radius.sm` and `radius.md` numeric values changed (8→12, 12→14). All usages are via token, so layout and behavior are unchanged; corners are slightly rounder where those tokens are used (events filters, dashboard countdown, profile).
- **No component logic or navigation changed.** No changes to providers, API calls, or shared business logic.

---

*Stage 2 complete. Token layer is normalized; next phase can consume `button.*`, `radius.button`, `gradient.*`, and semantic colors in components.*
