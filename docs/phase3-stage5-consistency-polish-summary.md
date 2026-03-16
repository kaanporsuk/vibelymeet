# Phase 3 — Stage 5: Consistency and polish pass (Profile + Settings) — summary

**Scope:** Normalize Profile and Settings against the shared mobile primitive system. Finish quality only; no large new structures.

---

## Final files changed

| File | Changes |
|------|--------|
| **`apps/mobile/app/(tabs)/profile/index.tsx`** | ScrollView `contentContainerStyle` paddingBottom → `layout.scrollContentPaddingBottomTab`. `vibeScoreCard` marginBottom: `spacing.lg + 4` → `spacing.xl`. `sectionLabel` marginTop: `spacing.lg + 4` → `spacing.xl`. `statsRow` gap: `spacing.md + 2` → `spacing.lg`. `statCard` padding: `spacing.lg + 2` → `spacing.lg`. `promptsEmptyInner` paddingVertical: `spacing.xl + 4` → `spacing.xl`. Edit form `input` borderRadius: `12` → `radius.input`. |
| **`apps/mobile/app/settings/index.tsx`** | ScrollView `contentContainerStyle` paddingBottom → `layout.scrollContentPaddingBottomTab` (was `spacing['2xl'] + layout.tabBarScrollPadding`). |
| **`docs/phase3-stage5-consistency-polish-summary.md`** | This summary. |

---

## Consistency fixes applied

- **Scroll / bottom safe area:** Profile and Settings now both use `layout.scrollContentPaddingBottomTab` for scroll content paddingBottom, matching Dashboard. Tab content clears the tab bar consistently.
- **Spacing scale:** Profile magic numbers replaced with theme tokens: `spacing.xl` for section/card margins, `spacing.lg` for stats row gap and stat card padding, `spacing.xl` for empty-state vertical padding.
- **Input radius:** Profile edit form inputs use `radius.input` instead of hardcoded `12`.
- **No structural changes:** No new components or layout wrappers; only token and style tweaks.

---

## Remaining known visual mismatches vs web

| Area | Mismatch | Notes |
|------|----------|--------|
| **Fonts** | Inter / Space Grotesk not loaded on native | Documented in Phase 2 cleanup; system fonts used until font assets are added. |
| **Section-to-section spacing** | Profile content cards use Card default `marginBottom: spacing.md`; Settings nav uses `spacing.lg` | Optional later: unify to `spacing.lg` for section cards (e.g. via a shared section-card style). |
| **Credits subtitle (Settings)** | Static copy vs web dynamic (Premium expiry / credit counts) | Requires credits/premium data on settings screen. |
| **Verification / trust** | Photo/phone verification status not read from API on native | Entry points open web; native could later show verified state from profile. |
| **Glass / blur** | Native glass cards are opaque (surfaceSubtle); no backdrop blur | Platform limitation; visual hierarchy and borders aligned. |

---

## Android rebuild recommendation

**Yes — an Android rebuild is warranted for device validation.**

- **Profile and Settings** now use the same scroll-bottom token as Dashboard, shared Card/glass treatment, and consistent spacing from the theme.
- **Phase 3** (Profile + Settings parity) is complete through Stage 5; consistency and polish are applied without new features or backend changes.
- A **device build** will confirm: tab bar overlap, safe area, scroll rhythm, and glass-card appearance on real hardware and different screen sizes.

**Suggested step:** Run a dev/build pass on a physical Android device (or emulator) for Profile and Settings, then proceed to any remaining Phase 3 verification or the next phase (e.g. matches/chat or global QA).
