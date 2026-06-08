import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read(
  "supabase/migrations/20260608215911_video_date_certification_exception_closure.sql",
);
const drainGuardMigration = read(
  "supabase/migrations/20260608211359_video_date_survey_feedback_drain_guard.sql",
);
const invariantSql = read("docs/sql/video-date-invariants.sql");
const packageJson = read("package.json");

const clientSources = [
  "src/hooks/useMatchQueue.ts",
  "src/pages/EventLobby.tsx",
  "src/components/video-date/PostDateSurvey.tsx",
  "apps/mobile/app/event/[eventId]/lobby.tsx",
  "apps/mobile/components/video-date/PostDateSurvey.tsx",
  "apps/mobile/components/NotificationDeepLinkHandler.tsx",
].map((path) => [path, read(path)] as const);

function functionBody(source: string, name: string): string {
  const start = source.search(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\s*\\(`),
  );
  assert.notEqual(start, -1, `missing function ${name}`);
  const end = source.indexOf("$function$;", start);
  assert.notEqual(end, -1, `missing function terminator for ${name}`);
  return source.slice(start, end);
}

test("certification feedback exception ledger is service-owned and audit-only", () => {
  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS public\.video_date_certification_feedback_exceptions/,
  );
  assert.match(migration, /PRIMARY KEY \(session_id, missing_user_id\)/);
  assert.match(migration, /exception_kind IN \([\s\S]+'known_failed_acceptance_run'[\s\S]+'historical_unreachable_feedback'[\s\S]+'operator_certified_non_completion'/);
  assert.match(migration, /ALTER TABLE public\.video_date_certification_feedback_exceptions ENABLE ROW LEVEL SECURITY/);
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\.video_date_certification_feedback_exceptions[\s\S]+FROM PUBLIC, anon, authenticated/,
  );
  assert.match(
    migration,
    /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.video_date_certification_feedback_exceptions[\s\S]+TO service_role/,
  );
  assert.match(migration, /Admins can view video date certification feedback exceptions/);
  assert.match(migration, /Does not complete survey, create date_feedback, or release in_survey users/);
});

test("service RPC refuses to fabricate completion or date_feedback", () => {
  const upsert = functionBody(
    migration,
    "upsert_video_date_certification_feedback_exception_v1",
  );
  assert.match(upsert, /session_participant_not_found/);
  assert.match(upsert, /FROM public\.date_feedback df[\s\S]+df\.session_id = p_session_id[\s\S]+df\.user_id = p_missing_user_id/);
  assert.match(upsert, /date_feedback_already_present/);
  assert.match(upsert, /does_not_persist_feedback/);
  assert.match(upsert, /does_not_release_survey/);
  assert.doesNotMatch(upsert, /INSERT INTO public\.date_feedback/);
  assert.doesNotMatch(upsert, /UPDATE public\.date_feedback/);

  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.upsert_video_date_certification_feedback_exception_v1\(uuid, uuid, text, text, jsonb, timestamptz\)[\s\S]+FROM PUBLIC, anon, authenticated, service_role/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.upsert_video_date_certification_feedback_exception_v1\(uuid, uuid, text, text, jsonb, timestamptz\)[\s\S]+TO service_role/,
  );
});

test("operator diagnostics and release invariants ignore only active exceptions", () => {
  const diagnostics = functionBody(
    migration,
    "video_date_missing_feedback_operator_diagnostics_v1",
  );
  assert.match(diagnostics, /RETURNS TABLE \([\s\S]+release_blocker boolean[\s\S]+\)/);
  assert.match(diagnostics, /active_exceptions AS \(/);
  assert.match(diagnostics, /FROM public\.video_date_certification_feedback_exceptions ex/);
  assert.match(diagnostics, /ex\.revoked_at IS NULL/);
  assert.match(diagnostics, /ex\.expires_at IS NULL OR ex\.expires_at > now\(\)/);
  assert.match(diagnostics, /LEFT JOIN active_exceptions ex[\s\S]+ex\.missing_user_id = sr\.missing_user_id/);
  assert.match(diagnostics, /AND ex\.session_id IS NULL[\s\S]+\) AS release_blocker/);

  assert.match(invariantSql, /stale_survey_pending_feedback_blocks_certification/);
  assert.match(invariantSql, /public\.video_date_certification_feedback_exceptions ex/);
  assert.match(invariantSql, /ex\.revoked_at IS NULL/);
  assert.match(invariantSql, /ex\.expires_at IS NULL OR ex\.expires_at > now\(\)/);
  assert.match(invariantSql, /Exceptions do not complete the survey or persist date_feedback/);
});

test("product routing and queue gates do not depend on certification exceptions", () => {
  assert.doesNotMatch(
    drainGuardMigration,
    /video_date_certification_feedback_exceptions|certification_feedback_exception/,
  );

  for (const [path, source] of clientSources) {
    assert.doesNotMatch(
      source,
      /video_date_certification_feedback_exceptions|certification_feedback_exception/,
      `${path} must not route users based on certification exceptions`,
    );
  }
});

test("certification exception closure is wired into Video Date suites", () => {
  assert.match(packageJson, /videoDateCertificationExceptionClosure\.test\.ts/);
});
