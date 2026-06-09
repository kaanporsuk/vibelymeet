import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const invariantSql = read("docs/sql/video-date-invariants.sql");
const audit = read(
  "docs/audits/date-route-owns-flow-current-codebase-audit-2026-06-09.md",
);
const commandCenter = read("docs/video-date-success-command-center.md");
const webVideoDate = read("src/pages/VideoDate.tsx");
const webVideoCall = read("src/hooks/useVideoCall.ts");
const webSurfaceGuard = read("src/hooks/useVideoDateDupTabGuard.ts");
const nativeDateRoute = read("apps/mobile/app/date/[id].tsx");
const nativeSurvey = read("apps/mobile/components/video-date/PostDateSurvey.tsx");
const packageJson = read("package.json");

function blockBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `missing end marker after ${start}: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("certification exceptions suppress all missing-feedback invariant warnings", () => {
  for (const [label, start, end] of [
    [
      "pending feedback",
      "'survey_pending_feedback_held_in_survey'::text",
      "'stale_survey_pending_feedback_blocks_certification'::text",
    ],
    [
      "stale pending feedback",
      "'stale_survey_pending_feedback_blocks_certification'::text",
      "'provider_join_webhook_evidence_present_for_recent_joined_sessions'::text",
    ],
  ] as const) {
    const block = blockBetween(invariantSql, start, end);
    assert.match(
      block,
      /FROM public\.video_date_certification_feedback_exceptions ex/,
      label,
    );
    assert.match(block, /ex\.session_id = sr\.session_id/, label);
    assert.match(block, /ex\.missing_user_id = sr\.user_id/, label);
    assert.match(block, /ex\.revoked_at IS NULL/, label);
  }
});

test("native survey one-shot queue drain is not cancelled by verdict UI state changes", () => {
  assert.match(nativeSurvey, /const queuedDrainRuntimeRef = useRef/);
  assert.match(nativeSurvey, /queuedDrainRuntimeRef\.current = \{/);
  assert.match(nativeSurvey, /runtime\.verdictUiState === 'submitting'/);
  assert.match(nativeSurvey, /runtime\.verdictUiState === 'confirmed'/);
  assert.match(nativeSurvey, /runtime\.verdictUiState === 'awaiting_partner'/);
  assert.match(nativeSurvey, /runtime\.onVideoDateReady\(pendingSessionId\)/);
  assert.match(
    nativeSurvey,
    /queuedDrainRuntimeRef\.current\.onQueuedVideoSessionReady\?\.\(nextSessionId\)/,
  );

  const drainEffect = blockBetween(
    nativeSurvey,
    "useEffect(() => {\n    if (!eventId || !userId || queuedNavigationStartedRef.current) return;",
    "useEffect(() => {\n    if (step !== 'celebration'",
  );
  const deps = drainEffect.slice(drainEffect.lastIndexOf("}, ["));
  assert.doesNotMatch(deps, /finishing/);
  assert.doesNotMatch(deps, /submitting/);
  assert.doesNotMatch(deps, /verdictUiState/);
  assert.doesNotMatch(deps, /onVideoDateReady/);
  assert.doesNotMatch(deps, /onQueuedVideoSessionReady/);
});

test("remote-seen retries keep the accepted render evidence source", () => {
  for (const [label, source] of [
    ["web", webVideoCall],
    ["native", nativeDateRoute],
  ] as const) {
    const block = blockBetween(
      source,
      "const baseEvidenceSource = source;",
      "const initialProof = buildProviderBoundRemoteSeenArgs(source);",
    );
    assert.match(block, /p_evidence_source: baseEvidenceSource/, label);
    assert.doesNotMatch(block, /p_evidence_source: attemptSource/, label);
    assert.match(
      source,
      /stamp\(`\$\{attemptSource\}_retry_\$\{nextAttempt\}`, nextAttempt\)/,
      label,
    );
  }
});

test("web surface claims start with the stable route shell and do not back off before backend claimability", () => {
  assert.match(webVideoDate, /const videoDateRouteShellActive =/);
  assert.match(webVideoDate, /videoDateAccess === "allowed"/);
  assert.match(webVideoDate, /!showFeedback/);
  assert.match(webVideoDate, /!terminalSurveyRecoveryActive/);
  assert.match(webVideoDate, /phase !== "ended"/);
  assert.match(webVideoDate, /const videoDateSurfaceLeaseActive =\s*\n\s*videoDateRouteShellActive/);

  assert.match(webSurfaceGuard, /SURFACE_NOT_CLAIMABLE/);
  assert.match(webSurfaceGuard, /if \(waitingForClaimableTruth\) \{/);
  assert.match(
    webSurfaceGuard,
    /waitingForClaimableTruth[\s\S]{0,180}serverClaimBackoffUntilRef\.current = 0/,
  );
});

test("review-comment documentation is scoped to the snapshot that produced it", () => {
  assert.match(audit, /Audit-time read-only evidence topped out at `20260608215911`/);
  assert.match(audit, /superseded by later command-center\/cloud alignment evidence/);
  assert.match(commandCenter, /At the PR #1257 verification moment/);
  assert.match(commandCenter, /before later PRs advanced `main`/);
});

test("latest review-comments contract is wired into Video Date suites", () => {
  assert.match(packageJson, /shared\/matching\/reviewComments1256_1262Followups\.test\.ts/);
});
