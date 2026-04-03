# VIBELY — SCHEMA APPENDIX

**Date:** 2026-03-10  
**Baseline:** `vibelymeet-pre-native-hardening-golden-2026-03-10.zip`  
**Primary sources:**
- `src/integrations/supabase/types.ts`
- `supabase/migrations/*.sql`

---

## 1. Purpose

This appendix is the human-readable schema companion to the audited golden snapshot and rebuild runbook.

It is meant to answer:
- what database objects exist in the frozen baseline
- what storage buckets exist
- what typed SQL/RPC surfaces exist
- which tables anchor the core product flows

This document is optimized for rebuild and maintenance work. For exact TypeScript row/insert/update typings, the canonical source remains:

- `src/integrations/supabase/types.ts`

---

## 2. Schema summary

### Public schema object counts

- **41 public tables**
- **1 public view**
- **22 typed public SQL functions / RPC surfaces**
- **3 public enums**
- **6 storage buckets referenced by migrations**

### Public enums

- `app_role` = `admin`, `moderator`, `user`
- `notification_platform` = `web`, `ios`, `android`, `pwa`
- `notification_status` = `queued`, `sending`, `sent`, `delivered`, `opened`, `clicked`, `failed`, `bounced`

### Public view

- `push_notification_events_admin`

### Important caveat

The generated Supabase types are the best single machine-readable schema artifact in the repo, but they are not a perfect substitute for migration review.

In particular:
- some semantic relationships are obvious from naming but not fully expressed in type metadata
- storage behavior is defined in migrations, not in `types.ts`
- policy intent and actual runtime behavior are not always identical

### Phase 2 events hardening delta (2026-04-04)

Migration `20260404195500_phase2_queue_ttl_ready_gate_sync_daily_gate.sql` introduces a server-owned queued expiry path and readiness sync improvements:
- `video_sessions.queued_expires_at` is now the canonical queued-match TTL field (10 minutes).
- `expire_stale_video_sessions()` owns queued TTL expiry, ready-gate expiry, and snooze wake-up transitions.
- `ready_gate_transition` now supports `sync` action for deterministic client polling fallback.

Edge function gate tightening:
- `supabase/functions/daily-room/index.ts` now issues Daily room tokens only when session is active (`handshake`/`date`/rejoin) or when `ready_gate_status = 'both_ready'` and `ready_gate_expires_at` is still valid.

### Phase 3 events hardening delta (2026-04-04)

Migration `20260412143000_phase3_legacy_queue_contract_cleanup.sql` consolidates queue-era compatibility surfaces and active contracts:
- `handle_swipe` and `drain_match_queue` are explicitly re-anchored to active swipe-first + queued-TTL semantics, including strict 60-second lobby foreground proof for immediate ready gate.
- Active payload contract remains `video_session_id` + `event_id`; `match_id` stays as a legacy alias for compatibility only.
- Legacy queue RPC surfaces are now compatibility-only:
  - `join_matching_queue` → deprecated no-op
  - `find_video_date_match` → deprecated no-op
  - `leave_matching_queue` → retained compatibility cleanup path, marked deprecated in response/comment

---

## 3. Storage buckets and media schema surfaces

The frozen migration set references the following storage buckets.

### `profile-photos`
- Purpose: user profile photos
- Access intent from migrations:
  - users upload / update / delete their own files
  - photo viewing is mediated by helper function `can_view_profile_photo(...)`
- Important nuance:
  - bucket was made private, then later set public again so `getPublicUrl` worked reliably
  - rebuild operator should verify the live exposure model carefully

### `proof-selfies`
- Purpose: selfie proof / photo verification evidence
- Access intent:
  - users upload their own proof selfie
  - users view their own proof selfie
  - admins may view all proof selfies
- Intended sensitivity: private / audit-only

### `vibe-videos`
- Purpose: user intro / vibe videos
- Access intent evolved over time:
  - originally public
  - later made private with more selective policies
  - later authenticated viewers were allowed to view most intro videos except moderation/admin/private paths
- Rebuild implication:
  - this bucket has the most policy history and should be validated after migration replay

### `event-covers`
- Purpose: event cover art
- Access intent:
  - admin upload / update / delete
  - public read

### `voice-messages`
- Purpose: audio attachments in chat
- Access intent:
  - users upload into their own namespace
  - read is broadly allowed by policy

### `chat-videos`
- Purpose: video attachments in chat / matches
- Access intent:
  - upload allowed to users participating in the relevant match namespace
  - authenticated read allowed by policy

---

## 4. Public SQL functions / RPC surfaces

The generated type surface exposes the following public functions.

### Access / privacy / roles
- `can_view_profile_photo(photo_owner_id)` → `boolean`
- `has_role(_role, _user_id)` → `boolean`
- `is_blocked(user1_id, user2_id)` → `boolean`
- `is_registered_for_event(_event_id, _user_id)` → `boolean`
- `get_own_pii(p_user_id)` → `{ phone_number, phone_verified, verified_email }[]`

### Matching / eligibility / swiping
- `check_gender_compatibility(_target_gender, _target_interested_in, _viewer_id)` → `boolean`
- `handle_swipe(p_actor_id, p_event_id, p_swipe_type, p_target_id)` → `Json`
- `check_mutual_vibe_and_match(p_session_id)` → `Json`
- `find_mystery_match(p_event_id, p_user_id)` → `Json`
- `find_video_date_match(p_event_id, p_user_id)` → `Json` (deprecated compatibility no-op)
- `join_matching_queue(p_event_id, p_user_id)` → `Json` (deprecated compatibility no-op)
- `leave_matching_queue(p_event_id)` → `Json` (deprecated compatibility surface; retained cleanup behavior for older clients)
- `drain_match_queue(p_event_id)` → `Json`
- `update_participant_status(p_event_id, p_status)` → `undefined` (activity/status update only)
- `mark_lobby_foreground(p_event_id)` → `undefined` (canonical 60s lobby-foreground presence proof)

### Events / deck generation / discovery
- `get_event_deck(p_event_id, p_limit?, p_user_id)` → deck rows containing profile-level event card data
- `get_visible_events(p_user_id, p_user_lat?, p_user_lng?, p_browse_lat?, p_browse_lng?, p_is_premium?)` → visible event rows with location and registration state
- `get_other_city_events(p_user_id, p_user_lat?, p_user_lng?)` → city-level event summaries
- `generate_recurring_events(p_parent_id, p_count?)` → `number`
- `haversine_distance(lat1, lat2, lng1, lng2)` → `number`

### Premium / credits
- `check_premium_status(p_user_id)` → `boolean`
- `get_user_subscription_status(p_user_id)` → `string`
- `deduct_credit(p_credit_type, p_user_id)` → `boolean`

---

## 5. Public view

## `push_notification_events_admin`

This is the only typed public view in the generated schema.

### Columns
- `id`
- `campaign_id`
- `user_id`
- `platform`
- `status`
- `queued_at`
- `sent_at`
- `delivered_at`
- `opened_at`
- `clicked_at`
- `created_at`
- `error_code`
- `error_message`
- `apns_message_id`
- `fcm_message_id`
- `device_token`

### Notes
- `campaign_id` links back to `push_campaigns`
- the view is clearly intended as an admin-safe / redacted reporting surface over push delivery events

---

## 6. Table catalog by domain

## A. Identity, profiles, trust, and verification

### `profiles`
Primary user profile table and the central product identity surface.

**Columns**
- `id`
- `name`
- `age`
- `birth_date`
- `gender`
- `interested_in`
- `looking_for`
- `tagline`
- `bio`
- `about_me`
- `job`
- `company`
- `height_cm`
- `country`
- `location`
- `location_data`
- `avatar_url`
- `photos`
- `prompts`
- `lifestyle`
- `vibe_caption`
- `bunny_video_uid`
- `bunny_video_status`
- `vibe_video_status`
- `email_verified`
- `verified_email`
- `email_unsubscribed`
- `phone_number`
- `phone_verified`
- `phone_verified_at`
- `photo_verified`
- `photo_verified_at`
- `photo_verification_expires_at`
- `proof_selfie_url`
- `is_premium`
- `premium_until`
- `premium_granted_at`
- `premium_granted_by`
- `is_suspended`
- `suspension_reason`
- `referred_by`
- `events_attended`
- `total_matches`
- `total_conversations`
- `last_seen_at`
- `created_at`
- `updated_at`

### `email_verifications`
Email verification code lifecycle.

**Columns**
- `id`
- `user_id`
- `email`
- `code`
- `expires_at`
- `verified_at`
- `created_at`

### `photo_verifications`
Photo/selfie verification workflow state.

**Columns**
- `id`
- `profile_photo_url`
- `selfie_url`
- `status`
- `client_match_result`
- `client_confidence_score`
- `rejection_reason`
- `reviewed_by`
- `reviewed_at`
- `expires_at`
- `created_at`
- `user_id`

### `verification_attempts`
Simple anti-abuse / verification-attempt logging.

**Columns**
- `id`
- `user_id`
- `attempt_at`
- `ip_address`

### `age_gate_blocks`
Records users blocked by age-gating.

**Columns**
- `id`
- `user_id`
- `date_of_birth`
- `blocked_at`

### `blocked_users`
User-to-user blocks.

**Columns**
- `id`
- `blocker_id`
- `blocked_id`
- `reason`
- `created_at`

### `vibe_tags`
Master table for vibe-tag taxonomy.

**Columns**
- `id`
- `label`
- `emoji`
- `category`
- `created_at`

### `profile_vibes`
Join table linking profiles to vibe tags.

**Columns**
- `id`
- `profile_id`
- `vibe_tag_id`
- `created_at`

**Typed foreign keys**
- `profile_id` → `profiles.id`
- `vibe_tag_id` → `vibe_tags.id`

---

## B. Events, registrations, swipes, and live sessions

### `events`
Master event table supporting physical / scoped / recurring events.

**Columns**
- `id`
- `title`
- `description`
- `cover_image`
- `tags`
- `vibes`
- `event_date`
- `duration_minutes`
- `status`
- `scope`
- `visibility`
- `city`
- `country`
- `location_name`
- `location_address`
- `latitude`
- `longitude`
- `radius_km`
- `is_location_specific`
- `is_free`
- `price_amount`
- `price_currency`
- `max_attendees`
- `current_attendees`
- `max_female_attendees`
- `max_male_attendees`
- `max_nonbinary_attendees`
- `is_recurring`
- `parent_event_id`
- `occurrence_number`
- `recurrence_type`
- `recurrence_days`
- `recurrence_count`
- `recurrence_ends_at`
- `created_at`
- `updated_at`
- `ended_at`
- `archived_at`
- `archived_by`

**Typed foreign keys**
- `parent_event_id` → `events.id`

### `event_registrations`
Per-user event attendance and queueing state.

**Columns**
- `id`
- `event_id`
- `profile_id`
- `registered_at`
- `payment_status`
- `queue_status`
- `joined_queue_at`
- `last_active_at`
- `last_matched_at`
- `current_partner_id`
- `current_room_id`
- `dates_completed`
- `attended`
- `attendance_marked`
- `attendance_marked_at`
- `attendance_marked_by`

**Typed foreign keys**
- `event_id` → `events.id`
- `profile_id` → `profiles.id`

### `event_swipes`
Directional swipes taken within an event deck.

**Columns**
- `id`
- `event_id`
- `actor_id`
- `target_id`
- `swipe_type`
- `created_at`

**Typed foreign keys**
- `event_id` → `events.id`
- `actor_id` → `profiles.id`
- `target_id` → `profiles.id`

### `event_vibes`
Event-context liking / vibe signal between users.

**Columns**
- `id`
- `event_id`
- `sender_id`
- `receiver_id`
- `created_at`

**Typed foreign keys**
- `event_id` → `events.id`
- `sender_id` → `profiles.id`
- `receiver_id` → `profiles.id`

### `video_sessions`
Core live-video date/session state machine.

**Columns**
- `id`
- `event_id`
- `participant_1_id`
- `participant_2_id`
- `daily_room_name`
- `daily_room_url`
- `phase`
- `started_at`
- `ended_at`
- `duration_seconds`
- `handshake_started_at`
- `date_started_at`
- `ready_gate_status`
- `ready_gate_expires_at`
- `ready_participant_1_at`
- `ready_participant_2_at`
- `participant_1_liked`
- `participant_2_liked`
- `snoozed_by`
- `snooze_expires_at`
- `vibe_questions`

**Typed foreign keys**
- `event_id` → `events.id`
- `participant_1_id` → `profiles.id`
- `participant_2_id` → `profiles.id`

### `date_feedback`
Post-date quality feedback tied to a video session.

**Columns**
- `id`
- `session_id`
- `liked`
- `energy`
- `conversation_flow`
- `honest_representation`
- `photo_accurate`
- `tag_fun`
- `tag_chemistry`
- `tag_safe`
- `tag_no_show`
- `tag_other`
- `created_at`
- `user_id`

**Typed foreign keys**
- `session_id` → `video_sessions.id`

### `date_proposals`
Post-match or match-context date proposal state.

**Columns**
- `id`
- `match_id`
- `proposer_id`
- `recipient_id`
- `activity`
- `proposed_date`
- `time_block`
- `status`
- `responded_at`
- `created_at`

**Typed foreign keys**
- `match_id` → `matches.id`

### `user_schedules`
Availability scheduling slots.

**Columns**
- `id`
- `user_id`
- `slot_date`
- `slot_key`
- `time_block`
- `status`
- `created_at`

---

## C. Matching, messaging, and daily-drop systems

### `matches`
Canonical 1:1 match table.

**Columns**
- `id`
- `event_id`
- `profile_id_1`
- `profile_id_2`
- `matched_at`
- `last_message_at`
- `archived_at`
- `archived_by`

**Typed foreign keys**
- `event_id` → `events.id`
- `profile_id_1` → `profiles.id`
- `profile_id_2` → `profiles.id`

### `messages`
Chat messages, now supporting text, voice, and video attachments.

**Columns**
- `id`
- `match_id`
- `sender_id`
- `content`
- `audio_url`
- `audio_duration_seconds`
- `video_url`
- `video_duration_seconds`
- `created_at`
- `read_at`

**Typed foreign keys**
- `match_id` → `matches.id`
- `sender_id` → `profiles.id`

### `match_calls`
Call records associated with a match.

**Columns**
- `id`
- `match_id`
- `caller_id`
- `callee_id`
- `call_type`
- `daily_room_name`
- `daily_room_url`
- `started_at`
- `ended_at`
- `duration_seconds`
- `status`
- `created_at`

**Typed foreign keys**
- `match_id` → `matches.id`
- `caller_id` → `profiles.id`
- `callee_id` → `profiles.id`

### `match_mutes`
Per-user muting state for a match.

**Columns**
- `id`
- `match_id`
- `user_id`
- `muted_until`
- `created_at`

**Typed foreign keys**
- `match_id` → `matches.id`

### `match_notification_mutes`
Per-user notification mute state for a match.

**Columns**
- `id`
- `match_id`
- `user_id`
- `muted_until`
- `created_at`

**Typed foreign keys**
- `match_id` → `matches.id`

### `daily_drops`
Timed daily-drop pairing / opener / reply mechanic.

**Columns**
- `id`
- `user_a_id`
- `user_b_id`
- `match_id`
- `drop_date`
- `starts_at`
- `expires_at`
- `status`
- `affinity_score`
- `pick_reasons`
- `user_a_viewed`
- `user_b_viewed`
- `opener_sender_id`
- `opener_text`
- `opener_sent_at`
- `reply_sender_id`
- `reply_text`
- `reply_sent_at`
- `chat_unlocked`
- `passed_by_user_id`
- `created_at`
- `updated_at`

**Typed foreign keys**
- `match_id` → `matches.id`

### `daily_drop_cooldowns`
Cooldowns to prevent repeat or undesired daily-drop pairings.

**Columns**
- `id`
- `user_a_id`
- `user_b_id`
- `reason`
- `cooldown_until`
- `created_at`

---

## D. Notifications, push, and outreach

### `notification_preferences`
Per-user notification routing and quiet-hours state.

**Columns**
- `id`
- `user_id`
- `push_enabled`
- `sound_enabled`
- `message_bundle_enabled`
- `onesignal_player_id`
- `onesignal_subscribed`
- `paused_until`
- `quiet_hours_enabled`
- `quiet_hours_start`
- `quiet_hours_end`
- `quiet_hours_timezone`
- `notify_messages`
- `notify_new_match`
- `notify_someone_vibed_you`
- `notify_daily_drop`
- `notify_event_reminder`
- `notify_event_live`
- `notify_date_reminder`
- `notify_ready_gate`
- `notify_recommendations`
- `notify_product_updates`
- `notify_credits_subscription`
- `created_at`
- `updated_at`

### `notification_log`
Application-level notification send log.

**Columns**
- `id`
- `user_id`
- `title`
- `body`
- `category`
- `data`
- `delivered`
- `suppressed_reason`
- `created_at`

### `admin_notifications`
Admin-facing notification feed.

**Columns**
- `id`
- `title`
- `message`
- `type`
- `data`
- `read`
- `created_at`

### `push_campaigns`
Admin-defined push campaigns / blasts.

**Columns**
- `id`
- `title`
- `body`
- `target_segment`
- `status`
- `scheduled_at`
- `sent_at`
- `created_at`
- `created_by`

### `push_notification_events`
Granular push delivery/open/click log.

**Columns**
- `id`
- `campaign_id`
- `user_id`
- `platform`
- `status`
- `device_token`
- `queued_at`
- `sent_at`
- `delivered_at`
- `opened_at`
- `clicked_at`
- `error_code`
- `error_message`
- `apns_message_id`
- `fcm_message_id`
- `created_at`

**Typed foreign keys**
- `campaign_id` → `push_campaigns.id`

### `email_drip_log`
Tracking table for drip-email sends.

**Columns**
- `id`
- `user_id`
- `email_key`
- `sent_at`

**Typed foreign keys**
- `user_id` → `profiles.id`

---

## E. Payments, premium, and credits

### `subscriptions`
Stripe-linked subscription state.

**Columns**
- `id`
- `user_id`
- `stripe_customer_id`
- `stripe_subscription_id`
- `plan`
- `status`
- `current_period_end`
- `created_at`
- `updated_at`

### `user_credits`
Credit balances for product actions.

**Columns**
- `id`
- `user_id`
- `super_vibe_credits`
- `extra_time_credits`
- `extended_vibe_credits`
- `created_at`
- `updated_at`

### `credit_adjustments`
Admin or system credit mutation audit trail.

**Columns**
- `id`
- `user_id`
- `admin_id`
- `credit_type`
- `previous_value`
- `new_value`
- `adjustment_reason`
- `created_at`

### `premium_history`
Premium grant/revoke audit history.

**Columns**
- `id`
- `user_id`
- `action`
- `reason`
- `premium_until`
- `admin_id`
- `created_at`

**Typed foreign keys**
- `user_id` → `profiles.id`

---

## F. Moderation, reporting, and admin controls

### `user_reports`
User reporting / moderation intake.

**Columns**
- `id`
- `reporter_id`
- `reported_id`
- `reason`
- `details`
- `also_blocked`
- `status`
- `action_taken`
- `reviewed_by`
- `reviewed_at`
- `created_at`

### `user_roles`
Role assignment table.

**Columns**
- `id`
- `user_id`
- `role`
- `created_at`

### `user_suspensions`
Suspension lifecycle.

**Columns**
- `id`
- `user_id`
- `reason`
- `status`
- `suspended_by`
- `suspended_at`
- `expires_at`
- `lifted_by`
- `lifted_at`

### `user_warnings`
Formal warnings issued to users.

**Columns**
- `id`
- `user_id`
- `issued_by`
- `reason`
- `message`
- `acknowledged_at`
- `created_at`

### `admin_activity_logs`
Admin action audit log.

**Columns**
- `id`
- `admin_id`
- `action_type`
- `target_type`
- `target_id`
- `details`
- `created_at`

### `feedback`
General feedback / support / QA intake.

**Columns**
- `id`
- `user_id`
- `category`
- `message`
- `device_info`
- `page_url`
- `status`
- `admin_notes`
- `created_at`

---

## G. Account lifecycle and operational controls

### `account_deletion_requests`
Deferred account-deletion workflow.

**Columns**
- `id`
- `user_id`
- `reason`
- `status`
- `requested_at`
- `scheduled_deletion_at`
- `cancelled_at`
- `completed_at`

### `rate_limits`
Basic anti-abuse counters.

**Columns**
- `user_id`
- `messages_count`
- `messages_window_start`
- `uploads_count`
- `uploads_window_start`

---

## 7. Core relational spine

The most important relational chain in the product is:

- `profiles`
- `events`
- `event_registrations`
- `event_swipes`
- `event_vibes`
- `video_sessions`
- `matches`
- `messages`
- `date_feedback`

A second major operational chain is:

- `profiles`
- `notification_preferences`
- `push_campaigns`
- `push_notification_events`
- `notification_log`

A third monetization chain is:

- `profiles`
- `subscriptions`
- `user_credits`
- `credit_adjustments`
- `premium_history`

---

## 8. Notable schema evolution signals from the migration set

The frozen migrations show that Vibely’s schema evolved substantially over a short time window. The most visible late-phase additions include:

- recurring-event support
- queue and participant state for live event matching
- daily drops and cooldowns
- credits and premium operations
- richer notification preferences and push telemetry
- account deletion workflow
- voice messages and chat videos
- more explicit moderation / suspension / warning surfaces
- photo verification and proof-selfie handling
- ready-gate / session-phase detail inside `video_sessions`

This matters because the schema is not a simple MVP core anymore. It is already operating with several layered subsystems.

---

## 9. Rebuild cautions

### Relationship metadata is useful but not exhaustive
Some user-linked tables clearly point to profile or auth identities by naming, but only a subset expose explicit typed foreign-key metadata in the generated file.

### Storage behavior must be validated separately
Bucket publicity and policy intent changed over time, especially for:
- `profile-photos`
- `vibe-videos`

### Policies are part of the schema story
For Vibely, schema recovery is not only table recreation. Correct behavior also depends on:
- RLS policies
- helper functions such as `can_view_profile_photo`
- storage bucket configuration
- trigger behavior introduced by migrations

### The generated type file is a snapshot, not a migration substitute
If there is ever a conflict between `types.ts` and the migration history, the migration history wins for physical schema reconstruction.

---

## 10. Bottom line

The frozen Vibely pre-native-hardening baseline already contains a relatively mature operational schema:
- multi-stage profile and trust state
- event-driven discovery and registration
- live session orchestration
- post-match chat with media attachments
- premium and credits rails
- push/email notification telemetry
- admin moderation and account lifecycle tooling

For rebuild purposes, the critical takeaway is that Vibely is not just a React frontend with a few tables. It is a tightly coupled product database with event, media, moderation, messaging, payments, and notification subsystems already encoded in the schema.

