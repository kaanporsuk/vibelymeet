import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read(
  "supabase/migrations/20260608202749_video_date_missing_feedback_certification_closure.sql",
);
const reminderWorker = read("supabase/functions/post-date-verdict-reminders/index.ts");
const invariantSql = read("docs/sql/video-date-invariants.sql");
const goldenFlowDoc = read("docs/qa/video-date-golden-flow-certification.md");
const nativeDeviceDoc = read("docs/qa/video-date-native-device-certification.md");
const packageJson = read("package.json");

test("zero-feedback survey stalls have a per-user service reminder ledger", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.post_date_zero_feedback_reminders/);
  assert.match(migration, /PRIMARY KEY \(session_id, missing_user_id\)/);
  assert.match(migration, /ALTER TABLE public\.post_date_zero_feedback_reminders ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.post_date_zero_feedback_reminders FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /CREATE POLICY "Admins can view zero-feedback post-date reminders"/);
  assert.match(migration, /CHECK \(participant_role IN \('participant_1', 'participant_2'\)\)/);
});

test("zero-feedback reminder sync only targets survey-eligible in_survey participants with no date_feedback", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.sync_post_date_zero_feedback_reminders_v1/);
  assert.match(migration, /er\.queue_status = 'in_survey'/);
  assert.match(migration, /public\.video_date_session_is_post_date_survey_eligible_v2/);
  assert.match(migration, /vs\.ended_at <= now\(\) - COALESCE\(p_older_than, interval '5 minutes'\)/);
  assert.match(migration, /NOT EXISTS \([\s\S]+FROM public\.date_feedback df_any[\s\S]+WHERE df_any\.session_id = vs\.id[\s\S]+\)/);
  assert.match(migration, /'participant_1'::text AS participant_role/);
  assert.match(migration, /'participant_2'::text/);
  assert.match(migration, /public\.is_blocked\(er\.missing_user_id, er\.partner_user_id\)/);
  assert.match(migration, /FROM public\.user_reports ur/);
});

test("reminder worker claims zero-feedback rows and sends canonical date-route reminders", () => {
  assert.match(reminderWorker, /mark_post_date_zero_feedback_reminders_stale_v1/);
  assert.match(reminderWorker, /claim_post_date_zero_feedback_reminders_v1/);
  assert.match(reminderWorker, /record_post_date_zero_feedback_reminder_result_v1/);
  assert.match(reminderWorker, /type ClaimedZeroFeedbackReminder/);
  assert.match(reminderWorker, /const dedupeKey = `post_date_feedback:\$\{row\.session_id\}:\$\{row\.missing_user_id\}`/);
  assert.match(reminderWorker, /category: "post_date_feedback_reminder"/);
  assert.match(reminderWorker, /url: deepLink/);
  assert.match(reminderWorker, /deep_link: deepLink/);
  assert.match(reminderWorker, /reminder_source: "zero_feedback_survey"/);
  assert.match(reminderWorker, /zero_feedback_claimed/);
  assert.match(reminderWorker, /zero_feedback_stale_marked/);
});

test("missing-feedback diagnostics and constraint validation are service-owned", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.video_date_missing_feedback_operator_diagnostics_v1/);
  assert.match(migration, /release_blocker boolean/);
  assert.match(migration, /sr\.ended_at <= now\(\) - COALESCE\(p_stale_after, interval '15 minutes'\)/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.video_date_missing_feedback_operator_diagnostics_v1\(uuid, interval, integer\)[\s\S]*TO service_role/);
  assert.match(migration, /VALIDATE CONSTRAINT video_sessions_ready_gate_timestamp_consistency/);
});

test("certification invariants make stale missing feedback a warn-as-error blocker", () => {
  assert.match(invariantSql, /stale_survey_pending_feedback_blocks_certification/);
  assert.match(invariantSql, /more than 15 minutes/);
  assert.match(invariantSql, /--warn-as-error/);
  assert.match(invariantSql, /public\.video_date_session_is_post_date_survey_eligible_v2/);
  assert.match(goldenFlowDoc, /npm run check:video-date:invariants -- --warn-as-error/);
  assert.match(nativeDeviceDoc, /npm run check:video-date:invariants -- --warn-as-error/);
});

test("missing-feedback certification closure is part of the red-flag suite", () => {
  assert.match(packageJson, /videoDateMissingFeedbackCertificationClosure\.test\.ts/);
});
