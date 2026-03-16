# Phase 3 — Stage 2: Photo/media presentation pass — summary

**Scope:** Improve native profile media area to match web hierarchy (hero primary photo + Photos gallery). No backend or provider changes.

---

## Files changed

| File | Changes |
|------|---------|
| `apps/mobile/app/(tabs)/profile/index.tsx` | Hero primary photo: rounded-2xl container, border-4 background, shadow; fallback initials when no photo. Photos section: Card variant="glass", header with Camera icon + VibelyText "Photos" + "Manage" / "Add photo" with chevron-forward. Grid: main tile with shadows.card for hierarchy; Main badge; empty state radius 2xl, padding 2xl. Main content padding uses layout.containerPadding; gallery card marginTop spacing['2xl']; effectiveGridWidth fallback uses layout.containerPadding. Added styles: heroPhotoContainer, heroPhotoImage, heroPhotoFallback, heroPhotoInitials, galleryCard, photoSectionTitleRow, photoSectionIcon, photoManageLink, photoManageLinkText, photoGridTileMain. Removed: avatarRing, avatarImage. |

---

## Web patterns mirrored

1. **Primary photo (hero)**  
   - Web: ProfilePhoto `rounded="2xl"`, `border-4 border-background`, `shadow-2xl`.  
   - Native: Rounded rectangle (radius['2xl']), borderWidth 4 with theme.background, shadows.card. Same prominence and clear “main” focal point.

2. **Gallery section surface**  
   - Web: `glass-card p-4 space-y-3`.  
   - Native: Card variant="glass" (surfaceSubtle, rounded-2xl, padding), marginTop spacing['2xl'] for section rhythm, header-to-grid spacing.md.

3. **Gallery header**  
   - Web: Row with Camera icon, “Photos” title, “Manage” + ChevronRight.  
   - Native: Camera icon (tint), VibelyText “Photos” (titleSM), “Manage” / “Add photo” + chevron-forward; same actions (manage sheet or add photo).

4. **Thumbnail grid**  
   - Web: grid 3 cols, gap-2; first tile col-span-2 row-span-2 aspect-[4/5], rest aspect-square; rounded-2xl.  
   - Native: Unchanged layout (main 2×2 + 4/5 aspect, secondary square); radius['2xl'] on all tiles; main tile gets shadows.card for hierarchy.

5. **Main badge**  
   - Web: Top-left pill, “Main” (Crown on web editable view).  
   - Native: Top-left pill, Sparkles + “Main”; badge background rgba(0,0,0,0.5) for readability.

6. **Empty state**  
   - Web: Dashed border, rounded-2xl add state.  
   - Native: Dashed border, radius['2xl'], paddingVertical spacing['2xl'], paddingHorizontal spacing.xl.

7. **Layout constants**  
   - Main content: paddingHorizontal layout.containerPadding.  
   - Section gap before Photos: marginTop spacing['2xl'].  
   - Grid width fallback: layout.containerPadding for consistency.

---

## What remains for the next stage

- **Hero gradient:** Web uses gradient strip + overlay animation; native still uses solid tint. Stage 1 audit: hero gradient is a visual mismatch; can be done in a later pass (e.g. GradientSurface).
- **Verification badge on photo:** Web shows VerificationBadge when verified; native does not (optional primitive).
- **Vibe Video 16:9 card:** Not in scope for Stage 2; remains for Stage 3 (video block reshape).
- **Prompts / vibes / verification steps:** Data and section structure; out of scope for photo/media pass.
- **Other sections:** Vibe Score, Schedule, Stats, Looking For, About Me, etc. still use default Card; can be moved to glass and VibelyText in a later stage for full profile parity.
