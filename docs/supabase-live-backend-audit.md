# Supabase Live Backend Audit

**Project ref:** `schdyxcunwcvddlcshwd`  
**Audit date:** 2026-03-18  
**Scope:** Live database, RPCs, Edge Functions, storage, RLS, realtime, secrets, migrations, and codebase alignment (web `src/` and native `apps/mobile/`).

> Update 2026-04-06: `public.match_mutes` was later retired after `match_notification_mutes` became the sole canonical per-match mute table. References below to `match_mutes` reflect the historical 2026-03-18 snapshot.
>
> Historical note: this document preserves a March 18, 2026 live audit snapshot. For current schema truth, use the latest migrations, live DB state, and `src/integrations/supabase/types.ts`.

---

## SECTION 1: LIVE DATABASE SCHEMA vs CODE

### 1. Live public tables (41)

```
account_deletion_requests, admin_activity_logs, admin_notifications, age_gate_blocks,
blocked_users, credit_adjustments, daily_drop_cooldowns, daily_drops, date_feedback,
date_proposals, email_drip_log, email_verifications, event_registrations, event_swipes,
event_vibes, events, feedback, match_calls, match_mutes, match_notification_mutes,
matches, messages, notification_log, notification_preferences, photo_verifications,
premium_history, profile_vibes, profiles, push_campaigns, push_notification_events,
push_notification_events_admin, rate_limits, subscriptions, user_credits, user_reports,
user_roles, user_schedules, user_suspensions, user_warnings, verification_attempts,
vibe_tags, video_sessions
```

### 1a. Tables: Live DB vs `src/integrations/supabase/types.ts`

- **In types and in live:** All 41 tables above are present in `types.ts` (including `push_notification_events_admin`).
- **In live but not in types:** None.
- **In types but not in live:** None.

**Result:** Schema and types are aligned.

### 1b. Code references `supabase.from('TABLE_NAME')` vs live tables

**Web (src/):**  
Tables used: `premium_history`, `profiles`, `match_calls`, `matches`, `vibe_tags`, `events`, `notification_preferences`, `push_notification_events`, `events`, `profiles`, `video_sessions`, `event_registrations`, `push_campaigns`, `event_swipes`, `video_sessions`, `event_vibes`, `event_registrations`, `events`, `admin_notifications`, `user_suspensions`, `feedback`, `messages`, `user_schedules`, `user_reports`, `blocked_users`, `messages`, `date_proposals`, `match_mutes`, `match_notification_mutes`, `matches`, `photo_verifications`, `notification_preferences`, `credit_adjustments`.

**Native (apps/mobile/):**  
Tables used: `messages`, `date_proposals`, `match_mutes`, `match_notification_mutes`, `matches`, `user_credits`, `blocked_users`, `event_vibes`, `user_reports`, `blocked_users`, `match_calls`, `matches`, `profiles`, `messages`, `event_registrations`, `profile_vibes`, `profiles`, `match_mutes`, `match_notification_mutes`, `profiles`, `notification_preferences`, `video_sessions`, `date_feedback`, `profiles`, `user_credits`.

All referenced tables exist in the live DB. **No code references a missing table.**

### 1c. Foreign keys: match child tables and ON DELETE behaviour

Relevant FKs (from live DB, `confdeltype`: `c` = CASCADE, `a` = NO ACTION):

| Table                     | FK to matches | delete_rule |
|---------------------------|--------------|-------------|
| messages                  | match_id     | CASCADE (c) |
| date_proposals            | match_id     | CASCADE (c) |
| match_mutes               | match_id     | CASCADE (c) |
| match_notification_mutes  | match_id     | CASCADE (c) |

**Result:** All four have `ON DELETE CASCADE` to `matches`. No FK discrepancy; manual deletes in code before deleting the match are redundant but safe.

---

## SECTION 2: LIVE RPC / SQL FUNCTIONS vs CODE

### Live public RPCs (callable; triggers omitted)

Routines: `can_view_profile_photo`, `check_mutual_vibe_and_match`, `check_premium_status`, `daily_drop_transition`, `deduct_credit`, `drain_match_queue`, `find_mystery_match`, `generate_recurring_events`, `get_event_deck`, `get_other_city_events`, `get_visible_events`, `handle_swipe`, `leave_matching_queue`, `ready_gate_transition`, `update_participant_status`, `video_date_transition`.

### 2a. RPC calls in code

| RPC | Web (src/) | Native (apps/mobile/) |
|-----|------------|------------------------|
| video_date_transition | VideoDate.tsx | videoDateApi.ts |
| leave_matching_queue | VideoDate.tsx | date/[id].tsx |
| deduct_credit | useCredits.ts | videoDateApi.ts |
| check_premium_status | usePremium.ts | — |
| update_participant_status | useEventStatus.ts | videoDateApi.ts |
| daily_drop_transition | useDailyDrop.ts | dailyDropApi.ts |
| get_visible_events | useVisibleEvents.ts | — |
| get_other_city_events | useVisibleEvents.ts | — |
| get_event_deck | useEventDeck.ts | eventsApi.ts |
| drain_match_queue | useMatchQueue.ts | eventsApi.ts |
| find_mystery_match | useMysteryMatch.ts | useMysteryMatch.ts |
| generate_recurring_events | AdminEventFormModal, AdminEventsPanel | — |
| check_mutual_vibe_and_match | PostDateSurvey.tsx | videoDateApi.ts |
| ready_gate_transition | useReadyGate.ts | readyGateApi.ts |

`handle_swipe` is not called directly from app code; it is invoked by the **swipe-actions** Edge Function (see `supabase/functions/swipe-actions/index.ts`). So RPC usage is consistent.

### 2b. Cross-reference

- **RPCs called in code but not in live DB:** None.
- **RPCs in live DB not called by code (and not by Edge Functions):**  
  `find_video_date_match`, `join_matching_queue`, `get_own_pii`, `get_user_subscription_status`, `can_view_profile_photo`, `check_gender_compatibility`, `haversine_distance`, `is_blocked`, `is_registered_for_event`, `has_role` — these are used by other RPCs/triggers or reserved for future use; no broken call sites.

### 2c. Critical RPCs: existence and signatures

| RPC | In live DB | Signature (args → result) |
|-----|------------|---------------------------|
| check_mutual_vibe_and_match | Yes | p_session_id uuid → jsonb |
| drain_match_queue | Yes | p_event_id uuid, p_user_id uuid → jsonb |
| find_mystery_match | Yes | p_event_id uuid, p_user_id uuid → jsonb |
| get_event_deck | Yes | p_event_id uuid, p_user_id uuid, p_limit int DEFAULT 50 → TABLE(...) |
| handle_swipe | Yes | p_event_id, p_actor_id, p_target_id uuid, p_swipe_type text → jsonb |
| deduct_credit | Yes | p_user_id uuid, p_credit_type text → boolean |

All critical RPCs exist with the expected signatures.

---

## SECTION 3: LIVE EDGE FUNCTIONS vs CODE

### 3a. Deployed Edge Functions (live)

33 functions: `delete-account`, `email-verification`, `event-notifications`, `push-webhook`, `geocode`, `verify-admin`, `forward-geocode`, `daily-room`, `phone-verify`, `admin-review-verification`, `create-video-upload`, `video-webhook`, `delete-vibe-video`, `upload-image`, `upload-voice`, `upload-event-cover`, `create-checkout-session`, `stripe-webhook`, `create-event-checkout`, `create-credits-checkout`, `create-portal-session`, `cancel-deletion`, `request-account-deletion`, `send-notification`, `generate-daily-drops`, `upload-chat-video`, `daily-drop-actions`, `send-message`, `swipe-actions`, `revenuecat-webhook`.

### 3b. Repo `supabase/functions/` vs deployed

All 34 deployed function names have a matching directory under `supabase/functions/` (e.g. `create-video-upload`, `daily-room`). No function is deployed without a repo counterpart. No repo function folder is missing from the deployed list.

### 3c. Code invocations: `supabase.functions.invoke()` and `fetch(.../functions/v1/...)`

**Web:**  
`create-checkout-session`, `create-video-upload` (fetch), `daily-room`, `upload-image` (fetch), `send-notification`, `geocode`, `push-webhook` (doc only), `upload-voice` (fetch), `upload-event-cover` (fetch), `admin-review-verification`, `daily-drop-actions`, `create-checkout-session`, `create-event-checkout`, `create-credits-checkout` (fetch), `verify-admin`, `delete-vibe-video` (fetch), `phone-verify`, `email-verification/send`, `email-verification/verify`, `request-account-deletion` (fetch), `event-notifications`, `forward-geocode`, `delete-account`, `cancel-deletion`, `swipe-actions`, `send-message`.

**Native:**  
`daily-room`, `email-verification/send`, `email-verification/verify`, `create-video-upload` (fetch), `delete-vibe-video` (fetch), `create-portal-session`, `request-account-deletion`, `create-credits-checkout` (fetch), `phone-verify`, `send-message`, `swipe-actions`, `daily-drop-actions`, `upload-voice` (fetch), `upload-chat-video` (fetch), `upload-image` (fetch), `cancel-deletion`.

All invoked names resolve to the deployed list (subpaths like `email-verification/send` and `email-verification/verify` are handled by the single `email-verification` function).

### 3d. Cross-reference

- **Invoked in code but not deployed:** None.
- **Deployed but not invoked from app code:**  
  `unsubscribe`, `email-drip`, `video-webhook`, `stripe-webhook`, `revenuecat-webhook`, `generate-daily-drops` (admin-only), `push-webhook` (webhook endpoint). These are webhooks/cron/admin; no issue.
- **In repo and deployed:** All 34; no repo-only functions left undeployed.

### 3e. Function configuration

`supabase functions list` does not expose `verify_jwt` per function in the output. JWT verification is typically enabled by default for Edge Functions; no mismatch was observed from the audit.

---

## SECTION 4: LIVE STORAGE BUCKETS vs CODE

### Live buckets

| name           | public | file_size_limit | allowed_mime_types |
|----------------|--------|-----------------|--------------------|
| chat-videos    | true   | null            | null               |
| proof-selfies  | false  | null            | null               |

### 4a. Code references to storage

No `supabase.storage.from(...)` calls were found in `src/` or `apps/mobile/`. Upload flows use Edge Functions and/or Bunny (e.g. `upload-chat-video`, `upload-voice`, `upload-image`, `upload-event-cover`, `create-video-upload`, `delete-vibe-video`). So **no code expects Supabase storage buckets** other than what the Edge Functions use (e.g. chat-videos, proof-selfies) — and those exist.

### 4b. Storage RLS (storage.objects)

- Admins can view all proof selfies.
- Anon/authenticated can view chat-videos; authenticated can insert chat-videos (folder = match id).
- Users can insert/view their own proof-selfies (folder = user id).

### 4c. Buckets referenced in code

No direct bucket names in client code. Legacy buckets (profile-photos, vibe-videos, event-covers, voice-messages) have been removed and moved to Bunny; no references to them remain in the audited code. **No code references a missing bucket.**

---

## SECTION 5: LIVE RLS POLICIES vs SECURITY

### 5a. RLS status

All 41 public tables have `rowsecurity = true`. **No table with RLS disabled is accessed by client code.**

### 5b. Tables with RLS enabled but zero policies

Every table that has RLS enabled has at least one policy. **No table has RLS on and zero policies.**

### 5c. Client operations vs policies

For the tables used by the app (e.g. profiles, matches, messages, event_registrations, events, match_calls, daily_drops, video_sessions, etc.), the following are covered by policies where needed:

- **SELECT:** Own rows or shared context (e.g. matches, messages, event participants, admin views).
- **INSERT:** Own/user-scoped (e.g. messages, blocks, feedback, event_registrations).
- **UPDATE:** Own rows or admin.
- **DELETE:** Own rows or admin (e.g. blocks, matches, event_registrations).

No client-only operation was found that clearly lacks a supporting policy. **No RLS gaps identified.**

---

## SECTION 6: LIVE REALTIME CONFIGURATION

### Realtime publication `supabase_realtime`

Tables in publication: **events**, **event_registrations**, **matches**, **messages**, **video_sessions**, **push_notification_events**, **match_calls**, **daily_drops**.

### 6a. Realtime subscriptions in code

**Web:**  
Channels / postgres_changes: `events-realtime` (events), `match-queue-*` (event_registrations / match flow), `matches-realtime-*` (matches), `messages:*` (messages), `session-timer-*`, `event-lifecycle-*` (events), `lobby-match-*`, `match-calls-*` (match_calls), `premium-*`, `subscription-*` (**subscriptions**), `push-notification-events-realtime` (push_notification_events), `event-status-*`, `daily-drop-*` (daily_drops), `ready-gate-*` (video_sessions), `vibe-questions-*`, admin: **profiles**, **matches**, **events**, **event_registrations**, **admin_notifications**, **user_reports**, **messages**.

**Native:**  
`matches-realtime-*` (matches), `messages-*` (messages), `daily-drop-*` (daily_drops), `lobby-reg-*`, `lobby-video-*`, `event-lifecycle-*`, `match-calls-*` (match_calls), `video-date-session-*` (video_sessions), `ready-gate-*` (video_sessions).

### 6b. Subscription vs publication

- **In publication:** events, event_registrations, matches, messages, video_sessions, push_notification_events, match_calls, daily_drops → subscriptions to these tables will receive events.
- **Not in publication:** **subscriptions**, **profiles**, **admin_notifications**, **user_reports**.

So:

- **Web:** `subscription-${user.id}` listening to **subscriptions** will not get postgres_changes (subscriptions not in realtime publication).
- **Admin (web):** Realtime for **profiles**, **admin_notifications**, **user_reports** will not fire (tables not in publication).

**Discrepancy:** Realtime subscriptions in code target tables that are not in the realtime publication; those subscriptions will not receive postgres change events.

---

## SECTION 7: LIVE SECRETS vs EDGE FUNCTION NEEDS

### Secrets referenced in `supabase/functions/` (Deno.env.get)

Collected unique names:  
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_MONTHLY_PRICE_ID`, `STRIPE_ANNUAL_PRICE_ID`, `BUNNY_STREAM_LIBRARY_ID`, `BUNNY_STREAM_API_KEY`, `BUNNY_STREAM_CDN_HOSTNAME`, `BUNNY_VIDEO_WEBHOOK_TOKEN`, `BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_API_KEY`, `BUNNY_CDN_HOSTNAME`, `ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY`, `APP_URL`, `RESEND_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`, `CRON_SECRET`, `UNSUB_HMAC_SECRET`, `REVENUECAT_WEBHOOK_AUTHORIZATION`, `PUSH_WEBHOOK_SECRET`, `DAILY_API_KEY`, `DAILY_DOMAIN`.

### Live secrets (from `supabase secrets list`)

All of the above are present. In addition, live has `LOVABLE_API_KEY` and `SUPABASE_DB_URL`; no Edge Function code references them. **No function expects a secret that is missing in production.**

---

## SECTION 8: LIVE vs CODEBASE MIGRATION STATE

### 8a. Migrations in repo not applied on live

`supabase migration list` (with project linked) showed **88 migrations** with matching Local and Remote timestamps. **No local migration is missing on live.**

### 8b. Migrations applied on live not in repo

All remote migrations had a corresponding local file. **No drift.**

---

## SECTION 9: WEB vs NATIVE DIVERGENCE ON BACKEND USAGE

### 9a. Tables/columns

- **Web-only (from this audit):** premium_history, push_campaigns, push_notification_events, admin_notifications, credit_adjustments, photo_verifications (admin). Native does not use these in the same way or at all.
- **Native-only:** Same core tables; no table is used only by native and missing on live. Both use profiles, matches, messages, event_registrations, events, match_calls, video_sessions, daily_drops, user_credits, etc.

No critical divergence: both apps use the same backend tables; web has extra admin/premium surfaces.

### 9b. Edge Functions

- **Web-only:** verify-admin, event-notifications, forward-geocode, admin-review-verification, generate-daily-drops (admin), account-pause, account-resume.
- **Native-only:** create-portal-session (settings).
- **Shared:** daily-room, geocode, create-video-upload, delete-vibe-video, phone-verify, email-verification, request-account-deletion, cancel-deletion, send-message, swipe-actions, daily-drop-actions, create-event-checkout, create-credits-checkout, upload-image, upload-voice, upload-chat-video.

No conflict; differences are by design (admin vs user, web vs native flows).

### 9c. Same Edge Function, different payloads

- **create-event-checkout:** Web and native both invoke with event/user context; no incompatible parameter mismatch found.
- **daily-room:** Same action set (e.g. create_room, delete_room); both pass equivalent payloads.
- **email-verification / phone-verify:** Same invoke names and logical usage.

No critical payload divergence identified.

### 9d. Realtime

- **Web:** More channels (admin profiles, notifications, reports; subscription status; event lifecycle; lobby; premium).
- **Native:** Matches, messages, daily_drops, match_calls, video_sessions, ready-gate, event lifecycle, lobby.

Same tables are used where both need realtime; web adds admin and subscription channels. The realtime **publication** gap (subscriptions, profiles, admin_notifications, user_reports) affects mainly web/admin.

---

## SECTION 10: DATA INTEGRITY CHECK

Spot checks on live data:

| Check | Result |
|-------|--------|
| Orphaned messages (match_id not in matches) | 0 |
| Orphaned date_proposals | 0 |
| Orphaned match_mutes | 0 |
| Profiles with name NULL or '' | 0 |
| Events with current_attendees ≠ count(event_registrations) | 0 (sample) |
| video_sessions with ended_at IS NULL and started_at &lt; 24h ago | 0 |

**Note:** `video_sessions` has no `created_at`; the query used `started_at` for the 24h window.

---

## DISCREPANCIES BY SECTION

### Section 1 (Schema)

- **None.** Tables in DB, types, and code are aligned; match FKs have ON DELETE CASCADE.

### Section 2 (RPCs)

- **None.** All RPCs used by code or Edge Functions exist with correct signatures.

### Section 3 (Edge Functions)

- **None.** All invoked functions are deployed; no code calls a missing function.

### Section 4 (Storage)

- **None.** Only chat-videos and proof-selfies exist; code does not reference Supabase buckets directly; no reference to deleted buckets.

### Section 5 (RLS)

- **None.** RLS is on for all public tables; no table has zero policies; client operations are covered.

### Section 6 (Realtime) — **DISCREPANCIES**

| Severity | Item |
|----------|------|
| **HIGH** | **subscriptions** table is not in `supabase_realtime` publication. Web `useSubscription` subscribes to `subscriptions` with filter `user_id=eq.${user.id}`. Subscription status (e.g. premium) will not update in real time after Stripe/RevenueCat; user may need to refresh. |
| **MEDIUM** | **profiles** table is not in realtime publication. Admin dashboard `useAdminRealtime` subscribes to profiles; admin panel will not see profile changes in real time. |
| **MEDIUM** | **admin_notifications** table is not in realtime publication. Admin notifications realtime subscription will not fire. |
| **MEDIUM** | **user_reports** table is not in realtime publication. Admin reports realtime subscription will not fire. |

### Section 7 (Secrets)

- **None.** Every secret read by Edge Functions is set in the live project. LOVABLE_API_KEY is set but unused (optional).

### Section 8 (Migrations)

- **None.** All 88 migrations are in sync between local and remote.

### Section 9 (Web vs Native)

- **None.** Divergence is intentional (admin vs user, web vs native). No missing backend for either app.

### Section 10 (Data integrity)

- **Resolved (April 6, 2026).** A later linked-DB integrity audit found 3 synthetic orphan `public.profiles` rows. They were manually removed in a one-off operational cleanup. Current post-cleanup count: `auth.users` without profiles = `0`; `profiles` without `auth.users` = `0`.

---

## SUMMARY: TOTAL DISCREPANCIES BY SEVERITY

| Severity  | Count |
|-----------|-------|
| CRITICAL  | 0     |
| HIGH      | 1     |
| MEDIUM    | 3     |
| LOW       | 0     |

**Total: 4 discrepancies**, all in **Realtime (Section 6)**.

---

## TOP 10 MOST URGENT ITEMS TO FIX

1. **Add `subscriptions` to realtime publication** (HIGH) — so web premium/subscription status updates in real time after Stripe/RevenueCat.
2. **Add `profiles` to realtime publication** (MEDIUM) — so admin dashboard sees profile changes live.
3. **Add `admin_notifications` to realtime publication** (MEDIUM) — so admin notification bell updates live.
4. **Add `user_reports` to realtime publication** (MEDIUM) — so admin reports list updates live.
5. (No further critical/high items; schema, RPCs, Edge Functions, storage, RLS, secrets, migrations, and data integrity are aligned.)

Remaining items 5–10: optional hardening (e.g. document that `handle_swipe` is only called via swipe-actions; confirm JWT config for Edge Functions if needed; keep types in sync after schema changes).

---

## RECOMMENDED FIX ORDER

1. **Realtime publication (single migration or dashboard change)**  
   Add to `supabase_realtime` publication:
   - `subscriptions`
   - `profiles`
   - `admin_notifications`
   - `user_reports`  

   Example (if using SQL):

   ```sql
   ALTER PUBLICATION supabase_realtime ADD TABLE public.subscriptions;
   ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
   ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_notifications;
   ALTER PUBLICATION supabase_realtime ADD TABLE public.user_reports;
   ```

   Then verify in Dashboard → Database → Replication that these tables are in the publication, and re-test web subscription status and admin realtime.

2. **Verification**  
   - Web: Change subscription (e.g. upgrade/downgrade) and confirm UI updates without refresh.  
   - Admin: Update a profile or create a report/notification and confirm panels update in real time.

3. **Optional**  
   - Add a short note in repo or runbook that `handle_swipe` is invoked only via the swipe-actions Edge Function.  
   - After any future schema change, regenerate `src/integrations/supabase/types.ts` and run this audit again for tables and RLS.

---

*End of audit.*
