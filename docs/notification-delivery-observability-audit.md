# Notification Delivery Observability Audit

Date: 2026-04-29
Scope: repo-only investigation. External OneSignal, Sentry, PostHog, Supabase production logs, and provider dashboards were not queried.

## Executive Summary

Vibely can currently diagnose several backend-side notification outcomes from `notification_log`: user disabled push, account pause, notification pause, quiet hours, match mute, unknown category, blocked pair, no player ID, and OneSignal API failures. The recent `no_player_id` diagnostic is present and useful because it records web/mobile player presence and subscription booleans without writing raw player IDs into `notification_log.data`.

The main observability gap is end-to-end correlation. For the common support question "I did not get the notification", there is no single durable record that joins client permission state, SDK init state, local player ID health, backend player persistence, suppression gate, OneSignal request attempt/status, provider notification ID, platform targeted, deep-link validity, and tap/open outcome.

The smallest safe follow-up is a code-only observability PR that enriches existing logs and telemetry. It should add structured, non-sensitive diagnostics to `notification_log.data`, emit redacted PostHog/Sentry events for client permission/sync failures, and document support SQL query patterns. It should not add new tables or make normal send success depend on `push-webhook`.

## Current Delivery Pipeline Map

### 1. Web Client Permission And Sync

- `src/main.tsx` initializes Sentry, PostHog, and OneSignal on allowed hosts through `initOneSignal()`.
- `src/lib/oneSignalWebOrigin.ts` allows localhost plus the apex and `www` Vibely hosts; canonical runtime URL generation is guarded separately by `npm run check:canonical-origin`.
- `src/lib/onesignal.ts` handles OneSignal init, legacy service worker cleanup, click navigation, subscription-change events, external user login/logout, and player ID polling.
- `src/lib/requestWebPushPermission.ts` prompts OneSignal, waits for init, calls `setExternalUserId(userId)`, polls `OneSignal.User.PushSubscription.id`, checks `optedIn`, and upserts `notification_preferences.onesignal_player_id`, `onesignal_subscribed`, and `push_enabled`.
- `src/hooks/usePushDeliveryHealth.ts` computes web health from browser permission, SDK status, local OneSignal player ID, backend player ID, backend subscribed boolean, sync status, and last sync result.
- `src/hooks/useAppBootstrap.ts` identifies PostHog/Sentry users, logs OneSignal in, and opportunistically syncs web push registration after auth. `src/contexts/AuthContext.tsx` logs OneSignal out and clears the web player ID on logout.

### 2. Native Client Permission And Sync

- `apps/mobile/components/PushRegistration.tsx` initializes OneSignal, binds the external user, applies tags, and runs foreground sync.
- `apps/mobile/lib/osPushPermission.ts` treats OneSignal native permission APIs as canonical OS permission state and request path.
- `apps/mobile/lib/requestPushPermissions.ts` owns preprompt gating, OS permission request, `push_enabled` upsert, and post-grant backend sync.
- `apps/mobile/lib/onesignal.ts` logs in/out of OneSignal, polls the native subscription ID, reads opt-in state, and upserts `notification_preferences.mobile_onesignal_player_id` and `mobile_onesignal_subscribed`.
- `apps/mobile/lib/usePushDeliveryHealth.ts` computes native health from OS permission, SDK state, local player ID, SDK subscribed state, backend mobile player ID, backend subscribed state, and last sync result.
- `apps/mobile/context/AuthContext.tsx` logs OneSignal out and clears the mobile player ID on logout.

### 3. Backend Send Request

- `supabase/functions/send-notification/index.ts` accepts service-role or valid user JWT callers, validates `user_id` and `category`, applies title/body templates when needed, reads preferences, runs suppression gates, gathers player IDs, sends OneSignal REST API requests, and writes `notification_log`.
- Common producers call `send-notification`: `send-message`, `swipe-actions`, `daily-drop-actions`, `generate-daily-drops`, `date-suggestion-actions`, `date-suggestion-expiry`, `daily-room`, `event-reminders`, `date-reminder-cron`, `post-date-verdict`, `post-date-verdict-reminders`, `process-waitlist-promotion-notify-queue`, `stripe-webhook`, `send-support-reply`, `send-game-event`, `src/hooks/useEventVibes.ts`, and admin event controls through `src/lib/notifications.ts`.
- Many producer paths intentionally treat notification failures as non-critical. Some only catch thrown transport errors and do not inspect a `success:false` logical result from `send-notification`.

### 4. Suppression Gates In `send-notification`

Current durable `suppressed_reason` values include:

- `blocked_pair`
- `no_preferences`
- `account_paused`
- `paused`
- `user_disabled`
- `unknown_category`
- `match_muted`
- `quiet_hours`
- `no_player_id`
- `onesignal_http_<status>`
- `onesignal_empty_notification_id`
- `onesignal_errors_array`
- `onesignal_errors_object`

Important nuance: `user_disabled` is used for both the master `push_enabled` toggle and category-specific `notify_*` toggles, so support must inspect preferences manually to distinguish them.

### 5. OneSignal Send

- The backend uses `https://api.onesignal.com/notifications`.
- It sends `include_player_ids` containing all registered web and mobile player IDs that are marked subscribed in `notification_preferences`.
- It sets `data` and `url`, with `url` built from `APP_URL` or the default `https://www.vibelymeet.com`.
- It returns `onesignal_id` to the caller on success, but does not persist that ID in `notification_log`.
- It logs `console.log('OneSignal:', status, notificationId || 'no-id')`, but this is not support-queryable from the database.

### 6. App Log Tables And Admin Surfaces

- `notification_preferences` is the source of backend deliverability: web player ID/subscribed, mobile player ID/subscribed, `push_enabled`, pause, quiet hours, category toggles, and message bundling.
- `notification_log` records transactional sends and suppressions with `user_id`, `category`, `title`, `body`, `data`, `delivered`, `suppressed_reason`, and `created_at`. It has indexes on `(user_id, category, created_at desc)` and `created_at`.
- `push_campaigns` and `push_notification_events` are campaign/admin telemetry tables, not the transactional `send-notification` ledger.
- `push_notification_events_admin` redacts FCM/APNs/device token fields for admin reads.
- `src/components/admin/AdminLiveEventMetrics.tsx` queries `notification_log` by `data->>event_id` for event lifecycle diagnostics.
- `src/hooks/usePushNotificationEvents.ts` and `src/hooks/usePushAnalytics.ts` visualize `push_notification_events`, but those rows are not populated by normal `send-notification` sends.
- `src/components/admin/AdminPushCampaignsPanel.tsx` creates `push_campaigns` rows and inserts `push_notification_events` rows with `status='queued'`, but the inspected code does not send OneSignal pushes for those campaign rows.
- `notification_outbox` appears in generated Supabase types and prior docs, but current repo searches did not find active Edge Function usage in the delivery path.

### 7. Provider/Webhook Telemetry

- `supabase/functions/push-webhook/index.ts` is present and listed in `supabase/config.toml` with `verify_jwt = false`.
- It requires `PUSH_WEBHOOK_SECRET`, parses generic FCM/APNs/Web payloads, and updates/inserts `push_notification_events`.
- `src/components/admin/LiveNotificationMonitor.tsx` documents webhook endpoints for FCM, APNs, and web push.
- Repo evidence does not show provider-dashboard wiring, OneSignal webhook wiring, or a durable join from `send-notification` to `push_notification_events`.
- Because transactional sends do not write `push_notification_events`, `push-webhook` should be treated as separate/admin telemetry until proven wired and correlated.

### 8. Click And Deep-Link Handling

- Web click handling in `src/lib/onesignal.ts` reads `event.notification.data.url` and sets `window.location.href`.
- Native click handling in `apps/mobile/components/NotificationDeepLinkHandler.tsx` reads `additionalData.url`, `deep_link`, `deepLink`, or `launchURL`, queues links while auth/entry state is not ready, reconciles `/date/:id` links with backend truth, and routes via expo-router.
- Native foreground suppression prevents duplicate chat banners when the user is already in the target chat thread.
- Native deep-link handling emits Sentry breadcrumbs under `rc.notif.deep_link`.
- Web click handling has no PostHog event, Sentry breadcrumb, or durable DB event.

## Current Observability Inventory

| Stage | What is logged | Where | Fields captured | Safe user/device/platform ID? | Support/admin queryable? |
| --- | --- | --- | --- | --- | --- |
| Web OneSignal init | Opt-in debug logs; one Sentry capture if top-level init throws | Browser console via `vibelyOsLog`; Sentry from `src/main.tsx` | origin, app ID tail, SDK status, init error string | User only partially identified by current Sentry/PostHog session; no player ID except local debug paths | No, unless debug console or Sentry issue exists |
| Web permission prompt | Prompt grant/defer in one prompt component; detailed sync result only local | PostHog `push_permission_granted`, `push_permission_deferred`; console/debug | grant/defer; sync codes in console/debug only | No raw player ID in PostHog; debug can show local state | Partial: PostHog only says grant/defer, not sync failure reason |
| Web push health | Full computed health in React state | UI/settings only | permission, SDK, local/backend player comparison, subscribed booleans, last sync result | Does not expose raw player ID in UI; backend row has raw player ID | No durable support history |
| Native permission prompt | Dev-only logs and UI state | Dev console via `pushPermDevLog` | OS state, prompt suppression reasons, request result | No raw player ID in prompt logs | No in production |
| Native push sync | Dev-only logs; backend preference row | Dev console; `notification_preferences` | player ID/subscribed booleans in DB, sync result in memory | Raw mobile player ID stored in DB; not duplicated in logs | DB queryable, but no durable sync attempt history |
| Backend suppression | Durable log row | `notification_log` | user, category, title, body, data, delivered=false, reason | User identifiable; no raw player ID in new no-player diagnostic | Yes for admins/service queries |
| Backend no player ID | Durable diagnostic | `notification_log.data.push_delivery_diagnostic` | web/mobile player present booleans, subscribed booleans, `push_enabled` | Safe: booleans only | Yes |
| Backend OneSignal attempt | Console plus success/failure row | Edge console; `notification_log` | HTTP status in suppression reason on failure; notification ID only console/response | No raw player IDs in DB log; request used raw IDs | Partially: DB cannot show provider notification ID on success |
| Provider delivery/open/click | Separate webhook model | `push_notification_events` if webhook/campaign path writes it | status, platform, timestamps, error codes; admin view masks tokens | Admin view redacts token/id fields | Yes for campaign/webhook rows, not transactional sends |
| Event lifecycle sends | Queue and send logs | `event_reminder_queue`, `waitlist_promotion_notify_queue`, `notification_log`, structured Edge console | queue IDs, event ID, admission status, result, reason | User IDs only; no raw player IDs | Good for event-specific admin view |
| Deep-link tap | Native breadcrumbs only; web direct navigation | Sentry breadcrumbs native; none durable web | href/path, date route decision, fallback reason | Native sanitizer applies; paths may include UUIDs | Sentry only, no DB/PostHog ledger |
| Canonical origin | Static guard | `npm run check:canonical-origin` | source text violations | Not user/device scoped | CI/local only |

## Gap Analysis

### P0: Impossible To Diagnose Common Production Failures Quickly

1. No durable client permission/sync history.
   - Support cannot query whether a user's browser/OS permission was denied, whether OneSignal SDK init failed, whether the local player ID existed, whether sync returned `stale_identity`, or whether an upsert failed at the time the user missed a push.

2. No persisted provider correlation for transactional sends.
   - Successful `send-notification` rows do not store `onesignal_id`, provider HTTP status, target platform summary, attempted player count, or provider logical failure detail in a structured DB field.

3. No open/click telemetry for transactional sends.
   - `push_notification_events` can model opened/clicked, but normal `send-notification` does not write rows there and click handlers do not update a durable event. "Sent but not opened/clicked" cannot be answered for transactional notifications.

4. Native-vs-web mismatch is not visible on successful sends.
   - On `no_player_id`, the diagnostic records web/mobile presence. On accepted sends, the log does not show whether web, mobile, or both were targeted.

5. Bad deep link or wrong origin is not logged at send time.
   - The send path builds `url` but does not persist `deeplink_url_present`, normalized path, `canonical_origin_valid`, or whether the deep link was absolute, relative, missing, or invalid.

### P1: Diagnosable But Slow Or Manual

1. `user_disabled` is overloaded.
   - Master push disabled and category disabled both log `user_disabled`. Support must inspect `notification_preferences` and category mapping manually.

2. Producer-level notification status can be misleading.
   - Several producers ignore logical `success:false` results from `send-notification`; the real outcome is in `notification_log`, not the producer log. No evidence was found that recent push-health work broke sends silently, but upstream "notify_sent" style logs can overstate success.

3. `push-webhook` is present but not proven correlated.
   - The function is configured and documented in admin UI, but repo evidence does not prove external provider wiring or a join key to OneSignal transactional sends.

4. Support/admin query path is fragmented.
   - Event lifecycle has an admin surface, but general user notification troubleshooting requires manual queries across `notification_preferences`, `notification_log`, `match_notification_mutes`, producer queues, and possibly PostHog/Sentry.

5. Raw message copy in `notification_log`.
   - Current `notification_log.title` and `body` can include message previews. This makes diagnosis easier but increases privacy risk and should not be expanded.

6. Campaign telemetry is easy to confuse with transactional delivery.
   - Admin push campaign events use `push_notification_events`, but inspected code only inserts queued rows and does not send OneSignal pushes in that path.

### P2: Nice-To-Have/Admin Polish

1. Add an admin/support "delivery explain" view after structured diagnostics exist.
2. Add saved SQL snippets or docs for support triage by `user_id`, category, event ID, and match ID.
3. Add PostHog funnels for permission prompt impression, prompt result, sync result, and notification tap.
4. Add dashboard labels that distinguish "provider accepted" from "delivered to device".

## Privacy And Security Review

### Current Sensitive Data

- Full OneSignal player IDs are stored in `notification_preferences.onesignal_player_id` and `mobile_onesignal_player_id`.
- `notification_log` stores `title` and `body`; message notifications can include previews or media labels.
- `notification_log.data` may contain user/profile UUIDs, match IDs, event IDs, session IDs, and deep-link paths.
- `send-notification` returns provider error snippets to callers on OneSignal failures. Provider responses should be treated as potentially sensitive because they may include invalid identifier details.
- Sentry web and native initialization removes email and IP from user payloads. Native diagnostic breadcrumbs use a sanitizer helper for RC breadcrumbs.

### Redaction Rules For Follow-Up Work

- Never write raw OneSignal player IDs to `notification_log`, PostHog, or Sentry. Use booleans, counts, or a short salted hash if correlation is truly needed.
- Do not log `ONESIGNAL_REST_API_KEY`, Supabase service role keys, auth headers, session tokens, provider authorization headers, or signed URLs.
- Do not add message content or notification body copies to new analytics. Existing `notification_log.body` already carries this risk; new diagnostics should use category and structural IDs only.
- For deep links, store presence, route class, canonical-origin validity, and path only when needed. Avoid query strings unless they are explicitly non-sensitive.
- Redact provider error details before returning them to non-service callers or before writing them to analytics.

## Minimal Implementation Plan

Recommended next PR: small code observability PR.

1. Enrich `notification_log.data.push_delivery_diagnostic` for every `send-notification` outcome.
   - Add structured fields listed in the suggested contract below.
   - Include player presence booleans and target counts for both suppressed and accepted sends.
   - Store provider request status and normalized error code, not raw provider payloads.
   - Persist `onesignal_id` in `notification_log.data.provider_notification_id` or a redacted/hash field if full IDs are considered sensitive.

2. Normalize suppression reasons.
   - Split `user_disabled` into `push_disabled` and `category_disabled`, or add `suppression_gate`/`preference_column` while keeping existing `suppressed_reason` for compatibility.

3. Add client telemetry for permission and sync.
   - Web: emit PostHog events and Sentry breadcrumbs for prompt result, SDK init failure, sync result code, no local player ID after retry, upsert failure, and stale identity.
   - Native: mirror the same event names/properties from OS permission and sync paths.
   - Use only non-sensitive metadata: platform, permission state, SDK status, sync result code, backend/local presence booleans, and route/surface.

4. Add tap/deep-link telemetry.
   - Web: add Sentry breadcrumb and PostHog event when a notification click has no URL, routes to a non-canonical URL, or navigates successfully.
   - Native: keep existing Sentry breadcrumbs and add matching PostHog events with sanitized route class.

5. Document support queries.
   - Add query snippets for recent sends/suppressions by user, event, category, and match.
   - Explicitly state that `push_notification_events` is not authoritative for transactional sends unless a future PR wires correlation.

Avoid in the next PR:

- New tables.
- Admin dashboard redesign.
- Requiring `push-webhook` telemetry before a normal send is considered diagnosable.
- Logging full player IDs, tokens, auth headers, notification body text in analytics, or raw provider error bodies.

## Suggested Event And Schema Contract

Recommended diagnostic fields for `notification_log.data.push_delivery_diagnostic`:

```json
{
  "notification_category": "messages",
  "target_user_id": "<uuid>",
  "platform_targeted": ["web", "native"],
  "web_player_present": true,
  "web_player_subscribed": true,
  "mobile_player_present": false,
  "mobile_player_subscribed": false,
  "player_target_count": 1,
  "suppression_reason": null,
  "suppression_gate": null,
  "preference_column": "notify_messages",
  "provider_request_attempted": true,
  "provider_status": "accepted",
  "provider_http_status": 200,
  "provider_error_code": null,
  "deeplink_url_present": true,
  "deeplink_route_class": "chat",
  "canonical_origin_valid": true,
  "client_health_status": null,
  "sync_result_code": null
}
```

Recommended PostHog event names:

- `push_permission_prompt_result`
- `push_registration_sync_result`
- `push_delivery_health_observed`
- `push_notification_tap`
- `push_notification_deeplink_result`

Recommended shared event properties:

- `platform`: `web` or `native`
- `surface`: `dashboard`, `settings`, `bootstrap`, `foreground_sync`, `notification_click`
- `permission_state`
- `sdk_status`
- `client_health_status`
- `sync_result_code`
- `backend_player_present`
- `local_player_present`
- `backend_subscribed`
- `provider_request_attempted`
- `deeplink_url_present`
- `deeplink_route_class`
- `canonical_origin_valid`

Do not include:

- Raw player IDs.
- Notification body or message preview.
- Auth/session tokens.
- Full external URLs with sensitive query strings.

## Support Query Patterns

Recent backend outcomes for one user:

```sql
select
  created_at,
  category,
  delivered,
  suppressed_reason,
  data->'push_delivery_diagnostic' as push_delivery_diagnostic
from notification_log
where user_id = '<user_id>'
order by created_at desc
limit 50;
```

Current backend deliverability for one user:

```sql
select
  user_id,
  push_enabled,
  paused_until,
  quiet_hours_enabled,
  quiet_hours_start,
  quiet_hours_end,
  quiet_hours_timezone,
  onesignal_player_id is not null as web_player_present,
  onesignal_subscribed as web_subscribed,
  mobile_onesignal_player_id is not null as mobile_player_present,
  mobile_onesignal_subscribed as mobile_subscribed
from notification_preferences
where user_id = '<user_id>';
```

Recent event notification outcomes:

```sql
select
  created_at,
  user_id,
  category,
  delivered,
  suppressed_reason,
  data->>'event_id' as event_id,
  data->>'admission_status' as admission_status,
  data->>'queue_id' as queue_id
from notification_log
where data->>'event_id' = '<event_id>'
order by created_at desc
limit 100;
```

Match mute check:

```sql
select *
from match_notification_mutes
where user_id = '<user_id>'
  and match_id = '<match_id>'
order by created_at desc;
```

## Test Plan For The Implementation PR

Unit/static tests:

- Assert `send-notification` writes diagnostics for `no_player_id`, including web/mobile presence and subscribed booleans.
- Assert master disabled and category disabled are distinguishable in structured diagnostics.
- Assert quiet hours diagnostics include gate/reason without writing raw player IDs.
- Assert match mute diagnostics include `match_muted` and do not include message content.
- Assert provider API failure maps to stable `provider_error_code` and redacts provider body.
- Assert valid send writes `provider_request_attempted=true`, `provider_status=accepted`, `platform_targeted`, and `player_target_count`.
- Assert bad/missing deep link records `deeplink_url_present=false` or `canonical_origin_valid=false`.
- Assert web/native target behavior records web-only, native-only, both, and no-player cases.

Integration/manual tests:

- Web denied permission: deny browser prompt, verify PostHog/Sentry event has permission denied and no raw player ID.
- Web OneSignal init blocked: run on unsupported host, verify `sdk_status=unsupported_host` telemetry.
- Web no local player ID: simulate no `PushSubscription.id`, verify `sync_result_code=no_player_id_after_retry`.
- Native OS denied: deny prompt, verify telemetry and settings recovery surface.
- Native sync after login/logout/login: verify stale identity does not leave old backend player ID and telemetry uses `stale_identity` only when applicable.
- User disabled push: set `push_enabled=false`, trigger send, verify `notification_log` reason and diagnostic gate.
- Category disabled: disable `notify_messages`, send message notification, verify category gate and column.
- Quiet hours: enable quiet hours covering current time, verify suppression.
- Match muted: create `match_notification_mutes` row, send message/date suggestion, verify suppression.
- Provider API failure: use invalid OneSignal key or mocked fetch, verify redacted provider diagnostic.
- Valid send: trigger message/daily drop/event reminder, verify accepted provider diagnostic and no new table requirement.
- Bad/missing deep link: send payload with missing/invalid URL, verify diagnostic and click handler telemetry.

## Final Recommendation

Proceed with a small code observability PR next.

Do not stop at docs/query-only changes because the current durable logs still cannot answer client permission, SDK init, sync failure, provider notification ID, platform targeting, or open/click questions quickly.

Do not start with larger admin dashboard work. Dashboard polish should wait until the structured diagnostic contract exists.

No new tables are necessary for the next PR. Use existing `notification_log.data` and existing analytics/Sentry plumbing first. Revisit `push_notification_events` only if Vibely intentionally wants transactional provider/open/click tracking with a stable correlation key.

## Validation For This Audit

- Repo-only searches and file inspection were used.
- `git diff --check` should pass for the documentation-only change.
- No product code, Supabase migrations, generated types, package scripts, or native files were changed.
- No build, Supabase deploy, DB migration, or native release is required for this audit document.
