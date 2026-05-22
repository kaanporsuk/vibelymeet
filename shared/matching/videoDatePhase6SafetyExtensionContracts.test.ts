import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/20260522014000_video_date_phase6_safety_extension_certification.sql"),
  "utf8",
);
const refundMigration = readFileSync(
  join(root, "supabase/migrations/20260508142000_video_date_refund_on_platform_failure.sql"),
  "utf8",
);
const reviewFollowupsMigration = readFileSync(
  join(root, "supabase/migrations/20260522023000_video_date_review_comment_followups_986_989.sql"),
  "utf8",
);
const transitionCommands = readFileSync(
  join(root, "shared/matching/videoDateTransitionCommands.ts"),
  "utf8",
);
const extensionSpend = readFileSync(
  join(root, "shared/matching/videoDateExtensionSpend.ts"),
  "utf8",
);
const webVideoDate = readFileSync(join(root, "src/pages/VideoDate.tsx"), "utf8");
const webKeepTheVibe = readFileSync(join(root, "src/components/video-date/KeepTheVibe.tsx"), "utf8");
const nativeVideoDate = readFileSync(join(root, "apps/mobile/app/date/[id].tsx"), "utf8");
const nativeApi = readFileSync(join(root, "apps/mobile/lib/videoDateApi.ts"), "utf8");
const nativeKeepTheVibe = readFileSync(
  join(root, "apps/mobile/components/video-date/KeepTheVibe.tsx"),
  "utf8",
);
const packageJson = readFileSync(join(root, "package.json"), "utf8");

function functionBody(name: string): string {
  const match = migration.match(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]+?COMMENT ON FUNCTION public\\.${name}`),
  );
  assert.ok(match, `missing ${name} function block`);
  return match[0];
}

test("PR 6.4 adds a server-owned mutual extension request model", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.video_date_extension_requests/);
  assert.match(migration, /status text NOT NULL DEFAULT 'pending'/);
  assert.match(migration, /status IN \('pending', 'applied', 'expired', 'failed', 'cancelled'\)/);
  assert.match(migration, /UNIQUE \(session_id, requester_id, idempotency_key\)/);
  assert.match(migration, /ALTER TABLE public\.video_date_extension_requests ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.video_date_extension_requests FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.video_date_extension_requests TO service_role/);
  assert.match(migration, /idx_video_date_extension_requests_pending/);
  assert.doesNotMatch(migration, /meeting[_-]?token|daily_token|DAILY_API_KEY|createMeetingToken/i);
});

test("mutual extension RPC is idempotent, participant-only, and charges only after both consent", () => {
  const fn = functionBody("video_session_request_extension_v2");
  assert.match(fn, /public\.video_session_command_begin_v2\(/);
  assert.match(fn, /public\.video_session_command_finish_v2\(/);
  assert.match(fn, /'extension_mutual'/);
  assert.match(fn, /FOR UPDATE;/);
  assert.match(fn, /v_actor IS DISTINCT FROM v_before\.participant_1_id/);
  assert.match(fn, /NOT FOUND[\s\S]+INSERT INTO public\.video_date_extension_requests[\s\S]+'pending'/);
  assert.match(fn, /'date_extension_requested'[\s\S]+'participants'/);
  assert.match(fn, /'awaiting_partner', true/);
  assert.match(fn, /SELECT \*[\s\S]+requester_id = v_partner_id[\s\S]+status = 'pending'[\s\S]+FOR UPDATE/);
  assert.match(fn, /UPDATE public\.user_credits[\s\S]+WHERE user_id = v_actor/);
  assert.match(fn, /INSERT INTO public\.video_date_credit_extension_spends/);
  assert.match(fn, /'mutual:' \|\| v_partner_request\.id::text/);
  assert.match(fn, /'failed'[\s\S]+'insufficient_credits'/);
  assert.match(fn, /'date_extension_applied'[\s\S]+'participants'/);
  assert.match(fn, /'awaiting_partner', false/);
  assert.doesNotMatch(fn, /public\.spend_video_date_credit_extension\(/);
});

test("mutual extension refuses to charge before room-expiry proof passes", () => {
  const fn = functionBody("video_session_request_extension_v2");
  assert.match(fn, /v_required_until :=[\s\S]+300 \+ COALESCE\(v_before\.date_extra_seconds, 0\) \+ v_add_seconds \+ 120 \+ 600/);
  assert.match(fn, /v_before\.daily_room_expires_at IS NULL OR v_before\.daily_room_expires_at <= v_required_until/);
  assert.match(fn, /'error', 'daily_room_expiring_before_extension'/);
  assert.ok(
    fn.indexOf("v_required_until :=") < fn.indexOf("UPDATE public.user_credits"),
    "room-expiry check must happen before any credit debit",
  );
  assert.ok(
    fn.indexOf("UPDATE public.user_credits") < fn.indexOf("INSERT INTO public.video_date_credit_extension_spends"),
    "canonical spend ledger must be written only after a successful debit",
  );
});

test("mutual extension expires stale pending requests and serializes partner races", () => {
  const fn = functionBody("video_session_request_extension_v2");
  assert.match(fn, /UPDATE public\.video_date_extension_requests[\s\S]+SET status = 'expired'[\s\S]+failure_reason = COALESCE\(failure_reason, 'request_expired'\)[\s\S]+expires_at <= v_now/);
  assert.match(fn, /UPDATE public\.video_date_extension_requests[\s\S]+failure_reason = COALESCE\(failure_reason, 'replaced_by_new_request'\)[\s\S]+requester_id = v_actor[\s\S]+status = 'pending'/);
  assert.match(fn, /SELECT \*[\s\S]+requester_id = v_partner_id[\s\S]+credit_type = v_credit_type[\s\S]+status = 'pending'[\s\S]+expires_at > v_now[\s\S]+ORDER BY created_at ASC[\s\S]+LIMIT 1[\s\S]+FOR UPDATE/);
  assert.match(fn, /UPDATE public\.video_date_extension_requests[\s\S]+failure_reason = COALESCE\(failure_reason, 'accepted_different_request'\)[\s\S]+requester_id = v_actor[\s\S]+status = 'pending'/);
  assert.ok(
    fn.indexOf("SELECT *\n  INTO v_before") < fn.indexOf("UPDATE public.video_date_extension_requests"),
    "session row lock must be acquired before stale-request cleanup and partner request selection",
  );
});

test("mutual extension spends remain covered by the existing refund engine", () => {
  assert.match(migration, /CREATE OR REPLACE VIEW public\.vw_video_date_extension_refund_certification/);
  assert.match(migration, /has_mutual_extension_spend/);
  assert.match(migration, /COALESCE\(bool_or\(sp\.idempotency_key LIKE 'mutual:%'\), false\) AS has_mutual_extension_spend/);
  assert.match(reviewFollowupsMigration, /COALESCE\(bool_or\(sp\.idempotency_key LIKE 'mutual:%'\), false\) AS has_mutual_extension_spend/);
  assert.match(refundMigration, /FROM public\.video_date_credit_extension_spends[\s\S]+WHERE session_id = p_session_id/);
  assert.match(refundMigration, /extra_time_refunded/);
  assert.match(refundMigration, /extended_vibe_refunded/);
  assert.match(refundMigration, /refund_failed_video_date/);
  assert.match(refundMigration, /'partial_join_peer_timeout'/);
  assert.match(refundMigration, /'prepare_entry_provider_failed_repair'/);
  assert.match(refundMigration, /'prepare_entry_daily_join_missing'/);
  assert.match(refundMigration, /'prepare_entry_timeout'/);
  assert.match(refundMigration, /'reconnect_grace_expired'/);
  assert.match(refundMigration, /CREATE TRIGGER video_session_refund_on_end/);
  assert.match(refundMigration, /WHEN \(NEW\.ended_reason IS NOT NULL[\s\S]+NEW\.refund_status IS NULL\)/);
});

test("PR 6.3 always-on safety flag drives web and native v2 safety surfaces", () => {
  assert.match(webVideoDate, /useFeatureFlag\("video_date\.safety_always_on_v2"\)/);
  assert.match(webVideoDate, /isConnected \|\| safetyAlwaysOnV2\.enabled/);
  assert.match(webVideoDate, /safetyV2=\{safetyV2\.enabled \|\| safetyAlwaysOnV2\.enabled\}/);
  assert.match(nativeVideoDate, /useFeatureFlag\('video_date\.safety_always_on_v2'\)/);
  assert.match(nativeVideoDate, /hasRemotePartner \|\| safetyAlwaysOnV2\.enabled/);
  assert.match(nativeVideoDate, /safetyV2=\{safetyV2\.enabled \|\| safetyAlwaysOnV2\.enabled\}/);
});

test("web and native consume mutual extension behind the default-off flag", () => {
  assert.match(transitionCommands, /buildVideoDateMutualExtensionIdempotencyKey/);
  assert.match(transitionCommands, /phase6:extension_mutual/);
  assert.match(extensionSpend, /awaitingPartner/);
  assert.match(extensionSpend, /requestExpiresAt/);

  assert.match(webVideoDate, /useFeatureFlag\("video_date\.extension_mutual_v2"\)/);
  assert.match(webVideoDate, /video_session_request_extension_v2/);
  assert.match(webVideoDate, /makeMutualExtensionIdempotencyKey/);
  assert.match(webVideoDate, /date_extension_requested/);
  assert.match(webVideoDate, /date_extension_applied/);
  assert.match(webVideoDate, /pendingPartnerExtension/);
  assert.match(webVideoDate, /pendingPartnerRequestType=\{pendingPartnerExtension\?\.type \?\? null\}/);
  assert.match(webKeepTheVibe, /mutualMode/);
  assert.match(webKeepTheVibe, /Ask \+2/);
  assert.match(webKeepTheVibe, /Accept \+2/);
  assert.match(webKeepTheVibe, /Request sent\. The date extends if your match accepts\./);

  assert.match(nativeApi, /extensionMutualV2\?: boolean/);
  assert.match(nativeApi, /video_session_request_extension_v2/);
  assert.match(nativeApi, /onBroadcastEvent/);
  assert.match(nativeVideoDate, /useFeatureFlag\('video_date\.extension_mutual_v2'\)/);
  assert.match(nativeVideoDate, /makeMutualExtensionIdempotencyKey/);
  assert.match(nativeVideoDate, /date_extension_requested/);
  assert.match(nativeVideoDate, /date_extension_applied/);
  assert.match(nativeVideoDate, /pendingPartnerExtension/);
  assert.match(nativeVideoDate, /pendingPartnerRequestType=\{pendingPartnerExtension\?\.type \?\? null\}/);
  assert.match(nativeKeepTheVibe, /mutualMode/);
  assert.match(nativeKeepTheVibe, /Ask \+2/);
  assert.match(nativeKeepTheVibe, /Accept \+2/);
});

test("Phase 6 safety/extension contracts are included in the v4 verification script", () => {
  assert.match(packageJson, /shared\/matching\/videoDatePhase6SafetyExtensionContracts\.test\.ts/);
});
