import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const MIGRATION = "supabase/migrations/20260512003000_confirmed_date_lifecycle_polish.sql";
const LEGACY_COMPLETE_HARDENING_MIGRATION =
  "supabase/migrations/20260512010500_date_lifecycle_contract_legacy_complete_path.sql";
const REVIEW_COMMENT_SECURITY_FOLLOWUP_MIGRATION =
  "supabase/migrations/20260512012138_pr_review_comments_security_followups.sql";

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

test("accepted schedule-share cards render confirmed plan state, not planning mechanics", () => {
  const src = readRepoFile("src/components/chat/DateSuggestionCard.tsx");

  assert.match(
    src,
    /planStartsAt[\s\S]{0,160}format\(planStartsAt,\s*"MMM d, h:mm a"\)/,
    "confirmed card must derive When from date_plan.starts_at when available",
  );
  assert.match(
    src,
    /status === "accepted" \|\| status === "completed"\s*\?\s*\(\s*confirmedWhenLabel/,
    "accepted/completed cards must render confirmedWhenLabel instead of time_choice_key",
  );
  assert.match(
    src,
    /current\.schedule_share_enabled && status !== "accepted" && status !== "completed"/,
    "schedule-share planning copy must be hidden after acceptance/completion",
  );
});

test("share-the-date uses editable text only and excludes schedule-share mechanics", () => {
  const sheet = readRepoFile("src/components/chat/ShareDateSheet.tsx");
  const copy = readRepoFile("src/lib/dateSuggestionCopy.ts");
  const fnStart = copy.indexOf("export function buildShareDateText");
  assert.notEqual(fnStart, -1, "expected buildShareDateText");
  const fnBody = copy.slice(fnStart);

  assert.match(sheet, /<Textarea[\s\S]{0,200}value=\{text\}/, "share text must be editable before sending");
  assert.match(sheet, /navigator\.share\(\{\s*title,\s*text\s*\}\)/, "navigator.share must pass title and text");
  assert.doesNotMatch(sheet, /\burl:/, "Share the Date must not pass a url field");

  assert.match(fnBody, /Met on Vibely \(vibelymeet\.com\)\./);
  assert.match(fnBody, /I wanted to let you know\./);
  for (const forbidden of [
    "Share your Vibely Schedule",
    "Vibely Schedule shared",
    "48h live windows",
    "Both open",
  ]) {
    assert.doesNotMatch(fnBody, new RegExp(forbidden), `share text must not include ${forbidden}`);
  }
});

test("mark-complete is gated after start and uses per-user completion confirmations", () => {
  const card = readRepoFile("src/components/chat/DateSuggestionCard.tsx");
  const edge = readRepoFile("supabase/functions/date-suggestion-actions/index.ts");
  const sql = readRepoFile(MIGRATION);

  assert.match(
    card,
    /hasDateStarted && !currentUserMarkedComplete/,
    "Mark complete button must only render/activate after date starts and before current user marks",
  );
  assert.match(edge, /p_action === "plan_mark_complete"[\s\S]{0,240}date_plan_mark_complete_v2/);
  assert.match(
    edge,
    /rpcName = p_action === "plan_mark_complete"[\s\S]{0,120}"date_plan_mark_complete_v2"/,
    "Edge logs and invokes the dedicated completion RPC for plan_mark_complete",
  );
  assert.match(edge, /console\.error\(`\$\{rpcName\} error:`, rpcError\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.date_plan_completion_confirmations/);
  assert.match(sql, /UNIQUE \(date_plan_id, user_id\)/);
  assert.match(sql, /'date_not_started'/, "backend must reject plan_mark_complete before starts_at");
  assert.match(sql, /'completion_state', 'self_marked'/);
  assert.match(sql, /'completion_state', 'mutually_completed'/);
});

test("legacy plan_mark_complete entrypoints route to date_plan_mark_complete_v2", () => {
  const sql = readRepoFile(LEGACY_COMPLETE_HARDENING_MIGRATION);
  const applyWrapperStart = sql.indexOf("CREATE OR REPLACE FUNCTION public.date_suggestion_apply(");
  const applyV2WrapperStart = sql.indexOf("CREATE OR REPLACE FUNCTION public.date_suggestion_apply_v2(");
  assert.notEqual(applyWrapperStart, -1, "expected legacy date_suggestion_apply wrapper");
  assert.notEqual(applyV2WrapperStart, -1, "expected date_suggestion_apply_v2 wrapper");

  const applyWrapper = sql.slice(applyWrapperStart, applyV2WrapperStart);
  const applyV2Wrapper = sql.slice(applyV2WrapperStart);

  for (const wrapper of [applyWrapper, applyV2Wrapper]) {
    const planBranch = wrapper.indexOf("IF p_action = 'plan_mark_complete' THEN");
    const v2Call = wrapper.indexOf("RETURN public.date_plan_mark_complete_v2(v_plan_id);");
    const delegateCall = wrapper.indexOf("_legacy_dispatch_20260512(p_action, p_payload)");
    assert.ok(planBranch >= 0, "wrapper must special-case plan_mark_complete");
    assert.ok(v2Call > planBranch, "wrapper must route plan_mark_complete to date_plan_mark_complete_v2");
    assert.ok(delegateCall > v2Call, "wrapper must route plan_mark_complete before legacy delegation");
    assert.match(wrapper, /RETURN jsonb_build_object\('ok', false, 'error', 'plan_id_required'\)/);
  }

  assert.match(sql, /REVOKE ALL ON FUNCTION public\.date_suggestion_apply_legacy_dispatch_20260512\(text, jsonb\)[\s\S]{0,120}authenticated/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.date_suggestion_apply_v2_legacy_dispatch_20260512\(text, jsonb\)[\s\S]{0,120}authenticated/);
  assert.doesNotMatch(sql, /awaiting_partner_confirm/);
});

test("review follow-up keeps legacy and physical-date writes RPC-only", () => {
  const sql = readRepoFile(REVIEW_COMMENT_SECURITY_FOLLOWUP_MIGRATION);

  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.date_suggestion_apply\(text, jsonb\)[\s\S]{0,80}FROM PUBLIC, anon, authenticated/,
    "legacy date_suggestion_apply must not be executable directly by authenticated clients",
  );
  assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.date_suggestion_apply\(text, jsonb\) TO authenticated/);
  assert.match(sql, /DROP POLICY IF EXISTS "date_plan_completion_confirmations_insert_own_participant"/);
  assert.match(
    sql,
    /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.date_plan_completion_confirmations[\s\S]{0,80}FROM PUBLIC, anon, authenticated/,
    "completion confirmations must be written through date_plan_mark_complete_v2",
  );
  assert.match(sql, /DROP POLICY IF EXISTS "date_plan_feedback_insert_reviewer_only"/);
  assert.match(sql, /DROP POLICY IF EXISTS "date_plan_feedback_update_reviewer_only"/);
  assert.match(
    sql,
    /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.date_plan_feedback[\s\S]{0,80}FROM PUBLIC, anon, authenticated/,
    "physical-date feedback must be written through submit_date_plan_feedback",
  );
  assert.match(
    sql,
    /OLD\.completion_initiated_at IS DISTINCT FROM NEW\.completion_initiated_at/,
    "early-completion trigger must guard completion_initiated_at too",
  );
});

test("physical date feedback is private, subject-scoped, and separate from video date_feedback", () => {
  const sql = readRepoFile(MIGRATION);
  const feedbackHook = readRepoFile("src/hooks/useDatePlanFeedback.ts");
  const videoSurvey = readRepoFile("src/components/video-date/PostDateSurvey.tsx");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.date_plan_feedback/);
  assert.match(sql, /reviewer_user_id uuid NOT NULL/);
  assert.match(sql, /subject_user_id uuid NOT NULL/);
  assert.match(sql, /UNIQUE \(date_plan_id, reviewer_user_id\)/);
  assert.match(sql, /idx_date_plan_feedback_reviewer_created/);
  assert.match(sql, /idx_date_plan_feedback_subject_created/);
  assert.match(sql, /idx_date_plan_feedback_report_requested_created/);
  assert.match(sql, /reviewer_user_id = auth\.uid\(\)/, "reviewer can read their own feedback");
  assert.doesNotMatch(
    sql,
    /subject_user_id = auth\.uid\(\)/,
    "subject must not receive a user-facing read policy for feedback about them",
  );
  assert.match(sql, /submit_date_plan_feedback/);
  assert.match(feedbackHook, /submit_date_plan_feedback/);

  assert.match(videoSurvey, /update_post_date_feedback_details/);
  assert.doesNotMatch(sql, /ALTER TABLE public\.date_feedback|DROP TABLE public\.date_feedback/);
});

test("optional physical-date feedback remains voluntary and report-aware", () => {
  const sheet = readRepoFile("src/components/chat/PhysicalDateFeedbackSheet.tsx");
  const card = readRepoFile("src/components/chat/DateSuggestionCard.tsx");

  assert.match(sheet, /Anything Vibely should know\?/);
  assert.match(sheet, /freeText/);
  assert.match(sheet, /I want to report something/);
  assert.match(sheet, /Report this date/);
  assert.match(card, /Want to fill a quick post-date survey\?/);
  assert.match(card, /Yes, share feedback/);
  assert.match(card, /Thanks for sharing\. Your feedback helps keep Vibely safe\./);
});
