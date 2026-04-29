# Vibe Video Processing And Score Consistency Investigation

Branch: `fix/vibe-video-processing-score-consistency`

## Canonical Contract

- Vibe Score video credit is UID-based: a non-empty `profiles.bunny_video_uid` is score eligible.
- Playback readiness is ready-state-based: clients may only render/play the video when the canonical state is ready and a playable URL is available.
- UID plus `uploading`, `processing`, missing, null, or unknown status means processing. It must not render as no video or as generic unavailable.
- UID plus `failed` means failed/retry or re-record. It must not render as no video.
- No UID means no video and no score video credit.
- Native surfaces must use `apps/mobile/lib/vibeVideoState.ts` or a safe extension of it.

## Inventory

### Database and backend contract

- `supabase/migrations/20260412170000_vibe_video_single_writer_ready_score.sql` introduced an older ready-only score rule.
- `supabase/migrations/20260501101000_vibe_video_contract_hardening.sql` and `supabase/migrations/20260501123000_vibe_video_backend_contract_repair.sql` replace that behavior. The latest `calculate_vibe_score` credits Vibe Video when `bunny_video_uid` is non-null and non-empty.
- `profiles.vibe_score` and `profiles.vibe_score_label` are DB-owned and recalculated by profile triggers/RPC flows. The latest migration backfills stored score fields using the UID-based rule.
- `supabase/functions/create-video-upload/index.ts` creates a Bunny video UID, records a media session, and activates the profile Vibe Video with status `uploading`. This is the intentional re-upload/processing window where score credit should exist before playback readiness.
- `supabase/functions/video-webhook/index.ts` maps Bunny statuses to profile/media-session statuses: ready statuses become `ready`, failed statuses become `failed`, everything else remains processing-like. The update is UID-guarded.
- `supabase/functions/delete-vibe-video/index.ts` calls the clear-profile RPC, clearing UID/status/caption. This removes score eligibility through the DB score recalculation path.

Conclusion: the current DB scoring contract is already canonical. No Supabase migration is expected unless implementation uncovers a later contradictory function.

### Web state checks

- `src/lib/vibeVideo/webVibeVideoState.ts` is the web resolver. It correctly separates UID-based score eligibility from readiness in spirit, but it still exposes persisted `uploading` as a distinct state. Canonical UI should collapse UID plus uploading into processing.
- `src/pages/ProfileStudio.tsx` reads DB-owned `profile.vibeScore` and `profile.vibeScoreLabel`. Its incomplete-action logic is UID-based through `src/lib/vibeScoreIncompleteActions.ts`.
- `src/pages/VibeStudio.tsx` uses the web resolver for backend state and uses upload-controller phase for live local upload progress. This distinction is good, but persisted profile status should resolve to processing.
- `src/components/hero-video/HeroVideoStatusCard.tsx` uses the resolver and controller phase. It can keep live controller `uploading`, but backend/profile `uploading` should no longer render as a persisted availability state.
- `src/pages/ProfilePreview.tsx` uses the resolver and treats ready plus playback URL as playable. It has owner-facing processing copy.
- `src/components/ProfilePreview.tsx` and `src/lib/vibeVideo/profilePreviewVisibility.ts` convert resolver state into preview sections. Non-owner processing/failed/CDN states are currently hidden, which can make UID+processing appear absent.
- `src/pages/UserProfile.tsx` only renders Vibe Video when ready and playable. UID+processing is currently hidden, which is an implicit empty/no-video presentation.
- `src/components/ProfileDetailDrawer.tsx` similarly gates the profile video section on ready plus playback URL. UID+processing is hidden.
- `src/components/matches/DropsTabContent.tsx` labels a drop as having Vibe Video only when ready/playable. Processing UID states do not get a processing indicator.
- `src/components/vibe-video/VibePlayer.tsx` has generic fallback copy containing "Video unavailable". Vibe Video callers usually pass ready-backed URLs, but the copy is still misleading under the canonical language.
- `src/components/LazyImage.tsx` has generic "Video unavailable" media copy. It is not a score source, but it should be softened to avoid conflicting terminology.
- `src/components/vibe-video/VibeStudioModal.tsx` has local-only "No video to confirm" copy. It is not profile UID semantics, but it can be changed to avoid stale "No video" search noise.

### Native state checks

- `apps/mobile/lib/vibeVideoState.ts` is the required native resolver. It mirrors the web resolver and also exposes persisted `uploading` as a distinct state. It should collapse UID plus uploading/null/unknown into processing.
- `apps/mobile/lib/vibeVideoStatus.ts` duplicates the web status normalizer. This creates drift risk and should be replaced with a shared status normalizer.
- `apps/mobile/app/(tabs)/profile/ProfileStudio.tsx` uses the native resolver and reads DB-owned `profile.vibe_score` and `profile.vibe_score_label`.
- `apps/mobile/app/vibe-studio.tsx` uses the native resolver for persisted state and the native upload controller for active local phases. Its delete flow optimistically clears UID/status after the backend delete succeeds.
- `apps/mobile/components/profile/UserProfileFullView.tsx` uses the native resolver, but only shows processing/failed/CDN cards to the owner. Non-owner UID+processing is hidden, matching the web preview gap.
- `apps/mobile/components/video/FullscreenVibeVideoModal.tsx` has ad hoc UID/playback fallback copy (`uid ? ... : no video`) instead of receiving resolver state from callers.
- `apps/mobile/lib/nativeHeroVideoUploadController.ts` can resume from profile status. Persisted `uploading` should resume as processing unless there is an active local upload controller phase.
- `apps/mobile/lib/vibeVideoApi.ts` treats empty delete responses as idempotent success. This is delete semantics, not processing availability.
- Native report flows use UID-based `reportedHasVibeVideo`, which matches score-eligibility semantics.

### Onboarding, wizard, nudges, and score helpers

- `src/components/wizard/ProfileWizard.tsx` uses DB-loaded `profileData?.vibeScore` for displayed progress and uses UID existence as the video completion hint. This matches the contract as long as the hint does not claim readiness.
- `src/lib/vibeScoreIncompleteActions.ts` and `apps/mobile/lib/vibeScoreIncompleteActions.ts` use UID existence for the Vibe Video incomplete action. This is correct for score credit.
- `src/utils/calculateVibeScore.ts` is deprecated/client-side and UID-based for `hasVibeVideo`. It must remain a hint only and not become source of truth.
- `src/utils/vibeScoreUtils.ts` is match/event compatibility logic, not profile completeness scoring.
- Profile Studio and native profile score displays read stored DB score fields rather than recalculating them locally.

### Client score ownership

- No audited client surface writes `vibe_score` or `vibe_score_label` as a direct source of truth.
- Web profile serialization avoids pushing `vibeScore`/`vibeScoreLabel` back into profile update payloads.
- Client calculators remain helper/hint utilities and must continue to be treated as non-authoritative.

## Ad Hoc Or Contradictory Checks

- Web and native resolver duplication can drift and currently preserves persisted `uploading` as its own availability state.
- Public/profile detail web surfaces use ready/playable gates without rendering the non-ready UID states, making processing look absent.
- Native full-screen playback fallback uses UID/playback checks directly instead of resolver-state copy.
- Native public profile details hide non-ready UID states from non-owners.
- Generic "Video unavailable" and "No video" copy appears in playback/media/delete paths and needs replacement or explicit justification when the state is truly no UID.

## Root Causes

1. The backend scoring contract was repaired to UID-based credit, but the web/native availability resolvers were not fully collapsed to the same four canonical UI buckets: none, processing, ready, failed.
2. Some UI surfaces equated "not playable yet" with "do not render a Vibe Video state", which made UID+processing appear like no video.
3. Native playback fallback copy bypassed `apps/mobile/lib/vibeVideoState.ts`, creating a separate UID/playback interpretation.
4. Status normalization exists in multiple files, so upload/processing wording can drift between web and native.

## Fix Plan

- Add a shared pure Vibe Video semantics helper for UID normalization, Bunny status normalization, canonical state resolution, and score eligibility.
- Update web and native resolvers to consume that helper. Persisted UID plus uploading/processing/null/unknown will resolve to processing; only active upload-controller phases may show live upload progress.
- Keep score display source-of-truth as DB `vibe_score`/`vibe_score_label`.
- Update web public/profile detail/drop surfaces so UID+processing renders a processing state and UID+failed renders failed/retry copy instead of disappearing.
- Update native public/profile/fullscreen surfaces to use resolver state and preserve web/native parity.
- Replace misleading generic "Video unavailable" and non-canonical "No video" copy where it can be reached from Vibe Video flows.
- Add tests for canonical state resolution, score eligibility, no-UID delete semantics, re-upload processing semantics, and non-authoritative client calculators.
- Re-run typecheck/lint/tests for web and mobile, then search for remaining ad hoc checks and document any intentional matches.

