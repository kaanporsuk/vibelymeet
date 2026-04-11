# Vibely — canonical project reference

> **Purpose:** This file is the **canonical project reference** for Vibely (VibelyMeet): architecture, locked decisions, workflows, and product semantics grounded in the repo. Use it at the start of implementation work, Cursor sessions, and engineer handoffs. Detailed runbooks, audits, and phase reports live elsewhere under `docs/`; this document does not replace them.

---

## 1. Repository layout

| Area | Path | Role |
|------|------|------|
| Web app | `src/` | Production web UI and routes |
| Native app | `apps/mobile/` | Expo React Native (iOS/Android) |
| Backend | `supabase/` | Postgres schema, RLS, Edge Functions, migrations |

Monorepo keeps API and behavior contracts visible and reduces drift between clients.

**Import path ownership (TypeScript):**

- **`@shared/*`** — Resolves to **`supabase/functions/_shared/`** (utilities co-located with Edge Functions: tiers, discovery contracts, profile adapters, etc.). Use for backend-aligned or deploy-bundled shared modules, not for arbitrary UI product logic.
- **`shared/`** (repo root) — **Cross-app product logic** shared by web and native (e.g. `shared/eventTimingBuckets.ts`, `shared/supabaseFunctionInvokeErrors.ts`). Import via **relative paths** from each app (`../../shared/...` from `src/`, deep relatives from `apps/mobile/`), unless a future alias is introduced deliberately.

Do not place frontend-only domain modules under `supabase/functions/_shared` solely to use the `@shared` alias.

---

## 2. Shared backend

- **One Supabase project** backs both web and native. There is no separate “mobile-only” backend or duplicate system of record for core domains.
- **Project reference** is the value of `project_id` in [`supabase/config.toml`](../supabase/config.toml) (repo source of truth for which cloud project this codebase targets).
- **Deploy and verify:** Follow [supabase-cloud-deploy.md](./supabase-cloud-deploy.md) — link alignment, `supabase migration list`, `supabase db push`, per-function or bulk Edge Function deploy, secrets outside git, and (when using Cursor MCP) confirming the MCP-authenticated project matches the linked ref.

---

## 3. Native parity reference and launch-closure truth

- **Historical parity reference:** Web remains the design-reference baseline for older native parity audits and mapping docs.
- **Current execution truth:** For launch closure, treat `docs/active-doc-map.md` as the canonical doc entrypoint and treat the shared backend/runtime state as the operational source of truth.
- **Safety net:** Legacy web routes remain; web and native share the same backend.

(Locked in [native-decision-log.md](./native-decision-log.md).)

---

## 4. Provider stack (locked)

| Concern | Provider | Notes |
|---------|----------|------|
| **Backend / auth** | Supabase | Same project, JWT/session semantics for web and native |
| **Live video** | Daily | Same `daily-room` Edge Function and room contract |
| **Media (images/video CDN)** | Bunny | Upload via Edge Functions; CDN URLs on profiles/messages |
| **Push** | OneSignal | Web + native; backend targets player IDs (e.g. `send-notification`) |
| **Native IAP / entitlements** | RevenueCat | Web checkout uses **Stripe**; backend reconciles (e.g. RevenueCat webhook + entitlement resolver) |
| **Analytics** | PostHog | Web primary; align event names on native where used |
| **Errors** | Sentry | Web + native SDKs |

**Bundle / application ID:** `com.vibelymeet.vibely` (RevenueCat, OneSignal, store submissions).

Full env matrix: [native-platform-adapter-matrix.md](./native-platform-adapter-matrix.md).

---

## 5. Native validation: Xcode-first

- Prefer **local iOS builds** first: `npx expo run:ios` from `apps/mobile`, or open **`apps/mobile/ios/mobile.xcworkspace`** in Xcode (scheme **mobile**).
- Set **Signing & Capabilities** for the main app and **OneSignalNotificationServiceExtension** when building for a physical device.
- Use **EAS** when a shareable or store-like artifact is needed (TestFlight, etc.).

See [phase7-stage4-ios-build-and-runtime-validation.md](./phase7-stage4-ios-build-and-runtime-validation.md) and [phase7-closure-typecheck-and-repo-ready.md](./phase7-closure-typecheck-and-repo-ready.md).

---

## 6. Git / Supabase deploy discipline

- Confirm the **linked Supabase project** matches `supabase/config.toml` → `project_id` before `db push` or function deploys.
- **Review migration SQL in PRs** before applying to cloud.
- Avoid accidental `supabase link` to the wrong project ref.
- **Edge Function secrets** live in the dashboard or `supabase secrets set`; they are not committed.
- Bulk deploy option: [`scripts/deploy-supabase-cloud.sh`](../scripts/deploy-supabase-cloud.sh) (DB + functions or functions-only).

Details: [supabase-cloud-deploy.md](./supabase-cloud-deploy.md).

---

## 7. Events: location filter semantics

**RPC:** `get_visible_events` (same for web and native).

### 7.1 Canonical location model (locked)

Post-onboarding, **`location`**, **`location_data`**, and **`country`** on `profiles` are written **only** via the **`update_profile_location`** RPC (not via PostgREST `profiles.update` from app editors). Migrations:

| Migration | Role |
|-----------|------|
| **`20260416100000_canonical_location_model.sql`** | Defines **`update_profile_location`**. Tightens **`get_visible_events`**: users with **no effective coordinates** (no device coords and no stored `location_data`) see **no `local`-scoped** rows (removed the old “no coords ⇒ show all local” bypass). |
| **`20260416110000_regional_events_require_location.sql`** | **`get_visible_events`**: **`regional`** scope now requires a **usable reference point** (`v_effective_lat` / `v_effective_lng` not null), same prerequisite style as **local** — not merely `profiles.country` match with stale text-only location. |

**Visibility summary (after both migrations):**

- **`scope` global or NULL** — always visible (no location required).
- **No usable location** (no premium browse coords, no device coords, no stored `location_data` lat/lng) — **only global-scoped events**; **zero regional, zero local**.
- **`scope = regional`** — requires valid coordinates **and** country match / premium browse rules as implemented in the function (see `COMMENT ON FUNCTION public.get_visible_events` in the latest migration file).
- **`scope = local`** — requires valid coordinates and distance within `radius_km`.

Older migrations (e.g. **`20260325100000_get_visible_events_no_coord_edge_case.sql`**) adjusted radius and edge cases; **20260416100000 / 20260416110000** supersede prior **no-coordinates** behavior for **local** and **regional** visibility.

**Client behavior**

- **Web:** [`src/pages/Events.tsx`](../src/pages/Events.tsx) — non-premium users are forced to **nearby** mode (city browse cleared); premium users can choose **nearby** vs **city** and a **distance (km)**.
- **Web data hook:** [`src/hooks/useVisibleEvents.ts`](../src/hooks/useVisibleEvents.ts) — passes device coordinates when available, falls back to `profiles.location_data`; for **city** mode passes `p_browse_lat` / `p_browse_lng` from the selected city; passes `p_filter_radius_km` when there is a valid reference point and a positive radius.
- **Native:** [`apps/mobile/lib/eventsApi.ts`](../apps/mobile/lib/eventsApi.ts) — documents parity with web; same RPC and analogous parameters (`DiscoverEventsParams`).

**Premium flag on the RPC**

- Web and mobile call the RPC with **`p_is_premium: false`**. Premium-driven browse capability is **not** trusted from the client flag; it is enforced **server-side** (subscriptions / admin), as noted in `useVisibleEvents`.

**Radius vs event scope (server)**

- When `p_filter_radius_km` is set, **local** events are filtered by distance from the effective browse/user point; **global** and **regional** scoped rows are **not** excluded by the user’s radius filter. For the **current** function body and comments, use the files **`20260416110000_regional_events_require_location.sql`** (latest `get_visible_events` in repo) as source of truth, not older snapshots alone.

### 7.2 Migration history note (operators)

Supabase **`schema_migrations`** on the linked project may list **both**:

- **`20260411134909_remote_history_align.sql`** — placeholder row used to align remote history when a version stamp existed before the matching repo file; and
- **`20260416100000`** / **`20260416110000`** — the full migration files with the canonical names.

**Do not assume duplicate logic errors** without diffing: the placeholder is `SELECT 1`; the numbered files contain the real DDL. If `supabase migration list` shows two version rows that look like duplicates, treat this as **history alignment**, not a signal to delete rows from `schema_migrations`.

### Admin lifecycle RPCs (web)

- **`admin_cancel_event(p_event_id)`** — `SECURITY DEFINER`, `has_role(..., admin)`; sets `events.status = 'cancelled'`; rejects archived rows and statuses already terminal (`cancelled`, `ended`, `completed`). Wired from [`AdminEventsPanel.tsx`](../src/components/admin/AdminEventsPanel.tsx).
- **`admin_delete_event(p_event_id)`** — same auth model; deletes in one transaction in dependency order (`event_swipes` → `video_sessions` → `event_vibes` → `event_registrations` → `events`), matching the former browser-side chain; remaining `event_id` FKs rely on `ON DELETE CASCADE` from `events`. Migration: `20260411120000_admin_event_cancel_delete_rpc.sql`.

**Admin push targeting:** In [`AdminEventControls.tsx`](../src/components/admin/AdminEventControls.tsx), **Go Live** sends only to **`admission_status = 'confirmed'`**; **Send reminder** sends to **confirmed + waitlist**. The attendees-modal broadcast matches the reminder audience (explicit in UI copy).

**Cancellation comms (web):** After a successful `admin_cancel_event`, [`AdminEventsPanel.tsx`](../src/components/admin/AdminEventsPanel.tsx) calls [`adminEventCancellationNotify.ts`](../src/lib/adminEventCancellationNotify.ts) — **separate** push copy for **confirmed** vs **waitlist** via category **`event_cancelled`** (mapped in [`send-notification`](../supabase/functions/send-notification/index.ts) to `notify_event_reminder`).

**Discovery / lobby truth:** `get_visible_events` excludes **`status = 'cancelled'`** (migration `20260412120000_event_cancel_truth_capacity.sql`). **`get_event_deck`** returns **no rows** for cancelled/archived events; **`handle_swipe`** returns **`event_not_active`** for cancelled/archived. Web [`EventDetails.tsx`](../src/pages/EventDetails.tsx) reads `events.status`; lobby redirects when cancelled.

**Discovery preferences (Sprint 2):** `profiles.event_discovery_prefs` (jsonb) persists default event-list UI state; **`get_visible_events` is unchanged**. **`get_event_deck`** (migration `20260415100000_get_event_deck_preferred_age.sql`) additionally respects viewer **`preferred_age_min` / `preferred_age_max`** against candidate **`profiles.age`** when age is known; null candidate age is not excluded by that clause. Settings: web **Discovery** drawer from [`Settings`](../src/pages/Settings.tsx); native **`/settings/discovery`**.

**Admin per-gender counts:** **`admin_get_event_confirmed_gender_counts(p_event_id)`** (same migration) — admin-only confirmed counts by normalized profile gender for edit-form warnings only (admission still **aggregate** `max_attendees` / `current_attendees`).

### Email verification (profile trust badge)

- **Canonical address:** `resolveCanonicalAuthEmail` in [`supabase/functions/_shared/verificationSemantics.ts`](../supabase/functions/_shared/verificationSemantics.ts) — prefers `auth.users.email`, then linked-provider `identity_data.email` (including **Apple** / Google / email provider rows). This is the **only** address the `email-verification` Edge Function will send to or accept for OTP when the client passes `email` in the body.
- **No inbox-first gate for OTP:** the trust flow is **send code → verify code** against that canonical address. Supabase “confirm your email” / magic-link flows are **separate** account-level concerns and must not be confused with this gate.
- **Runtime proof:** Apple Sign-In on real devices is **not** re-validated in automated CI here; treat in-app verification as **code-aligned** until a fresh QA run is logged.

---

## 8. Vibe score and Vibe Video readiness

### 8.1 System of record (database)

- Persisted fields: **`profiles.vibe_score`**, **`profiles.vibe_score_label`**, maintained by triggers calling **`calculate_vibe_score`** (see `supabase/migrations/`, including `20260324100000_fix_vibe_score_video_points.sql`).
- **Vibe Video points:** **15** when `bunny_video_uid` is **non-null and non-empty**, regardless of `bunny_video_status`. This avoids a large score drop while status is `uploading` / `processing` during re-upload or transcode.

### 8.2 Native UI readiness (playback and actions)

- Resolver: [`apps/mobile/lib/vibeVideoState.ts`](../apps/mobile/lib/vibeVideoState.ts) — canonical for native surfaces.
- **States:** `none`, `uploading`, `processing`, `ready`, `failed`, `error`.
- **`canPlay`:** `true` only when `bunny_video_status` is **`ready`** and a playback URL exists.
- If a **uid** exists but status is missing or unrecognized → treat as **`processing`** (e.g. webhook lag).

### 8.3 Legacy client-side wizard score (not server truth)

- [`src/utils/calculateVibeScore.ts`](../src/utils/calculateVibeScore.ts) is a **deprecated local completeness estimator** (see file header). It is **not** the source of truth for `profiles.vibe_score` / `vibe_score_label`. There is **no** `apps/mobile/lib/calculateVibeScore.ts`; native reads persisted scores from the profile row.
- **Do not confuse** with [`src/utils/vibeScoreUtils.ts`](../src/utils/vibeScoreUtils.ts) **`calculateVibeScore`**, which is a **different** concept (event/match **compatibility %**, not profile completeness).

### 8.4 Webhook pipeline (operator)

- Bunny transcode → **`video-webhook`** Edge Function updates `bunny_video_status`. If webhooks fail, clients can remain on `processing` until fixed. See [vibe-video-webhook-operator.md](./vibe-video-webhook-operator.md).

---

## 9. Related docs

| Document | Use |
|----------|-----|
| [native-decision-log.md](./native-decision-log.md) | Locked architecture and process decisions |
| [native-platform-adapter-matrix.md](./native-platform-adapter-matrix.md) | Provider mapping and env vars |
| [supabase-cloud-deploy.md](./supabase-cloud-deploy.md) | Cloud verify, migrate, deploy |
| [vibe-video-webhook-operator.md](./vibe-video-webhook-operator.md) | Vibe Video webhook and operator steps |
| [native-external-setup-checklist.md](./native-external-setup-checklist.md) | RevenueCat, OneSignal, stores, EAS |
