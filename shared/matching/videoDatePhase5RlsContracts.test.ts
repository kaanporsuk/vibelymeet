import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function functionSection(source: string, functionName: string, revokeName = functionName): string {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${functionName}`);
  assert.notEqual(start, -1, `${functionName} definition should exist`);
  const revoke = source.indexOf(`REVOKE ALL ON FUNCTION public.${revokeName}`, start);
  assert.notEqual(revoke, -1, `${revokeName} revoke block should follow definition`);
  return source.slice(start, revoke);
}

const config = read("supabase/config.toml");
const publicApiMigration = read("supabase/migrations/20260523123000_public_api_interface_changes.sql");
const paymentMigration = read("supabase/migrations/20260523200000_phase2_payments_durable_notifications.sql");
const v4FoundationMigration = read("supabase/migrations/20260521150000_video_date_v4_foundation.sql");
const transactionEngineMigration = read("supabase/migrations/20260521203000_video_date_phase2_transaction_engine.sql");
const snapshotCoreMigration = read("supabase/migrations/20260521193000_video_date_phase1_snapshot_event_id.sql");
const tokenRefreshFunction = read("supabase/functions/video-date-token-refresh/index.ts");
const validationPack = read("supabase/validation/video_date_phase5_rls_contracts.sql");
const packageJson = read("package.json");
const tokenRefreshLogBlocks = [...tokenRefreshFunction.matchAll(/console\.error\(JSON\.stringify\(\{[\s\S]*?\}\)\);/g)]
  .map((match) => match[0]);

const deckV3Section = functionSection(publicApiMigration, "get_event_deck_v3");
const queueHintSection = functionSection(publicApiMigration, "get_video_date_queue_hint_v1");
const paymentStatusSection = functionSection(paymentMigration, "get_event_ticket_payment_status_v1");
const snapshotCoreSection = functionSection(snapshotCoreMigration, "get_video_date_snapshot_core");
const refundEnqueueSection = functionSection(paymentMigration, "enqueue_event_ticket_refund_v1");
const refundClaimSection = functionSection(paymentMigration, "claim_event_ticket_refund_jobs_v1");
const refundCompleteSection = functionSection(paymentMigration, "complete_event_ticket_refund_job_v1");
const refundSupportSection = functionSection(paymentMigration, "ensure_event_ticket_refund_support_exception_v1");
const outboxEnqueueSection = functionSection(transactionEngineMigration, "video_date_outbox_enqueue_v2");
const outboxClaimSection = functionSection(transactionEngineMigration, "claim_video_date_provider_outbox_v2");
const outboxCompleteSection = functionSection(transactionEngineMigration, "complete_video_date_provider_outbox_v2");

test("Phase 5 deck v3 and queue hint contracts stay caller-scoped and typed", () => {
  assert.match(deckV3Section, /SECURITY DEFINER/);
  assert.match(deckV3Section, /v_viewer uuid := auth\.uid\(\)/);
  assert.match(deckV3Section, /IF v_viewer IS NULL OR v_viewer <> p_user_id THEN/);
  assert.match(deckV3Section, /RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501'/);
  assert.match(deckV3Section, /public\.get_event_lobby_active_state\(p_event_id, now\(\)\)/);
  assert.match(deckV3Section, /'reason', 'event_not_active'/);
  assert.match(deckV3Section, /'inactive_reason'/);
  assert.match(deckV3Section, /COALESCE\(er\.admission_status, 'confirmed'\) = 'confirmed'/);
  assert.match(deckV3Section, /'reason', 'not_registered'/);
  assert.match(deckV3Section, /public\.is_profile_hidden\(p_user_id\)/);
  assert.match(deckV3Section, /'reason', 'viewer_paused'/);
  assert.match(deckV3Section, /public\.record_event_profile_impression_v2/);
  assert.match(deckV3Section, /'server_dealt', true/);
  assert.match(deckV3Section, /'deck_version', 'v3'/);
  for (const reason of ["has_profiles", "event_not_active", "not_registered", "viewer_paused", "no_remaining_profiles"]) {
    assert.match(deckV3Section, new RegExp(reason));
  }
  for (const legacyReason of ["'ready'", "'no_confirmed_candidates'", "'scan_window_exhausted'"]) {
    assert.doesNotMatch(deckV3Section, new RegExp(legacyReason));
  }
  assert.match(publicApiMigration, /REVOKE ALL ON FUNCTION public\.get_event_deck_v3\(uuid, uuid, integer\) FROM PUBLIC, anon/);
  assert.match(publicApiMigration, /GRANT EXECUTE ON FUNCTION public\.get_event_deck_v3\(uuid, uuid, integer\)[\s\S]+TO authenticated, service_role/);

  assert.match(queueHintSection, /SECURITY DEFINER/);
  assert.match(queueHintSection, /v_uid uuid := auth\.uid\(\)/);
  assert.match(queueHintSection, /IF v_uid IS NULL OR v_uid <> p_user_id THEN/);
  assert.match(queueHintSection, /COALESCE\(er\.admission_status, 'confirmed'\) = 'confirmed'/);
  assert.match(queueHintSection, /'reason', 'not_registered'/);
  assert.match(queueHintSection, /ready_gate_status = 'queued'/);
  assert.match(queueHintSection, /COALESCE\(vs\.queued_expires_at, COALESCE\(vs\.started_at, now\(\)\) \+ interval '10 minutes'\) > now\(\)/);
  assert.match(queueHintSection, /public\.v_video_date_queue_fairness_candidates/);
  assert.match(queueHintSection, /'event_queued_count'/);
  assert.match(queueHintSection, /'user_queued_count'/);
  assert.match(queueHintSection, /'estimated_wait_seconds'/);
  assert.match(queueHintSection, /'relief_active'/);
  assert.match(publicApiMigration, /REVOKE ALL ON FUNCTION public\.get_video_date_queue_hint_v1\(uuid, uuid\) FROM PUBLIC, anon/);
  assert.match(publicApiMigration, /GRANT EXECUTE ON FUNCTION public\.get_video_date_queue_hint_v1\(uuid, uuid\)[\s\S]+TO authenticated, service_role/);
});

test("Phase 5 payment status is caller-derived and refund-aware without cross-user parameters", () => {
  assert.match(paymentStatusSection, /SECURITY DEFINER/);
  assert.match(paymentStatusSection, /v_uid uuid := auth\.uid\(\)/);
  assert.doesNotMatch(paymentStatusSection, /p_user_id|p_profile_id/);
  assert.match(paymentStatusSection, /IF v_uid IS NULL THEN/);
  assert.match(paymentStatusSection, /er\.profile_id = v_uid/);
  assert.match(paymentStatusSection, /i\.user_id = v_uid/);
  assert.match(paymentStatusSection, /s\.profile_id = v_uid/);
  assert.match(paymentStatusSection, /r\.profile_id = v_uid/);
  assert.match(paymentStatusSection, /v_checkout\.checkout_session_id IS NULL[\s\S]+s\.checkout_session_id = v_checkout\.checkout_session_id/);
  assert.match(paymentStatusSection, /v_checkout\.checkout_session_id IS NULL[\s\S]+r\.checkout_session_id = v_checkout\.checkout_session_id/);
  assert.match(paymentStatusSection, /'checkout'/);
  assert.match(paymentStatusSection, /'settlement'/);
  assert.match(paymentStatusSection, /'refund'/);
  assert.match(paymentStatusSection, /'support_needed'/);
  assert.match(paymentMigration, /REVOKE ALL ON FUNCTION public\.get_event_ticket_payment_status_v1\(uuid\) FROM PUBLIC, anon/);
  assert.match(paymentMigration, /GRANT EXECUTE ON FUNCTION public\.get_event_ticket_payment_status_v1\(uuid\)[\s\S]+TO authenticated, service_role/);
});

test("Phase 5 token refresh keeps Daily tokens inside authenticated active-session boundaries", () => {
  assert.match(config, /\[functions\.video-date-token-refresh\]\s+verify_jwt = true/);
  assert.match(tokenRefreshFunction, /const authHeader = req\.headers\.get\("Authorization"\)/);
  assert.match(tokenRefreshFunction, /supabase\.auth\.getUser\(\)/);
  assert.match(tokenRefreshFunction, /UUID_PATTERN\.test\(sessionId\)/);
  assert.match(tokenRefreshFunction, /supabase\.rpc\("get_video_date_snapshot_core"/);
  assert.match(tokenRefreshFunction, /snapshot\?\.error === "not_participant" \? 403/);
  assert.match(tokenRefreshFunction, /phase !== "handshake" && phase !== "date"/);
  assert.match(tokenRefreshFunction, /error: "session_not_active"/);
  assert.match(tokenRefreshFunction, /error: "room_not_ready"/);
  assert.match(tokenRefreshFunction, /"Cache-Control": "no-store"/);
  assert.match(tokenRefreshFunction, /ejectAtTokenExp: true/);
  assert.doesNotMatch(tokenRefreshFunction, /SERVICE_ROLE|service_role/i);
  assert.doesNotMatch(tokenRefreshFunction, /\.from\(/);
  assert.doesNotMatch(tokenRefreshFunction, /video_date_outbox|outbox/i);
  assert.ok(tokenRefreshLogBlocks.length > 0, "token refresh should keep structured failure logging");
  for (const logBlock of tokenRefreshLogBlocks) {
    assert.doesNotMatch(logBlock, /tokenResult|payload\.token|DAILY_API_KEY|Authorization/);
  }

  assert.match(snapshotCoreSection, /v_uid uuid := auth\.uid\(\)/);
  assert.match(snapshotCoreSection, /RETURN jsonb_build_object\('ok', false, 'error', 'not_authenticated'\)/);
  assert.match(snapshotCoreSection, /v_uid IS DISTINCT FROM v_session\.participant_1_id/);
  assert.match(snapshotCoreSection, /v_uid IS DISTINCT FROM v_session\.participant_2_id/);
  assert.match(snapshotCoreSection, /'error', 'not_participant'/);
  assert.match(snapshotCoreSection, /WHEN v_session\.ended_at IS NOT NULL OR v_session\.state::text = 'ended' THEN 'ended'/);
  assert.doesNotMatch(snapshotCoreSection, /meeting-token|meeting_token|daily_token|token'/i);
});

test("Phase 5 outbox and refund worker surfaces remain service-role only", () => {
  assert.match(v4FoundationMigration, /ALTER TABLE public\.video_date_provider_outbox ENABLE ROW LEVEL SECURITY/);
  assert.match(v4FoundationMigration, /REVOKE ALL ON TABLE public\.video_date_provider_outbox FROM PUBLIC, anon, authenticated/);
  assert.match(v4FoundationMigration, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.video_date_provider_outbox TO service_role/);
  assert.match(v4FoundationMigration, /video_date_provider_outbox_no_top_level_token/);
  assert.match(v4FoundationMigration, /video_date_provider_outbox_no_secret_keys/);

  assert.match(paymentMigration, /ALTER TABLE public\.stripe_event_ticket_refunds ENABLE ROW LEVEL SECURITY/);
  assert.match(paymentMigration, /REVOKE ALL ON TABLE public\.stripe_event_ticket_refunds FROM PUBLIC, anon, authenticated/);
  assert.match(paymentMigration, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.stripe_event_ticket_refunds TO service_role/);
  assert.match(paymentMigration, /CREATE POLICY stripe_event_ticket_refunds_service_role_all/);
  assert.match(paymentMigration, /USING \(auth\.role\(\) = 'service_role'\)/);

  for (const section of [outboxEnqueueSection, outboxClaimSection, outboxCompleteSection]) {
    assert.match(section, /SECURITY DEFINER/);
  }
  assert.match(transactionEngineMigration, /REVOKE ALL ON FUNCTION public\.video_date_outbox_enqueue_v2\(uuid, text, jsonb, text, timestamptz\)[\s\S]+FROM PUBLIC, anon, authenticated/);
  assert.match(transactionEngineMigration, /GRANT EXECUTE ON FUNCTION public\.video_date_outbox_enqueue_v2\(uuid, text, jsonb, text, timestamptz\)[\s\S]+TO service_role/);
  assert.match(transactionEngineMigration, /REVOKE ALL ON FUNCTION public\.claim_video_date_provider_outbox_v2\(text, integer, integer\)[\s\S]+FROM PUBLIC, anon, authenticated/);
  assert.match(transactionEngineMigration, /GRANT EXECUTE ON FUNCTION public\.claim_video_date_provider_outbox_v2\(text, integer, integer\)[\s\S]+TO service_role/);
  assert.match(transactionEngineMigration, /REVOKE ALL ON FUNCTION public\.complete_video_date_provider_outbox_v2\(bigint, text, boolean, text, integer, boolean\)[\s\S]+FROM PUBLIC, anon, authenticated/);
  assert.match(transactionEngineMigration, /GRANT EXECUTE ON FUNCTION public\.complete_video_date_provider_outbox_v2\(bigint, text, boolean, text, integer, boolean\)[\s\S]+TO service_role/);

  for (const section of [refundEnqueueSection, refundClaimSection, refundCompleteSection, refundSupportSection]) {
    assert.match(section, /SECURITY DEFINER/);
    assert.match(section, /auth\.role\(\) IS DISTINCT FROM 'service_role'/);
  }
  assert.match(paymentMigration, /REVOKE ALL ON FUNCTION public\.enqueue_event_ticket_refund_v1\(text, uuid, uuid, text, integer, text, text, text, text, jsonb\)[\s\S]+FROM PUBLIC, anon, authenticated/);
  assert.match(paymentMigration, /GRANT EXECUTE ON FUNCTION public\.enqueue_event_ticket_refund_v1\(text, uuid, uuid, text, integer, text, text, text, text, jsonb\)[\s\S]+TO service_role/);
  assert.match(paymentMigration, /REVOKE ALL ON FUNCTION public\.claim_event_ticket_refund_jobs_v1\(text, integer, integer\)[\s\S]+FROM PUBLIC, anon, authenticated/);
  assert.match(paymentMigration, /GRANT EXECUTE ON FUNCTION public\.claim_event_ticket_refund_jobs_v1\(text, integer, integer\)[\s\S]+TO service_role/);
  assert.match(paymentMigration, /REVOKE ALL ON FUNCTION public\.complete_event_ticket_refund_job_v1\(uuid, text, boolean, text, text, text, integer, boolean, boolean\)[\s\S]+FROM PUBLIC, anon, authenticated/);
  assert.match(paymentMigration, /GRANT EXECUTE ON FUNCTION public\.complete_event_ticket_refund_job_v1\(uuid, text, boolean, text, text, text, integer, boolean, boolean\)[\s\S]+TO service_role/);
});

test("Phase 5 validation and test packs are wired into the no-build safety net", () => {
  assert.match(validationPack, /video_date_phase5_public_rpc_acl/);
  assert.match(validationPack, /video_date_phase5_public_rpc_definer_guards/);
  assert.match(validationPack, /video_date_phase5_outbox_refund_tables_service_role_only/);
  assert.match(validationPack, /video_date_phase5_worker_rpcs_service_role_only/);
  assert.match(validationPack, /video_date_phase5_snapshot_core_participant_scoped/);
  assert.match(validationPack, /video_date_phase5_payment_status_caller_scoped/);
  assert.match(packageJson, /videoDatePhase5RlsContracts\.test\.ts/);
  assert.match(packageJson, /videoDatePublicApiRlsRuntime\.test\.ts/);
});
