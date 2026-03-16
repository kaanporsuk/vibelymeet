# Phase 3 — Stage 3: Profile content and interaction parity — summary

**Scope:** Refine native profile content sections and interactions to match web hierarchy, affordances, and trust surfaces. No backend or business-logic changes.

---

## What changed visually and structurally

### 1. Section card treatment

- **Glass cards:** All content sections now use `Card variant="glass"` (surfaceSubtle, rounded-2xl) to match web `glass-card`: Vibe Score, My Vibe Schedule, Looking For, About Me, My Vibes, The Basics, Lifestyle, Verification, Invite Friends. Photos already used glass in Stage 2.
- **Unified section header:** Sections that have an edit entry point use a shared pattern: row with icon + VibelyText title (titleSM) on the left, and "Edit" + chevron-forward on the right. Applied to Looking For, About Me, My Vibes, The Basics, Lifestyle.

### 2. Bio / about / prompt hierarchy

- **Looking For:** Icon (flag) + title + Edit chevron; value shown with `Chip` (variant="secondary") instead of a custom pill; placeholder "Be upfront. It saves everyone time." uses `helperText` style.
- **About Me:** Title + Edit chevron; body copy unchanged; same placeholder.
- **Conversation Starters:** Standalone section header (Quote icon + title) with no card wrapper; empty state is a single **pressable** dashed card (borderRadius 2xl, dashed border, surfaceSubtle) that opens the edit flow. Copy: "Add your first Conversation Starter" + "Give matches something fun to respond to."

### 3. Vibe chips and status rows

- **My Vibes:** Glass card, Sparkles icon + title + Edit chevron; placeholder "No vibes yet. Add some personality!" with `helperText`. Structure ready for future Chip list when vibes exist in API.
- **Stats row:** Each stat cell uses `theme.surfaceSubtle` and `theme.glassBorder` (and existing radius.xl) so the row matches web glass-card treatment.
- **The Basics:** Glass card; each metadata row uses `theme.surface` and `borderRadius: radius.xl` (web rounded-xl).

### 4. Edit actions and entry points

- **Single edit affordance:** All section edit entry points use the same pattern: Pressable with "Edit" + chevron-forward, styles `sectionEditLink` and `sectionEditLinkText` (14px, fontWeight 600, theme.tint). No mixed button/link styles.
- **Conversation Starters:** Empty state is a single tappable card that calls `setEditing(true)` instead of a non-interactive card.

### 5. Verification (trust surfaces)

- **Step list:** Verification is a glass card with header (shield icon + "Verification"), subline "Get a verified badge and stand out", and three rows:
  - **Email:** label "Email", description "Verified", checkmark icon (no action).
  - **Photo:** label "Photo verification", description "Verify on web", chevron; press opens vibelymeet.com/profile.
  - **Phone:** label "Phone number", description "Verify on web", chevron; press opens vibelymeet.com/settings.
- Rows use consistent spacing, label/description typography, and optional trailing icon (checkmark vs chevron). No backend or profile fields used; entry points are web links.

### 6. Section titles, sublabels, spacing

- **Titles:** Section titles use VibelyText variant="titleSM" for Looking For, About Me, My Vibes, The Basics, Lifestyle, Verification; same for standalone headers (Conversation Starters, Vibe Video).
- **Helper copy:** Placeholder/helper text uses `helperText` (14px, lineHeight 20) for Looking For, My Vibes, Lifestyle.
- **Spacing:** `sectionHeaderRow` has marginBottom spacing.md; `verificationSubline` has marginBottom spacing.md; basics grid and verification steps use consistent padding.

### 7. New / updated styles

- **sectionHeaderRow,** **sectionTitleRow,** **sectionIcon,** **sectionEditLink,** **sectionEditLinkText** — shared section header and edit link.
- **chipWrap,** **helperText** — chip container and body/helper text.
- **sectionHeaderStandalone** — for sections without a card (Conversation Starters, Vibe Video).
- **promptsEmptyCard** — dashed, rounded-2xl, padding for the empty Conversation Starters card.
- **verificationSubline,** **verificationSteps,** **verificationStepRow,** **verificationStepRowLast,** **verificationStepContent,** **verificationStepLabel,** **verificationStepDesc** — verification step list.
- **basicRow** — borderRadius set to radius.xl (web rounded-xl).
- **statCard** — uses theme.surfaceSubtle and theme.glassBorder.

---

## What profile areas are now at acceptable parity

- **Section structure:** Glass cards and a single section-header + edit pattern across Looking For, About Me, My Vibes, The Basics, Lifestyle; standalone headers for Conversation Starters and Vibe Video.
- **Edit affordances:** One consistent "Edit" + chevron style and behavior; Conversation Starters empty state is an explicit edit entry point.
- **Verification:** Presented as a short step list with clear entry points (Verify on web) instead of a single paragraph.
- **Status/metadata rows:** Stats and Basics use glass-like styling and rounded-xl rows; Looking For uses Chip for value.
- **Visual rhythm:** Shared spacing (sectionHeaderRow marginBottom, verification subline, step row padding) and typography (VibelyText titleSM, helperText).

---

## What is still intentionally deferred

- **Prompts and vibes data:** Conversation Starters and My Vibes do not yet render list/chip content from the API; native profile fetch does not include `prompts` or `vibes`. Display of prompts and vibe chips is deferred until the profile API is extended (Stage 1 audit).
- **Verification status:** Email is shown as "Verified" by default; photo and phone show "Verify on web" only. Actual photo_verified / phone_verified from the backend are not read on native in this pass.
- **Lifestyle key-value rows:** Lifestyle section still shows a single placeholder line; no lifestyle object rendering until profile API returns lifestyle and UI is extended.
- **Edit flow:** Inline edit form (name, tagline, job, about_me) is unchanged; no per-section drawers. Edit entry points are unified; the flow remains a single form at the bottom when "Edit" is pressed.
- **Hero gradient and VerificationBadge on photo:** Out of scope for Stage 3; deferred to earlier/later stage.
- **Vibe Video 16:9 cinematic card:** Not changed in Stage 3; deferred.

---

## Files changed

- **apps/mobile/app/(tabs)/profile/index.tsx** — All section structure, Card variant="glass", section header + edit pattern, Chip for Looking For, Conversation Starters pressable empty card, Verification step list, Stats/Basics styling, new styles.
- **docs/phase3-stage3-content-interaction-parity-summary.md** — This summary.

No changes to `lib/profileApi`, `components/ui`, or backend.
