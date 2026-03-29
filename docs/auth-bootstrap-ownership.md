# Auth & bootstrap ownership (post-refactor)

This document captures the new ownership model for authentication, profile, entitlements, and bootstrap side effects after `refactor/auth-decomposition`.

## Old model

Previously, `src/contexts/AuthContext.tsx` handled **all** of the following:

- Session lifecycle: Supabase `onAuthStateChange`, `getSession`, `signIn`, `signUp`, `logout`
- Profile hydration: fetching `profiles` row and transforming it into a frontend `user`
- Entitlements: checking the `user_roles` table for `admin`
- Pause/resume: local-only `isPaused` / `pauseUntil` state on the `user` object
- Sentry identity: `Sentry.setUser`, auth breadcrumbs
- Analytics identity: `identifyUser`, `resetAnalytics`, `setUserProperties`
- Notification identity: OneSignal `setExternalUserId` / `removeExternalUserId`, `notification_preferences` upserts

All of this was exposed via a single `useAuth()` hook that components used for:

- Session flags (`session`, `isAuthenticated`, `isLoading`, `isOfflineAtBoot`)
- Profile data (`user`)
- Entitlements (`isAdmin`)
- Pause / resume (`pauseAccount`, `resumeAccount`)

## New model

### 1. Session-only auth context

`AuthProvider` in `src/contexts/AuthContext.tsx` now exposes a **session-only** context via `useAuth()`:

- `session: Session | null`
- `isAuthenticated: boolean`
- `isLoading: boolean`
- `isOfflineAtBoot: boolean`
- `signUp(email, password, name)`
- `signIn(email, password)`
- `logout()`

It is responsible for:

- Wiring Supabase `onAuthStateChange` and `getSession`
- Tracking loading and offline-at-boot state
- Calling `refreshProfile` / `checkAdminRole` when a session user is present

It is **not** responsible for:

- Sentry identity
- PostHog identity or analytics user properties
- OneSignal identity or notification preference upserts

### 2. Profile ownership

`AuthProvider` now owns a dedicated **profile context** exposed via:

- `useUserProfile()` → `{ user, refreshProfile }`

Where `user` is the transformed profile:

- `id`, `name`, `email`, `avatarUrl`
- `age`, `gender`, `location`
- `hasPhotos`, `isPremium`, `isVerified`
- `isPaused`, `pauseUntil`

Responsibilities:

- Fetch `profiles` for the current `session.user.id`
- Map DB profile + Supabase user into the `User` shape
- Provide `refreshProfile()` so callers can force a re-hydration

All previous `const { user } = useAuth()` call sites in **shared/core** have been moved to `useUserProfile()`:

- Hooks: `useDailyDrop`, `useVisibleEvents`, `useEvents` (`useNextRegisteredEvent`), `useEventDetails`, `useEventStatus`, `useCredits`, `useEventReminders`, `useNotificationPreferences`, `useBlockUser`, `useMatches`, `useSubscription`, `useActivityHeartbeat`, `useMatchQueue`, `useMatchCall`, `useEventDeck`, `useDeletionRecovery`, `useMuteMatch`, `useRegistrations` (`useReengagementNotifications` removed — PR #143; web `useMysteryMatch` removed — session cleanup, native uses `lib/useMysteryMatch`)
- Components/pages that only needed profile data: `Dashboard`, `Events`, `EventLobby`, `Matches`, `Credits`, `Chat`, `ReadyGate`, `ReadyGateOverlay`, `MiniProfileModal`, `MatchSuccessModal`, `PauseAccountFlow`, `PushPermissionPrompt`, `NotificationManager`, `AccountSettingsDrawer`, `FeedbackDrawer`, `AdminGrantCreditsModal`, `AdminEventsPanel`, `ReportWizard`, `ProfileWizard`, `PostDateSurvey`, `EventDetails`

### 3. Account status ownership (pause / resume / admin flags)

Account-level entitlement state (not subscription tier capabilities) lives in a separate context exposed via:

- `useAccountStatus()` → `{ isAdmin, pauseAccount, resumeAccount }`

Responsibilities:

- `isAdmin`: hydrated via the existing `user_roles` query (`checkAdminRole`)
- Pause state: `pauseAccount` / `resumeAccount` still operate on the `User` shape, but are separated from the session API

**Tier capabilities** (swipe limits, event tier access, etc.) use **`useEntitlements()`** from **`@/hooks/useEntitlements`** (see `docs/entitlements-migration-guide.md`) — do not confuse with `useAccountStatus`.

Call sites that previously used `pauseAccount` from `useAuth` now use `useAccountStatus()`:

- `components/safety/PauseAccountFlow.tsx`

Admin gating in `ProtectedRoute` continues to rely on the **server-verified** `verify-admin` Edge Function for hard checks; client entitlements remain advisory.

### 4. Bootstrap / side-effect ownership

All non-session side effects have been moved out of `AuthProvider` into a dedicated hook:

- `src/hooks/useAppBootstrap.ts`
- Used once at the app shell level via `AppContent` in `src/App.tsx`

`useAppBootstrap()` is responsible for:

- **Sentry identity**
  - On login: `Sentry.setUser({ id })`
  - On logout: `Sentry.setUser(null)`
- **Analytics identity**
  - On login: `identifyUser(id, { email, created_at })`
  - On logout: `resetAnalytics()`
  - On profile updates: `setUserProperties(...)` driven by the enriched `user` from `useUserProfile()`
- **Notification / OneSignal identity**
  - On login: `setExternalUserId(user.id)`, `getPlayerId()`, `isSubscribed()`, and upsert into `notification_preferences`
  - On logout: `removeExternalUserId()`

This keeps `AuthProvider` purely about **data** and moves all provider-specific and analytics-specific wiring into a single, composable bootstrap hook.

## Summary: how to consume auth now

- **For session / routing / auth guards**
  - Use `useAuth()` for:
    - `session`, `isAuthenticated`, `isLoading`, `isOfflineAtBoot`
    - `signIn`, `signUp`, `logout`
  - Examples: `ProtectedRoute`, `Auth` page, `Index` landing.

- **For profile data**
  - Use `useUserProfile()` for:
    - `user` and `refreshProfile()`

- **For account state (pause / resume / admin flags)**
  - Use `useAccountStatus()` for:
    - `isAdmin`, `pauseAccount`, `resumeAccount`

- **For global bootstrap side effects**
  - Call `useAppBootstrap()` once near the root (already wired in `AppContent`).

