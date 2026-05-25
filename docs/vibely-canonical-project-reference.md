# Vibely — canonical project reference

> **Purpose:** This file is the **canonical project reference** for Vibely (VibelyMeet): architecture, locked decisions, workflows, and product semantics grounded in the repo. Use it at the start of implementation work, AI-assisted implementation sessions, and engineer handoffs. Detailed runbooks, audits, and phase reports live elsewhere under `docs/`; this document does not replace them.

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
- **`shared/`** (repo root) — **Cross-app product logic** shared by web and native (e.g. `shared/eventTimingBuckets.ts`, `shared/supabaseFunctionInvokeErrors.ts`, `shared/vibeVideoSemantics.ts`). Import through the deliberate **`@clientShared/*`** alias where configured, or by relative path in contexts that do not load the app tsconfig.

Do not place frontend-only domain modules under `supabase/functions/_shared` solely to use the `@shared` alias.

---

## 2. Shared backend

- **One Supabase project** backs both web and native. There is no separate “mobile-only” backend or duplicate system of record for core domains.
- **Project reference** is the value of `project_id` in [`supabase/config.toml`](../supabase/config.toml) (repo source of truth for which cloud project this codebase targets).
- **Deploy and verify:** Follow [supabase-cloud-deploy.md](./supabase-cloud-deploy.md) — link alignment, `supabase migration list`, `supabase db push`, per-function or bulk Edge Function deploy, secrets outside git, and confirming any authenticated agent/MCP project matches the linked ref.

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

### 4.1 Video Date Handshake release contract

Current release status: **complete and deployed** as of 2026-04-30 on Supabase project `schdyxcunwcvddlcshwd`.

Durable contract for web and native:

- `confirm_video_date_entry_prepared(...)` is the provider-atomic routeability step. It persists Daily metadata and makes the session routeable without starting `handshake_started_at`.
- `mark_video_date_daily_joined(...)` stamps the authenticated participant's Daily join and starts `handshake_started_at` only after both participant join stamps exist.
- Ready Gate `both_ready` provider handoff is `45s`, and expired Ready Gates are not reopened.
- Web and native warm-up timers and Vibe/Pass controls wait for server-owned `handshake_started_at`.
- Daily room identity remains deterministic and session-scoped; both participants must target the same `video_sessions.id` and Daily room.
- Each participant receives a distinct user-scoped Daily token. Non-participants must not receive tokens or write join stamps.
- Critical video-date lifecycle state remains backend-owned through RPCs/state-machine functions; clients render and route from server truth.
- Daily provider diagnostics must not log meeting tokens, auth headers, provider secrets, or raw secret values.

Release evidence:

- Migration applied: `20260501170000_video_date_handshake_starts_after_daily_join.sql`.
- Edge Function redeployed: `daily-room`.
- Required Supabase secret names were present at release check: `DAILY_API_KEY`, `DAILY_DOMAIN`, `DAILY_WEBHOOK_SECRET`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
- Video Date Daily webhook endpoint: `https://schdyxcunwcvddlcshwd.supabase.co/functions/v1/video-date-daily-webhook`, `verify_jwt=false`, protected by Daily HMAC/timestamp validation. `DAILY_WEBHOOK_SECRET` stores Daily's base64 webhook `hmac` exactly as returned by Daily.
- Two-person Daily/provider runtime QA for the handshake release is recorded as completed.

---

## 5. Native validation: Xcode-first

- Prefer **local iOS builds** first: `npx expo run:ios` from `apps/mobile`, or open **`apps/mobile/ios/mobile.xcworkspace`** in Xcode (scheme **mobile**).
- Set **Signing & Capabilities** for the main app and **OneSignalNotificationServiceExtension** when building for a physical device.
- Use **EAS** when a shareable or store-like artifact is needed (TestFlight, etc.).

See [native-release-readiness/stage4-ios-build-and-runtime-validation.md](./native-release-readiness/stage4-ios-build-and-runtime-validation.md) and [native-release-readiness/closure-typecheck-and-repo-ready.md](./native-release-readiness/closure-typecheck-and-repo-ready.md).

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
| **`20260501150000_get_visible_events_location_entitlement_guards.sql`** | Restores the authenticated `p_user_id = auth.uid()` guard, keeps `p_is_premium` ignored, derives city-browse entitlement server-side, and treats local/location-specific no-coordinate rows as ineligible for radius matching. |

**Visibility summary (current):**

- **`scope = global`** — always visible (no location required) unless the row is also marked location-specific.
- **Legacy `scope IS NULL`** — treated as global only when the row has no location-specific/coordinate signals; null-scope rows with location signals are treated as local for discovery eligibility.
- **No usable location** (no premium browse coords, no device coords, no stored `location_data` lat/lng) — **only global-scoped events**; **zero regional, zero local**.
- **`scope = regional`** — requires valid coordinates **and** country match / premium browse rules as implemented in the function (see `COMMENT ON FUNCTION public.get_visible_events` in the latest migration file).
- **`scope = local`** and location-specific rows — require event `latitude` / `longitude`, valid viewer/browse coordinates, and distance within `radius_km`.

Older migrations (e.g. **`20260325100000_get_visible_events_no_coord_edge_case.sql`**) adjusted radius and edge cases; **20260416100000 / 20260416110000** supersede prior **no-coordinates** behavior for **local** and **regional** visibility.

**Client behavior**

- **Web:** [`src/pages/Events.tsx`](../src/pages/Events.tsx) — non-premium users are forced to **nearby** mode (city browse cleared); premium users can choose **nearby** vs **city** and a **distance (km)**.
- **Web data hook:** [`src/hooks/useVisibleEvents.ts`](../src/hooks/useVisibleEvents.ts) — passes device coordinates when available, falls back to `profiles.location_data`; for **city** mode passes `p_browse_lat` / `p_browse_lng` from the selected city; passes `p_filter_radius_km` when there is a valid reference point and a positive radius.
- **Native:** [`apps/mobile/lib/eventsApi.ts`](../apps/mobile/lib/eventsApi.ts) — documents parity with web; same RPC and analogous parameters (`DiscoverEventsParams`).

**Premium flag on the RPC**

- Web and mobile call the RPC with **`p_is_premium: false`**. Premium-driven browse capability is **not** trusted from the client flag; it is enforced **server-side** (subscriptions / admin), as noted in `useVisibleEvents`.
- Non-service callers cannot borrow another profile id for entitlement checks: `get_visible_events` requires `auth.uid() = p_user_id`.
- For non-premium callers that still send city browse coordinates, the server ignores those coordinates and falls back to the stored profile location only; arbitrary client coordinates in the same browse request are not accepted as a replacement remote city.

**Radius vs event scope (server)**

- When `p_filter_radius_km` is set, **local/location-specific** events are filtered by distance from the effective browse/user point and must have event coordinates. **Explicit global** and **regional** scoped rows are **not** excluded by the user’s radius filter. For the **current** function body and comments, use **`20260501150000_get_visible_events_location_entitlement_guards.sql`** as source of truth, not older snapshots alone.

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

**Discovery / lobby truth:** `get_visible_events` excludes **`status = 'cancelled'`** (migration `20260412120000_event_cancel_truth_capacity.sql`). **Event Lobby contract:** [`docs/contracts/event-lobby-native-contract.md`](contracts/event-lobby-native-contract.md) is the canonical backend/web/native reference for active-event eligibility, deck payload, swipe outcomes, Ready Gate, queueing, media, realtime recovery, and observability. **`get_event_deck`** now raises **`event_not_active`** for inactive events instead of silently returning an empty cancelled/archived deck; **`handle_swipe`** returns **`event_not_active`** for inactive events without mutation. Web [`EventDetails.tsx`](../src/pages/EventDetails.tsx) reads `events.status`; lobby redirects when cancelled.

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
- **States:** `none`, `processing`, `stale_processing`, `ready`, `failed`, `error`. Provider `uploading` is normalized into `processing` in UI resolver output.
- **`canPlay`:** `true` only when `bunny_video_status` is **`ready`** and a playback URL exists.
- If a **uid** exists but status is missing or unrecognized → treat as **`processing`** (e.g. webhook lag), and as **`stale_processing`** after the shared stale threshold when profile timestamps are available.

### 8.3 Legacy client-side wizard score (not server truth)

- [`src/utils/calculateVibeScore.ts`](../src/utils/calculateVibeScore.ts) is a **deprecated local completeness estimator** (see file header). It is **not** the source of truth for `profiles.vibe_score` / `vibe_score_label`. There is **no** `apps/mobile/lib/calculateVibeScore.ts`; native reads persisted scores from the profile row.
- **Do not confuse** with [`src/utils/vibeScoreUtils.ts`](../src/utils/vibeScoreUtils.ts) **`calculateVibeScore`**, which is a **different** concept (event/match **compatibility %**, not profile completeness).

### 8.4 Webhook pipeline (operator)

- Bunny transcode → **`video-webhook`** Edge Function updates `bunny_video_status`. If webhooks fail, clients keep polling/refetching and show recoverable processing/stale-processing copy until fixed. See [vibe-video-webhook-operator.md](./vibe-video-webhook-operator.md).

---

## 9. Related docs

| Document | Use |
|----------|-----|
| [native-decision-log.md](./native-decision-log.md) | Locked architecture and process decisions |
| [native-platform-adapter-matrix.md](./native-platform-adapter-matrix.md) | Provider mapping and env vars |
| [supabase-cloud-deploy.md](./supabase-cloud-deploy.md) | Cloud verify, migrate, deploy |
| [vibe-video-webhook-operator.md](./vibe-video-webhook-operator.md) | Vibe Video webhook and operator steps |
| [native-external-setup-checklist.md](./native-external-setup-checklist.md) | RevenueCat, OneSignal, stores, EAS |
