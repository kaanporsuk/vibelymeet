import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const foundationMigration = readFileSync(
  join(root, "supabase/migrations/20260521150000_video_date_v4_foundation.sql"),
  "utf8",
);
const dailyRoomIndex = readFileSync(
  join(root, "supabase/functions/daily-room/index.ts"),
  "utf8",
);

test("v4 foundation uses explicit session_seq bumps instead of noisy update triggers", () => {
  assert.match(foundationMigration, /ADD COLUMN IF NOT EXISTS session_seq bigint NOT NULL DEFAULT 0/);
  assert.match(foundationMigration, /CREATE OR REPLACE FUNCTION public\.bump_video_session_seq/);
  assert.doesNotMatch(foundationMigration, /CREATE\s+TRIGGER[\s\S]+session_seq/i);
});

test("v4 foundation carries Phase 0 additive primitives", () => {
  assert.match(foundationMigration, /ADD COLUMN IF NOT EXISTS is_test_event boolean NOT NULL DEFAULT false/);
  assert.match(foundationMigration, /ADD COLUMN IF NOT EXISTS ready_gate_suppressed_until timestamptz/);
  assert.match(foundationMigration, /CREATE TABLE IF NOT EXISTS public\.event_participant_runtime_state/);
  assert.match(foundationMigration, /CREATE OR REPLACE FUNCTION public\.record_heartbeat_v2/);
  assert.match(foundationMigration, /CREATE OR REPLACE FUNCTION public\.record_readiness_check_v2/);
  assert.match(foundationMigration, /CREATE OR REPLACE FUNCTION public\.record_heartbeat_v2[\s\S]+COALESCE\(er\.admission_status, 'confirmed'\) = 'confirmed'/);
  assert.match(foundationMigration, /CREATE OR REPLACE FUNCTION public\.record_readiness_check_v2[\s\S]+COALESCE\(er\.admission_status, 'confirmed'\) = 'confirmed'/);
});

test("v4 event log has visibility classes and participant-safe RLS", () => {
  assert.match(foundationMigration, /visibility text NOT NULL DEFAULT 'participants'/);
  assert.match(foundationMigration, /'participants', 'actor_only', 'internal', 'safety_review'/);
  assert.match(foundationMigration, /sanitized_payload jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(foundationMigration, /GRANT SELECT \([\s\S]+sanitized_payload[\s\S]+\) ON public\.video_session_events TO authenticated/);
  assert.doesNotMatch(foundationMigration, /GRANT SELECT ON TABLE public\.video_session_events TO authenticated/);
  assert.match(foundationMigration, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.video_session_events TO service_role/);
  assert.match(foundationMigration, /Participants can read sanitized video session events/);
  assert.match(foundationMigration, /visibility = 'participants'[\s\S]+participant_1_id = auth\.uid\(\)/);
  assert.match(foundationMigration, /Actors can read own actor-only video session events/);
  assert.match(foundationMigration, /CREATE OR REPLACE VIEW public\.video_session_participant_events/);
  assert.match(foundationMigration, /sanitized_payload AS payload/);
  assert.match(foundationMigration, /WITH \(security_invoker = true\)/);
  assert.match(foundationMigration, /GRANT SELECT ON TABLE public\.video_session_participant_events TO authenticated/);
});

test("v4 commands and provider outbox preserve idempotency and token secrecy", () => {
  assert.match(foundationMigration, /CREATE TABLE IF NOT EXISTS public\.video_session_commands/);
  assert.match(foundationMigration, /request_hash text NOT NULL/);
  assert.match(foundationMigration, /UNIQUE \(actor, idempotency_key\)/);
  assert.match(foundationMigration, /video_date_provider_outbox_no_top_level_token/);
  assert.match(foundationMigration, /NOT \(payload \? 'token'\)/);
  assert.match(foundationMigration, /CREATE OR REPLACE FUNCTION public\.video_date_jsonb_has_secret_key/);
  assert.match(foundationMigration, /video_session_events_no_payload_secret_keys/);
  assert.match(foundationMigration, /video_session_commands_no_secret_keys/);
  assert.match(foundationMigration, /video_date_provider_outbox_no_secret_keys/);
  assert.match(foundationMigration, /event_profile_impressions_no_metadata_secret_keys/);
  assert.match(foundationMigration, /event_profile_impression_events_no_metadata_secret_keys/);
  assert.match(foundationMigration, /lower\(v_key\) LIKE '%token%'/);
});

test("v4 server-dealt impressions are stronger than client refs", () => {
  assert.match(foundationMigration, /CREATE TABLE IF NOT EXISTS public\.event_profile_impressions/);
  assert.match(foundationMigration, /strongest_exclusion_reason text NOT NULL/);
  assert.match(foundationMigration, /CREATE TABLE IF NOT EXISTS public\.event_profile_impression_events/);
  assert.match(foundationMigration, /CREATE OR REPLACE FUNCTION public\.record_deck_deal_v2/);
  assert.match(foundationMigration, /CREATE OR REPLACE FUNCTION public\.get_event_deck_v2/);
  assert.match(foundationMigration, /FROM public\.event_registrations er[\s\S]+er\.profile_id = p_viewer_id[\s\S]+COALESCE\(er\.admission_status, 'confirmed'\) = 'confirmed'/);
  assert.match(foundationMigration, /er\.profile_id = p_target_id[\s\S]+target_not_registered/);
  assert.match(foundationMigration, /CREATE OR REPLACE FUNCTION public\.get_event_deck_v2[\s\S]+er\.profile_id = p_user_id[\s\S]+RAISE EXCEPTION 'not_registered'/);
  assert.match(foundationMigration, /pg_advisory_xact_lock\([\s\S]+video_date_deck_v2:/);
  assert.match(foundationMigration, /v_scan_limit integer := LEAST\(GREATEST/);
  assert.match(foundationMigration, /record_event_profile_impression_v2\([\s\S]+get_event_deck_v2_top/);
});

test("v4 snapshot core is token-free and Edge-owned Daily token paths eject at token expiry", () => {
  assert.match(foundationMigration, /CREATE OR REPLACE FUNCTION public\.get_video_date_snapshot_core/);
  assert.match(foundationMigration, /Token-free video date snapshot/);
  assert.match(foundationMigration, /'tokenRequired', true/);
  assert.doesNotMatch(foundationMigration, /'token'\s*,\s*v_/);

  const videoDateTokenCalls = dailyRoomIndex.match(/DAILY_VIDEO_DATE(?:_SOLO_PREJOIN)?_TOKEN_TTL_SECONDS,[\s\S]{0,120}\{ ejectAtTokenExp: true \}/g) ?? [];
  assert.ok(
    videoDateTokenCalls.length >= 4,
    "all video-date token issuance paths should opt into eject_at_token_exp",
  );
});
