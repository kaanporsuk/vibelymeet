# VIBELY — MIGRATION MANIFEST

**Date:** 2026-03-11  
**Baseline:** `vibelymeet-pre-native-hardening-golden-2026-03-10.zip` (frozen 101-file archive)  
**Primary source:** `supabase/migrations/*.sql`

---

## 1. Purpose

This document is the migration-side companion to the audited golden snapshot, rebuild runbook, schema appendix, and Edge Function manifest.

It answers:
- what the frozen migration history actually contains
- which phases of product evolution it reflects
- which migrations are structural versus data-mutating
- which migrations are dangerous to replay blindly
- where the migration history appears incomplete relative to the generated Supabase types

This is especially important for Vibely because the migration chain is **not** purely schema DDL. It includes policy rewrites, storage changes, backfills, destructive cleanup, and test-data manipulation.

### Current-state addendum (2026-04-13, updated 2026-04-14)

The repo has moved well beyond the frozen/archive counts below.

- Current repo migration count: **269** files under `supabase/migrations` after `20260429100000_deduct_credit_auth_bind.sql` (re-baseline this line when migrations are added).
- Deployable Edge Functions: **46** (`supabase/functions/*/index.ts`); see `_cursor_context/vibely_machine_readable_inventory.json` → `repo_inventory_counts.edge_functions_deployable`.
- **2026-04-14 (Video Dates P0/P1 + credit budget):** `20260428120000_video_date_p0_p1_closure.sql` and `20260428120100_video_date_credit_extension_budget.sql` — closure evidence: `docs/branch-deltas/fix-video-date-p0-p1-closure.md`; full-system audit: `docs/audits/full-system-forensic-closure-audit-2026-04-14.md`.
- **2026-04-14 (mechanical trust):** `src/integrations/supabase/types.ts` regenerated from linked DB; inventory recount + surface audit script — `docs/audits/mechanical-trust-closure-2026-04-14.md`.
- **2026-04-29 (deduct_credit auth bind):** `20260429100000_deduct_credit_auth_bind.sql` — `deduct_credit` requires `auth.uid() = p_user_id` unless `auth.role() = service_role`; evidence: `docs/audits/deduct-credit-caller-map-2026-04-14.md`.
- Sprint 1 media lifecycle foundation landed as `20260417100000_media_lifecycle_foundation.sql`.
- That migration adds the four `media_*` tables, five service-role media lifecycle RPCs, retention seed rows, and the queue/asset foundation without changing user-facing media flows yet.
- Sprint 2 profile-media wiring landed as `20260417110000_media_lifecycle_profile_media_wiring.sql`.
- Sprint 3 chat/account cleanup landed as `20260419100000_media_lifecycle_chat_account_cleanup.sql` plus `20260419103000_chat_retention_user_wrappers.sql`.
- Sprint 3 grace-period follow-up landed as `20260419110000_account_deletion_grace_media_fix.sql`.
- For current deploy work, treat the live migration list plus this file as additive history: the baseline/archive counts below remain historically useful, but they are not the current total.
- **2026-04-14 (chat/call launch closure branch):** `20260414190000_schedule_match_call_room_cleanup_cron.sql` — optional `pg_cron` + `pg_net` schedule for Edge `match-call-room-cleanup` (Bearer `CRON_SECRET`, same vault pattern as other HTTP crons). Applies only when extensions exist; no client contract change.
- **2026-04-18 (match calls Wave 3):** `20260418210000_match_calls_one_open_per_match.sql` — preflight terminalizes legacy duplicate open rows per `match_id`, then partial unique index **`uniq_match_calls_match_id_open`** on `match_calls(match_id)` where `status IN ('ringing','active')`. Deploy before relying on `daily-room` **409** `DUPLICATE_ACTIVE_CALL` for insert races.
- **2026-04-18 (match calls Wave 4):** `20260418220000_expire_stale_match_calls_log.sql` — same `expire_stale_match_calls` behavior; adds `RAISE LOG` when expiry count > 0 for Postgres log visibility.
- **2026-04-19 (match calls Wave 5):** `20260419120000_match_call_lifecycle_hardening.sql` — adds match-call join/heartbeat/provider-cleanup metadata, extends `match_call_transition` with `heartbeat`, `joined`, and `join_failed`, and updates `expire_stale_match_calls` so stale `active` rows are ended server-side instead of blocking future calls indefinitely.

---

## 2. Migration summary

### Counts (frozen audited archive)
- **101 SQL migration files**
- **Date range:** `20251218002545` → `20260310124838`
- **Distinct public tables created in migration history:** **39**
- **Distinct public views created in migration history:** **1** (`push_notification_events_admin`)
- **Distinct enums created in migration history:** **3**
- **Distinct SQL functions created or replaced in migration history:** **36**
- **Distinct storage buckets referenced in migration history:** **6**

### Storage buckets introduced through migrations
- `profile-photos`
- `proof-selfies`
- `vibe-videos`
- `event-covers`
- `voice-messages`
- `chat-videos`

### Important discrepancy vs current generated types
The generated Supabase types expose two public tables that are **not created anywhere in the 101-file frozen migration chain**:
- `feedback`
- `premium_history`

That means at least one of the following is true:
- the migration history is incomplete relative to the linked Supabase project
- those objects were created outside the preserved migration chain
- they were present before this repo’s earliest frozen migration and never backfilled into versioned SQL

For rebuild fidelity, this is a real gap and should be treated as such.

### Post-repair working baseline (linked production branch)

After the dedicated migration-repair workstream (2026-03-11), the **current hardened/live-aligned branch baseline** contains **109** migration files under `supabase/migrations`:
- the original 101 frozen SQL migrations described above, plus:
  - `20260311000000_chat_videos_anon_read.sql` — chat-videos anon-read RLS policy; its logic had already been applied manually before being recorded as applied in history
  - `20260309000534_legacy_remote_artifact.sql` — **no-op placeholder** representing a legacy remote-only version that must not be replayed
  - `20260309005543_legacy_remote_artifact.sql` — **no-op placeholder** representing a second legacy remote-only version that must not be replayed
  - `20260311120000_profiles_pause_columns.sql` — **Stream 1B:** add `profiles.is_paused`, `paused_at`, `paused_until`, `pause_reason` for backend-authoritative account pause/resume
  - `20260311120001_get_event_deck_exclude_paused.sql` — **Stream 1B:** update `get_event_deck` to exclude effectively paused profiles from discoverability
  - `20260311141500_get_event_deck_auth_guard.sql` — **Stream 1B follow-up:** add `auth.uid()` = `p_user_id` guard to `get_event_deck` via an additive, production-safe function redefinition
  - **Naming (migration-era vs Stage 1 UX):** In the next two bullets, **“Stream 2A / 2B”** refer to **historical events/schema workstream labels** on these dated migrations (~March 2026). They are **not** the same as **Stage 1 / Stream 2A** or **Stage 1 / Stream 2B** (queued/ready-gate/deep-link UX hardening PRs). Use filenames when tracing behavior.
  - `20260311133000_video_date_state_machine.sql` — **Migration-era “Stream 2A” (events schema):** introduce server-owned video-date state machine (`video_date_state`, `video_date_transition`) and move timing/phase ownership out of fragile client writes
  - `20260311153000_ready_gate_transition.sql` — **Migration-era “Stream 2B” (events schema):** introduce server-owned Ready Gate transition RPC (`ready_gate_transition`) to replace fragile client-owned updates for ready/snooze/forfeit
  - `20260311160000_daily_drop_transition.sql` — **Migration-era “Stream 2C” (events schema):** introduce server-owned Daily Drop transition RPC (`daily_drop_transition`) for view/opener/reply/pass, including match creation and idempotent terminal handling
  - `20260410120000_get_event_attendee_preview.sql` — **Who's Going / attendee privacy:** `get_event_attendee_preview(p_event_id, p_viewer_id)` returns JSON (viewer admission, `total_other_confirmed`, cohort counts, top-2 revealed rows, obscured remainder); confirmed viewers only get identifiable previews; waitlisted and non-admitted get aggregate counts only.

The parity repair was performed **via metadata-only history reconciliation** using `supabase migration repair`:
- historical SQL bodies were **not** re-executed
- the two legacy artifacts are now represented locally, but contain no DDL/DML
- `./scripts/check_migration_parity.sh` reports zero missing local/remote versions
- `supabase db push --linked --dry-run` reports the remote database as **up to date**

### Phase 2 events hardening addendum (2026-04-04)

Added migration:
- `20260404195500_phase2_queue_ttl_ready_gate_sync_daily_gate.sql`

Key deltas recorded in this migration:
- Adds canonical queued TTL column: `video_sessions.queued_expires_at`.
- Backfills queued TTL for existing queued sessions and sets TTL at queued-match creation in `handle_swipe`.
- Adds deterministic backend cleanup RPC `expire_stale_video_sessions()` and schedules it minutely with `pg_cron` (best effort; migration remains safe where cron is unavailable).
- Updates `drain_match_queue` to run cleanup first and only promote non-expired queued sessions.
- Extends `ready_gate_transition` with `p_action = 'sync'` for poll-based state reconciliation.
- Preserves strict 60-second `last_lobby_foregrounded_at` presence semantics introduced in Phase 1.1 for immediate promotion.
- Tightens lifecycle expiry ownership by ending stale queued/ready states server-side with explicit end reasons.

### Phase 3 events hardening addendum (2026-04-04)

Added migration:
- `20260412143000_phase3_legacy_queue_contract_cleanup.sql`

Key deltas recorded in this migration:
- Re-anchors active swipe/drain contracts to Phase 1.1/2 semantics after later migration drift:
  - `handle_swipe` keeps strict 60-second true-lobby foreground proof for immediate ready gate.
  - queued matches keep canonical `queued_expires_at` TTL semantics.
  - active payload shape is normalized around `video_session_id` + `event_id` with legacy `match_id` alias preserved.
- `drain_match_queue` cleanup-first behavior is restored (`expire_stale_video_sessions()`) with queued TTL guard and 60-second foreground recency checks.
- Legacy queue-era RPC surfaces are retired safely:
  - `join_matching_queue` and `find_video_date_match` are now compatibility no-ops returning a deprecated contract.
  - `leave_matching_queue` is kept for compatibility and returns `deprecated: true` while preserving cleanup behavior.
- This pass does not alter payment settlement semantics or swipe-first matching product flow.

### Media lifecycle addendum (2026-04-13)

Current repo state now contains **253** migration files under `supabase/migrations`.

Media lifecycle progression:
- `20260417100000_media_lifecycle_foundation.sql` — Sprint 1 foundation:
  - adds `media_retention_settings`, `media_assets`, `media_references`, `media_delete_jobs`
  - seeds retention policies and introduces worker-facing RPCs / `process-media-delete-jobs`
- `20260417110000_media_lifecycle_profile_media_wiring.sql` — Sprint 2 profile-media wiring:
  - adds `profile_vibe_videos` for future multi-video-per-user support with a single current/primary marker
  - redefines `publish_photo_set`, `mark_photo_deleted`, `mark_photo_drafts_deleted`, `update_media_session_status`, `publish_media_session`, and `finalize_onboarding`
  - adds helper functions `media_compute_purge_after`, `mark_media_asset_soft_deleted_if_unreferenced`, `ensure_profile_photo_asset`, `ensure_vibe_video_asset`, `sync_profile_photo_media`, `activate_profile_vibe_video`, and `clear_profile_vibe_video`
  - conservatively backfills existing live `profiles.photos` / `avatar_url` / `bunny_video_uid` rows into lifecycle tables when applied
- `20260419100000_media_lifecycle_chat_account_cleanup.sql` — Sprint 3 chat/account cleanup:
  - adds `chat_media_retention_states`
  - converts `chat_image`, `chat_video`, `chat_video_thumbnail`, and `voice_message` from placeholder retention settings into live participant-retention wiring
  - adds helper functions `ensure_chat_media_asset`, `attach_chat_media_asset_to_match`, `sync_chat_message_media`, `release_chat_match_participant`, `restore_chat_match_participant`, `apply_account_deletion_media_hold`, `cancel_account_deletion_media_hold`, and `backfill_chat_message_media_lifecycle`
  - adds a `BEFORE DELETE` trigger on `matches` so existing destructive match cleanup releases both participants before the row disappears
- `20260419103000_chat_retention_user_wrappers.sql` — Sprint 3 follow-up:
  - adds authenticated wrapper RPC `delete_chat_for_current_user(p_match_id uuid)` so client-owned “delete chat for me” can move through the backend retention model without service-role calls
- `20260419110000_account_deletion_grace_media_fix.sql` — Sprint 3 grace-period correction:
  - adds `chat_media_retention_states.account_deletion_pending_at` so a pending deletion request is a reversible hold, not a final deletion state
  - adds helper functions `mark_chat_match_participant_deletion_pending` and `complete_account_deletion_media_cleanup`
  - redefines `apply_account_deletion_media_hold` / `cancel_account_deletion_media_hold` so pending requests no longer release chat refs
  - adds an `account_deletion_requests` completion trigger so final `account_deleted` chat release and owned profile/vibe media finalization happen only when the request becomes `completed`

Important Sprint 2 boundaries:
- keeps `profiles.bunny_video_uid` / `profiles.bunny_video_status` as the compatibility mirror for the primary vibe video
- keeps `profiles.photos` / `profiles.avatar_url` as the compatibility mirror for published profile photos
- does **not** enable `process-media-delete-jobs` cron
- Sprint 3 boundaries:
  - chat media now uses lifecycle tables, but `process-media-delete-jobs` cron is still **not** enabled
  - shared chat media still waits for explicit eligibility; there is no simple TTL-before-eligibility shortcut
  - pending deletion requests are reversible holds only; they do not count as final deletion for chat eligibility
  - only the operative completion event (`account_deletion_requests.status = 'completed'`) releases the deleting side as `account_deleted` and moves owned profile/vibe media into final lifecycle cleanup

### Stage 1 / Stream 1 — promote-ready-gate + session hydration (2026-04-18)

Branch: `stage1/stream1-backend-promotion-and-hydration`.

- **Migration:** `20260418120000_tighten_promote_ready_gate_helper.sql` replaces `public.promote_ready_gate_if_eligible(p_event_id, p_uid)` with a stricter implementation: live event validity (`events` share-lock, ended/cancelled rejected), queued TTL + non-ended session checks, deterministic `event_registrations` row locks in `profile_id` order after `video_sessions` `FOR UPDATE SKIP LOCKED`, and a conflict guard when another non-ended session exists. **RPC signature and return shape for this function are unchanged** at the SQL boundary.
- **Backend-owned promotion tightening only:** `mark_lobby_foreground` and **`drain_match_queue` retain their roles**; the latter remains the **fallback** path that invokes cleanup/promotion for queued work—this stream does not remove or replace `drain_match_queue`.
- **App layer (not in the migration file):** web and native add **session hydration before route decisions** (`useActiveSession`, route hydration components) so users in `in_ready_gate` are not left on a stale `/date` shell; native deep links align with the same rules.
- **Explicitly out of scope for this stream:** no new **durable notification outbox** tables or delivery pipeline; push/deep-link behavior stays on existing Edge + client paths.

### Stage 1 / Stream 1C — conflicting-session race hardening (2026-04-20)

Branch: `stage1/stream1_9-conflicting-session-race-hardening`.

- **Contract bugfix (separate concern):** `20260420120000_drain_match_queue_flat_promotion_envelope.sql` redefines `public.drain_match_queue(p_event_id)` so it still calls `promote_ready_gate_if_eligible` but returns the **flat** JSON expected by web/native (fixes nested-`promotion` envelope drift). Merge as its own small PR if you prefer to separate from session logic.
- **Mutual swipe hardening:** `20260420123000_handle_swipe_mutual_session_conflict_guard.sql` adds the same **non-ended session conflict guard** used in `promote_ready_gate_if_eligible` **before** `handle_swipe` inserts into `video_sessions`, excluding the same participant pair (still `already_matched` via `ON CONFLICT`). Returns `result: participant_has_active_session_conflict` when a *different* pair’s session already holds either user.

### Stage 1 / Stream 1D — trust / fairness (2026-04-13)

Branch: `stage1/stream1_10-trust-fairness-work`.

- **App-only:** `SWIPE_SESSION_CONFLICT_USER_MESSAGE` in `supabase/functions/_shared/matching/videoSessionFlow.ts` is shown on web (Sonner `toast.info`) and native (lobby dialog) when mutual swipe returns `participant_has_active_session_conflict`, closing the silent-failure gap for that path. No notification or routing changes.

### Phase 2 — live-loop observability (2026-04-23)

Branch: `phase2/observability-queue-promotion`.

- **Migration:** `20260423120000_event_loop_observability.sql` adds append-only table `public.event_loop_observability_events` (RLS enabled; **no** `authenticated`/`anon` policies — read via **service role** or SQL editor only).
- **Function:** `public.record_event_loop_observability(...)` — `SECURITY DEFINER`, `REVOKE`d from `PUBLIC`; inserts are wrapped in `EXCEPTION WHEN OTHERS` so logging cannot break hot paths.
- **Instrumented RPCs (replaced in same migration):** `promote_ready_gate_if_eligible`, `drain_match_queue`, `expire_stale_video_sessions`, `mark_lobby_foreground`, and `handle_swipe` (mutual / promotion-relevant branches only). Per-invocation `latency_ms` and structured `outcome` / `reason_code` / `detail` jsonb (cleanup counts for expiry, nested promotion JSON for `mark_lobby_foreground`).
- **Explicitly out of scope:** notification delivery redesign, client UI, Edge Functions, env vars, or sampling toggles.

### Phase 3 — event-loop read model (2026-04-24)

Branch: `phase3/event-loop-read-model`.

- **Migration:** `20260424120000_event_loop_read_model_views.sql` adds **views only** on `public.event_loop_observability_events` (append-only table unchanged; **no** write-path or RPC changes).
- **Row-level views:** `v_event_loop_promotion_events`, `v_event_loop_drain_events`, `v_event_loop_expire_events`, `v_event_loop_swipe_mutual_events`, `v_event_loop_mark_lobby_events` (includes `detail.promotion` extraction for lobby).
- **Hourly rollups (UTC `bucket_utc`):** `v_event_loop_promotion_outcomes_hourly`, `v_event_loop_drain_outcomes_hourly`, `v_event_loop_expire_activity_hourly`, `v_event_loop_guard_outcomes_hourly` (conflict/block/error), `v_event_loop_latency_by_operation_outcome_hourly`.
- **Permissions:** `REVOKE` from `PUBLIC` / `anon` / `authenticated`; `GRANT SELECT` to **`service_role`** only (same posture as base table).
- **Explicitly out of scope:** retention/archival, admin UI, Edge Functions, product API changes.

### Phase 3b — operator dashboard normalization (additive views)

- **Migration:** `20260430123100_event_loop_operator_normalized_read_models.sql` adds **`v_event_loop_mark_lobby_promotion_normalized`** (nested promotion mapped to **`promotion_derived_outcome`**), **`v_event_loop_observability_metric_streams`** (**`metric_stream`** label for dedupe-friendly filters), and **COMMENT-only** clarifications on existing hourly rollup views. **No** changes to base table or write paths. **Docs:** `docs/observability/event-loop-dashboard-normalization.md`.

### Video Dates P0/P1 closure (2026-04-28)

Branch: `fix/video-date-p0-p1-closure`.

- **Migration:** `20260428120000_video_date_p0_p1_closure.sql`
  - **`expire_stale_video_date_phases()`** — ends stale **handshake** (60s product window + 30s buffer) and **date** (300s + 60s buffer) using `video_sessions.handshake_started_at` / `date_started_at`; skips rows with an **active** reconnect-grace deadline (`reconnect_grace_ends_at > now()`).
  - **`expire_stale_video_sessions()`** — adds **`both_ready`** gate expiry (excluding sessions already in `handshake`/`date`), calls `expire_stale_video_date_phases()`, extends observability `detail` with `both_ready_expired`, `handshake_timeout`, `date_timeout`.
  - **`ready_gate_transition`** — on transition to **`both_ready`**, sets `ready_gate_expires_at = now() + 30 seconds` (fresh navigation window; idempotent terminal short-circuit unchanged).
  - **`video_date_transition` (`end`, `beforeunload`)** — departing actor → `offline`; partner → `in_survey` (no longer double-offline).
  - **`update_participant_status`** — allowlist only: `browsing`, `idle`, `in_ready_gate`, `in_survey`, `offline` (invalid values no-op).
  - **`submit_user_report`** — `SECURITY DEFINER` RPC: canonical reasons, trimmed details, **20 reports / hour** cap, optional `blocked_users` insert with `ON CONFLICT DO NOTHING`; `GRANT EXECUTE` to `authenticated`.

- **Migration:** `20260428120100_video_date_credit_extension_budget.sql` (same branch; apply **after** `20260428120000_*`)
  - **`video_sessions.date_extra_seconds`** — default `0`; accumulates **+120s** per `extra_time` credit and **+300s** per `extended_vibe` credit spent in-session.
  - **`spend_video_date_credit_extension(p_session_id, p_credit_type)`** — `SECURITY DEFINER`; requires caller in session, `state = date`; atomically deducts one credit from `user_credits` and increments `date_extra_seconds`; `GRANT EXECUTE` to `authenticated`.
  - **`expire_stale_video_date_phases()`** — **replaced**: date-phase expiry predicate is `date_started_at + (300 + date_extra_seconds + 60) seconds` (reconnect-grace skip unchanged). Supersedes the fixed **360s** date window from `20260428120000_*` for date rows once this migration runs.

#### Operator SQL pack (service role / SQL editor)

```sql
-- Last 24h: promotion outcome mix
SELECT outcome, reason_code, SUM(n) AS n
FROM public.v_event_loop_promotion_outcomes_hourly
WHERE bucket_utc > now() - interval '24 hours'
GROUP BY outcome, reason_code
ORDER BY n DESC;

-- Last 24h: drain useful work vs unauthorized / no-op
SELECT outcome, reason_code, SUM(n) AS n, SUM(n_found_true) AS found_hits, SUM(n_queued_wait) AS queued_wait_hits
FROM public.v_event_loop_drain_outcomes_hourly
WHERE bucket_utc > now() - interval '24 hours'
GROUP BY outcome, reason_code
ORDER BY n DESC;

-- Expire / hygiene volume
SELECT * FROM public.v_event_loop_expire_activity_hourly
WHERE bucket_utc > now() - interval '7 days'
ORDER BY bucket_utc DESC
LIMIT 48;

-- Conflicts / blocks / errors by reason
SELECT * FROM public.v_event_loop_guard_outcomes_hourly
WHERE bucket_utc > now() - interval '24 hours'
ORDER BY n DESC;

-- Latency by operation + outcome (last 24h buckets)
SELECT operation, outcome, SUM(n) AS n,
       round(SUM(avg_latency_ms * n) / NULLIF(SUM(n), 0), 2) AS wavg_ms
FROM public.v_event_loop_latency_by_operation_outcome_hourly
WHERE bucket_utc > now() - interval '24 hours'
GROUP BY operation, outcome
ORDER BY n DESC;
```

### Phase 3b — event-loop observability retention (decision brief)

Branch: `phase3b/event-loop-retention-policy`.

- **Decision brief:** `_cursor_context/event_loop_observability_retention_policy.md` — **30d** raw retention, batched delete first, partitioning and cold export deferred.

### Phase 3c — event-loop observability retention (implementation)

Branch: `phase3c/event-loop-observability-retention`.

- **Migration:** `20260425120000_event_loop_observability_retention_prune.sql` — `public.prune_event_loop_observability_events(p_batch_limit default 5000, p_retention_days default 30)` returns JSON (`deleted_count`, `cutoff_utc`, `batch_limit`, `retention_days`, `has_more_to_prune`). **SECURITY DEFINER**; `EXECUTE` for **`service_role`** only. Batched `DELETE` on `event_loop_observability_events` only; write-path loggers and `v_event_loop_*` view definitions unchanged.
- **Follow-up:** `20260425130000_event_loop_prune_revoke_client_roles.sql` — explicit `REVOKE` from **`anon` / `authenticated`** (aligns with default-grant hygiene on new functions).
- **Scheduler:** enable **`pg_cron`** (or run SQL manually) per `docs/supabase-cloud-deploy.md` — not committed in-repo.

---

## 3. The single most important migration finding

The frozen migration history is **not safe to describe as “schema only.”**

It contains at least four risky classes of migration:

### A. Destructive data-reset migrations
Example:
- `20251227005244_73d18021-43bd-4b86-b7df-c49f7d22bd64.sql` deletes rows from `event_registrations`, `messages`, `matches`, `profile_vibes`, `video_sessions`, `events`, and `profiles`

### B. Data backfills / data rewrites
Examples:
- attendee count reconciliation
- signed-URL-to-raw-path migration for profile photos
- nulling out legacy `video_intro_url`

### C. Environment-specific test-data migrations
Examples:
- migrations that create “Video Call Test Event” and “Sunday Vibe Check ☀️”
- migrations that insert or update registrations for specific hardcoded user UUIDs
- migrations that simulate queue joins and test session creation

### D. Security/policy hotfix migrations
There are many RLS/policy corrections that narrow previously too-broad access. These are structurally important and must be preserved.

### Why this matters
A naive replay can:
- fail on a blank database because referenced users do not exist
- mutate or wipe data in a live environment
- create test artifacts in a supposedly clean rebuild
- produce different security behavior if policy-fix migrations are skipped or reordered

---

## 4. Replay risk classification

## Safe-ish classes
These are generally expected in a normal migration chain:
- create table / enum / function / view
- add column / constraint / index
- create or drop RLS policies
- add storage bucket and policies
- function rewrites for bug fixes

## Replay-sensitive classes
These need operator attention before cold rebuild or cross-environment replay:
- destructive `DELETE` / `DROP TABLE ... CASCADE` against business data
- `INSERT` statements that seed test events or test sessions
- `UPDATE` statements tied to concrete UUIDs
- migrations that assume specific existing users or rows
- migrations that fix production state rather than only physical schema

---

## 5. Risky non-structural migrations that deserve special handling

### Destructive reset
- `20251227005244_73d18021-43bd-4b86-b7df-c49f7d22bd64.sql`  
  Deletes core rows from events/profiles/registrations/matches/messages/video_sessions/profile_vibes.

### Data correction / backfill
- `20260128001207_d087e5f7-cdd5-439c-8cfd-a77bb4f2eb60.sql`  
  Recomputes `events.current_attendees` from `event_registrations`.
- `20260216044426_f60a05b9-638d-4799-a0c4-ad8ba11cb104.sql`  
  Migrates expired signed photo URLs into raw storage paths.
- `20260308111830_7a8e3618-ec6f-4338-999a-499c94ef4312.sql`  
  Nulls legacy `profiles.video_intro_url` values before Bunny-native video fields take over.

### Test / manual QA state migrations with hardcoded identities
- `20260206050534_64a3c48f-fabe-42c8-8faa-63c333cc77b6.sql`
- `20260206050705_61b47f53-e360-487a-b059-31a706534cc1.sql`
- `20260208224222_553d3be9-fc52-4758-bd3e-0129cbc6d7d9.sql`
- `20260209192940_c129ce86-f1a9-49b8-ab5e-fc7cbcac695b.sql`
- `20260209193216_294b70b7-f9a0-46fd-aeec-23346b330859.sql`
- `20260209193336_eda17c83-ee27-4079-881f-007eae5fa189.sql`
- `20260209200028_38de6643-0bf6-4d2c-8854-ee7241ad1b9f.sql`

These manipulate concrete event rows and specific user UUIDs. They are the clearest evidence that the chain was used as both migration history and operational test harness.

---

## 6. Operator guidance for rebuilds

### If you are restoring against the original linked Supabase project
The preserved migration order matters. Keep the history intact and validate what is already applied before pushing anything.

### If you are rehearsing on a truly blank new database
Do **not** assume `supabase db reset` or `supabase db push` will succeed cleanly without intervention.

You must inspect at least:
- destructive reset migration(s)
- hardcoded test-data migrations
- any migration that assumes real auth users or preexisting profile rows

### If you are rebuilding for long-term maintainability
The long-term fix is to split history into:
- canonical schema migrations
- seed data (if any)
- one-off operational corrections
- QA/test fixtures

That split has **not** been done in the frozen baseline.

---

## 7. Major evolution phases in the migration chain

## Phase 1 — Core product bootstrap and initial RLS (2025-12-18 to 2025-12-31)
This phase creates the original spine of the app:
- `profiles`
- `events`
- `event_registrations`
- `matches`
- `messages`
- `video_sessions`
- `vibe_tags`
- `profile_vibes`

It also introduces early demo-mode/public-read policies, initial vibe-video storage, role support, richer profile fields, profile photos, daily drops/date proposals, photo verification primitives, and schedules.

## Phase 2 — Safety, admin, moderation, and event-control hardening (2026-01-06 to 2026-01-27)
This phase adds:
- blocking and muting
- verification attempts
- admin notifications
- suspensions and warnings
- user reports
- admin activity logs
- event cover storage
- push campaign and push event telemetry enums/tables
- multiple profile/privacy policy tightenings

It is also the phase where the schema starts to show real moderation/admin maturity.

## Phase 3 — Live queueing, event decking, video matching, and QA-heavy evolution (2026-01-31 to 2026-02-20)
This is the most operationally turbulent period.

It adds or rewrites:
- queue status fields on `event_registrations`
- matching/session functions such as `find_video_date_match`, `join_matching_queue`, `leave_matching_queue`
- `event_vibes`
- secure push admin view
- `user_credits`
- `date_feedback`
- `event_swipes`
- `credit_adjustments`
- mystery-match and swipe functions
- queue state expansions
- recurring-event and geo-targeting functions

It also includes the clearly noncanonical test-event/test-session migrations.

## Phase 4 — Media, monetization, verification, notifications, and late hardening (2026-02-21 to 2026-03-10)
This phase introduces:
- `voice-messages` storage
- `match_calls`
- phone verification profile fields
- referral tracking
- `email_drip_log`
- `photo_verifications`
- Bunny-native vibe-video identity fields
- `subscriptions`
- `is_premium`
- event `payment_status`
- account deletion requests
- age gate blocks
- notification preferences / logs / mutes
- rebuilt daily-drops model and cooldowns
- `chat-videos` storage
- message video fields
- protection for admin-managed profile fields
- `get_own_pii`

This is the final pre-native-hardening shape of the system.

---

## 8. Chronological ledger

Each entry below records the migration file and its main observed purpose.

### 2025-12-18
- `20251218002545_d8e57774-e32c-4b62-ba72-476b014bc930.sql` — bootstrap core schema: `vibe_tags`, `profiles`, `profile_vibes`, `events`, `event_registrations`, `matches`, `messages`, `video_sessions`; enables RLS; adds update/message/event-attendee triggers and functions.
- `20251218002813_781c162f-bcbf-42b7-838a-a72e0dc707c5.sql` — demo-mode/public-read policy expansion for matches and messages.

### 2025-12-24
- `20251224173423_eb996d9b-303c-48e3-a50a-a9a69770826a.sql` — creates `vibe-videos` storage bucket and policies.
- `20251224180727_028b6b04-5827-4b12-be42-62519912f183.sql` — adds `app_role`, `user_roles`, and `has_role()` for admin/moderator role checks.

### 2025-12-26
- `20251226160948_a55c9710-fd6f-44cf-b89c-447d97a9c5ca.sql` — drops an overly permissive public policy.

### 2025-12-27
- `20251227005244_73d18021-43bd-4b86-b7df-c49f7d22bd64.sql` — destructive data reset of core business tables.
- `20251227010039_421d6f54-df51-4071-a774-706459484397.sql` — adds missing INSERT policy for `video_sessions`.
- `20251227011125_a767d943-0e04-4a06-95e5-3ee652415a9a.sql` — security hardening: makes `vibe-videos` private; introduces `rate_limits` and message-rate-limiting trigger/function.
- `20251227012106_b28f04de-470b-434d-b31a-00931a538f09.sql` — drops another overly permissive policy.

### 2025-12-28
- `20251228015626_8e73a470-1845-4f79-ab42-3de8c0559150.sql` — major `profiles` expansion: `birth_date`, `tagline`, `interested_in`, `company`, `about_me`, `looking_for`, `lifestyle`, `prompts`, `location_data`, `video_intro_url`.
- `20251228020729_f7163dec-ca6b-44aa-98f7-0d1d89d8bd37.sql` — creates `profile-photos` bucket and `email_verifications` table.
- `20251228022019_184acae1-ce11-4e1a-be8e-6a031d1d887b.sql` — message edit/delete support plus creation of early `daily_drops` and `date_proposals` tables.

### 2025-12-29
- `20251229003354_00812dea-4711-4487-bc86-f845cae730ba.sql` — adds `profiles.photo_verified`, `proof-selfies` bucket, and related policies.
- `20251229004756_88f6cd10-26e6-4ad9-8024-2db3f6d66ef8.sql` — makes `profile-photos` private and adds `can_view_profile_photo()` helper.

### 2025-12-31
- `20251231001331_0d9fe89a-9ace-48ad-aca1-a41281c247ff.sql` — creates `user_schedules` table for availability persistence.

### 2026-01-06
- `20260106014442_17770f5c-3d0c-4b2c-bc33-7415231f0a10.sql` — adds archived matches support plus `blocked_users` and `match_mutes`.
- `20260106020103_88ea4113-1308-408f-930d-c3363be8707a.sql` — revisits `vibe-videos` bucket policies.

### 2026-01-15
- `20260115235308_110b0dfa-7788-4ff2-9a1d-ffded64c3617.sql` — creates `verification_attempts` and cleanup trigger/function.

### 2026-01-16
- `20260116001552_9617ea07-ce16-4492-a909-9b6ed6e1aca7.sql` — locks down `vibe-videos` access and introduces `is_blocked()`.
- `20260116235941_4f178270-40d1-42cf-a996-96a900a593ba.sql` — admin RLS policies for broad profile/data visibility.

### 2026-01-17
- `20260117213531_78588c84-22f2-4a74-a2e1-f61b5bd43512.sql` — creates `admin_notifications`, `user_suspensions`, `user_warnings`, and admin-notification trigger functions.
- `20260117213540_6334de97-b847-4295-8d82-6667ed298ef7.sql` — removes overly permissive insert policy on `admin_notifications`; relies on SECURITY DEFINER triggers instead.

### 2026-01-18
- `20260118071417_c8b1264d-f97f-4280-899d-649d6137b0c1.sql` — creates `user_reports` and admin report notification trigger.
- `20260118074329_b2d606c5-65fc-4661-978c-0f55db05d39d.sql` — fixes public exposure of `profile_vibes`.

### 2026-01-19
- `20260119220544_c5d2ce37-6c21-4b8b-8170-337fabb3b608.sql` — expands `events` with vibes, gender caps, location-specific fields, visibility, pricing, and attendance markers.

### 2026-01-20
- `20260120205733_6f220346-9a7e-48a0-a509-f92bd3b3f466.sql` — creates `admin_activity_logs`.

### 2026-01-21
- `20260121071919_de94db86-098f-41d1-9503-cf80d3499832.sql` — removes public profile-vibe exposure.
- `20260121081429_9f7afe26-166c-4364-a95e-27d0e999e73e.sql` — adds event-capacity alert function/trigger for admin notifications.

### 2026-01-23
- `20260123001944_15682c3a-5b6e-4a4c-84d4-01ed82fd3a90.sql` — creates `event-covers` bucket and policies.

### 2026-01-24
- `20260124003754_422db6ed-1234-4cf9-807e-0d9c1e7f4690.sql` — requires authentication for profile reads, narrowing prior exposure.

### 2026-01-26
- `20260126185213_7351f30b-804b-4ef1-90f6-afb30bc339eb.sql` — creates `notification_platform`, `notification_status`, `push_campaigns`, and `push_notification_events`.
- `20260126193631_47279744-15e3-46c0-a38d-58002348105e.sql` — adds `is_registered_for_event()` helper to avoid RLS recursion.

### 2026-01-27
- `20260127231851_c0705953-7186-403e-bcf1-80ab03f2ff11.sql` — critical profiles RLS security fix for Daily Drop visibility.
- `20260127233140_d195af58-4538-410b-987d-b383ead4d7de.sql` — rewrites profile visibility logic using `check_gender_compatibility()` to avoid recursion.

### 2026-01-28
- `20260128001207_d087e5f7-cdd5-439c-8cfd-a77bb4f2eb60.sql` — backfills `events.current_attendees` from registrations.

### 2026-01-31
- `20260131235453_08b0ef6c-39b0-4fe8-9191-59dbe16c00a9.sql` — introduces queueing on `event_registrations` and first-generation `find_video_date_match`, `join_matching_queue`, `leave_matching_queue`.

### 2026-02-01
- `20260201102603_1efdd0c3-aaa1-43d4-b67b-494804bedfb9.sql` — rewrites `find_video_date_match` so `current_room_id` tracks `video_sessions.id`.

### 2026-02-02
- `20260202115108_484eac10-9445-4459-a4b4-279bd515f9bd.sql` — fixes singular/plural gender matching in `find_video_date_match` and related logic.
- `20260202115643_6e013e4b-4c78-4d2d-a939-6be217bf7c95.sql` — creates `event_vibes` for pre-event interest expressions.

### 2026-02-04
- `20260204233635_45842883-27c6-4b82-92dd-3ca3e6576109.sql` — creates admin-safe `push_notification_events_admin` view with token masking.

### 2026-02-05
- `20260205004148_4094ebad-15af-44e1-9297-3eadbda53c8b.sql` — drops and recreates the push admin view.

### 2026-02-06
- `20260206050534_64a3c48f-fabe-42c8-8faa-63c333cc77b6.sql` — inserts live QA test event plus hardcoded registrations for specific users.
- `20260206050705_61b47f53-e360-487a-b059-31a706534cc1.sql` — sets a hardcoded test user to `searching` queue state.

### 2026-02-08
- `20260208224222_553d3be9-fc52-4758-bd3e-0129cbc6d7d9.sql` — resets hardcoded test registrations and ends active sessions for those users.

### 2026-02-09
- `20260209192940_c129ce86-f1a9-49b8-ab5e-fc7cbcac695b.sql` — creates another QA test event (“Sunday Vibe Check ☀️”) and registers two hardcoded users.
- `20260209193216_294b70b7-f9a0-46fd-aeec-23346b330859.sql` — simulates queue join and session creation for test users.
- `20260209193336_eda17c83-ee27-4079-881f-007eae5fa189.sql` — resets those users back to idle and closes the test session.
- `20260209195435_5ba979a8-8cdc-40d3-be88-78cb19eb49b5.sql` — changes `find_video_date_match` to exclude only active/non-ended sessions.
- `20260209195922_abd03d88-7cfd-4085-9c79-f425ae7e52bb.sql` — fixes UUID/text mismatch around `current_room_id`.
- `20260209200028_38de6643-0bf6-4d2c-8854-ee7241ad1b9f.sql` — cleans up test session state and extends the test event duration.

### 2026-02-11
- `20260211150718_adf98e65-9ffd-4eaa-9b0d-4b6b932a52ea.sql` — creates `user_credits` with update trigger and policies.

### 2026-02-12
- `20260212001353_1855c6d3-05a3-4bf3-bbed-6c18a9730a12.sql` — adds `vibe_questions` to `video_sessions`, creates `date_feedback`, and adds `check_mutual_vibe_and_match()`.
- `20260212083221_9e3b1510-2776-435a-8fd6-f121b10ef97e.sql` — introduces first `get_event_deck()` deck builder.
- `20260212180837_ca99dbd7-13dc-4701-a70b-6227456017fe.sql` — adds `event_swipes`, `last_active_at`, `drain_match_queue()`, `handle_swipe()`, and `update_participant_status()`.
- `20260212181239_38a33705-1e97-4860-b29a-4128671946fa.sql` — race-condition protection: `deduct_credit()`, date-feedback idempotency, and `find_mystery_match()`.
- `20260212181754_5ccc735a-15f3-4d1b-9e4c-7c43157f6e7f.sql` — creates `credit_adjustments` and additional idempotency constraints.

### 2026-02-15
- `20260215160918_dda5e61b-5ebc-43f5-ba8e-f408ac5647c2.sql` — unique pair index on `matches` using normalized ordering.
- `20260215161008_c34db7ed-530d-4ebb-9e52-4e49559cdf05.sql` — aligns `check_mutual_vibe_and_match()` with normalized match ordering.

### 2026-02-16
- `20260216043319_2c1af590-ba93-419a-8f59-18bd3fda80dc.sql` — drops old queue-status constraint and rebuilds it for expanded statuses.
- `20260216043517_81a09c23-617b-495c-96e7-1a57e6af24ab.sql` — expands `queue_status` again to include `browsing`, `in_ready_gate`, `in_handshake`, `in_survey`, `offline`.
- `20260216044426_f60a05b9-638d-4799-a0c4-ad8ba11cb104.sql` — migrates signed profile photo URLs to raw storage paths and adds `extract_storage_path()`.
- `20260216044723_8d3710b8-9855-4b49-8454-24af6c4febe0.sql` — further normalizes `check_mutual_vibe_and_match()` logic.

### 2026-02-17
- `20260217070547_4e834470-ffa6-41da-8ba0-cb1d2e72ffd9.sql` — makes `profile-photos` public again so `getPublicUrl()` works reliably.

### 2026-02-18
- `20260218034339_dbbf5a04-4457-499a-a6c5-1be9e624f866.sql` — recreates `push_notification_events_admin` with explicit `SECURITY INVOKER` behavior.
- `20260218132914_4c1f8ab9-725a-4874-9d3b-5c7b8a0b1960.sql` — adds `ended` to `events.status` constraint.
- `20260218135136_1bc2e313-da2a-42f3-a590-6c5c12db6aae.sql` — adds core live/event/chat tables to `supabase_realtime` publication.

### 2026-02-19
- `20260219033734_038f8c45-c285-4a8b-8afc-cd488ceefc6f.sql` — queue constraint refresh plus cleanup of stale foreign keys/policies around queue/video feedback surfaces.
- `20260219035638_7b4e72a8-5b1b-4c08-9481-30b22d1ceed4.sql` — cleans duplicate `video_sessions` state and strengthens uniqueness assumptions used by swiping/matching.

### 2026-02-20
- `20260220040047_ece0f1ad-2803-42a8-bb87-a322cb85f856.sql` — major geo-targeting/recurrence package: event lat/lng/radius/scope/city/country/recurrence fields plus `generate_recurring_events()`, `get_other_city_events()`, `get_visible_events()`, `haversine_distance()`.
- `20260220094344_cfd94d22-cf68-4c84-a943-f9884e3559e2.sql` — fixes interval arithmetic in `get_visible_events()` and adds `profiles.country`.

### 2026-02-21
- `20260221001701_d5bdfa71-57e3-4e79-b976-636e0f6b52c2.sql` — adds `profiles.last_seen_at` and `voice-messages` storage bucket.

### 2026-02-25
- `20260225005439_95fb24d3-70de-4f1c-8fdb-f01a759633cb.sql` — creates `match_calls` and Daily room tracking fields.

### 2026-04-14
- `20260414171000_chat_call_contract_hardening.sql` — removes direct authenticated `messages` insert/update and `match_calls` insert/update policies so chat publishing must flow through `send-message`, match-call creation must flow through `daily-room`, and match-call lifecycle changes must flow through `match_call_transition`; this is the policy-side closure for the chat-call hardening pass.

### 2026-02-27
- `20260227000205_ad0f5696-2016-4bd4-aca1-4c9691c95735.sql` — adds phone verification columns to `profiles`.
- `20260227044110_ad1f69ae-6d15-4e01-8df7-a027994190a6.sql` — adds `profiles.referred_by`.

### 2026-02-28
- `20260228004543_88b1a174-6832-43c7-9987-c880f0018127.sql` — creates `email_drip_log`.

### 2026-03-01
- `20260301001911_6f1cff72-1925-4e1f-9638-dd67406151ec.sql` — adds `handshake_started_at`, `date_started_at`, and `phase` to `video_sessions`.

### 2026-03-03
- `20260303001003_48c59a0d-da5c-44eb-9405-ad7167aaa499.sql` — creates `photo_verifications` for admin review pipeline.

### 2026-03-04
- `20260304070841_939aa319-682b-4497-b46f-2b7b166898d0.sql` — allows authenticated users to view vibe-video intros.

### 2026-03-07
- `20260307235953_5a5e6851-a915-45c0-9c5a-3f3a608b5322.sql` — adds Bunny-native video identity fields: `bunny_video_uid`, `bunny_video_status`.

### 2026-03-08
- `20260308111830_7a8e3618-ec6f-4338-999a-499c94ef4312.sql` — clears legacy `video_intro_url` data before migration to Bunny-native fields.
- `20260308145056_7ba2db3e-f952-4e18-b75a-00c8f8d42463.sql` — drops `profiles.video_intro_url`.
- `20260308151948_54ae49cd-efca-47d2-ab08-b2ba3237e6e9.sql` — rewrites `get_event_deck()` signature and deck contents.
- `20260308153207_a3bb071b-1f69-481b-be52-34ac0bd26a4d.sql` — search_path/security-linter fixes on core helper functions.
- `20260308201324_7d16b6a9-0a63-4059-a738-a25c5a2af2ea.sql` — creates `subscriptions` and `get_user_subscription_status()`.
- `20260308202948_9bf8ddc2-663c-4cf0-9f1b-d0c8eeb3b6c0.sql` — adds `profiles.is_premium`.
- `20260308203622_5325e3cf-3b4d-4784-a8e2-61d332f0a28d.sql` — adds `event_registrations.payment_status`.
- `20260308214251_e2a9367c-5fcb-48c0-a16c-a9e23268d8f3.sql` — loosens/repairs `vibe_tags.category` constraint handling.
- `20260308221259_43805edf-157f-4157-b86a-ab09e8787745.sql` — creates `account_deletion_requests`.
- `20260308221841_a41e28c2-3d0d-43a4-9168-687cbabb0534.sql` — creates `age_gate_blocks` plus age-enforcement trigger.
- `20260308221853_4734cdb3-6032-4ce7-824e-c445fee37cdd.sql` — rewrites `check_age_requirement()` trigger function.
- `20260308223451_5cb15e92-a308-4e01-9dd8-f80a727bc382.sql` — locks `get_event_deck()` to `auth.uid() = p_user_id` and introduces Daily Drop candidate logic.

### 2026-03-09
- `20260309025904_e67e0f18-d092-4863-947e-f859aac7a978.sql` — creates `notification_preferences`, `notification_log`, `match_notification_mutes`, and auto-create preferences trigger.
- `20260309025913_4a26eafe-cba5-4764-875c-edd250a2ec04.sql` — fixes `create_notification_preferences()` search_path and tightens `notification_log` insertion policy.
- `20260309034333_6812c46a-0ce5-46f6-a3ae-0afea31710f6.sql` — removes overly broad Daily Drop profile-read policy that exposed sensitive columns.
- `20260309034647_9dff2a13-f846-4b46-9114-1297fa01cce5.sql` — expands `get_event_deck()` to include shared vibe counts.
- `20260309042852_52c78e2a-8131-44eb-8319-560227e5157e.sql` — drops old Daily Drop model and replaces it with new `daily_drops` + `daily_drop_cooldowns` schema.
- `20260309043602_8a55f497-4d7f-44ff-bf60-2b83f094d71f.sql` — adds `daily_drops` to `supabase_realtime` publication.
- `20260309050102_0e98bf2b-3b08-4fa1-bd9c-b833a37f63e9.sql` — creates `chat-videos` storage bucket and policies.

### 2026-03-10
- `20260310003534_7dccf499-0724-4dae-a6e4-6b170816431e.sql` — adds `video_url` and `video_duration_seconds` to `messages`.
- `20260310124808_84e1cfb5-c367-4e34-a610-b555e7907d5b.sql` — creates trigger protection for admin-managed/sensitive profile columns.
- `20260310124838_45630bae-e49a-4d34-a108-326f06e5ed18.sql` — adds `get_own_pii()` and rebalances profile PII visibility after an overly broad revoke.

---

## 9. What the migration history says about the product

The migration chain shows a clear product progression:

1. **Basic dating/event app core**  
   Profiles, events, registrations, matches, messages, vibe tags, video sessions.

2. **Trust and moderation maturity**  
   Verification attempts, blocking, reports, suspensions, warnings, admin notifications, admin activity logs.

3. **Live event/video date orchestration**  
   Queue states, ready-gate/session phases, matching functions, swipe logic, deck logic, Daily room tracking.

4. **Notification and re-engagement sophistication**  
   Push campaigns, push telemetry view, notification preferences/logs, email drip log.

5. **Monetization and account lifecycle**  
   Credits, subscriptions, payment status, account deletion requests, premium flags.

6. **Media surface expansion**  
   Profile photos, proof selfies, vibe videos, event covers, voice messages, chat videos.

The codebase was already substantially beyond MVP by the end of this chain.

---

## 10. Practical rebuild implications

### Implication 1 — cold replay is not guaranteed clean
Because test-data and environment-specific migrations exist, a brand-new empty project can fail or diverge during migration replay.

### Implication 2 — migration history is part schema, part operations log
Some files are not general-purpose migrations; they are snapshots of things the team did during debugging or live QA.

### Implication 3 — policies are first-class infrastructure
A large share of the migration history is about RLS correction and security repair. For Vibely, replaying schema without policies is not a real rebuild.

### Implication 4 — the frozen migration chain is not a perfect superset of the current typed schema
Because `feedback` and `premium_history` exist in generated types but not as CREATE TABLE migrations here, the repo snapshot alone does not fully explain the linked project’s full historical object graph.

---

## 11. Recommended next hardening step after this manifest

For long-term rebuildability, the migration chain should eventually be classified into four buckets:
- canonical structural migrations
- security/policy migrations
- data backfills/repairs
- test/QA-only operational migrations

That refactor has **not** been done yet in the frozen baseline, but this manifest identifies the places where it will matter most.

---

## 11b. Stream — canonical event admission + Stripe ticket settlement (2026-04-05)

- **Migration:** `supabase/migrations/20260405103000_event_admission_rpc_auth_stripe_settle.sql`
- **Table:** `public.stripe_event_ticket_settlements` — idempotency ledger for processing `checkout.session.completed` when `metadata.type = 'event_ticket'`
- **Column:** `public.event_registrations.admission_status` — `confirmed` | `waitlisted` | `canceled`; **`events.current_attendees` is maintained from confirmed rows only** (trigger `update_event_attendees`)
- **RLS:** `event_registrations` SELECT — own row, or any row for events where the viewer has a **confirmed** registration (cohort visibility)
- **RPCs (high level):** `register_for_event(p_event_id)` uses `auth.uid()` only for free confirmed admission; **`settle_event_ticket_checkout`** (service role) is the canonical paid settlement entrypoint; event-path mutations (`handle_swipe`, queue drain/leave/status, `join_matching_queue`, `find_video_date_match`, deck/visible-events helpers) bind **`auth.uid()`** and confirmed-admission rules where applicable
- **Note:** `ready_gate_transition`, `video_date_transition`, and `submit_post_date_verdict` already enforced participant identity via `auth.uid()` in earlier migrations; this stream did not need to redefine them

---

## 11c. Stream — paid waitlist promotion (2026-04-07)

- **Migrations:**
  - `supabase/migrations/20260407120000_paid_waitlist_promotion.sql` — `event_registrations.waitlisted_at`, `promoted_at`; `waitlist_promotion_notify_queue`; `on_registration_change` extended to **`UPDATE OF admission_status`** (so waitlist→confirmed updates `current_attendees`); `promote_waitlist_for_event_worker` / `promote_waitlist_for_event`; `cancel_event_registration`; `admin_remove_event_registration`; delete + `max_attendees` triggers calling the worker; `settle_event_ticket_checkout` sets `waitlisted_at` / enqueue notify on paid waitlist paths
  - `supabase/migrations/20260407121000_schedule_waitlist_promotion_notify_cron.sql` — historical: first cron schedule for this job via DB GUCs `app.supabase_url` + `app.cron_secret` (often not settable on hosted Supabase); **superseded for this job** by the Vault-backed migration below (job name unchanged: unschedule + reschedule replaces command body)
  - `supabase/migrations/20260408120000_waitlist_promotion_cron_vault.sql` — **`waitlist-promotion-notify-queue`** `pg_cron` job reads **`vault.decrypted_secrets`** rows named **`project_url`** and **`cron_secret`** (must match Edge `CRON_SECRET`); POSTs to `/functions/v1/process-waitlist-promotion-notify-queue`
- **Edge:** `supabase/functions/process-waitlist-promotion-notify-queue` — drains notify queue with Bearer token (cron: Vault `cron_secret`; Edge runtime: secret `CRON_SECRET`), invokes `send-notification` with category `event_waitlist_promoted` (maps to `notify_event_reminder`)

---

## 11d. Stream — Ready Gate / queue_status phase sync + server-owned reconnect grace (2026-04-09)

- **Migrations:**
  - `supabase/migrations/20260409100000_video_date_reconnect_grace_queue_sync.sql` — columns on `video_sessions`; `video_date_transition` gains `sync_reconnect`, `mark_reconnect_partner_away`, `mark_reconnect_return`; **per-call** expiry when `reconnect_grace_ends_at <= now()` (same row updates + `event_registrations` → `idle`)
  - `supabase/migrations/20260409110000_expire_video_date_reconnect_grace_cron.sql` — **`public.expire_video_date_reconnect_graces()`** (same end semantics as the RPC branch); **pg_cron** job `expire-video-date-reconnect-graces` every minute so grace expiry does not depend only on clients polling `sync_reconnect`
- **Table `public.video_sessions`:** `reconnect_grace_ends_at`, `participant_1_away_at`, `participant_2_away_at` — 30s grace, away markers cleared on return
- **`video_date_transition`:** `enter_handshake` / `end` / vibe paths align `event_registrations.queue_status` with handshake vs date vs survey/offline (no FIFO / `drain_match_queue` ordering changes)
- **Parity:** `20260408120000_waitlist_promotion_cron_vault.sql` — waitlist promotion HTTP cron via Vault secrets (`project_url`, `cron_secret`)

---

## 11e. Stream — events hardening Phase 1 + Phase 1.1 (2026-04-04)

- **Migrations:**
  - `supabase/migrations/20260404183000_phase1_presence_atomic_cleanup.sql`
    - adds `event_registrations.last_lobby_foregrounded_at`
    - hardens immediate-vs-queued behavior in `handle_swipe` and queued promotion in `drain_match_queue` to require queue status **and** recency (`last_lobby_foregrounded_at >= now() - 60s`)
    - makes `ready_gate_transition('forfeit')` atomic by clearing `event_registrations` linkage server-side
    - consolidates active date-end cleanup under `video_date_transition('end')`
  - `supabase/migrations/20260404191500_phase1_1_true_lobby_foreground.sql`
    - introduces `mark_lobby_foreground(p_event_id)` as the canonical foreground-proof RPC
    - narrows `update_participant_status(p_event_id, p_status)` so it no longer stamps `last_lobby_foregrounded_at`
- **Client-path implications:**
  - active product path no longer calls `leave_matching_queue` in web/mobile date exit flows
  - lobby foreground proof is refreshed only from actual lobby surfaces (web visibility/route gated; native focus + AppState gated)

---

## 11f. Stream — discovery preference controls (Sprint 2, 2026-04)

- **`supabase/migrations/20260407180000_sprint2_discovery_prefs.sql`**
  - **`profiles.preferred_age_min`**, **`profiles.preferred_age_max`** — nullable `smallint`, CHECK 18–99, min ≤ max when both set.
  - **`profiles.event_discovery_prefs`** — nullable `jsonb`, CHECK `jsonb_typeof = 'object'` when non-null; client-owned defaults for event list UI (`locationMode`, `distanceKm`, `selectedCity`); **not** used for premium entitlements (`get_visible_events` unchanged).
- **`supabase/migrations/20260415100000_get_event_deck_preferred_age.sql`**
  - **`CREATE OR REPLACE public.get_event_deck`** — same contract as post–`20260412120000` deck; adds filtering when target **`p.age` IS NOT NULL** against viewer `preferred_age_min` / `preferred_age_max` (open bounds when either null). **`p.age` NULL** still passes the age clause (no exclusion by age).
  - **Ordering:** Timestamp **after** `20260412120000_event_cancel_truth_capacity.sql` so this definition is not overwritten by that migration.

**Product surfaces (reference):** Web Settings → Discovery drawer [`src/components/settings/DiscoveryDrawer.tsx`](../src/components/settings/DiscoveryDrawer.tsx); native stack route `app/settings/discovery.tsx`. Events tabs seed filters from `event_discovery_prefs` (city mode applied only when tier allows `canCityBrowse`).

---

## 12. Bottom line

The Vibely migration history is rich, real, and operationally meaningful — but it is also messy in a very specific way:
- strong schema coverage
- strong policy/version history
- multiple late-stage product subsystems
- several noncanonical data/testing migrations mixed into the chain
- at least two schema objects visible in types but not created anywhere in the frozen SQL set

That means this migration manifest is not just an inventory. It is a warning label for rebuild strategy: **preserve the history, but do not replay it blindly.**
