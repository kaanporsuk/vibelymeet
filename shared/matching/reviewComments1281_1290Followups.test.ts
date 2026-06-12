import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const followupMigration = read(
  "supabase/migrations/20260611135321_review_comments_1281_1290_followups.sql",
);
const sourceRemovalMigration = read(
  "supabase/migrations/20260610120000_remove_match_queue_source_always_ready.sql",
);
const queuedPurgeMigration = read(
  "supabase/migrations/20260611104830_purge_video_date_queued_residue.sql",
);
const readyGateOverlay = read("src/components/lobby/ReadyGateOverlay.tsx");
const webPartnerProfile = read("src/lib/videoDatePartnerProfile.ts");
const nativePartnerProfile = read("apps/mobile/lib/videoDatePartnerProfile.ts");
const operatorDashboards = read("docs/observability/video-date-operator-dashboards.md");
const branchDelta = read("docs/branch-deltas/review-comments-1281-1290-followups.md");
const packageJson = read("package.json");

function sqlFunctionBody(source: string, functionName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${functionName}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing function ${functionName}`);
  const end = source.indexOf("COMMENT ON FUNCTION", start);
  assert.ok(end > start, `missing function end after ${functionName}`);
  return source.slice(start, end);
}

test("PR 1281 queued fallback comments stay superseded by direct-ready source removal", () => {
  const activeWrapper = sqlFunctionBody(
    sourceRemovalMigration,
    "handle_swipe_20260601183000_deck_authority_base",
  );

  assert.doesNotMatch(activeWrapper, /match_queued|queue_removed_conversion|queued_expires_at/);
  assert.match(queuedPurgeMigration, /DROP COLUMN IF EXISTS queued_expires_at/);
  assert.match(branchDelta, /#1281 queued fallback comments are superseded/);
  assert.match(branchDelta, /does not restore longer queued-style TTL behavior/);
});

test("Ready Gate prepare exceptions close on terminal truth instead of retrying forever", () => {
  assert.match(
    readyGateOverlay,
    /const exceptionTruth =\s+await fetchVideoSessionDateEntryTruthCoalesced\(sessionId\)/,
  );
  assert.match(
    readyGateOverlay,
    /else if \(isTerminalReadyGateTruth\(exceptionTruth\)\) \{[\s\S]{0,520}retryable: false[\s\S]{0,260}onClose\(\);/s,
  );
});

test("entry RPC forward migration reloads the PostgREST schema cache", () => {
  assert.match(
    followupMigration,
    /to_regprocedure\('public\.video_session_continue_entry_v2\(uuid,text,text\)'\)/,
  );
  assert.match(
    followupMigration,
    /to_regprocedure\('public\.video_session_entry_auto_promote_v2\(uuid,text,text\)'\)/,
  );
  assert.match(followupMigration, /NOTIFY pgrst, 'reload schema';/);
});

test("operator survey dashboard no longer points at removed queue drain behavior", () => {
  assert.match(
    operatorDashboards,
    /Dashboard: Survey To Next Ready Gate Conversion - REMOVED/,
  );
  assert.doesNotMatch(operatorDashboards, /Existing conversion evidence: `video_date_queue_drain_found`/);
  assert.doesNotMatch(operatorDashboards, /Use the existing `useMatchQueue`/);
  assert.doesNotMatch(operatorDashboards, /enableSurveyPhaseDrain`\./);
  assert.match(operatorDashboards, /date_feedback/);
});

test("Video Date partner profile memoization is viewer-scoped on web and native", () => {
  for (const [label, source] of [
    ["web", webPartnerProfile],
    ["native", nativePartnerProfile],
  ] as const) {
    assert.match(source, /supabase\.auth\.getSession\(\)/, `${label} should read the current viewer`);
    assert.match(
      source,
      /getVideoDatePartnerProfileCacheKey\(session\?\.user\?\.id \?\? null, partnerId\)/,
      `${label} should key cache by viewer and partner`,
    );
    assert.match(source, /cache\.get\(cacheKey\)/, `${label} should read by scoped key`);
    assert.match(source, /inFlight\.get\(cacheKey\)/, `${label} should coalesce by scoped key`);
    assert.match(source, /cache\.set\(cacheKey,/, `${label} should write by scoped key`);
  }
});

test("review-comments 1281-1290 follow-up is wired into Video Date suites", () => {
  assert.match(branchDelta, /Review Comments 1281-1290 Follow-ups/);
  assert.match(
    packageJson,
    /shared\/matching\/reviewComments1281_1290Followups\.test\.ts/,
  );
});
