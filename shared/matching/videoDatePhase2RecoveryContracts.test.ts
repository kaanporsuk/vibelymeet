import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/20260521214500_video_date_phase2_recovery_webhooks_cleanup.sql"),
  "utf8",
);
const config = readFileSync(join(root, "supabase/config.toml"), "utf8");
const dailyWebhook = readFileSync(
  join(root, "supabase/functions/video-date-daily-webhook/index.ts"),
  "utf8",
);
const orphanCleanup = readFileSync(
  join(root, "supabase/functions/video-date-orphan-room-cleanup/index.ts"),
  "utf8",
);

test("PR 2.4 adds service-role recovery dashboards and alert summaries", () => {
  assert.match(migration, /ALTER TABLE public\.event_registrations\s+ADD COLUMN IF NOT EXISTS updated_at timestamptz/);
  assert.match(migration, /UPDATE public\.event_registrations\s+SET updated_at = registered_at\s+WHERE updated_at IS NULL/);
  assert.match(migration, /ALTER COLUMN updated_at SET DEFAULT now\(\)/);
  assert.match(migration, /Ready Gate suppression and queue lifecycle RPCs/);
  assert.match(migration, /CREATE OR REPLACE VIEW public\.vw_video_date_lease_recovery_health/);
  assert.match(migration, /CREATE OR REPLACE VIEW public\.vw_video_date_recovery_alerts/);
  assert.match(migration, /CREATE OR REPLACE VIEW public\.vw_video_date_provider_room_reconciliation/);
  assert.match(migration, /CREATE OR REPLACE VIEW public\.vw_video_date_orphan_room_cleanup_health/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_video_date_phase2_recovery_health\(\)/);
  assert.match(migration, /expired_lease_count/);
  assert.match(migration, /late_due_count/);
  assert.match(migration, /high_attempt_count/);
  assert.match(migration, /failed_count/);
  assert.match(migration, /'severity', v_severity/);
  assert.match(migration, /REVOKE ALL ON public\.vw_video_date_lease_recovery_health FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT SELECT ON public\.vw_video_date_lease_recovery_health TO service_role/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_video_date_phase2_recovery_health\(\)[\s\S]+FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_video_date_phase2_recovery_health\(\)[\s\S]+TO service_role/);
  assert.doesNotMatch(migration, /meeting[_-]?token|daily_token|DAILY_API_KEY/i);
});

test("PR 2.5 Daily webhook endpoint verifies signatures and writes an idempotent ledger", () => {
  assert.match(config, /\[functions\.video-date-daily-webhook\]\s+verify_jwt = false/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.video_date_daily_webhook_events/);
  assert.match(migration, /provider_event_id text NOT NULL UNIQUE/);
  assert.match(migration, /video_date_daily_webhook_events_no_secret_keys/);
  assert.match(migration, /ON CONFLICT \(provider_event_id\) DO NOTHING/);
  assert.match(migration, /length\(v_provider_event_id\) > 500/);
  assert.doesNotMatch(migration, /v_provider_event_id text := left/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.record_video_date_daily_webhook_event_v2/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.record_video_date_daily_webhook_event_v2[\s\S]+TO service_role/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.video_date_daily_webhook_events FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /'daily_webhook_reconciled'/);
  assert.match(migration, /'internal'/);
  assert.match(migration, /public\.evaluate_client_feature_flag\('video_date\.daily_webhooks_v2', v_actor\)/);
  assert.match(migration, /ignored_feature_disabled/);
  assert.match(migration, /v_event_kind IN \('participant\.joined', 'participant\.join'\)/);
  assert.match(migration, /v_event_kind IN \('participant\.left', 'participant\.leave'\)/);
  assert.match(migration, /PERFORM public\.bump_video_session_seq\(v_session\.id\)/);
  assert.doesNotMatch(migration, /handshake_started_at\s*=/);

  assert.match(dailyWebhook, /const SIGNATURE_HEADER = "x-webhook-signature"/);
  assert.match(dailyWebhook, /const TIMESTAMP_HEADER = "x-webhook-timestamp"/);
  assert.match(dailyWebhook, /DAILY_WEBHOOK_SECRET/);
  assert.match(dailyWebhook, /MAX_TIMESTAMP_SKEW_MS = 5 \* 60 \* 1000/);
  assert.match(dailyWebhook, /crypto\.subtle\.importKey/);
  assert.match(dailyWebhook, /crypto\.subtle\.sign\(\s*"HMAC"/);
  assert.match(dailyWebhook, /`\$\{SIGNATURE_VERSION\}:\$\{timestampHeader\}:\$\{rawBody\}`/);
  assert.match(dailyWebhook, /signatureFromHeader\(req\.headers\.get\(SIGNATURE_HEADER\)\)/);
  assert.match(dailyWebhook, /safeEqual\(received, expected\)/);
  assert.match(dailyWebhook, /const rawBody = await req\.text\(\)/);
  assert.match(dailyWebhook, /JSON\.parse\(rawBody\)/);
  assert.match(dailyWebhook, /function sanitizeWebhookPayload/);
  assert.match(dailyWebhook, /hasSecretishKey/);
  assert.match(dailyWebhook, /redacted_fields/);
  assert.equal(dailyWebhook.includes('sanitized[key] = "[redacted]"'), false);
  assert.match(dailyWebhook, /p_payload: sanitizeWebhookPayload\(payload\)/);
  assert.match(dailyWebhook, /record_video_date_daily_webhook_event_v2/);
  assert.doesNotMatch(dailyWebhook, /meeting-tokens|createMeetingToken|daily_token|tokenExpiresAt/);
  assert.doesNotMatch(dailyWebhook, /console\.log\(rawBody|console\.error\(rawBody/);
});

test("PR 2.6 Daily orphan-room cleanup is cron-protected and presence-gated before delete", () => {
  assert.match(config, /\[functions\.video-date-orphan-room-cleanup\]\s+verify_jwt = false/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.video_date_orphan_room_cleanup_audit/);
  assert.match(migration, /video_date_orphan_room_cleanup_audit_no_secret_keys/);
  assert.match(migration, /delete_candidate/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.record_video_date_orphan_room_cleanup_audit_v2/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.record_video_date_orphan_room_cleanup_audit_v2[\s\S]+TO service_role/);
  assert.match(migration, /video-date-orphan-room-cleanup/);
  assert.match(migration, /pg_extension WHERE extname = 'pg_cron'/);
  assert.match(migration, /pg_extension WHERE extname = 'pg_net'/);
  assert.match(migration, /vault\.decrypted_secrets/);
  assert.match(migration, /missing Vault project_url or cron_secret/);
  assert.match(migration, /EXCEPTION[\s\S]+WHEN OTHERS THEN[\s\S]+orphan room cleanup cron scheduling skipped/);

  assert.match(orphanCleanup, /CRON_SECRET/);
  assert.match(orphanCleanup, /safeEqual/);
  assert.match(orphanCleanup, /const VIDEO_DATE_ROOM_RE = \/\^date-\[0-9a-f\]\{32\}\$\/;/);
  assert.match(orphanCleanup, /DEFAULT_ROOM_LIST_MAX_PAGES = 10/);
  assert.match(orphanCleanup, /pagesScanned < maxPages/);
  assert.match(orphanCleanup, /max_pages/);
  assert.equal(orphanCleanup.includes("!isTerminalSession(row) && isTerminalSession(existing)"), true);
  assert.match(orphanCleanup, /url\.searchParams\.set\("ending_before", endingBefore\)/);
  assert.match(orphanCleanup, /\/rooms\/\$\{[\s\S]*encodeURIComponent\(roomName\)[\s\S]*\}\/presence\?limit=100/);
  assert.match(orphanCleanup, /if \(presence\.exists && presence\.activeCount > 0\)/);
  assert.match(orphanCleanup, /await deleteDailyRoom\(room\.name\)/);
  assert.match(orphanCleanup, /record_video_date_orphan_room_cleanup_audit_v2/);
  assert.match(orphanCleanup, /action: "delete_candidate"/);
  assert.match(orphanCleanup, /if \(!candidateAudited\)/);
  assert.match(orphanCleanup, /dry_run/);
  assert.match(orphanCleanup, /active_db_session/);
  assert.match(orphanCleanup, /provider_presence_active/);
  assert.match(orphanCleanup, /orphan_grace_window/);
  assert.match(orphanCleanup, /terminal_grace_window/);
  assert.doesNotMatch(orphanCleanup, /meeting-tokens|createMeetingToken|daily_token|tokenExpiresAt/);
});
