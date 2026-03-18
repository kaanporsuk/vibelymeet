# Supabase full backend vs frontend audit

**Project ref:** `schdyxcunwcvddlcshwd`  
**Audited:** repo `src/` (web) vs `apps/mobile/` (native) vs `supabase/functions/`  
**CLI checks run:** `supabase functions list`, `supabase secrets list` (2026-03-18)

**Link project (run locally):**

```bash
supabase link --project-ref schdyxcunwcvddlcshwd
```

**Live DB SQL:** Sections that require Postgres (full RPC enumeration vs `types.ts`, `pg_publication_tables`, RLS dump, triggers, cron, indexes, storage buckets) should be executed in the **Supabase SQL Editor** using the queries in this doc. This report uses **generated types** (`src/integrations/supabase/types.ts`) as the RPC catalog and **migrations** for RLS/trigger hints where live SQL was not executed here.

---

## 1. Edge Functions — inventory & web/native matrix

### 1a. Deployed functions (CLI)

35 ACTIVE functions (names match repo `supabase/functions/*`).

### 1b–1e. Per-function summary

| Function | Method | verify_jwt | Purpose (1-line) | Web | Native | External APIs |
|----------|--------|------------|------------------|-----|--------|---------------|
| account-pause | POST | true | Pause account | AuthContext | — | Supabase |
| account-resume | POST | true | Resume account | AuthContext | — | Supabase |
| admin-review-verification | POST | true | Admin photo verify actions | AdminPhotoVerificationPanel | — | Supabase |
| cancel-deletion | POST | true | Cancel scheduled deletion | useDeletionRecovery | useDeletionRecovery | Supabase |
| create-checkout-session | POST | true | Stripe subscription checkout | useSubscription | — | Stripe |
| create-credits-checkout | POST | true | Stripe credits checkout | Credits (invoke) | creditsCheckout (fetch) | Stripe |
| create-event-checkout | POST | true | Paid event checkout | PaymentModal | events/[id] | Stripe |
| create-portal-session | POST | true | Stripe customer portal | PremiumSettingsCard | settings/index | Stripe |
| create-video-upload | POST | true | Bunny Stream upload URL | VibeStudioModal (fetch) | vibeVideoApi (fetch) | Bunny Stream |
| daily-drop-actions | POST | true | Opener/reply on daily drop | useDailyDrop | dailyDropApi | RPC + optional notify |
| daily-room | POST | true | Daily.co room CRUD | useMatchCall, VideoDate | videoDateApi, matchCallApi | Daily |
| delete-account | POST | true | Delete user data | useDeleteAccount | — | Supabase + cascades |
| delete-vibe-video | POST | true | Remove vibe video | Profile (fetch) | vibeVideoApi (fetch) | Bunny |
| email-drip | POST | false | Drip emails | — (cron/external) | — | Resend |
| email-verification/* | POST | true | Send/verify email | useEmailVerification | EmailVerificationFlow | Resend |
| event-notifications | POST | true | Notify on event ops | Admin modals | — | OneSignal / notify |
| forward-geocode | POST | true | Address → lat/lng | AdminEventFormModal | — | (geocode svc) |
| generate-daily-drops | POST | false | Cron: generate drops | AdminDailyDropCard | — | Supabase |
| geocode | POST | true | Reverse geocode | Events, profileService | — | External geocode |
| phone-verify | POST | true | Twilio verify | PhoneVerification | PhoneVerificationFlow | Twilio |
| push-webhook | POST | false | FCM/APNS/web push ingest | Admin doc only | — | OneSignal path |
| request-account-deletion | POST | false | Start deletion window | DeleteAccountWeb (fetch) | account (invoke) | Supabase |
| revenuecat-webhook | POST | false | RC subscription events | — | — | RevenueCat |
| send-message | POST | true | Send chat (incl. media) | useMessages | chatApi | Supabase |
| send-notification | POST | true | Server push/email path | notifications.ts | — | OneSignal/Resend |
| stripe-webhook | POST | false | Stripe events | — | — | Stripe |
| swipe-actions | POST | true | Event deck swipe + notify | useSwipeAction | eventsApi | RPC + send-notification |
| unsubscribe | GET/POST | false | Email unsubscribe | — | — | HMAC + DB |
| upload-chat-video | POST | true | Chat video to Bunny | chatVideoUploadService (fetch) | chatMediaUpload (fetch) | Bunny |
| upload-event-cover | POST | true | Admin event cover | eventCoverUploadService | — | Bunny |
| upload-image | POST | true | Profile/photos upload | imageUploadService (fetch) | uploadImage (fetch) | Bunny CDN |
| upload-voice | POST | true | Voice note upload | voiceUploadService (fetch) | chatMediaUpload (fetch) | Storage/Bunny |
| verify-admin | POST | true | Admin gate | ProtectedRoute | — | Supabase |
| video-webhook | POST | false | Bunny video lifecycle | — | — | Bunny |
| vibe-notification | POST | true | Vibe nudge notify | useEventVibes | — | notify |

### Flags (§1e)

| Issue | Severity | Notes |
|-------|----------|-------|
| **Web-only invokes** (no native): `verify-admin`, `upload-event-cover`, `forward-geocode`, `event-notifications`, `admin-review-verification`, `create-checkout-session`, `vibe-notification`, `generate-daily-drops`, `send-notification`, `geocode`, `delete-account`, `account-pause`, `account-resume` | **LOW–MEDIUM** | Many intentional (admin, Stripe web, marketing). **MEDIUM:** `delete-account` / pause-resume — README defers native delete; users on app only lack parity. |
| **Native fetch vs web invoke** for same function: `upload-image`, `create-credits-checkout`, `create-video-upload`, `delete-vibe-video` | **LOW** | Same endpoints; ensure auth headers and error handling match. |
| **Neither client** (webhooks/cron): `stripe-webhook`, `revenuecat-webhook`, `video-webhook`, `push-webhook`, `email-drip`, `unsubscribe`, `generate-daily-drops` (only admin triggers from web) | OK | Expected server-to-server. |
| **Divergence:** `request-account-deletion` — web uses raw `fetch`, native uses `invoke` | **LOW** | Both hit same function; JWT differs (`verify_jwt=false` — must pass anon key + body correctly on web). |

**Recommendations**

1. Add native `delete-account` + `account-pause` / `account-resume` or deep-link to web for parity (**MEDIUM**).
2. If mobile needs city-scoped events like web, add `geocode` or reuse stored `location_data` consistently (**MEDIUM**, see §3).

---

## 2. RPC functions — inventory & usage matrix

### 2a. Catalog (from `Database["public"]["Functions"]` in types)

| RPC | Args (summary) | Returns |
|-----|----------------|---------|
| can_view_profile_photo | photo_owner_id | boolean |
| check_gender_compatibility | _viewer_id, _target_gender, _target_interested_in | boolean |
| check_mutual_vibe_and_match | p_session_id | Json |
| check_premium_status | p_user_id | boolean |
| deduct_credit | p_user_id, p_credit_type | boolean |
| drain_match_queue | p_event_id, p_user_id | Json |
| find_mystery_match | p_event_id, p_user_id | Json |
| find_video_date_match | p_event_id, p_user_id | Json |
| generate_recurring_events | p_parent_id, p_count? | number |
| get_event_deck | p_event_id, p_user_id, p_limit? | setof row |
| get_other_city_events | p_user_id, p_user_lat?, p_user_lng? | setof row |
| get_own_pii | p_user_id | setof row |
| get_user_subscription_status | p_user_id | string |
| get_visible_events | p_user_id, coords, p_is_premium? | setof row |
| handle_swipe | p_event_id, p_actor_id, p_target_id, p_swipe_type | Json |
| has_role | _user_id, _role | boolean |
| haversine_distance | lat/lng pairs | number |
| is_blocked | user1_id, user2_id | boolean |
| is_registered_for_event | _event_id, _user_id | boolean |
| join_matching_queue | p_event_id, p_user_id | Json |
| leave_matching_queue | p_event_id, p_user_id | Json |
| update_participant_status | p_event_id, p_user_id, p_status | void |
| daily_drop_transition | p_drop_id, p_action, p_text? | Json |
| ready_gate_transition | p_session_id, p_action, p_reason? | Json |
| video_date_transition | p_session_id, p_action, p_reason? | Json |

**Verify live DB:** run user’s SQL on `pg_proc` / `public` and diff to this list.

### 2b. Who calls what

| RPC | Web | Native |
|-----|-----|--------|
| get_visible_events | useVisibleEvents | eventsApi (`useEvents`, `fetchVisibleEventsList`) |
| get_other_city_events | useVisibleEvents | useOtherCityEvents |
| generate_recurring_events | Admin panels | **—** |
| check_premium_status | usePremium | **—** (native: RevenueCat / subscriptionApi) |
| get_event_deck | useEventDeck | eventsApi |
| drain_match_queue | useMatchQueue | eventsApi |
| find_mystery_match | useMysteryMatch | useMysteryMatch |
| update_participant_status | useEventStatus | videoDateApi |
| video_date_transition | VideoDate | videoDateApi |
| ready_gate_transition | useReadyGate | readyGateApi |
| daily_drop_transition | useDailyDrop | dailyDropApi (view/pass); opener/reply via **edge** |
| check_mutual_vibe_and_match | PostDateSurvey | videoDateApi |
| deduct_credit | useCredits | videoDateApi |
| leave_matching_queue | VideoDate | date/[id] |
| handle_swipe | **only via** swipe-actions EF | **only via** swipe-actions EF |

**Not referenced in src/ or apps/mobile/** (likely DB/trigger/internal): `join_matching_queue`, `find_video_date_match`, `can_view_profile_photo`, `check_gender_compatibility`, `get_own_pii`, `get_user_subscription_status`, `has_role`, `haversine_distance`, `is_blocked`, `is_registered_for_event` — confirm with SQL + grep before marking dead.

### 2c. Flags

| Issue | Severity |
|-------|----------|
| ~~Native skips `get_visible_events`~~ **RESOLVED** — native now calls `get_visible_events` RPC in `eventsApi.ts` (aligned with web) | **RESOLVED** |
| Native skips `check_premium_status` | **MEDIUM** — intentional if RevenueCat is source of truth; ensure `subscriptions` / RPC stay aligned |
| `generate_recurring_events` web-only | **LOW** (admin) |

**RESOLVED:** Native now uses `get_visible_events` in `apps/mobile/lib/eventsApi.ts` with the same params as web (user id, lat/lng, premium flag).

---

## 3. Database tables — CRUD highlights

**Methodology:** Full per-table grep matrix is huge; critical tables below. For exhaustive table list, run:

```sql
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
```

Then `grep -rn "from('TABLENAME')" src/` and `apps/mobile/`.

### 3b. Critical tables

| Table | Web pattern | Native pattern | Gap |
|-------|-------------|----------------|-----|
| **profiles** | Full editor (name, photos, vibes, prompts, lifestyle, geo, etc.) | profileApi updates subset; many reads are partial selects | **MEDIUM:** confirm every web-editable field exists on native edit screen |
| **matches** | useMatches + realtime | chatApi match channels + lists | Compare archived/expired handling |
| **messages** | useRealtimeMessages, send-message EF | chatApi + send-message EF | Align reactions, read receipts, video/voice types |
| **events** | get_visible_events RPC | Same RPC in `eventsApi` for browse list; detail/registered paths may still use direct `events` selects where appropriate | **RESOLVED** (browse list) |
| **event_registrations** | Web lobby flows | lobby.tsx + eventsApi | Compare queue_status updates |
| **video_sessions** | VideoDate + realtime | videoDateApi + realtime | Parity generally good |
| **daily_drops** | useDailyDrop + EF + RPC | dailyDropApi | Web has more RPC paths for transitions |
| **date_proposals** | Web schedule flow | useDateProposals / useScheduleProposals | Verify accept/decline parity |
| **subscriptions** | Stripe + check_premium_status | RevenueCat + subscriptionApi | **MEDIUM:** dual provider — document source of truth per platform |
| **user_credits** | useCredits + deduct_credit | videoDateApi deduct_credit | Ensure all credit spends use RPC |
| **blocked_users** | Web settings/chat | grep mobile for block flows | Verify INSERT/DELETE parity |
| **notification_preferences** | hooks + drawers | useNotificationPreferences + onesignal | **LOW:** column parity (e.g. mobile_onesignal_player_id) |
| **profile_vibes / vibe_tags** | Event + profile | events deck + profile | Native uses get_event_deck; verify vibe counts |

---

## 4. Realtime subscriptions

### 4a. Web (postgres_changes)

| Area | Table(s) | Files (examples) |
|------|----------|------------------|
| Matches | matches | useMatches |
| Messages | messages | useRealtimeMessages, vibelyService |
| Events | events | useEvents |
| Daily drop | daily_drops | useDailyDrop |
| Video session | video_sessions | VideoDate (timer), useReadyGate, IceBreakerCard |
| Match calls | match_calls | useMatchCall |
| Lobby / queue | matches, event_registrations | EventLobby, useMatchQueue |
| Premium / subscription | profiles? | usePremium, useSubscription |
| Admin | profiles, matches, events, … | useAdminRealtime |
| Push campaigns | push_notification_events | usePushNotificationEvents |
| Event lifecycle | events | useEventLifecycle |

### 4b. Native

| Area | Table | Files |
|------|-------|-------|
| Daily drop | daily_drops | dailyDropApi |
| Match calls | match_calls | useMatchCall |
| Video date | video_sessions | videoDateApi |
| Matches | matches | chatApi |
| Messages | messages | chatApi |
| Ready gate | video_sessions | readyGateApi |
| Lobby | event_registrations, video_sessions, events | lobby.tsx |

### 4c. Gaps

| Gap | Severity |
|-----|----------|
| Native missing: dedicated **match-queue** channel, **session timer** channel, **ice-breaker** questions channel, **premium/subscription** realtime, **admin** channels | **MEDIUM** — UX/feature parity |
| Web missing nothing critical that native has except same lobby patterns | — |

### 4d. Publication check

**Run in SQL Editor:**

```sql
SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY tablename;
```

Flag any table subscribed in code but not listed.

---

## 5. Storage & CDN

### 5a. Buckets (live)

```sql
SELECT name, public, file_size_limit, allowed_mime_types FROM storage.buckets;
```

### 5b–5c. Code

- **Web:** `storage.from` rare (e.g. signed URLs in AdminPhotoVerification); most uploads via Edge → Bunny.
- **Native:** No `storage.from` / `getPublicUrl` matches in grep — uploads via function URLs.

### 5d. Bunny / CDN

Grep patterns: `bunny`, `b-cdn`, `vibelymeet.com/photos`, `cdn.vibelymeet` in both trees — align env (`BUNNY_*` secrets on Edge; public URLs in app config).

### 5e. Flags

- **Web-only:** `upload-event-cover` — expected.
- Bucket mismatch: compare SQL bucket list to upload function paths.

---

## 6. RLS — native write verification

**Run:**

```sql
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, cmd;
```

**Hints from migrations:** `messages` policies restrict send to participants in match; UPDATE/DELETE own messages. Native uses **send-message** edge for sends — confirm edge uses user JWT + service logic vs direct insert.

**Spot-checks (confirm on live policies):**

| Operation | Risk |
|-----------|------|
| Native INSERT messages | If only direct insert, must satisfy RLS; if always EF, OK |
| Native UPDATE profiles | profileApi.update — column-level RLS if any |
| blocked_users, user_reports, match_mutes | grep native callers + match policy |
| event_registrations.queue_status | lobby updates |

---

## 7. Secrets & env

### 7a. Live secrets (CLI — names only)

Listed: `APP_URL`, `BUNNY_*`, `CRON_SECRET`, `DAILY_*`, `LOVABLE_API_KEY`, `ONESIGNAL_*`, `PUSH_WEBHOOK_SECRET`, `RESEND_API_KEY`, `REVENUECAT_WEBHOOK_AUTHORIZATION`, `STRIPE_*`, `SUPABASE_*`, `TWILIO_*`, `UNSUB_HMAC_SECRET`.

### 7b. Edge `Deno.env.get`

Grep: `supabase/functions/` — each function documents required secrets; cross-check all appear in secrets list (done above).

### 7c–7d. App env

- **Web:** `VITE_SUPABASE_*`, Stripe publishable if any, Daily domain — grep `import.meta.env` / `VITE_`.
- **Native:** `EXPO_PUBLIC_SUPABASE_*`, RevenueCat keys — grep `EXPO_PUBLIC_`.

### 7e. Flags

- **LOVABLE_API_KEY** in Edge secrets — confirm still needed; rotate if platform unused.
- No secret values committed in this audit grep scope; rotate if historical leaks suspected.

---

## 8. Triggers & cron

**Triggers:**

```sql
SELECT trigger_name, event_manipulation, event_object_table, action_statement
FROM information_schema.triggers WHERE trigger_schema = 'public' ORDER BY event_object_table;
```

**Cron:**

```sql
SELECT * FROM cron.job ORDER BY jobname;
```

(May error if `pg_cron` disabled — note in runbook.)

---

## 9. Indexes

**List:**

```sql
SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename;
```

**Hot paths to verify:**

- `messages(match_id, created_at)`
- `matches` for user_a / user_b OR pattern (often two indexes or expression)
- `event_registrations(event_id, profile_id)`
- `daily_drops` user pair + date
- `profiles(id)` PK
- `blocked_users(blocker_id)`

---

## Discrepancy summary by severity

| Severity | Count (approx.) | Themes |
|----------|-----------------|--------|
| **CRITICAL** | 0 | None identified without live RLS/publication SQL |
| **HIGH** | 0–1 | ~~Events listing~~ — resolved; remaining HIGH items need live SQL verification |
| **MEDIUM** | 4–6 | Premium source split; profile field parity; delete-account/pause native; realtime gaps; date_proposals |
| **LOW** | 10+ | Admin-only functions; fetch vs invoke; webhook-only functions |

---

## Top 10 action items

1. ~~**Align event discovery**~~ **DONE** — native uses `get_visible_events`. Next: run live SQL verification (RLS, publication).
2. **Document subscription truth:** See `docs/subscription-architecture.md`. **MEDIUM** (doc added; keep in sync with product)
3. **Native account lifecycle:** Pause/resume + scheduled deletion documented in app; immediate `delete-account` still web-only if needed. **LOW–MEDIUM**
4. **Realtime parity:** match queue, session timer, ice-breakers where product requires. **MEDIUM**
5. **Messages:** read receipts / reactions parity web vs native. **MEDIUM**
6. **Run live SQL pack:** RPC list, publication tables, RLS dump, indexes — attach diff to this doc. **HIGH** (process)
7. **Blocked / reports:** Ensure native flows hit same tables/policies as web. **MEDIUM**
8. **Credits:** Audit all spend paths use `deduct_credit`. **LOW–MEDIUM**
9. **Prune or document unused RPCs** (`join_matching_queue`, etc.). **LOW**
10. **Remove or justify LOVABLE_API_KEY** in secrets. **LOW**

**Immediate vs deferred**

- **Immediate:** Live SQL verification (RLS + publication). Event listing parity with web is **done**.
- **Deferred:** Admin-only gaps, LOVABLE key, nice-to-have realtime on mobile.

---

*Generated as part of backend vs frontend audit. Re-run greps and SQL after major releases.*
