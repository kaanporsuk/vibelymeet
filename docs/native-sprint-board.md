# Native sprint board (UI-1 through UI-6)

> **Historical implementation backlog.** The active launch-closure backlog is now `docs/native-final-blocker-matrix.md`; use `docs/active-doc-map.md` for the current execution path. This file remains as parity-era planning history only.

Implementation sprint order for native UI parity. Do not start UI parity implementation until Sprint 0 (architecture lock) is merged. Web is the product/design source of truth.

---

## UI-1 — Shared design primitives

**Goal:** Reusable design tokens, typography, and core UI components so all later screens share one system.

**Scope:**
- Design tokens (colors, spacing, radii) aligned with web where applicable.
- Typography scale and font usage.
- Core primitives: buttons, inputs, cards, lists, navigation components.
- Theming (light/dark) if used on web.

**Deliverables:**
- Token/theme module in `apps/mobile`.
- Primitive components used by UI-2+.
- No new routes; no backend changes.

**Done when:** Any new screen can be built from these primitives without redefining base styles.

---

## UI-2 — Dashboard + shell

**Goal:** Main app shell, auth gates, and dashboard (home) screen at parity with web.

**Scope:**
- Tab navigation (Dashboard, Events, Matches, Profile) and stack for modal/stack screens.
- Auth gate: unauthenticated → auth flow; authenticated but not onboarded → onboarding.
- Dashboard (home) content: next event, matches summary, schedule hints, CTAs.
- Env/bootstrap, Sentry, PostHog, logging as needed.

**Backend:** Session (Supabase Auth), profiles (onboarding check), video_sessions/event_registrations for dashboard state. No new RPCs/EFs.

**Done when:** User can sign in/out, complete onboarding (or skip if already done), and land on a stable dashboard tab with correct gating.

---

## UI-3 — Profile + settings

**Goal:** Profile view/edit and settings at parity with web.

**Scope:**
- Profile: view own profile, edit core fields, photo upload (Bunny/Supabase) where in scope.
- Settings: notifications, account (pause/resume), delete account path, premium/credits entry.
- Use same backend contracts: profiles, notification_preferences, account-pause, account-resume, delete-account (or link to web).

**Backend:** profiles, notification_preferences, account-pause, account-resume, delete-account (EF), check_premium_status. No new RPCs/EFs.

**Done when:** User can view/edit profile and change settings; account actions and notification prefs persist correctly.

---

## UI-4 — Matches + chat list

**Goal:** Matches list and chat list/thread at parity with web.

**Scope:**
- Matches list: match cards, archive, mute, block; Daily Drop tab/section; use swipe-actions only.
- Chat list: from matches with last message; navigate to chat thread.
- Chat thread: message history, send text (and audio/video if in scope) via send-message EF; realtime updates.
- Deep links: `/chat/:id` from push.

**Backend:** matches, send-message (EF), messages + realtime, daily_drop_transition + daily-drop-actions (EF). No new RPCs/EFs.

**Done when:** User can see matches, open chat, send/receive messages with correct ordering and no duplicate sends; Daily Drop view/actions work.

---

## UI-5 — Events / discovery / lobby

**Goal:** Events list, event detail, and event lobby (deck, swipe, Ready Gate entry) at parity with web.

**Scope:**
- Events list: get_visible_events / get_other_city_events; location from geocode if needed.
- Event detail: register/unregister, “Who’s going”, event vibes.
- Event lobby: get_event_deck, swipe-actions, update_participant_status, drain_match_queue; Ready Gate entry when both ready.

**Backend:** get_visible_events, get_other_city_events, get_event_deck, swipe-actions (EF), update_participant_status, drain_match_queue. No new RPCs/EFs.

**Done when:** User can browse events, register, enter lobby, swipe, and reach Ready Gate with same semantics as web.

---

## UI-6 — Premium / roughness sweep

**Goal:** Premium/entitlements UX and final polish; no regressions.

**Scope:**
- Premium: offer wall / paywall using RevenueCat; respect backend entitlement (check_premium_status); restore purchases.
- Credits: respect credits state; purchase or link-out per product decision.
- Roughness sweep: accessibility, loading/error states, deep links (Ready Gate, video date), any remaining parity gaps.
- Golden-path regression: run web runbook; document mobile coverage.

**Backend:** check_premium_status, get_user_subscription_status, RevenueCat webhook already wired. No new RPCs/EFs unless documenting existing.

**Done when:** Premium and credits state consistent across web and native; regression run passed; release checklist updated.

---

## Cross-cutting

- **Video date** and **Ready Gate** screens are required for full parity; implement when shell and events/lobby are in place (Ready Gate after lobby; video date after Ready Gate). They depend on daily-room (EF), video_date_transition, ready_gate_transition. Include in UI-4/UI-5 scope or as part of UI-6 depending on team capacity.
- **Realtime:** Use same Supabase realtime channels as web (e.g. messages, session state).
- **No provider swaps:** RevenueCat, OneSignal, Daily, Bunny, Supabase as-is. See `docs/native-platform-adapter-matrix.md` and `docs/native-decision-log.md`.

---

## References

- Screen-level mapping: `docs/native-screen-contract-map.md`
- Backend contracts: `docs/native-backend-contract-matrix.md`
- Adapters and env: `docs/native-platform-adapter-matrix.md`
- Architecture and baseline: `docs/native-build-architecture-plan.md`
