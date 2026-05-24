import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const phase2Migration = readFileSync(
  join(root, "supabase/migrations/20260521203000_video_date_phase2_transaction_engine.sql"),
  "utf8",
);
const phase2CronTrimMigration = readFileSync(
  join(root, "supabase/migrations/20260522005000_video_date_phase2_trim_worker_cron_secret.sql"),
  "utf8",
);
const phase2ReviewFollowupsMigration = readFileSync(
  join(root, "supabase/migrations/20260522012500_video_date_review_comment_followups.sql"),
  "utf8",
);
const config = readFileSync(join(root, "supabase/config.toml"), "utf8");
const outboxDrainer = readFileSync(
  join(root, "supabase/functions/video-date-outbox-drainer/index.ts"),
  "utf8",
);
const deadlineFinalizer = readFileSync(
  join(root, "supabase/functions/video-date-deadline-finalizer/index.ts"),
  "utf8",
);

test("PR 2.1 command helpers detect request-hash idempotency conflicts", () => {
  assert.match(phase2Migration, /CREATE OR REPLACE FUNCTION public\.video_date_command_request_hash_v2/);
  assert.match(phase2Migration, /CREATE OR REPLACE FUNCTION public\.video_session_command_begin_v2/);
  assert.match(phase2Migration, /CREATE OR REPLACE FUNCTION public\.video_session_command_finish_v2/);
  assert.match(phase2Migration, /ON CONFLICT \(actor, idempotency_key\) DO NOTHING/);
  assert.match(phase2Migration, /FOR UPDATE/);
  assert.match(phase2Migration, /v_command\.session_id IS DISTINCT FROM p_session_id/);
  assert.match(phase2Migration, /v_command\.command_kind IS DISTINCT FROM v_kind/);
  assert.match(phase2Migration, /v_command\.request_hash IS DISTINCT FROM v_hash/);
  assert.match(phase2Migration, /v_command\.request_payload IS DISTINCT FROM v_payload/);
  assert.match(phase2Migration, /v_canonical_hash := public\.video_date_command_request_hash_v2/);
  assert.match(phase2Migration, /v_hash IS DISTINCT FROM v_canonical_hash/);
  assert.match(phase2Migration, /'error', 'idempotency_conflict'/);
  assert.match(phase2Migration, /'status', 'replay'/);
  assert.match(phase2Migration, /'status', 'replay_rejected'/);
  assert.match(phase2Migration, /p_actor IS DISTINCT FROM v_session\.participant_1_id/);
  assert.match(phase2Migration, /GRANT EXECUTE ON FUNCTION public\.video_session_command_begin_v2[\s\S]+TO service_role/);
  assert.match(phase2Migration, /GRANT EXECUTE ON FUNCTION public\.video_session_command_finish_v2[\s\S]+TO service_role/);
  assert.doesNotMatch(phase2Migration, /GRANT EXECUTE ON FUNCTION public\.video_session_command_(?:begin|finish)_v2[\s\S]+TO authenticated/);
});

test("PR 2.2 provider outbox has lease claim, safe completion, and no token persistence", () => {
  assert.match(phase2Migration, /CREATE OR REPLACE FUNCTION public\.video_date_outbox_enqueue_v2/);
  assert.match(phase2Migration, /CREATE OR REPLACE FUNCTION public\.claim_video_date_provider_outbox_v2/);
  assert.match(phase2Migration, /CREATE OR REPLACE FUNCTION public\.complete_video_date_provider_outbox_v2/);
  assert.match(phase2Migration, /pg_advisory_xact_lock\(hashtextextended\(/);
  assert.match(phase2Migration, /COALESCE\(p_session_id::text, 'global'\)/);
  assert.match(phase2Migration, /state IN \('pending', 'claimed', 'done'\)/);
  assert.match(phase2Migration, /FOR UPDATE SKIP LOCKED/);
  assert.match(phase2Migration, /state = 'claimed'/);
  assert.match(phase2Migration, /attempts = o\.attempts \+ 1/);
  assert.match(phase2Migration, /claim_expires_at = now\(\) \+ \(v_lease_seconds \* interval '1 second'\)/);
  assert.match(phase2Migration, /v_row\.state IS DISTINCT FROM 'claimed' OR v_row\.claimed_by IS DISTINCT FROM v_worker/);
  assert.match(phase2Migration, /'error', 'lease_expired'/);
  assert.match(phase2Migration, /state = 'done'/);
  assert.match(phase2Migration, /state = 'failed'/);
  assert.match(phase2Migration, /state = 'pending'/);
  assert.match(phase2Migration, /video_date_provider_outbox_no_secret_keys/);
  assert.doesNotMatch(phase2Migration, /meeting[_-]?token|daily_token|DAILY_API_KEY/i);
});

test("PR 2.3 deadline finalizer claims due rows and finalizes only under the lease", () => {
  assert.match(phase2Migration, /CREATE OR REPLACE FUNCTION public\.claim_video_session_deadlines_v2/);
  assert.match(phase2Migration, /CREATE OR REPLACE FUNCTION public\.complete_video_session_deadline_v2/);
  assert.match(phase2Migration, /CREATE OR REPLACE FUNCTION public\.finalize_video_session_deadline_v2/);
  assert.match(phase2Migration, /d\.state = 'pending'[\s\S]+d\.due_at <= now\(\)/);
  assert.match(phase2Migration, /FOR UPDATE SKIP LOCKED/);
  assert.match(phase2Migration, /v_deadline\.state IS DISTINCT FROM 'claimed'/);
  assert.match(phase2Migration, /v_deadline\.claim_expires_at IS NULL OR v_deadline\.claim_expires_at <= now\(\)/);
  assert.match(phase2Migration, /v_deadline\.kind IN \('handshake_auto_promote', 'handshake_timeout'\)/);
  assert.match(phase2Migration, /public\.finalize_video_date_handshake_deadline/);
  assert.match(phase2Migration, /WHERE id = v_deadline\.session_id\s+FOR UPDATE/);
  assert.match(phase2Migration, /'error', 'session_not_found'[\s\S]+'state', 'failed'/);
  assert.match(phase2Migration, /unsupported_deadline_kind/);
  assert.match(phase2Migration, /public\.append_video_session_event_v2/);
  assert.match(phase2Migration, /'deadline_finalized'/);
  assert.match(phase2Migration, /p_bump_seq boolean DEFAULT true/);
});

test("Phase 2 workers are cron-protected and configured in Supabase", () => {
  assert.match(config, /\[functions\.video-date-outbox-drainer\]\s+verify_jwt = false/);
  assert.match(config, /\[functions\.video-date-deadline-finalizer\]\s+verify_jwt = false/);

  assert.match(outboxDrainer, /CRON_SECRET/);
  assert.match(outboxDrainer, /safeEqual/);
  assert.match(outboxDrainer, /claim_video_date_provider_outbox_v2/);
  assert.match(outboxDrainer, /complete_video_date_provider_outbox_v2/);
  assert.match(outboxDrainer, /daily\.ensure_video_date_room/);
  assert.match(outboxDrainer, /daily\.delete_video_date_room/);
  assert.match(outboxDrainer, /providerState\.expired[\s\S]+await deleteDailyRoom\(supabase, roomName/);
  assert.match(outboxDrainer, /isDailyRoomUrlForName\(session\.daily_room_url, roomName, DAILY_DOMAIN\)/);
  assert.match(outboxDrainer, /typeof body\?\.url !== "string"[\s\S]+isDailyRoomUrlForName\(body\.url, roomName, DAILY_DOMAIN\)/);
  assert.match(outboxDrainer, /terminalRoomName[\s\S]+await deleteDailyRoom\(supabase, terminalRoomName/);
  assert.match(outboxDrainer, /\.select\("id"\)\s+\.maybeSingle\(\)/);
  assert.match(outboxDrainer, /skipped_terminal_after_provider_verify/);
  assert.match(outboxDrainer, /notification\.send/);
  assert.match(outboxDrainer, /videoDateRoomNameForSession/);
  assert.match(outboxDrainer, /send-notification/);
  assert.doesNotMatch(outboxDrainer, /meeting-tokens|createMeetingToken|tokenExpiresAt/);

  assert.match(deadlineFinalizer, /CRON_SECRET/);
  assert.match(deadlineFinalizer, /safeEqual/);
  assert.match(deadlineFinalizer, /claim_video_session_deadlines_v2/);
  assert.match(deadlineFinalizer, /finalize_video_session_deadline_v2/);
  assert.match(deadlineFinalizer, /complete_video_session_deadline_v2/);
  assert.match(deadlineFinalizer, /payload\.state === "failed"/);
  assert.match(deadlineFinalizer, /payload\.error \?\? "deadline_failed"/);
  assert.doesNotMatch(deadlineFinalizer, /DAILY_API_KEY|meeting-tokens|token/);
});

test("Phase 2 workers can be scheduled through Vault-backed pg_cron without hard-failing local stacks", () => {
  assert.match(phase2Migration, /video-date-outbox-drainer/);
  assert.match(phase2Migration, /video-date-deadline-finalizer/);
  assert.match(phase2Migration, /pg_extension WHERE extname = 'pg_cron'/);
  assert.match(phase2Migration, /pg_extension WHERE extname = 'pg_net'/);
  assert.match(phase2Migration, /vault\.decrypted_secrets/);
  assert.match(phase2Migration, /'Authorization', 'Bearer ' \|\| trim\(\(select decrypted_secret from vault\.decrypted_secrets where name = 'cron_secret'\)\)/);
  assert.doesNotMatch(phase2Migration, /'Authorization', 'Bearer ' \|\| \(select decrypted_secret from vault\.decrypted_secrets where name = 'cron_secret'\)/);
  assert.match(phase2CronTrimMigration, /cron\.unschedule\(jobid\)[\s\S]+video-date-outbox-drainer[\s\S]+video-date-deadline-finalizer/);
  assert.match(phase2CronTrimMigration, /btrim\(decrypted_secret, E' \\t\\n\\r'\)/);
  assert.match(
    phase2CronTrimMigration,
    /'Authorization', 'Bearer ' \|\| btrim\(\(select decrypted_secret from vault\.decrypted_secrets where name = 'cron_secret' limit 1\), E' \\t\\n\\r'\)/,
  );
  assert.match(phase2ReviewFollowupsMigration, /video-date phase2 worker cron btrim reschedule/);
  assert.match(phase2ReviewFollowupsMigration, /btrim\(\(select decrypted_secret from vault\.decrypted_secrets where name = 'project_url' limit 1\), E' \\t\\n\\r'\)/);
  assert.match(phase2ReviewFollowupsMigration, /sentry_claimed_at <= now\(\) - interval '15 minutes'/);
  assert.match(phase2ReviewFollowupsMigration, /slack_claimed_at <= now\(\) - interval '15 minutes'/);
  assert.match(phase2Migration, /missing Vault project_url or cron_secret/);
  assert.match(phase2Migration, /EXCEPTION[\s\S]+WHEN OTHERS THEN[\s\S]+worker cron scheduling skipped/);
});
