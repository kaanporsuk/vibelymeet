# Mobile — Sprint 2: Profile, Onboarding, Events, Discovery

Sprint 2 implements profile + onboarding + events + attendee discovery parity on mobile using the same backend as web. No backend-only forks; no new backend changes.

## Repo contracts used

- **Profiles:** `profiles` table (select/upsert). Web: `profileService.createProfile`, `profileService.updateMyProfile`, `profileService.fetchMyProfile`; mobile uses same tables and semantics via `lib/profileApi.ts` (createProfile, updateMyProfile, fetchMyProfile).
- **Onboarding completeness:** Web `ProtectedRoute` and `Auth` check `profiles` row + `gender` + `photos.length`; mobile treats “profile row exists” as onboarding complete (see gaps below).
- **Events:** `events` table (select, order by event_date). Visibility: same as web `isEventVisible` (grace period, status filter) in `lib/eventsApi.ts`.
- **Event registration:** `event_registrations` insert/delete (same as web `useRegistrations`).
- **Event deck:** RPC `get_event_deck(p_event_id, p_user_id, p_limit)` — backend-owned pause/deck exclusion. Mobile calls it via `useEventDeck` in `lib/eventsApi.ts`.
- **Swipe actions:** Edge Function `swipe-actions` with body `event_id`, `target_id`, `swipe_type` (`vibe` | `pass` | `super_vibe`). Notifications and match creation remain backend-owned.

## Implemented in Sprint 2

1. **Onboarding:** Multi-step (name → gender + optional tagline, job, about_me). Submits via `createProfile` (profiles upsert + user_credits upsert). No profile photo upload; message in UI and docs.
2. **Profile:** Load own profile (fetchMyProfile), display avatar/photos if present, edit name/tagline/job/about_me (updateMyProfile). Photo upload not implemented; existing media displayed via `lib/imageUrl.ts` (Bunny CDN + Supabase storage).
3. **Events list:** Load from `events` with same visibility rules; loading/error/empty states; tap to detail.
4. **Event detail:** Load event by id, show cover/title/date/description, register/unregister (event_registrations), “Open lobby” when registered.
5. **Event lobby:** Requires registration; loads deck via `get_event_deck`; one card at a time with Pass / Vibe / Super Vibe; calls `swipe-actions`; match/queue toasts.

## Backend / shared changes

None. All flows use existing tables, RPCs, and Edge Functions. No schema or API changes.

## Web impact

None. Web app unchanged; no root or web-only code modified.

## Gaps after Sprint 2

- **Onboarding:** Web requires at least 1 photo (and often 2) for “complete”; mobile considers profile row existence sufficient. Users who onboard only on mobile may be sent to onboarding again on web until they add photos. Documented in onboarding screen and README.
- **Profile photo upload:** Deferred. Web uses `persistPhotos` → `uploadImageToBunny` (File API); mobile would need image picker + upload path to same contract; not implemented this sprint.
- **Vibes/prompts/lifestyle:** Onboarding and profile edit do not yet sync `profile_vibes`, `prompts`, or `lifestyle` (web onboarding does). Can be added in a follow-up using same backend tables.

## Checks

- **Web:** `npm run typecheck:core`, `npm run build`, `./scripts/run_golden_path_smoke.sh` (run from repo root).
- **Mobile:** `cd apps/mobile && npm run typecheck`.

**Sprint 3:** Chat + notifications — see **`docs/mobile-sprint3.md`**.
