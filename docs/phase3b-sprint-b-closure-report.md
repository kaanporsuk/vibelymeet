# Sprint B — Onboarding, trust, and settings — Closure report

## Sprint B status: **complete**

All major code-inferable onboarding, trust, and settings gaps are closed within `apps/mobile`. Remaining work is mostly matches/chat/monetization completion and later screenshot-led polish.

---

## Exact scope completed

### A) Onboarding expansion / web fallback
- **Audit**: Native had 2 steps (name → gender/tagline/job/about). Web has 8 steps (welcome, identity, location, details, about, vibes, looking for, photos/video).
- **Implemented**:
  - Onboarding screen restyled with theme tokens (Colors, spacing, radius), VibelyButton, Card.
  - Explicit **“Add photos & more on web”** card with copy and **“Complete on web”** CTA opening `https://vibelymeet.com/profile`.
  - No silent dead ends; handoff to web is clear and intentional.

### B) Notification permission flow
- **Permission state**: `usePushPermission` hook (OneSignal `getPermissionAsync` / `requestPermission`) exposes `status`, `isGranted`, `isDenied`, `requestPermission`, `openSettings`, `refresh`.
- **NotificationPermissionFlow** modal: intro → requesting → success or denied; when denied, **“Open Settings”** uses `Linking.openSettings()` (Android) or `Linking.openURL('app-settings:')` (iOS).
- **Wiring**: Dashboard notification icon opens the flow when permission not granted, otherwise navigates to Settings → Notifications. Settings → Notifications shows permission status (Enabled / Disabled / Not set), “Enable notifications” or “Open Settings” when denied, and link to web for quiet hours/toggles.
- OneSignal/provider stack unchanged; `registerPushWithBackend` still used after grant.

### C) Phone verification nudge
- **PhoneVerificationNudge** component with variants: wizard, match, event, empty. Copy aligned with web; CTA is **“Verify on Web”** (or “Verify Phone” for event) opening `https://vibelymeet.com/settings`.
- **Dashboard**: Nudge shown when profile `phone_verified` is false; dismiss persisted to AsyncStorage (`vibely_phone_nudge_dashboard_dismissed`). No native OTP flow; verification remains web-only.

### D) Deletion recovery banner
- **useDeletionRecovery**: Reads `account_deletion_requests` for `user_id` and `status = 'pending'`; **cancelDeletion** calls Edge Function `cancel-deletion` with session token.
- **DeletionRecoveryBanner**: Shows scheduled date and “Cancel Deletion” CTA; glass/neon styling.
- **Surfaces**: Dashboard (top, in-flow) and Account settings (above account card). No new account lifecycle logic.

### E) Events location prompt
- **Logic**: `useQuery` for `profiles.location_data`; banner shown when no `location_data` (or no lat/lng) and not dismissed.
- **LocationPromptBanner**: “Set your location to see events near you” with “Not now” and **“Set location”** opening `https://vibelymeet.com/profile`. Events list is not blocked when location is missing.

### F) Profile verification / Safety Hub
- **Profile**: Existing Verification section and photo/phone verified badges unchanged.
- **Account settings**: Verification state (phone verified, photo verified) shown as chips on Account screen.
- **Safety Center**: New Settings row “Safety Center” (subtitle: “Report, tips, emergency resources”) opening web. No native Safety Hub sheet (web remains source for report/tips/emergency/pause).

### G) Settings completion
- **Notifications** (`/settings/notifications`): Push permission state, request flow, “Open Settings” when denied, link to web for quiet hours/alert sounds. Uses GlassHeaderBar and Card.
- **Privacy** (`/settings/privacy`): New screen with “Profile & discovery” copy, “Open privacy on web”, Blocked users (web), Privacy Policy link.
- **Account** (`/settings/account`): Email, phone/photo verification chips, deletion recovery banner when pending, “Open account settings on web”. GlassHeaderBar.
- **Main Settings**: Privacy now routes to native `/settings/privacy`. Safety Center row added. Quick links: How Vibely Works, Help & Feedback, Privacy Policy, Terms of Service. No dead taps; all rows either work or hand off to web/support.

---

## Exact files changed

| File | Change |
|------|--------|
| `apps/mobile/lib/useDeletionRecovery.ts` | **New**. Hook for pending deletion + cancel via `cancel-deletion`. |
| `apps/mobile/lib/usePushPermission.ts` | **New**. OneSignal permission state, request, openSettings. |
| `apps/mobile/components/settings/DeletionRecoveryBanner.tsx` | **New**. Banner with scheduled date and Cancel CTA. |
| `apps/mobile/components/notifications/NotificationPermissionFlow.tsx` | **New**. Modal: intro / requesting / success / denied + Open Settings. |
| `apps/mobile/components/PhoneVerificationNudge.tsx` | **New**. Nudge card with “Verify on Web” handoff. |
| `apps/mobile/app/(tabs)/index.tsx` | Deletion recovery banner, usePushPermission + NotificationPermissionFlow, PhoneVerificationNudge (dashboard), handleNotificationPress, handleCancelDeletion. |
| `apps/mobile/app/(onboarding)/index.tsx` | Theme/Colors, VibelyButton, Card, “Complete on web” card and CTA. |
| `apps/mobile/app/(tabs)/events/index.tsx` | Profile location query, showLocationPrompt from `!hasLocation`, LocationPromptBanner “Set location” → web profile. |
| `apps/mobile/app/settings/index.tsx` | Privacy → `/settings/privacy`, Safety Center row. |
| `apps/mobile/app/settings/_layout.tsx` | Stack screen `privacy`. |
| `apps/mobile/app/settings/notifications.tsx` | Permission state, request, Open Settings, NotificationPermissionFlow, link to web. |
| `apps/mobile/app/settings/account.tsx` | GlassHeaderBar, verification chips (phone/photo), useDeletionRecovery + DeletionRecoveryBanner. |
| `apps/mobile/app/settings/privacy.tsx` | **New**. Privacy screen: copy, Open privacy on web, Blocked users, Privacy Policy. |

---

## Exact behaviors now working

1. **Onboarding**: Themed basics (name, gender, tagline, job, about); clear “Add photos & more on web” and “Complete on web” to profile URL.
2. **Notifications**: Permission state reflected in UI; first-time request via modal; denied → “Open Settings”; Settings → Notifications shows status and web link for toggles.
3. **Phone verification**: Dashboard nudge for unverified users with “Verify on Web”; dismiss stored in AsyncStorage.
4. **Deletion recovery**: Pending deletion shown on dashboard and account; “Cancel Deletion” calls `cancel-deletion` and clears banner.
5. **Events location**: Banner when profile has no location; “Set location” opens web profile; “Not now” dismisses for session.
6. **Account**: Email, phone/photo verification chips, recovery banner when deletion pending, web handoff for password/pause/delete.
7. **Privacy**: Dedicated screen with visibility/blocked copy and web links.
8. **Safety Center**: Single entry in Settings opening web.

---

## Anything still blocked and why

- **Phone verification in-app**: Full OTP/verification flow is web-only; native only shows nudge and “Verify on Web”. No backend change.
- **Native Safety Hub sheet**: Report/tips/emergency/pause flows live on web; native only exposes entry to web. No new native screens for report wizard or pause flow.
- **Location set in-app**: Setting `location_data` (e.g. geolocation or city picker) is not implemented natively; “Set location” opens web profile.
- **Expo Router typed routes**: `/settings/privacy` required a cast to `Href` for typecheck; route works at runtime.

---

## Ready for manual screenshot refinement?

Yes. All Sprint B surfaces use the existing mobile design system (glass/neon-noir), safe areas, and grouped sections. Remaining work after Sprint B is mainly:

- Matches/chat/monetization completion (Sprint C).
- Screenshot-led visual and copy polish.
- Any product decision to move phone verification or location onboarding into the app (would require backend/contracts unchanged here).

---

*Generated after Sprint B implementation. TypeScript: `npx tsc --noEmit` passes.*
