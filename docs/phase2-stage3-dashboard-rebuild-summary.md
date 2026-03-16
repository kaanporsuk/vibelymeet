# Phase 2 Stage 3 — Dashboard card and section rebuild summary

**Goal:** Rebuild the dashboard’s visible cards and sections so they feel recognizably Vibely rather than scaffolded, matching web hierarchy and ornamentation where possible.

---

## 1. Rebuilt sections

| Section | Changes |
|--------|--------|
| **Next Event (event preview)** | Card: glass border (`theme.glassBorder`), `shadows.card` for depth. Media: 144px height, stronger overlay (0.5) for title contrast. **Live state:** `shadows.glowPink`, LIVE badge (destructive bg/border, Radio icon, “Live Now”), subline “People vibing right now” with People icon. **Registered badge:** Neon-cyan pill (top-right) when not live. Title/date: `VibelyText` titleLG (white) + date; caption area aligned with web. Countdown: blocks use `theme.secondary` only (no border), `VibelyText` titleMD for numbers (tint). CTA: “View & Register” uses `size="sm"` when not registered; “Enter Lobby →” primary when live. |
| **No upcoming events (empty)** | Wrapper uses `Card variant="glass"` for glass-card parity; copy unchanged (“No upcoming events”, “Browse Events”). |
| **Your Matches (match preview)** | Section title: `VibelyText` titleMD. “X new” pill unchanged (accent soft/border). Match names: `VibelyText` body, 12px, maxWidth 64. Row: gap `spacing.lg` (16), item gap `spacing.sm`. New-match ring (tint border) unchanged. **Empty state:** `Card variant="glass"`; copy: “No matches yet”, “Join an event to start connecting!”, “Browse Events”. |
| **Upcoming Events (discover rail)** | Cards: `radius['2xl']` (24), `theme.glassBorder`, `shadows.card`, `theme.surfaceSubtle`. Image: 120px, `resizeMode="cover"`. Body: padding `spacing.md`, gap 6. Title: `VibelyText` titleSM. Meta: date • time at 12px. Attendees: row with `Ionicons people-outline` + “X attending” (12px). Skeleton: `radius['2xl']` to match. |
| **Section headers** | “Next Event” and “Upcoming Events” use `SectionHeader`. “Your Matches” uses custom row with `VibelyText` titleMD + “X new” pill + “See all” link. “See all” / “All events” remain primary (tint). |

---

## 2. Tokens and primitives used

- **Theme:** `layout`, `spacing`, `radius`, `shadows` (card, glowPink), `typography` via VibelyText.
- **Colors:** `theme.surfaceSubtle`, `theme.glassBorder`, `theme.secondary`, `theme.tint`, `theme.neonCyan`, `theme.danger`, `theme.dangerSoft`, `theme.accent`, `theme.accentSoft`, `theme.text`, `theme.textSecondary`, `theme.primaryForeground`.
- **Components:** `GlassHeaderBar`, `SectionHeader`, `VibelyText`, `VibelyButton`, `Card` (default + glass), `Avatar`, `EmptyState`, `Skeleton`.

---

## 3. Remaining dashboard parity gaps

| Gap | Notes |
|-----|--------|
| **Backdrop blur** | Web glass-card uses `backdrop-blur-xl`; native uses opaque `surfaceSubtle` + border. No blur without adding a blur dependency. |
| **Gradient CTA** | Web “Enter Lobby →” uses `variant="gradient"`; native uses primary solid. GradientSurface/button gradient deferred. |
| **LIVE badge animation** | Web uses `animate={{ scale: [1, 1.2, 1] }}`; native badge is static. Optional later. |
| **MiniDateCountdown in header** | Web shows next date reminder in header; native does not. Deferred. |
| **Banners** | ActiveCallBanner, DeletionRecoveryBanner, PhoneVerificationNudge, date reminders, Premium/other-cities nudge not on native dashboard. Deferred to later phases. |
| **Next event source** | Web uses `useNextRegisteredEvent` (registered-first); native uses first upcoming from `useEvents`. Behavior gap accepted unless product asks to align. |

---

## 4. Device validation pass

**The dashboard is now visually acceptable for a device validation pass.**

- **Hierarchy:** Section order and headings match web (Next Event → Your Matches → Upcoming Events). Section titles use the typography scale; CTAs are clear.
- **Surfaces:** Event and discover cards use glass-like treatment (surfaceSubtle, glassBorder, shadow). Empty states use Card variant="glass". Live state has distinct LIVE badge and glow.
- **Ornamentation:** Borders, radius (2xl on cards), elevation (shadows.card, glowPink when live), and neon accents (cyan registered, pink “new” pill, violet countdown/tint) are in place. No placeholder-only rows; copy matches web where applicable.
- **Data wiring:** Unchanged; no backend or contract changes.

Recommended: run an Android (and optionally iOS) build to confirm layout, safe area, and touch targets on device, then proceed to state-handling polish (Stage 4) or further screen parity as needed.
