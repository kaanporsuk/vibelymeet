import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  POST_DATE_VERDICT_CONFIRM_TIMEOUT_MS,
  confirmationResultFromVerdictBroadcast,
  derivePostDateSurveyStepFromVerdict,
  isConfirmingVerdictBroadcast,
  isVideoDateVerdictConfirmEnabled,
  normalizePostDateVerdictConfirmationResult,
} from "./postDateVerdictConfirmation";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/20260525090000_video_date_verdict_confirmation_v2.sql"),
  "utf8",
);
const flags = readFileSync(join(root, "shared/featureFlags/videoDateV4Flags.ts"), "utf8");
const outboxTypes = readFileSync(join(root, "shared/postDateOutbox/types.ts"), "utf8");
const edgeFunction = readFileSync(join(root, "supabase/functions/post-date-verdict/index.ts"), "utf8");
const webSurvey = readFileSync(join(root, "src/components/video-date/PostDateSurvey.tsx"), "utf8");
const webVerdictScreen = readFileSync(join(root, "src/components/video-date/survey/VerdictScreen.tsx"), "utf8");
const webSafetyScreen = readFileSync(join(root, "src/components/video-date/survey/SafetyScreen.tsx"), "utf8");
const nativeSurvey = readFileSync(join(root, "apps/mobile/components/video-date/PostDateSurvey.tsx"), "utf8");
const nativeApi = readFileSync(join(root, "apps/mobile/lib/videoDateApi.ts"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");

test("verdict confirmation flags and v3 RPC contract are additive and default-off", () => {
  for (const flag of ["video_date.verdict_confirm_v2", "video_date.verdict_confirm_v1"]) {
    assert.match(migration, new RegExp(`'${flag}',\\s*false,\\s*0`));
  }
  // PR 6 flag freeze: verdict confirmation is hard-coded on; neither key is
  // client-declared any longer.
  assert.doesNotMatch(flags, /"video_date\.verdict_confirm_v2"/);
  assert.doesNotMatch(flags, /"video_date\.verdict_confirm_v1"/);

  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.submit_post_date_verdict_v3/);
  assert.match(migration, /'committed', true/);
  assert.match(migration, /'session_seq', v_session_seq/);
  assert.match(migration, /'verdict_state', v_verdict_state/);
  assert.match(migration, /'next_surface', v_next_surface/);
  assert.match(migration, /public\.resolve_post_date_next_surface\(p_session_id\)/);
  assert.match(migration, /EXCEPTION WHEN OTHERS THEN\s+v_next_surface := NULL/);
  assert.match(migration, /FROM public\.date_feedback df/);
  assert.match(migration, /v_actor_liked AND v_partner_liked THEN 'resolved_mutual'/);
  assert.match(migration, /'partner_verdict_recorded', v_partner_has_feedback/);
  assert.match(migration, /'awaiting_partner_verdict', NOT v_partner_has_feedback/);
  assert.match(migration, /'mutual', v_actor_liked AND v_partner_liked/);
  assert.match(migration, /v_begin->>'status' = 'replay_rejected'[\s\S]+RETURN v_replay_result \|\| jsonb_build_object/);
  assert.doesNotMatch(
    migration.match(/v_begin->>'status' = 'replay_rejected'[\s\S]+?END IF;/)?.[0] ?? "",
    /'committed', true/,
  );
  const replayBlock = migration.match(/IF v_begin->>'status' IN \('replay', 'replay_rejected'\)[\s\S]+?IF v_begin->>'status' IS DISTINCT FROM 'started'/)?.[0] ?? "";
  assert.match(replayBlock, /FROM public\.date_feedback df/);
  assert.match(replayBlock, /v_actor_liked AND v_partner_liked THEN 'resolved_mutual'/);
});

test("verdict confirmation shared helper normalizes flags, results, broadcasts, and steps", () => {
  assert.equal(POST_DATE_VERDICT_CONFIRM_TIMEOUT_MS, 2_500);
  assert.equal(isVideoDateVerdictConfirmEnabled({ enabled: true }), true);
  assert.equal(isVideoDateVerdictConfirmEnabled({ enabled: false }), false);
  assert.equal(isVideoDateVerdictConfirmEnabled(null), false);

  const result = normalizePostDateVerdictConfirmationResult({
    success: true,
    committed: true,
    session_seq: 12,
    verdict_state: "awaiting_partner",
    awaiting_partner_verdict: true,
    next_surface: { success: true, action: "lobby", session_id: "s1" },
  });
  assert.equal(result.committed, true);
  assert.equal(result.sessionSeq, 12);
  assert.equal(result.verdictState, "awaiting_partner");
  assert.equal(result.nextSurface?.action, "lobby");
  const camelNextSurface = normalizePostDateVerdictConfirmationResult({
    nextSurface: { success: true, action: "ready_gate", nextSessionId: "next-1", secondsUntilEventEnd: 42 },
  });
  assert.equal(camelNextSurface.nextSurface?.nextSessionId, "next-1");
  assert.equal(camelNextSurface.nextSurface?.secondsUntilEventEnd, 42);
  assert.equal(derivePostDateSurveyStepFromVerdict({ mutual: true }), "celebration");
  assert.equal(derivePostDateSurveyStepFromVerdict({ next_surface: { success: true, action: "chat", match_id: "m1" } }), "highlights");
  assert.equal(derivePostDateSurveyStepFromVerdict(result), "awaiting_partner");
  assert.equal(derivePostDateSurveyStepFromVerdict({ verdict_state: "resolved_not_mutual" }), "highlights");

  assert.equal(isConfirmingVerdictBroadcast({ kind: "post_date_verdict_recorded", sessionSeq: 7 }, 7), true);
  assert.equal(isConfirmingVerdictBroadcast({ kind: "post_date_verdict_resolved", sessionSeq: 8 }, 7), true);
  assert.equal(isConfirmingVerdictBroadcast({ kind: "post_date_verdict_recorded", sessionSeq: 6 }, 7), false);
  assert.equal(isConfirmingVerdictBroadcast({ kind: "ready_gate_marked", sessionSeq: 8 }, 7), false);
  const broadcastConfirmation = confirmationResultFromVerdictBroadcast({
    kind: "post_date_verdict_resolved",
    sessionSeq: 9,
    payload: { mutual: true, match_id: "match-1" },
  }, 8);
  assert.equal(broadcastConfirmation?.committed, true);
  assert.equal(broadcastConfirmation?.verdict_state, "resolved_mutual");
});

test("types and Edge wrapper carry verdict confirmation fields without changing auth/push flow", () => {
  for (const source of [outboxTypes, edgeFunction, nativeApi]) {
    assert.match(source, /committed\??:/);
    assert.match(source, /session_seq\??:/);
    assert.match(source, /verdict_state\??:/);
    assert.match(source, /next_surface\??:/);
  }
  assert.match(edgeFunction, /type VerdictRpcResult/);
  assert.match(edgeFunction, /submit_post_date_verdict_v3/);
  assert.match(edgeFunction, /serviceClient\.functions\.invoke\("send-notification"/);
});

test("post-date mutual match notifications carry per-recipient peer routing data", () => {
  assert.match(edgeFunction, /async function stableUuidFromParts/);
  assert.match(edgeFunction, /crypto\.subtle\.digest\(/);
  assert.match(edgeFunction, /const matchNotificationBodyFor = async \(recipientUserId: string, otherUserId: string\) =>/);
  assert.match(edgeFunction, /dedupe_key: `post_date_match:\$\{matchId\}:\$\{recipientUserId\}`/);
  assert.match(edgeFunction, /provider_idempotency_key: await stableUuidFromParts/);
  assert.match(edgeFunction, /other_user_id: otherUserId/);
  assert.match(edgeFunction, /partner_id: otherUserId/);
  assert.match(
    edgeFunction,
    /const participant1Notification = await matchNotificationBodyFor\([\s\S]*sess\.participant_1_id,[\s\S]*sess\.participant_2_id/,
  );
  assert.match(
    edgeFunction,
    /const participant2Notification = await matchNotificationBodyFor\([\s\S]*sess\.participant_2_id,[\s\S]*sess\.participant_1_id/,
  );
  assert.match(edgeFunction, /body: \{ user_id: sess\.participant_1_id, \.\.\.participant1Notification \}/);
  assert.match(edgeFunction, /body: \{ user_id: sess\.participant_2_id, \.\.\.participant2Notification \}/);
});

test("web and native surveys gate optimistic advancement behind shared confirmation", () => {
  for (const source of [webSurvey, nativeSurvey]) {
    assert.doesNotMatch(source, /useFeatureFlag\(["']video_date\.verdict_confirm_v2["']\)/);
    assert.doesNotMatch(source, /verdict_confirm_v1/);
    assert.match(source, /type PostDateVerdictUiState/);
    for (const state of ["idle", "submitting", "confirmed", "awaiting_partner", "retryable_failed"]) {
      assert.match(source, new RegExp(`["']${state}["']`));
    }
    assert.match(source, /pendingVerdictConfirmRef/);
    assert.match(source, /verdictConfirmTimeoutRef/);
    assert.match(source, /POST_DATE_VERDICT_CONFIRM_TIMEOUT_MS/);
    assert.match(source, /createVideoDateSessionChannel/);
    assert.match(source, /confirmationResultFromVerdictBroadcast/);
    assert.match(source, /waitForVerdictConfirmation/);
    assert.match(source, /normalizePostDateVerdictConfirmationResult/);
    assert.match(source, /derivePostDateSurveyStepFromVerdict/);
    assert.match(source, /nextSurface\.action === ["']survey["']/);
    assert.match(source, /confirmVerdictWithServerNextSurface/);
    assert.match(source, /resolve_post_date_next_surface/);
    assert.match(source, /normalizeServerPostDateNextSurface/);
    assert.match(
      source,
      /verdictConfirmTimeoutRef\.current = (?:window\.)?setTimeout\(\(\) => \{[\s\S]+confirmVerdictWithServerNextSurface\(result\)/,
    );
    assert.match(source, /const confirmedResult = await waitForVerdictConfirmation\(result\)/);
    assert.doesNotMatch(source, /postDateInstantNext|canOptimisticallyAdvanceVerdict|optimisticStep/);
    const verdictSubmitBlock =
      source.match(/const confirmedResult = await waitForVerdictConfirmation[\s\S]+?applyConfirmedVerdictStep\(confirmedResult\);/)?.[0] ?? "";
    assert.match(source, /type VerdictSource = ['"]vibe['"] \| ['"]pass['"] \| ['"]skip['"]/);
    assert.match(source, /lastVerdictSourceAttemptRef/);
    assert.match(source, /source === ['"]skip['"] \? ['"]verdict_skipped['"] : ['"]verdict_submitted['"]/);
    assert.match(source, /POST_DATE_SURVEY_SKIP[\s\S]{0,180}step: ['"]verdict['"][\s\S]{0,120}outcome: ['"]pass['"]/);
    assert.match(source, /source: verdictSource/);
    assert.match(verdictSubmitBlock, /const feedbackRowConfirmed = await confirmActorFeedbackRow\(liked, verdictSource\)/);
    assert.ok(
      verdictSubmitBlock.indexOf("waitForVerdictConfirmation") < verdictSubmitBlock.indexOf("confirmActorFeedbackRow"),
      "survey must wait for verdict confirmation before actor feedback-row proof",
    );
    assert.ok(
      verdictSubmitBlock.indexOf("confirmActorFeedbackRow") < verdictSubmitBlock.indexOf("applyConfirmedVerdictStep"),
      "survey must not advance until actor feedback-row proof is visible",
    );
    assert.match(source, /recordReportPassVerdict[\s\S]+waitForVerdictConfirmation/);
    assert.match(source, /report_pass_confirmation_failed/);
    assert.match(source, /highlightsSaveInFlightRef/);
    assert.match(source, /safetySaveInFlightRef/);
    assert.match(source, /safetyReportInFlightRef/);
  }
  // Verdict submission is hard-coded to v3; no flag-gated version selection.
  assert.doesNotMatch(nativeSurvey, /outbox_v2\.submit_verdict|backendVersion/);
  assert.match(webVerdictScreen, /aria-label=["']Skip this check-in["']/);
  assert.match(webVerdictScreen, /absolute right-0 top-0/);
  assert.match(webSurvey, /onSkip=\{\(\) => void handleVerdict\(false, ["']skip["']\)\}/);
  assert.match(nativeSurvey, /accessibilityLabel=["']Skip this check-in["']/);
  assert.match(nativeSurvey, /onPress=\{\(\) => void handleVerdict\(false, ['"]skip['"]\)\}/);
  assert.match(nativeSurvey, /minHeight: 44/);
  assert.match(webSafetyScreen, /onReport: \(reason: string, details: string, alsoBlock: boolean\) => boolean \| Promise<boolean>/);
  assert.match(webSafetyScreen, /isReportSubmitting/);
});

test("verdict confirmation contracts are included in the video-date no-build suite", () => {
  assert.match(packageJson, /videoDateVerdictConfirmationContracts\.test\.ts/);
});
