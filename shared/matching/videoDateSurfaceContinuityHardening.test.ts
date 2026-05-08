import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read("supabase/migrations/20260508143000_video_date_surface_claims_post_date_continuity.sql");
const webDupGuard = read("src/hooks/useVideoDateDupTabGuard.ts");
const webSurvey = read("src/components/video-date/PostDateSurvey.tsx");
const nativeSurvey = read("apps/mobile/components/video-date/PostDateSurvey.tsx");
const sharedContinuity = read("shared/matching/postDateContinuity.ts");
const postDateVerdictFunction = read("supabase/functions/post-date-verdict/index.ts");
const dailyRoomFunction = read("supabase/functions/daily-room/index.ts");

test("surface claim migration adds server-owned duplicate active UI ownership", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.video_date_surface_claims/);
  assert.match(migration, /profile_id uuid PRIMARY KEY/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.claim_video_date_surface/);
  assert.match(migration, /SURFACE_CLAIM_CONFLICT/);
  assert.match(migration, /p_takeover boolean DEFAULT false/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.claim_video_date_surface\(uuid, text, text, boolean, integer\) TO authenticated, service_role/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.release_video_date_surface_claim/);
});

test("active-session audit remains service-role-only and uses the shared active-surface predicate", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.video_date_session_is_active_surface/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.audit_active_video_date_surface_conflicts/);
  assert.match(migration, /HAVING count\(DISTINCT ap\.session_id\) > 1/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.audit_active_video_date_surface_conflicts\(\) TO service_role/);
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.audit_active_video_date_surface_conflicts\(\) TO authenticated/);
});

test("web duplicate-tab guard renews and releases backend surface claims", () => {
  assert.match(webDupGuard, /claim_video_date_surface/);
  assert.match(webDupGuard, /release_video_date_surface_claim/);
  assert.match(webDupGuard, /p_surface:\s*"video_date"/);
  assert.match(webDupGuard, /p_takeover:\s*true/);
  assert.match(webDupGuard, /SURFACE_CLAIM_CONFLICT/);
});

test("post-date continuity is backend-resolved before client event fallback", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.resolve_post_date_next_surface/);
  for (const action of ["survey", "ready_gate", "video_date", "lobby", "chat", "wrap_up", "home"]) {
    assert.match(migration, new RegExp(`'action', '${action}'`));
  }
  assert.match(migration, /v_session\.event_id IS NULL[\s\S]*'action', 'home'/);
  assert.match(migration, /INSERT INTO public\.migration_classifications/);
  assert.match(sharedContinuity, /normalizeServerPostDateNextSurface/);
  assert.match(webSurvey, /resolve_post_date_next_surface/);
  assert.match(nativeSurvey, /resolve_post_date_next_surface/);
  assert.match(nativeSurvey, /onVideoDateReady/);
  assert.match(nativeSurvey, /serverNext\.action === 'video_date'/);
  assert.match(nativeSurvey, /route: 'date'/);
  assert.ok(
    webSurvey.indexOf("resolve_post_date_next_surface") < webSurvey.indexOf("const active = await checkEventActive"),
    "web survey should ask backend for next surface before falling back to client lifecycle checks",
  );
  assert.ok(
    nativeSurvey.indexOf("resolve_post_date_next_surface") < nativeSurvey.indexOf("const continuation = await getEventContinuationSnapshot"),
    "native survey should ask backend for next surface before falling back to client lifecycle checks",
  );
});

test("optional post-date details use participant-checked RPC instead of direct client updates", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.update_post_date_feedback_details/);
  assert.match(migration, /VERDICT_REQUIRED/);
  assert.match(migration, /jsonb_typeof\(v_patch->'tag_chemistry'\) = 'boolean'/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.update_post_date_feedback_details\(uuid, jsonb\) TO authenticated, service_role/);
  assert.match(webSurvey, /update_post_date_feedback_details/);
  assert.match(nativeSurvey, /update_post_date_feedback_details/);
  assert.doesNotMatch(webSurvey, /\.from\(["']date_feedback["']\)[\s\S]{0,500}\.update\(/);
  assert.doesNotMatch(nativeSurvey, /\.from\(["']date_feedback["']\)[\s\S]{0,500}\.update\(/);
});

test("service-role Edge functions keep participant state writes behind user-authenticated RPCs", () => {
  assert.match(postDateVerdictFunction, /const userClient = createClient\(supabaseUrl, anonKey/);
  assert.match(postDateVerdictFunction, /userClient\.rpc\("submit_post_date_verdict_v2"/);
  assert.doesNotMatch(postDateVerdictFunction, /serviceClient\.rpc\("submit_post_date_verdict/);
  assert.match(dailyRoomFunction, /const supabase = createClient\(supabaseUrl, supabaseAnonKey/);
  assert.match(dailyRoomFunction, /supabase\.rpc\("video_date_transition"/);
  assert.doesNotMatch(dailyRoomFunction, /serviceClient\.rpc\("video_date_transition"/);
});
