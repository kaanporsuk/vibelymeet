# Native Sprint 0 — architecture lock (v1)

**Date:** 2026-04-13  
**Branch:** `native/sprint0-architecture-lock`  
**Scope:** Lock native implementation plan on the **current shared Supabase backend** (event-loop observability track is **closed** and **maintenance-only** — do not expand without new evidence).

**Constraints honored:** No `expo-av` (repo uses **`expo-video`** + Daily for live video). Preserve backend-owned behavior across web / iOS / Android.

---

## 1. Locked provider stack

| Provider | Role in native | Primary touchpoints |
|----------|----------------|---------------------|
| **Supabase** | Auth (PKCE + AsyncStorage), Postgres reads/writes, RPCs, Realtime, Edge Function invokes | `apps/mobile/lib/supabase.ts`, domain `lib/*Api.ts` |
| **Daily.co** | Video date + match-call WebRTC rooms | `@daily-co/react-native-daily-js`, Edge `daily-room` (`create_date_room`, `delete_room`) |
| **Bunny** | Vibe video TUS upload + Stream CDN playback hostnames | `create-video-upload` / playback URL helpers, `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME` for photos |
| **OneSignal** | Push registration + notification routing | `react-native-onesignal`, `apps/mobile/lib/onesignal.ts`, prefs mirror web columns |
| **RevenueCat** | IAP + entitlement gate | `react-native-purchases`, `lib/revenuecat.ts`, webhook-synced backend |

**Analytics / monitoring (non-core providers):** PostHog, Sentry — wired in root layout; not part of product contracts.

---

## 2. Backend contract audit — `apps/mobile` vs canonical flows

### 2.1 Ready gate

| Item | Backend source of truth | Native status |
|------|-------------------------|---------------|
| State | `video_sessions` (`ready_gate_status`, ready timestamps, snooze) | `useReadyGate` + realtime (`readyGateApi.ts`) |
| Transitions | RPC **`ready_gate_transition`** (`mark_ready`, `snooze`, `forfeit`) | Implemented |
| Presence | **`updateParticipantStatus`** for `in_ready_gate` (lobby overlay) | `ReadyGateOverlay`, lobby |
| Navigation | `event_registrations.queue_status === 'in_ready_gate'` → `/ready/[id]` | `useActiveSession`, `NotificationDeepLinkHandler` |

**Gaps / parity:** Standalone `/ready/[id].tsx` guards against stale sessions (breadcrumb diagnostics). Web parity for copy/edge cases: treat as **polish**, not contract drift.

### 2.2 Video date transition

| Item | Backend source of truth | Native status |
|------|-------------------------|---------------|
| Session | `video_sessions` rows + Realtime | `useVideoDateSession` (`videoDateApi.ts`) |
| Room + token | Edge **`daily-room`** `create_date_room` | `getDailyRoomToken`; classified errors (`READY_GATE_NOT_READY`, etc.) |
| Phases | RPC **`video_date_transition`** (`enter_handshake`, `end`, …) | Implemented; leave path includes `delete_room` + queue leave when applicable |

**Docs:** `docs/mobile-sprint5.md`, `docs/native-video-date-hardening-deploy.md`.

**Gaps / parity (known):** Post-date survey in-call (web) vs mobile “Date ended” only — **documented gap**. Handshake vibe / credit extend — web has more UI; mobile has phase/timer baseline.

### 2.3 Daily drop transition

| Item | Backend source of truth | Native status |
|------|-------------------------|---------------|
| Rows | `daily_drops` + status enum | `dailyDropApi.ts` |
| Transitions | RPC **`daily_drop_transition`**, Edge **`daily-drop-actions`** for openers/replies | Sprint 4 scope per `README` |

**Gaps:** Tab badge + flows aligned with web; treat copy/UI as polish unless product changes rules.

### 2.4 Swipe / match path

| Item | Backend source of truth | Native status |
|------|-------------------------|---------------|
| Deck | RPC **`get_event_deck`** | `eventsApi.ts` |
| Swipe | Edge **`swipe-actions`** | `eventsApi.ts` invoke |
| Queue drain | RPC **`drain_match_queue`** (post-swipe / lobby) | Used where README documents |

**Backend queue/promotion** is server-owned (including Phase 2 observability); native does **not** implement alternate promotion logic.

### 2.5 Chat send path

| Item | Backend source of truth | Native status |
|------|-------------------------|---------------|
| Send | Edge **`send-message`** (and related media upload paths) | `chatApi.ts`, `chatMediaUpload.ts`, **`ChatOutboxRunner`** (offline/foreground retry) |
| Realtime | Supabase Realtime on `messages` | Subscriptions + query invalidation |

**Gaps:** README lists **read receipts / deep link polish** as deferred — backlog items, not new contracts.

### 2.6 Event visibility / location path

| Item | Backend source of truth | Native status |
|------|-------------------------|---------------|
| List | RPC **`get_visible_events`** + filters | `eventsApi.ts` (location/radius parity with web) |
| Detail / registration | Tables + RPCs as web | `(tabs)/events/[id].tsx` |
| Lobby | Event session + deck | `event/[eventId]/lobby.tsx` |

### 2.7 Vibe video semantics

| Item | Backend source of truth | Native status |
|------|-------------------------|---------------|
| Upload | Edge **`create-video-upload`** → **TUS → Bunny** | `vibeVideoApi.ts` |
| State | `profiles.bunny_video_uid`, `bunny_video_status` (backend-owned) | Poll / UI on Profile & onboarding step |
| Playback | Stream CDN hostname resolution | `vibeVideoPlaybackUrl.ts`, **`expo-video`** for playback (not `expo-av`) |

---

## 3. Native v1 route / screen map

| Screen / route | File(s) | Purpose |
|----------------|---------|---------|
| **Auth** | `app/(auth)/sign-in.tsx`, `reset-password.tsx` | Email/Apple sign-in, recovery |
| **Onboarding** | `app/(onboarding)/` | Profile bootstrap (`createProfile`, credits) |
| **Dashboard / home** | `app/(tabs)/index.tsx` | Now tab; active session banners, daily drop entry |
| **Events list** | `app/(tabs)/events/index.tsx` | Discover |
| **Event details** | `app/(tabs)/events/[id].tsx` | Detail + register |
| **Event lobby** | `app/event/[eventId]/lobby.tsx` | Deck, Ready overlay, queue |
| **Matches** | `app/(tabs)/matches/index.tsx` | List + daily drop tab content |
| **Chat thread** | `app/chat/[id].tsx` | Thread + games + media |
| **Ready gate** | `app/ready/[id].tsx`, overlay in lobby | Full-screen + in-lobby |
| **Video date** | `app/date/[id].tsx` | Daily room |
| **Post-date survey** | *Web in-call; mobile deferred* | Component exists in **web** `PostDateSurvey`; not first-class route on native v1 |
| **Profile** | `app/(tabs)/profile/index.tsx`, `ProfileStudio.tsx` | Edit + vibe video |
| **Settings** | `app/settings/*` | Account, notifications, privacy, credits, support, etc. |
| **Premium** | `app/premium.tsx` | RevenueCat |
| **Daily drop** | `app/daily-drop.tsx` | Dedicated surface |
| **Aux** | `schedule.tsx`, `vibe-video-record.tsx`, `vibe-studio.tsx`, `entry-recovery.tsx`, `how-it-works.tsx` | Supporting |

---

## 4. Per-screen matrix (summary)

| Area | SoT contract | Native | Gap vs desired | Web parity |
|------|--------------|--------|------------------|------------|
| Ready gate | `ready_gate_transition` + `video_sessions` | **Good** | Minor UX/diagnostics | Good |
| Video date | `daily-room` + `video_date_transition` | **Good** | Survey, vibe/extend | Ahead on survey |
| Daily drop | `daily_drop_transition` + tables | **Good** | UI polish | Good |
| Swipe/match | `get_event_deck` + `swipe-actions` + drain | **Good** | — | Good |
| Chat | `send-message` + outbox | **Good** | Read receipts deferred | Ahead |
| Events/location | `get_visible_events` | **Good** | — | Good |
| Vibe video | TUS + Bunny + profile columns | **Good** | Processing edge cases | Good |
| Post-date survey | Backend survey hooks (web) | **Missing route** | **Highest visible gap** | Reference |

---

## 5. Recommended implementation order (after Sprint 0)

1. **Post-date survey parity** on native (`PostDateSurvey` pattern from web) — closes the largest documented UX gap (`docs/mobile-sprint5.md`).
2. **Notification deep links + read receipts** — README-deferred; pick by launch priority.
3. **Video date in-call extras** (mutual vibe, extend) — product-dependent; not contract blockers.
4. **Ongoing:** Golden-path smoke (`scripts/run_golden_path_smoke.sh` web) + `docs/native-manual-test-matrix.md` for cross-platform.

---

## 6. First concrete native branch after Sprint 0 (recommended)

**`native/sprint1-post-date-survey-parity`** (or equivalent name under `native/*`)

- Brings post-date survey flow in line with web after video date end, using existing backend contracts (no new observability scope).

---

## 7. Doc alignment

- **Canonical project reference:** `docs/vibely-canonical-project-reference.md` (import boundaries, `@shared`).
- **Active entry map:** `docs/active-doc-map.md` — this file is the **native architecture lock** for v1 planning.
- **Mobile sprints:** `apps/mobile/README.md`, `docs/mobile-sprint4.md`–`sprint6`, `docs/native-external-setup-checklist.md`.

---

## 8. Explicit non-goals

- No reopening **event-loop backend** redesign or new observability features unless new production evidence appears.
- No partitioning/export/retention scope beyond shipped Phase 3c.
- No instruction to run the native app locally in Cursor (operators use EAS/device per existing runbooks).
