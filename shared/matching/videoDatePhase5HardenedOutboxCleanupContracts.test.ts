import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read("supabase/migrations/20260524203000_video_date_phase5_hardened_outbox_finalizer_cleanup.sql");
const reviewComments1041To1049Migration = read("supabase/migrations/20260525180000_review_comments_1041_1049.sql");
const reliabilityMigration = read("supabase/migrations/20260524090000_video_date_phase1_provider_reliability.sql");
const helper = read("supabase/functions/_shared/video-date-provider-reliability.ts");
const outboxDrainer = read("supabase/functions/video-date-outbox-drainer/index.ts");
const deadlineFinalizer = read("supabase/functions/video-date-deadline-finalizer/index.ts");
const dailyWebhook = read("supabase/functions/video-date-daily-webhook/index.ts");
const orphanCleanup = read("supabase/functions/video-date-orphan-room-cleanup/index.ts");
const flags = read("shared/featureFlags/videoDateV4Flags.ts");
const packageJson = read("package.json");
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("Phase 5 seeds shared operational flags for all client surfaces", () => {
  for (const flag of [
    "video_date.outbox_lease_refresh_v2",
    "video_date.deadline_partial_unique_v2",
    "video_date.orphan_safety_interlock_v2",
    "video_date.circuit_breaker_v2",
  ]) {
    assert.match(migration, new RegExp(`'${escapeRegExp(flag)}', false, 0`));
    assert.match(flags, new RegExp(`"${escapeRegExp(flag)}"`));
  }
});

test("Phase 5 makes outbox/deadline claims indexable and active deadlines uniquely enforced", () => {
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_vdpo_state_kind_active[\s\S]+ON public\.video_date_provider_outbox\(state, kind\)[\s\S]+WHERE state IN \('pending', 'claimed'\)/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_vsd_state_kind_active[\s\S]+ON public\.video_session_deadlines\(state, kind\)[\s\S]+WHERE state IN \('pending', 'claimed'\)/);
  assert.match(migration, /phase5_duplicate_video_session_deadlines/);
  assert.match(migration, /row_number\(\) OVER \([\s\S]+PARTITION BY d\.session_id, d\.kind/);
  assert.match(migration, /phase5_duplicate_active_deadline_retired/);
  assert.match(migration, /ALTER TABLE public\.video_session_deadlines DROP CONSTRAINT/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS video_session_deadlines_active_session_kind_uidx[\s\S]+ON public\.video_session_deadlines\(session_id, kind\)[\s\S]+WHERE state IN \('pending', 'claimed'\)/);
});

test("Phase 5 preserves lease refresh and permanent failure logging in the workers", () => {
  assert.match(reliabilityMigration, /CREATE TABLE IF NOT EXISTS public\.video_date_provider_outbox_failure_log/);
  assert.match(reliabilityMigration, /CREATE TABLE IF NOT EXISTS public\.video_date_provider_dead_letters/);
  assert.match(reliabilityMigration, /refresh_video_date_provider_outbox_claim_v1/);
  assert.match(reliabilityMigration, /refresh_video_session_deadline_claim_v1/);
  assert.match(helper, /Math\.min\(25_000/);
  assert.match(helper, /refresh_video_date_provider_outbox_claim_v1/);
  assert.match(helper, /refresh_video_session_deadline_claim_v1/);
  for (const source of [outboxDrainer, deadlineFinalizer]) {
    assert.match(source, /createClaimLeaseRefresher/);
    assert.match(source, /rowLease\.isLost\(\)/);
    assert.match(source, /deadLetterVideoDateProviderFailure/);
    assert.match(source, /logVideoDateProviderFailure/);
  }
});

test("Phase 5 routes signed Daily webhook permanent failures into a sanitized DLQ", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.video_date_webhook_dlq/);
  assert.match(migration, /video_date_webhook_dlq_no_secret_keys/);
  assert.match(migration, /video_date_webhook_dlq_provider_payload_error_uidx/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.record_video_date_webhook_dlq_v1/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.record_video_date_webhook_dlq_v1[\s\S]+TO service_role/);
  assert.match(dailyWebhook, /sha256Hex\(rawBody\)/);
  assert.match(dailyWebhook, /record_video_date_webhook_dlq_v1/);
  assert.match(dailyWebhook, /SECRETISH_EXACT_KEYS/);
  assert.match(dailyWebhook, /lower\.includes\("bearer"\)/);
  assert.match(dailyWebhook, /SECRETISH_EXACT_KEYS\.has\(normalized\)/);
  assert.match(dailyWebhook, /data\?\.ok === false/);
  assert.match(dailyWebhook, /dlq_rejected/);
  assert.match(dailyWebhook, /errorClass: "invalid_json"/);
  assert.match(dailyWebhook, /errorClass: "payload_must_be_object"/);
  assert.match(dailyWebhook, /errorClass: "provider_event_id_or_type_missing"/);
  assert.match(dailyWebhook, /errorClass: "webhook_record_failed"/);
  assert.match(dailyWebhook, /retryable: true/);
  assert.doesNotMatch(dailyWebhook, /p_sanitized_payload:\s*payload/);
});

test("Phase 5 cleanup checks safety evidence before Daily room deletion", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.video_date_orphan_safety_interlock_v1/);
  assert.match(migration, /visibility = 'safety_review'/);
  assert.match(migration, /ur\.status = 'pending'/);
  assert.match(migration, /v_latest_safety_at \+ interval '7 days'/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.video_date_orphan_safety_interlock_v1\(uuid, text\)[\s\S]+TO service_role/);
  assert.match(orphanCleanup, /video_date_orphan_safety_interlock_v1/);
  assert.match(orphanCleanup, /action: "skipped_safety_review"/);
  assert.match(orphanCleanup, /reason: "safety_interlock_unavailable"/);
  assert.match(reviewComments1041To1049Migration, /CREATE OR REPLACE FUNCTION public\.record_video_date_orphan_room_cleanup_audit_v2/);
  assert.match(reviewComments1041To1049Migration, /'skipped_safety_review'/);
  assert.match(reviewComments1041To1049Migration, /TO service_role/);
  assert.ok(
    orphanCleanup.indexOf("checkSafetyInterlock") < orphanCleanup.indexOf("getDailyRoomPresence(room.name)"),
    "cleanup must run the safety interlock before the first provider presence/delete path",
  );
});

test("Phase 5 suppresses empty sanitized participant broadcasts in single and batched modes", () => {
  assert.match(migration, /CREATE POLICY "Safety review video session events require staff"/);
  assert.match(migration, /AS RESTRICTIVE/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.broadcast_video_session_event_v2\(\)/);
  assert.match(migration, /IF v_sanitized_payload = '\{\}'::jsonb THEN[\s\S]+RETURN NULL/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.broadcast_video_session_events_batched_v2\(\)/);
  assert.match(migration, /WHERE s\.sanitized_payload <> '\{\}'::jsonb/);
});

test("Phase 5 exposes a service-role circuit breaker decision and dry-run rollback RPC", () => {
  assert.match(migration, /CREATE OR REPLACE VIEW public\.vw_video_date_phase5_circuit_breaker_decision/);
  assert.match(migration, /stuck_outbox_claims/);
  assert.match(migration, /active_deadline_duplicates/);
  assert.match(migration, /recent_webhook_dlq_rows/);
  assert.match(migration, /recent_safety_interlock_failures/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_video_date_circuit_breaker_decision_v1\(\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.apply_video_date_circuit_breaker_v1/);
  assert.match(migration, /p_dry_run boolean DEFAULT true/);
  assert.match(migration, /kill_switch_active = true/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.apply_video_date_circuit_breaker_v1\(text, boolean\)[\s\S]+TO service_role/);
});

test("Phase 5 Daily provider room validation remains strict against provider field drift", () => {
  assert.match(outboxDrainer, /body\.name !== roomName/);
  assert.match(outboxDrainer, /isDailyRoomUrlForName\(body\.url, roomName, DAILY_DOMAIN\)/);
  assert.match(outboxDrainer, /const exp = body\?\.config\?\.exp/);
  assert.match(outboxDrainer, /body\.config\?\.max_participants !== 2/);
  assert.match(outboxDrainer, /daily_create_failed:invalid_room_response/);
});

test("Phase 5 contracts are included in the v4 verification script", () => {
  assert.match(packageJson, /shared\/matching\/videoDatePhase5HardenedOutboxCleanupContracts\.test\.ts/);
});
