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

---

## 2. Shared backend

- **One Supabase project** backs both web and native. There is no separate “mobile-only” backend or duplicate system of record for core domains.
- **Project reference** is the value of `project_id` in [`supabase/config.toml`](../supabase/config.toml) (repo source of truth for which cloud project this codebase targets).
- **Deploy and verify:** Follow [supabase-cloud-deploy.md](./supabase-cloud-deploy.md) — link alignment, `supabase migration list`, `supabase db push`, per-function or bulk Edge Function deploy, secrets outside git, and (when using Cursor MCP) confirming the MCP-authenticated project matches the linked ref.

---

## 3. Web as source of truth for native parity

- **Product and design source of truth:** Web. Native work targets **parity** with web behavior and UX for v1 user flows, not an independent redesign.
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

**Client behavior**

- **Web:** [`src/pages/Events.tsx`](../src/pages/Events.tsx) — non-premium users are forced to **nearby** mode (city browse cleared); premium users can choose **nearby** vs **city** and a **distance (km)**.
- **Web data hook:** [`src/hooks/useVisibleEvents.ts`](../src/hooks/useVisibleEvents.ts) — passes device coordinates when available, falls back to `profiles.location_data`; for **city** mode passes `p_browse_lat` / `p_browse_lng` from the selected city; passes `p_filter_radius_km` when there is a valid reference point and a positive radius.
- **Native:** [`apps/mobile/lib/eventsApi.ts`](../apps/mobile/lib/eventsApi.ts) — documents parity with web; same RPC and analogous parameters (`DiscoverEventsParams`).

**Premium flag on the RPC**

- Web and mobile call the RPC with **`p_is_premium: false`**. Premium-driven browse capability is **not** trusted from the client flag; it is enforced **server-side** (subscriptions / admin), as noted in `useVisibleEvents`.

**Radius vs event scope (server)**

- When `p_filter_radius_km` is set, **local** events are filtered by distance from the effective browse/user point; **global** and **regional** scoped rows are **not** excluded by the user’s radius filter (see latest `get_visible_events` definitions under `supabase/migrations/`, e.g. `20260325100000_get_visible_events_no_coord_edge_case.sql`).

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
