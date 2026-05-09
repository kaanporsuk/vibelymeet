# Surface inventory candidates (mechanical)

**Generated:** 2026-05-09 via `node scripts/surface-inventory-audit.mjs`

## Method

Static import graph from `src/App.tsx`, expanding `@/*`, `@shared/*`, `@clientShared/*`, and relative imports.

## Summary

| Bucket | Orphan count |
|--------|----------------|
| `src/pages` | **0** |
| `src/hooks` | **0** |
| `src/components` | **41** |
| Modules in graph | **547** |

## Orphan pages (0)

_None._

## Orphan hooks (0)

_None._

## Orphan components (41)

- `src/components/DashboardGreeting.tsx`
- `src/components/EventCard.tsx`
- `src/components/LazyImage.tsx`
- `src/components/NavLink.tsx`
- `src/components/OnboardingStep.tsx`
- `src/components/PageTransition.tsx`
- `src/components/PhoneVerifiedBadge.tsx`
- `src/components/PhotoGallery.tsx`
- `src/components/ProfilePreview.tsx`
- `src/components/ProgressBar.tsx`
- `src/components/SuperLikeButton.tsx`
- `src/components/VibeScore.tsx`
- `src/components/events/AttendeeCard.tsx`
- `src/components/events/MiniProfileModal.tsx`
- `src/components/safety/EmergencyResources.tsx`
- `src/components/safety/PauseAccountFlow.tsx`
- `src/components/safety/SafetyHub.tsx`
- `src/components/safety/SafetyTipsCarousel.tsx`
- `src/components/schedule/DateProposalTicket.tsx`
- `src/components/ui/accordion.tsx`
- `src/components/ui/breadcrumb.tsx`
- `src/components/ui/carousel.tsx`
- `src/components/ui/chart.tsx`
- `src/components/ui/command.tsx`
- `src/components/ui/context-menu.tsx`
- `src/components/ui/form.tsx`
- `src/components/ui/hover-card.tsx`
- `src/components/ui/menubar.tsx`
- `src/components/ui/navigation-menu.tsx`
- `src/components/ui/pagination.tsx`
- `src/components/ui/resizable.tsx`
- `src/components/ui/separator.tsx`
- `src/components/ui/sidebar.tsx`
- `src/components/ui/toggle-group.tsx`
- `src/components/ui/toggle.tsx`
- `src/components/ui/use-toast.ts`
- `src/components/wizard/PhotoUploadGrid.tsx`
- `src/components/wizard/ProfileWizard.tsx`
- `src/components/wizard/PromptCards.tsx`
- `src/components/wizard/VibeTagCloud.tsx`
- `src/components/wizard/WizardProgressRing.tsx`


## Caveats

- Graph starts at src/App.tsx; follows @/, @shared/, @clientShared/, and relative imports.
- Literal dynamic import() paths are analyzed; computed dynamic paths are not.
- Files only loaded by Vite glob or runtime strings may false-positive as orphans.

## Interpretation (2026-05-09 audit refresh)

Legacy **video-date checkpoint / unused survey** orphans were already removed — see `docs/audits/orphan-triage-2026-04-14.md`. The current candidate list still contains mostly shadcn `ui/*`, wizard, safety, and marketing-style components. Treat this file as a triage queue, not a deletion manifest; do not mass-delete without product or route-level proof.
