## 1. Executive summary

Vibely’s current production baseline is a hardened web app running against a single Supabase-backed backend with Edge Functions and Stripe-based billing. The `origin/main` branch already includes server-owned state for video dates and Ready Gate, backend-owned Daily Drop transitions, and server-owned chat/swipe notification flows, with a controlled migration history and a documented rebuild pack in `_cursor_context`. A separate, not-yet-merged docs/runbook pair (`docs/golden-path-regression-runbook.md`, `scripts/run_golden_path_smoke.sh`) adds a golden-path regression harness on top of that baseline.

The goal of the native-build stream is to add iOS and Android clients that sit on top of **the same backend system of record**, reuse the hardened business logic, and preserve web rebuildability. This document focuses on architecture and planning only: it defines target parity, backend contracts, client responsibilities, and a recommended native stack so that when implementation starts, it is constrained by shared contracts rather than ad-hoc duplication.

---

## 2. Verified baseline on `main`

**What is present on `origin/main`:**

- **Hardened backend state and flows**
  - Video dates: server-owned state machine and RPC via migrations such as `video_date_state_machine.sql`; web code calls into backend rather than mutating `video_sessions` directly.
  - Ready Gate: server-atomic transitions via `ready_gate_transition.sql` and corresponding web flows (Ready Gate overlay / page) that read from DB and call the RPC.
  - Daily Drop: backend-owned transitions and notifications via:
    - SQL migration `daily_drop_transition.sql`.
    - Edge Function `supabase/functions/daily-drop-actions/index.ts` using `daily_drop_transition` RPC and `send-notification` for opener/reply events.
  - Chat send + notifications:
    - Edge Function `supabase/functions/send-message/index.ts`:
      - Validates match participation against `matches`.
      - Writes `messages` rows server-side.
      - Enforces short-window idempotency.
      - Invokes `send-notification` with deep link `/chat/:match_id`.
  - Swipe / match notifications:
    - Edge Function `supabase/functions/swipe-actions/index.ts`:
      - Calls `handle_swipe` RPC.
      - Sends match / ready-gate / “someone vibed you” notifications via `send-notification`.
  - Edge Functions inventory is committed (`supabase/functions/*`), with central config in `supabase/config.toml` as described by `_cursor_context/vibely_edge_function_manifest.md`.
  - Supabase migrations capture:
    - `profiles` pause columns and `get_event_deck_exclude_paused.sql` (backend-owned pause behavior).
    - `video_date_state_machine.sql`, `ready_gate_transition.sql`, `daily_drop_transition.sql`, `get_event_deck_auth_guard.sql`.
    - A reconciled migration history (including `chat_videos_anon_read` and two legacy placeholder migrations) per `_cursor_context/vibely_migration_manifest.md` and `_cursor_context/vibely_rebuild_runbook.md`.

- **Rebuild and hardening docs**
  - `_cursor_context/vibely_rebuild_runbook.md` — canonical rebuild procedure for the frozen web baseline, including:
    - Required env vars (frontend and Edge Functions).
    - `supabase db push --linked` rules and migration parity requirements.
    - Edge Function secrets and deployment strategy.
    - Golden-path smoke guidance at a high level.
  - `_cursor_context/vibely_cursor_hardening_campaign.md` — hardening campaign rules:
    - No schema/function/env drift without manifest updates.
    - Parity-first rule for migrations via `scripts/check_migration_parity.sh`.
    - Native-build interaction rules: native must not destroy web rebuildability.
  - Other `_cursor_context` artifacts (schema appendix, migration manifest, inventory JSON, provider sheets) that define the current backend/system-of-record as source of truth.

- **Backend regression harness pieces**
  - `scripts/check_migration_parity.sh` and `scripts/rebuild_rehearsal_checklist.sh` on `origin/main` for DB/migration parity and rebuild rehearsals.
  - Edge Functions `send-message`, `swipe-actions`, and `daily-drop-actions` are all present and wired to central notification machinery (`send-notification`), matching the web hardening goals for:
    - server-owned send-message side effects
    - server-owned swipe/match notification flows
    - server-owned Daily Drop opener/reply flows

**What exists locally but is not yet on `origin/main`:**

- `docs/golden-path-regression-runbook.md` — stepwise golden-path regression checklist, including:
  - Auth/onboarding gating.
  - Pause/resume.
  - Ready Gate transitions.
  - Video-date lifecycle.
  - Daily Drop, chat send, swipe/match flows, premium/credits, admin.
- `scripts/run_golden_path_smoke.sh` — static smoke harness:
  - Runs `npm run typecheck:core` and `npm run build`.
  - Points operators to the golden-path runbook for manual/browser flows.

These two files are currently **untracked** on the working branch and therefore not yet proven to be merged into `origin/main`, even though they were authored against this baseline.

**Gaps / uncertainties (“still not proven on main”):**

- Automated E2E coverage: there is no Cypress/Playwright suite checked in; golden-path regression remains a manual/scripted process.
- Notification provider exact configuration:
  - The code assumes OneSignal for web push and `send-notification` Edge Function, but specific app IDs, segmentation rules, and production policies live in the OneSignal dashboard and are only partially captured in provider sheets.
- Video provider details:
  - Daily domain (`vibelyapp.daily.co`) is documented in the rebuild runbook and provider sheets, but native SDK usage and mobile-specific constraints are not yet documented.
- Reproducibility is tightly coupled to the existing Supabase project (`schdyxcunwcvddlcshwd`), Stripe webhooks, Bunny, Twilio, Resend, etc.; these are controlled by the rebuild pack but not by code alone.

**Assumptions used in this document:**

- The **single source of truth** for user, event, match, chat, Daily Drop, and video-date state is the production Supabase project as reflected by the migrations in `origin/main`.
- The hardening streams for backend-owned pause/resume, Ready Gate, video-date lifecycle, Daily Drop, and notification flows are all landed on `origin/main`.
- The golden-path regression docs/runbook pair will be merged in a near-term branch and treated as part of the operational baseline, but until that happens they are **advisory**, not canonical.

---

## 3. Target product parity (web / iOS / Android)

For each domain, the target is that all three clients operate on the **same backend state and semantics**, with differences only in presentation and platform affordances.

- **Auth / session**
  - Source of truth:
    - Supabase auth and RLS policies as currently configured.
  - Parity requirements:
    - All clients authenticate against Supabase using the same project, JWTs, and role model.
    - Sessions must be refreshable and revocable server-side; mobile must not cache long-lived tokens beyond Supabase’s own semantics.
    - Admin / elevated roles must be honored identically on all platforms (e.g. verify-admin flows).

- **Onboarding / profile**
  - Source of truth:
    - `profiles` table and associated media buckets (`proof-selfies`, Bunny media), as per schema appendix.
  - Parity requirements:
    - Required onboarding steps (basic info, photos, verification as needed) must be enforced by backend policies and/or profile completeness flags.
    - Native clients must respect the same “onboarding completed” gates and must not bypass prerequisites to reach dashboard, events, or matchmaking.
    - Profile edits (bio, prompts, photos, verification states) must go through the same backend APIs / RPCs / storage flows used by web (e.g. upload to Bunny, metadata in Supabase).

- **Events + attendee discovery**
  - Source of truth:
    - `events`, `event_attendees`, and deck-related SQL functions (`get_event_deck_*`) and auth guards.
  - Parity requirements:
    - Web, iOS, and Android must use the same deck/query endpoints, including:
      - Excluding paused or ineligible users (pause columns and `get_event_deck_exclude_paused`).
      - Respecting Ready Gate / lobby state.
    - Any event filtering/sorting options exposed on web must either be present on mobile or be explicitly documented as mobile-only deviations.

- **Swipes / likes / matches**
  - Source of truth:
    - `matches` table, `handle_swipe` RPC, and `swipe-actions` Edge Function.
  - Parity requirements:
    - All swipe actions (vibe, super vibe, match) must:
      - Call `swipe-actions` (or an equivalent backend endpoint) rather than writing to `matches` or swipe logs directly.
      - Receive the same result taxonomy (`match`, `match_queued`, `super_vibe_sent`, `vibe_recorded`, `already_matched`, etc.).
    - Match creation, “It’s a match” signaling, and any Ready Gate queueing must behave identically across clients.

- **Daily Drop**
  - Source of truth:
    - `daily_drops` and associated RPCs (`daily_drop_transition`), plus `daily-drop-actions` Edge Function.
  - Parity requirements:
    - Viewing, opening, replying, and passing drops must all go through backend transitions; native cannot locally adjust drop status or infer matches.
    - Notification semantics (opener sent, reply received, match unlocked) must match the web semantics defined in `daily-drop-actions`.

- **Chat / messaging**
  - Source of truth:
    - `messages` table, `send-message` Edge Function, and Supabase realtime channels.
  - Parity requirements:
    - All text/audio/video messages must be created server-side via `send-message` (or a mobile-safe equivalent wrapper of the same logic).
    - Idempotency and duplicate suppression rules must match (e.g. 5-second duplicate prevention).
    - Read receipts, typing indicators, and presence are optional enhancements but, if used, must not contradict message ordering or delivery semantics.

- **Ready Gate**
  - Source of truth:
    - `ready_gate` / `video_sessions` related tables and `ready_gate_transition` RPC.
  - Parity requirements:
    - Ready Gate transitions must only happen via backend RPC:
      - “I’m ready”, snooze, forfeit, etc.
    - Native must use the same state machine and not introduce additional client-side states that disagree with the DB.

- **Live video dates / calling**
  - Source of truth:
    - `video_sessions` rows, video-date state machine, and Daily room configuration (via Edge Function `daily-room`).
  - Parity requirements:
    - Web, iOS, and Android all join the same Daily rooms with consistent roles and tokens.
    - All state transitions (handshake, active, ended) are driven by backend transitions; clients only observe and signal intents.
    - End-of-call behaviors (timeout, disconnect, manual end) must converge to the same terminal states.

- **Notifications**
  - Source of truth:
    - Notification intent comes from the backend:
      - `send-notification` Edge Function and provider integrations (OneSignal, potentially FCM/APNs or RevenueCat webhooks later).
  - Parity requirements:
    - All user-visible pushes related to swipes, matches, chat, Daily Drop, Ready Gate, events, and billing must be triggered from backend logic, not client-local heuristics.
    - Mobile push tokens must be stored in the same user/profile table(s) as web push endpoints, or in a well-defined sibling table, and must be respected by `send-notification`.

- **Billing / entitlements**
  - Source of truth:
    - Supabase tables capturing subscriptions/credits, updated by Stripe webhooks (web) and RevenueCat webhooks (native).
  - Parity requirements:
    - A given user’s effective entitlements (premium flags, credits, feature gates) must be computed on the backend and surfaced through a single contract consumed by all clients.
    - Web Stripe-originated entitlements and native RevenueCat-originated entitlements must reconcile to the same entitlement schema.

### 3.1 Cross-platform contract matrix

| Domain | Backend source of truth | Current web usage | Native client responsibility | Compatibility requirement | Backend work before native parity? |
|--------|-------------------------|-------------------|------------------------------|---------------------------|-------------------------------------|
| **auth/session** | Supabase Auth, RLS | Supabase JS client, session in memory/storage | Same Supabase project; persist session (e.g. SecureStore); same JWT/refresh | Same project, same roles; no client-only auth forks | No |
| **onboarding/profile** | `profiles`, profile completeness, storage | Onboarding wizard; profile APIs; Bunny/Supabase uploads | Same onboarding gates; same upload endpoints; no skip paths | Same completeness rules; same media buckets | No |
| **events/attendance** | `events`, `event_attendees`, deck RPCs, `get_event_deck_*` | Events list/detail/lobby; deck fetch; pause-aware | Same RPCs and filters; same pause/exclusion semantics | Deck and lobby behavior identical | No |
| **swipes/matches** | `matches`, `handle_swipe` RPC, `swipe-actions` Edge Function | Calls `swipe-actions`; no direct match writes | Call `swipe-actions` only; same result taxonomy | Same notifications and match creation | No |
| **Daily Drop** | `daily_drops`, `daily_drop_transition` RPC, `daily-drop-actions` Edge Function | `daily-drop-actions` for opener/reply; RPC for view/pass | Same; no direct `daily_drops` writes | Same notification and match semantics | No |
| **chat/messages** | `messages` table, `send-message` Edge Function | `send-message` for all sends; realtime on `messages` | Same; realtime subscribe same table | Idempotency and deep links identical | No |
| **Ready Gate** | `video_sessions`, `ready_gate_transition` RPC | RPC only; no direct column writes | RPC only; same state machine | Same transition semantics | No |
| **video-date lifecycle** | `video_sessions`, video-date state machine, `daily-room` Edge Function | `video_date_transition` RPC; `daily-room` for token | Same RPC and token flow; Daily SDK join | Same state machine and end-of-call behavior | No |
| **notifications** | `send-notification` Edge Function, `notification_preferences`, OneSignal | OneSignal Web SDK; player ID in `notification_preferences` | OneSignal native SDK; register player ID (or equivalent) with backend; same categories | Single entrypoint; same prefs/quiet hours/mutes | Yes: store mobile player IDs and include in send path |
| **entitlements** | Entitlements tables, Stripe + RevenueCat webhooks | Stripe checkout + webhook; read from backend | RevenueCat SDK + webhook; read same backend contract | Single entitlement resolver for all clients | Yes: RevenueCat webhook + resolver |

---

## 4. Architecture principles

- **One shared backend / system of record**
  - Supabase (Postgres, RLS, Edge Functions) remains the **only** authoritative system for:
    - Users, profiles, events, matches, messages, Daily Drops, video sessions, notifications, and entitlements.
  - Mobile clients may cache state locally but must treat cache as derived and disposable.

- **Backend-owned business logic**
  - All critical transitions (auth/session changes, onboarding gates, pause/resume, deck membership, swipes, match creation, Daily Drop transitions, chat send, Ready Gate, video-date, billing/entitlement changes) must be implemented in:
    - SQL (functions/RPCs), or
    - Edge Functions, or
    - Server-side webhook handlers.
  - Clients act as **orchestrators of intent**, not implementers of rules.

- **Client-thin state transitions**
  - Mobile and web should:
    - Submit transition intents (e.g. `ready_gate_transition`, `daily_drop_transition`, `handle_swipe`, `send-message`).
    - Subscribe to realtime feeds / polling to observe resulting state.
  - UI-level wizards and validations are allowed, but they may not fork business logic from the backend.

- **Backward compatibility for web**
  - Any new backend capabilities introduced for native (e.g. new fields, new RPC arguments, new notification categories) must:
    - Be additive and backward compatible with the existing web client, or
    - Include coordinated web updates in the same branch.
  - No breaking DB schema or RPC signature changes are allowed without:
    - A compatibility layer (e.g. versioned endpoints), and
    - An explicit migration plan for web.

- **Shared realtime/event semantics**
  - Supabase realtime (Postgres changes, presence, and/or custom channels) should drive:
    - Chat message updates.
    - Match/Ready Gate/Daily Drop state.
    - Video-date session state.
  - Event payloads and channel naming should be **client-agnostic**, so web/iOS/Android can all subscribe with the same semantics.

- **Safe rollout / rollback expectations**
  - Native rollout must preserve:
    - Web-only deployability (web can still be rolled forward/back independently as long as DB and Edge Function contracts are honored).
    - The rebuild pack’s ability to reconstruct the historical baseline.
  - Any schema or critical function change that is needed to support native must:
    - Be captured in migrations and manifests.
    - Include an explicit rollback strategy (e.g. feature flags, shadow fields, fallback behavior).

---

## 5. Recommended native stack

**Recommendation:** Expo + React Native (TypeScript), with a shared TypeScript domain model and a thin data layer over Supabase and Edge Functions.

- **App framework**
  - Expo-managed React Native app (TypeScript), using:
    - Expo Router (file-based) or React Navigation (stack/tab) for navigation.
    - Expo’s config and build tooling (EAS Build) for consistent, reproducible builds.
  - Rationale:
    - Aligns with existing React + TypeScript web code and domain models.
    - First-class support for OTA updates, push notifications, and native modules (Daily, RevenueCat).

- **Navigation / routing**
  - Use **React Navigation** (stack + tab navigator), with route naming aligned conceptually to web routes:
    - `Dashboard`, `Events`, `EventLobby`, `Matches`, `Chat`, `Profile`, `Settings`, `ReadyGate`, `VideoDate`, `Premium`, `Credits`, etc.
  - Where deep links exist on web (e.g. `/chat/:matchId`, `/ready/:id`, `/date/:id`), define corresponding deep link patterns in mobile navigation.

- **State / data layer**
  - Use **TanStack Query (React Query)** for server state:
    - Queries for profiles, events, decks, matches, messages, Daily Drops, entitlements.
    - Mutations that call Supabase RPCs or Edge Functions.
  - Use a light global client state store (e.g. **Zustand** or React Context) for:
    - Auth/session tokens.
    - UI-only state (modals, in-progress flows).
  - Favor:
    - Declarative hooks (`useQuery`, `useMutation`) mapping directly to backend contracts.
    - Centralized TypeScript types for each domain (reused from or aligned with web `src/integrations/supabase/types.ts`).

- **Auth integration**
  - Use **Supabase JS client for React Native** (or the official Supabase React Native SDK) configured against the existing project:
    - Support email/password or magic link flows consistent with web.
    - Persist JWT/session securely using Expo SecureStore or equivalent.
  - Keep session refresh logic centralized (shared hooks) and reused across screens.

- **Realtime / messaging integration**
  - Use Supabase realtime channels:
    - `messages` channel per `match_id`.
    - Optional presence channels for lobby/Ready Gate sessions.
  - All message sends go through:
    - `send-message` Edge Function (HTTP).
    - Subscriptions listen to `messages` table changes for live updates.
  - Ensure the same idempotency boundaries as web (e.g. disable send button until mutation resolves or de-duplicate by client-generated IDs).

- **Video call integration**
  - Use **Daily’s React Native SDK**:
    - Clients request a room and token via `daily-room` Edge Function (same as web).
    - Join/leave logic and event handlers are implemented in a shared abstraction so that state transitions map 1:1 to the server-owned video-date state machine.
  - Avoid embedding any room-state business logic in the client beyond interpreting the server state machine.

- **Push notifications**
  - See **§5.1 Push architecture (cross-platform)** below.

- **Analytics / error tracking**
  - **Sentry** for error monitoring, mirroring web Sentry usage:
    - Capture JS errors, source maps, and breadcrumbs.
  - **PostHog** for product analytics:
    - Track the same key events (auth, onboarding complete, event registrations, matches, chat sends, Daily Drop actions, video-date events).
  - Ensure event naming and properties match web as closely as possible to preserve longitudinal analytics.

- **CI/CD / build/release path**
  - Use **Expo Application Services (EAS)** or a mobile-focused CI pipeline:
    - CI runs:
      - Lint + typecheck.
      - Unit tests.
      - Optional Detox or similar E2E tests for critical flows.
    - Build profiles for staging/production per platform.
  - Integrate with existing web CI as a separate workflow but ensure:
    - Any migration or backend change used by mobile is validated via the golden-path smoke script and runbook before promotion.

- **Secrets / env handling**
  - Use:
    - Expo’s encrypted config for runtime env where possible.
    - Platform-specific secret stores (SecureStore, Keychain, Keystore) for tokens.
  - Do **not** embed production Supabase keys, Daily keys, or RevenueCat keys in public artifacts; treat them as secrets aligned with the rebuild pack’s env manifests.

### 5.1 Push architecture (cross-platform)

**Recommendation:** Use **OneSignal as the default cross-platform notification provider** for web, iOS, and Android. The repo already uses OneSignal for web push (`src/lib/onesignal.ts`, `notification_preferences.onesignal_player_id`, `send-notification` Edge Function calling OneSignal REST API). OneSignal supports iOS and Android via native SDKs and the same app can target multiple platforms; there is no in-repo evidence that a different provider is required for mobile.

**Principles:**

- **Backend-owned notification orchestration:** All user-facing push notifications (messages, matches, Daily Drop, Ready Gate, events, etc.) are triggered only from backend logic. Clients never call a “send notification” API for these flows; they trigger state transitions (e.g. `send-message`, `swipe-actions`, `daily-drop-actions`), and the backend invokes `send-notification` (or equivalent shared orchestration) as the single entrypoint.
- **Single entrypoint:** The `send-notification` Edge Function (or a single shared backend path that wraps it) remains the **only** place that decides when and what to send. It already respects preferences, quiet hours, match mutes, and account pause; any mobile-specific routing (e.g. by platform) is done inside this function, not in mobile-only forks.

**Device / player registration:**

- **Web:** The web app uses OneSignal Web SDK; on permission grant it obtains a subscription/player ID and writes it to `notification_preferences` (`onesignal_player_id`, `onesignal_subscribed`). `send-notification` uses `include_player_ids: [prefs.onesignal_player_id]` and OneSignal delivers to the browser.
- **iOS / Android:** The native app uses the OneSignal iOS/Android SDK. On init and login, the app registers the device with OneSignal and associates the external user ID (Supabase user id). OneSignal assigns a player/subscription ID per device. The native client must write this identifier to the backend (e.g. same `notification_preferences` table with a platform column, or a dedicated `device_push_tokens` table keyed by user + platform) so that `send-notification` can include these player IDs when sending. OneSignal’s API supports multiple `include_player_ids` (or equivalent) so one user can receive on both web and mobile from a single send, or the backend can send once per platform if required by OneSignal’s model.

**Compatibility:** Existing web behavior must be preserved: `notification_preferences.onesignal_player_id` continues to drive web push. Native adds either additional columns (e.g. `onesignal_player_id_ios`, `onesignal_player_id_android`) or a separate table that `send-notification` joins so it can include all relevant player IDs for the target user. No mobile-only backend logic forks: the same `send-notification` function and category/preference rules apply to all platforms.

---

## 5.2 Web route → native screen mapping

Mapping from current web routes (from `src/App.tsx`) to target native screen architecture. Route names and path params are as implemented; native screen names are the intended conceptual targets.

| Web route / flow | Native screen / flow | Notes |
|------------------|----------------------|--------|
| `/`, `/auth` | Auth entry (splash → login/signup) | Unauthenticated entry; deep links may land here or redirect to auth. |
| `/reset-password` | Reset password screen | Same flow as web. |
| `/onboarding` | Onboarding flow (multi-step) | Protected; same steps as web (profile, photos, etc.). |
| `/dashboard`, `/home` | Dashboard / Home (main tab) | Primary tab after onboarding. |
| `/events` | Events list (tab or stack) | Events list. |
| `/events/:id` | Event detail | Event details, register, “Who’s going”. |
| `/event/:eventId/lobby` | Event lobby | Deck, swipe, Ready Gate entry. |
| `/matches` | Matches list (tab) | Matches + Daily Drop tab (assumption: same as web). |
| `/chat/:id` | Chat thread | `:id` = match_id; deep link from push. |
| `/profile` | Profile (tab or stack) | Own profile view/edit. |
| `/settings` | Settings | Drawers: notifications, privacy, account (assumption: same structure as web). |
| `/date/:id` | Video date room | `:id` = video session id; state from backend. |
| `/ready/:id` | Ready Gate | `:id` = session id; transitions via RPC only. |
| `/schedule` | Schedule | Upcoming dates / schedule. |
| `/user/:userId` | User profile (other user) | Public profile view. |
| `/premium`, `/subscription/success`, `/subscription/cancel` | Premium / subscription screens | Stripe on web; native uses RevenueCat, same entitlement outcome. |
| `/credits`, `/credits/success` | Credits purchase / success | Web: Stripe; native: RevenueCat. |
| `/event-payment/success` | Event payment success | Post-event payment. |
| `/vibe-studio` | Vibe studio | Assumption: redirect or equivalent to profile/studio flow as on web. |
| `/match-celebration` | Match celebration modal/screen | Shown after match. |
| `/how-it-works`, `/privacy`, `/terms`, `/delete-account`, `/community-guidelines` | Legal / info screens | Same content, native presentation. |
| `/kaan`, `/kaan/dashboard` | Admin login, Admin dashboard | Admin-only; same gating as web. |
| `/admin/create-event` | Admin create event | Admin-only. |

**Assumptions:** Matches and Daily Drop live on the same “Matches” surface (tabs or sections) as on web. Chat `:id` is match_id everywhere. Ready Gate and Video Date use session IDs from the backend. Any route not listed (e.g. future admin sub-routes) should be added to this table when introduced.

---

## 6. Payments and entitlements architecture

**Non-negotiables:**
- iOS and Android **must** use RevenueCat for in-app payments.
- Web continues to use Stripe.
- Backend exposes a **single entitlement model** consumed by all clients.

- **Product / entitlement model**
  - Define a canonical entitlement schema in Supabase:
    - `entitlements` or `user_entitlements` table capturing:
      - `user_id`
      - entitlement type (`premium`, `credits`, feature flags)
      - source (`stripe`, `revenuecat`)
      - status (active, expired, canceled, trial)
      - quantity (for credits)
      - metadata (e.g. product IDs, platform).
  - Keep existing Stripe-based flow:
    - `create-checkout-session`, `create-credits-checkout`, `create-event-checkout` Edge Functions.
    - Stripe webhook updates entitlements/credits.

- **RevenueCat integration (mobile)**
  - iOS/Android apps:
    - Use RevenueCat SDK with platform-specific product identifiers mapped to:
      - The same logical entitlements as web (premium, credits).
  - Backend:
    - Implement a RevenueCat webhook handler (new Edge Function) that:
      - Verifies RevenueCat signature.
      - Maps RevenueCat events to the canonical entitlement schema.
      - Ensures idempotency (no double-granting on retries).
  - Mobile clients read entitlements by:
    - Calling a backend endpoint (`get_entitlements` RPC or function) that merges Stripe and RevenueCat sources.

- **Webhook / backend sync concept**
  - Stripe webhooks and RevenueCat webhooks must:
    - Converge on the same **entitlement update path** (e.g. a shared stored procedure or Edge Function).
  - Entitlements are never computed purely client-side:
    - Clients may poll or subscribe to entitlement changes.
    - Any discrepancy is resolved by requesting authoritative state from backend.

- **Web and native entitlement coexistence**
  - For a single user, entitlements may be sourced from:
    - Stripe-only (web purchase).
    - RevenueCat-only (mobile purchase).
    - Both (mixed purchase history).
  - The entitlement resolver must:
    - De-duplicate overlapping entitlements (e.g. highest tier wins).
    - Additive credits from any platform.

- **Risks and compatibility notes**
  - Double-billing / double-entitlement risk if product mappings diverge between Stripe and RevenueCat; mitigate with:
    - A clear mapping table checked into the repo (documented in `_cursor_context` and docs).
  - Downgrade behavior and refunds must be reflected in both systems where relevant.
  - Native entitlements must honor the same premium gates as web (e.g. who-likes-you, event discounts).

---

## 7. Shared backend contract (by domain)

For each domain, we define source of truth, key entities, and responsibilities.

- **Users / profiles**
  - Source of truth: `profiles`, Supabase auth users, and related tables.
  - Key entities:
    - `profiles`, `profile_photos`, verification fields, preference fields.
  - Client responsibilities:
    - Display and edit profile via approved APIs.
    - Upload media via backend-approved upload endpoints (Bunny, chat-videos, proof-selfies).
  - Backend responsibilities:
    - Enforce uniqueness, eligibility, and visibility.
    - Control who can see what (RLS, joins).

- **Events / attendance**
  - Source of truth: `events`, `event_attendees`, `event_decks` and view/RPC layers.
  - Key entities:
    - Event metadata, capacity, timing, deck configuration.
  - Client responsibilities:
    - Register/unregister via backend endpoints.
    - Request decks with filters that map to existing RPCs.
  - Backend responsibilities:
    - Enforce capacity and eligibility.
    - Exclude paused/blocked users.

- **Swipes / matches**
  - Source of truth: `matches`, swipe logs, `handle_swipe` RPC.
  - Key entities:
    - Match rows (participants, created_at, status), swipe history.
  - Client responsibilities:
    - Call `swipe-actions` with event and target IDs.
    - Display match results and UI transitions.
  - Backend responsibilities:
    - Decide outcome of swipes.
    - Trigger notifications and Ready Gate state as needed.

- **Chat / messages**
  - Source of truth: `messages` table and `send-message` Edge Function.
  - Key entities:
    - Messages (content, audio/video URLs, sender, timestamps).
  - Client responsibilities:
    - Use `send-message` for all sends.
    - Subscribe to realtime changes / query history.
  - Backend responsibilities:
    - Validate participants.
    - Persist messages and send notifications.
    - Enforce rate limiting / idempotency.

- **Daily Drop**
  - Source of truth: `daily_drops`, related status fields and RPC.
  - Key entities:
    - Drop pairing, opener, reply, status, match linkage.
  - Client responsibilities:
    - Trigger actions via `daily-drop-actions` only.
    - Render UI based on drop status and match info.
  - Backend responsibilities:
    - Ensure transitions are valid and idempotent.
    - Trigger notifications and match creation.

- **Ready Gate**
  - Source of truth: `ready_gate`/`video_sessions` with `ready_gate_transition`.
  - Key entities:
    - Session participants, ready statuses, timeouts.
  - Client responsibilities:
    - Trigger ready/snooze/forfeit via RPC.
    - Subscribe to state to update UI.
  - Backend responsibilities:
    - Manage concurrency and race conditions.
    - Link Ready Gate outcomes to video-date sessions.

- **Video-date sessions**
  - Source of truth: `video_sessions`, video-date state machine, Daily config.
  - Key entities:
    - Session ID, participants, state, ended_at, recording metadata.
  - Client responsibilities:
    - Request join tokens via `daily-room`.
    - Signal start/stop/end via RPC or Edge Function where defined.
  - Backend responsibilities:
    - Enforce state machine constraints.
    - Map Daily webhooks (if used) to DB state.

- **Notifications**
  - Source of truth: Notification intent functions, not clients.
  - Key entities:
    - Notification events / categories, user device tokens, OneSignal IDs, etc.
  - Client responsibilities:
    - Register tokens/IDs.
    - Handle foreground/background push delivery.
  - Backend responsibilities:
    - Decide when and what to send.
    - Ensure idempotency and correct targeting.

- **Subscriptions / entitlements**
  - Source of truth: Entitlements tables, Stripe + RevenueCat webhooks.
  - Key entities:
    - Subscription state, credits, feature flags, source metadata.
  - Client responsibilities:
    - Initiate purchases through platform-appropriate flows (Stripe / RevenueCat).
    - Consume entitlements returned by backend to enable/disable UI.
  - Backend responsibilities:
    - Reconcile entitlements across providers.
    - Enforce access to premium features in all domains.

---

## 8. Realtime and cross-platform interoperability

- **Mixed-platform chat**
  - Web and mobile subscribe to the same `messages` table events for a given `match_id`.
  - `send-message` remains the single write path; message ordering is determined by server timestamps, not client clocks.
  - Idempotency rules guarantee that retries from any platform do not create duplicates.

- **Mixed-platform video dates**
  - Any participant (web or mobile) signals transitions via the same RPCs.
  - Daily rooms are shared; join tokens carry user identity but not divergent state machines.
  - Presence in a room (active connection) is observable but does not override backend session state.

- **Notifications / state updates from any client**
  - Actions from any platform (swipe, message, Daily Drop action, Ready Gate action) result in:
    - DB changes visible to all clients via realtime or polling.
    - Notifications dispatched from backend, targeting all registered endpoints for the recipient (web + mobile).

- **Ordering and idempotency**
  - All write paths must be:
    - Idempotent for retry-safe behavior (e.g. Daily Drop transitions, send-message, swipe-actions).
    - Designed so that repeated actions from different devices do not conflict (e.g. duplicate “ready” clicks).
  - Mobile implementations should:
    - Use optimistic UI only when safe and immediately reconcile with server state.

- **Presence / read-state consistency**
  - Optional layer:
    - Read receipts and presence may be added via dedicated tables/channels.
  - Constraint:
    - These enhancements must never override the underlying message or session ordering or produce contradictory states across clients.

---

## 9. Web-compatibility rules and native change policy

Shared backend and infrastructure changes must preserve web functionality or include matching web updates in the same tranche. The following rules are mandatory.

- **No mobile-only backend logic forks for core domains**
  - Core domains (auth, profiles, events, swipes/matches, Daily Drop, chat, Ready Gate, video-date, notifications, entitlements) must be implemented in a single backend path consumed by all clients.
  - No separate “mobile-only” RPCs or Edge Functions that duplicate or diverge from web logic for these domains. Additive, optional parameters (e.g. platform hint) are allowed where they do not change behavior for web.

- **Any native-motivated migration must include web impact review**
  - Before merging a migration that is introduced for native (e.g. new columns for mobile push tokens, entitlement schema for RevenueCat):
    - Document in the PR or in `_cursor_context`/docs how the change affects the web client (e.g. “additive only”, “web ignores new column”, “web must be updated to X”).
    - If web must change, include the web change in the same branch.
  - Run the golden-path regression runbook (or at least the affected sections) against the web client after the change.

- **Any parity-affecting backend change requires web regression validation**
  - Changes that affect behavior shared by web and native (e.g. Ready Gate rules, Daily Drop transitions, send-message idempotency, entitlement resolution) must:
    - Be validated by running the web golden-path regression (manual or scripted) before the change is considered done.
    - Update `docs/golden-path-regression-runbook.md` if new steps or expectations are introduced.

- **Additive / versioned backend evolution is the default rule**
  - Prefer additive changes: new columns, new tables, new optional RPC parameters, new notification categories that web can ignore.
  - If a breaking change is unavoidable:
    - Introduce versioned endpoints or RPCs (e.g. `send-message-v2`) and migrate web in the same branch to use them, or
    - Provide a compatibility layer so existing web behavior is preserved until web is updated.
  - No breaking DB schema or RPC signature changes without an explicit compatibility plan and, where applicable, web updates in the same tranche.

- **Document web impact for all shared infra changes**
  - Any change to table structure used by web, RPC parameters/return types, or Edge Function behavior used by web must include a short “web impact” note in the PR and in relevant docs (`_cursor_context` or `/docs`).

- **Migration strategy expectations**
  - Use `scripts/check_migration_parity.sh` and migration manifests. Any native-motivated migration is a first-class part of the shared system; no “mobile-only” tables that bypass central manifests. Maintain a clear path for down-migrations (where safe) or forward-compatible behavior that does not break historical web clients.

---

## 10. Proposed repo structure for native

**Recommendation:** Add a new `apps/mobile` directory, aligned with the existing web app and shared packages.

- **Structure proposal**
  - `apps/web` (optional future move; currently root React app in `src/`).
  - `apps/mobile`
    - Expo + React Native app (TypeScript).
    - Own `app.json`/`app.config.ts`, `package.json`.
  - `packages/shared-types` (optional now, recommended soon after):
    - Shared TypeScript types for domains (`User`, `Profile`, `Event`, `Match`, `Message`, `DailyDrop`, `VideoSession`, `Entitlement`).
  - `packages/shared-client` (later phase):
    - Shared supabase client config, API wrappers, and domain-specific hooks.
  - `docs/native/*`
    - Native-specific architecture, runbooks, and rebuild notes.

- **Why `apps/mobile` in this repo**
  - Keeps mobile development close to the web and backend contracts.
  - Makes shared TypeScript domain models and utilities straightforward.
  - Ensures that any backend-affecting change is visible to both app surfaces.

---

## 11. Sprint plan

**Sprint 0 — Architecture, contracts, risk list (this document)**
- **Objective:** Lock in shared contracts and stack decisions before writing mobile code.
- **Scope:**
  - Finalize this plan.
  - Confirm backend contracts and schemas from `_cursor_context` docs.
  - Align on entitlements model (Stripe + RevenueCat).
  - Define initial `apps/mobile` layout and shared packages plan (no scaffolding yet).
- **Dependencies:** Current rebuild pack, origin/main, stakeholder sign-off.
- **Acceptance criteria:**
  - This doc committed and reviewed.
  - Clear written decisions on stack, contracts, and entitlements.
  - At least one golden-path regression run performed against web baseline.
- **Web/backend coordination notes:**
  - None beyond verification; this sprint is documentation-only.

**Sprint 1 — App shell, auth, navigation, env/bootstrap**
- **Objective:** Stand up a non-functional mobile shell that can authenticate against the existing backend.
- **Scope:**
  - Scaffold `apps/mobile` (Expo + React Native + TypeScript).
  - Implement Supabase auth integration and basic session management.
  - Wire navigation for main tabs (Dashboard, Events, Matches, Profile, Settings).
  - Set up env handling, Sentry, PostHog, and basic logging.
- **Dependencies:** Finalized stack choice, Supabase project, existing auth flow.
- **Acceptance criteria:**
  - Mobile app can sign in/out using same accounts as web.
  - Session persists and recovers across app restarts.
  - Navigation between core tabs is stable.
- **Web/backend coordination notes:**
  - No schema changes; ensure any new mobile-specific env vars are documented.

**Sprint 2 — Profile / events / discovery parity**
- **Objective:** Achieve parity for onboarding, profile, and event discovery.
- **Scope:**
  - Implement onboarding flows mapped to web’s required steps.
  - Implement profile view/edit, including photo upload using existing Bunny/Supabase flows.
  - Implement events list, event detail, and registration flows.
  - Ensure deck fetching respects pause, auth guards, and eligibility.
- **Dependencies:** Sprint 1 shell + auth; existing event and profile APIs.
- **Acceptance criteria:**
  - A new user can onboard, create a profile, and register for events from mobile.
  - Behavior matches web constraints and validations.
  - No new schema or logic divergence from web.
- **Web/backend coordination notes:**
  - Any missing backend APIs discovered must be added in a shared-compatible way and documented.

**Sprint 3 — Chat + notifications parity**
- **Objective:** Bring chat messaging and notification behavior to parity.
- **Scope:**
  - Implement chat list and chat detail screens.
  - Integrate `send-message` Edge Function for all message sends.
  - Subscribe to realtime message updates.
  - Integrate push notifications for messages, hooked into existing notification categories.
- **Dependencies:** Sprints 1–2; push infrastructure and `send-notification` behavior.
- **Acceptance criteria:**
  - A match between web and mobile users can chat with consistent message ordering and notifications.
  - Re-sends and retries do not create duplicate messages or notifications.
  - Notification deep links open the correct chat thread on mobile.
- **Web/backend coordination notes:**
  - Any new notification categories or fields used by mobile must be compatible with web or explicitly gated.

**Sprint 4 — Daily Drop + Ready Gate parity**
- **Objective:** Bring Daily Drop and Ready Gate flows to parity across platforms.
- **Scope:**
  - Implement Daily Drop UI and flows (view, send opener, send reply, pass).
  - Integrate `daily-drop-actions` and `daily_drop_transition` RPC.
  - Implement Ready Gate screens and actions using `ready_gate_transition`.
  - Wire notifications for opener/reply and Ready Gate events.
- **Dependencies:** Sprints 1–3; Daily Drop and Ready Gate backend contracts.
- **Acceptance criteria:**
  - Mixed-platform Daily Drop conversations behave identically to web baseline.
  - Ready Gate states and transitions match the golden-path runbook.
  - No client-side-only transitions for these flows.
- **Web/backend coordination notes:**
  - Any refinements to Daily Drop or Ready Gate semantics are shared by web and documented in golden-path runbook.

**Sprint 5 — Video date parity**
- **Objective:** Enable video dates between any combination of web and mobile clients.
- **Scope:**
  - Integrate Daily SDK for React Native with existing `daily-room` Edge Function.
  - Implement video-date screens, including handshake and in-call experience.
  - Mirror web’s state machine for video sessions exactly.
  - Handle end-of-call, reconnection, and failure states gracefully.
- **Dependencies:** Sprints 1–4; stable video-date backend state machine.
- **Acceptance criteria:**
  - A web user and a mobile user can complete a full video date following the golden-path runbook.
  - All transitions are driven by backend, not client-specific hacks.
  - No platform-only video states.
- **Web/backend coordination notes:**
  - Any state machine adjustments for mobile ergonomics must be reflected on web and in the rebuild pack.

**Sprint 6 — RevenueCat entitlements + polish / release hardening**
- **Objective:** Add mobile-native billing with RevenueCat and harden cross-platform release.
- **Scope:**
  - Integrate RevenueCat SDK on iOS/Android with mapped products.
  - Add RevenueCat webhook Edge Function and entitlement reconciliation logic.
  - Update entitlement resolver to combine Stripe + RevenueCat sources.
  - Run full golden-path regression across web and mobile (manual and automated where available).
  - Prepare app store submissions and rollout plan.
- **Dependencies:** Entitlement schema, Stripe flows, Sprints 1–5.
- **Acceptance criteria:**
  - A user can upgrade on web (Stripe) or mobile (RevenueCat) and see consistent entitlements everywhere.
  - Full regression run passes for web; subset passes on mobile with documented gaps.
  - Release checklist and runbooks updated.
- **Web/backend coordination notes:**
  - Any changes to entitlement schema or notification flows must be tested against web golden path and documented in `_cursor_context`.

---

## 12. Risks and open questions

- **Web build/reproducibility**
  - Risk: Native changes may inadvertently alter web build pipeline (e.g. shared packages, bundler config).
  - Mitigation: Keep web build commands (`npm run build`, `scripts/run_golden_path_smoke.sh`) stable and run them in CI for any native-related change.

- **Notification provider assumptions**
  - Risk: Today’s notification flow is primarily web + OneSignal; extending to mobile adds multiple destinations and token types.
  - Questions:
    - Will OneSignal be kept as the aggregator for all platforms, or will mobile use native push providers directly?
  - Mitigation: Decide on a single backend notification abstraction and keep `send-notification` as the only entry point.

- **Video provider assumptions**
  - Risk: Daily’s web-specific setup (domains, room configuration) may need adjustments for native SDK usage (e.g. mobile-specific permissions, reconnection strategies).
  - Mitigation: Validate Daily’s React Native support and configuration early in Sprint 1–2, even before full video-date parity work.

- **Edge Functions / API contract uncertainty**
  - Risk: Some web flows may rely on undocumented or lightly documented behavior in Edge Functions or RPCs.
  - Mitigation: For each domain targeted by a sprint, explicitly map client calls to specific Edge Functions and RPCs and cross-check against `_cursor_context` manifests.

- **Native vs web billing coexistence**
  - Risk: Users with mixed purchases could see inconsistent entitlements if Stripe and RevenueCat are not perfectly reconciled.
  - Mitigation: Design and test entitlement resolver carefully; include mixed-origin scenarios in golden-path tests.

- **Rebuild pack drift risk**
  - Risk: Native-focused changes could introduce new env vars, third-party dependencies, or Edge Functions without corresponding updates to the rebuild pack.
  - Mitigation: Treat `_cursor_context` docs as mandatory update targets for any change affecting backend, infra, or provider configuration.

---

## 13. Recommended immediate next action

Execute the following in order; do not scaffold `apps/mobile` until the first two are done.

1. **Merge the regression harness to `main`.**  
   Add and merge `docs/golden-path-regression-runbook.md` and `scripts/run_golden_path_smoke.sh` to the repository (e.g. via a dedicated PR or branch). They become the canonical golden-path checklist and static smoke for the web baseline.

2. **Rerun web golden-path regression.**  
   On a checkout that includes the harness: run `./scripts/run_golden_path_smoke.sh` (typecheck + build), then perform the manual steps in `docs/golden-path-regression-runbook.md` (auth, pause/resume, Ready Gate, video-date, Daily Drop, chat, swipe, premium, admin). Confirm all sections pass or document any failures. Fix any regressions before proceeding.

3. **Only then scaffold `apps/mobile`.**  
   After the harness is on `main` and the web baseline has passed a full golden-path run, proceed with Sprint 1 (app shell, auth, navigation, env/bootstrap) and create the `apps/mobile` directory. Do not create `apps/mobile` or any native app code before completing steps 1 and 2.

