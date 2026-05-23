import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function assertOrder(source: string, labels: [string, string][]): void {
  let previous = -1;
  for (const [label, marker] of labels) {
    const index = source.indexOf(marker);
    assert.ok(index >= 0, `${label} marker not found`);
    assert.ok(index > previous, `${label} should appear after previous marker`);
    previous = index;
  }
}

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.ok(start >= 0, `${name} definition should exist`);
  const end = source.indexOf("REVOKE ALL ON FUNCTION", start);
  assert.ok(end > start, `${name} definition should include revoke boundary`);
  return source.slice(start, end);
}

const createVideoUpload = read("supabase/functions/create-video-upload/index.ts");
const videoWebhook = read("supabase/functions/video-webhook/index.ts");
const syncVibeVideoStatus = read("supabase/functions/sync-vibe-video-status/index.ts");
const deleteVibeVideo = read("supabase/functions/delete-vibe-video/index.ts");
const uploadImage = read("supabase/functions/upload-image/index.ts");
const webPhotoDraftReconcile = read("src/lib/photoDraftReconcile.ts");
const nativePhotoBatchController = read("apps/mobile/lib/photoBatchController.ts");
const supabaseTypes = read("src/integrations/supabase/types.ts");
const migration = read("supabase/migrations/20260523130000_draft_media_sessions_deprecation.sql");
const reviewFollowupsMigration = read("supabase/migrations/20260523201000_review_comment_followups_1019_1026.sql");

test("modern Vibe Video status RPC is provider-object keyed and syncs public read models", () => {
  const body = functionBody(migration, "update_vibe_video_upload_status");
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.update_vibe_video_upload_status/);
  assert.match(migration, /p_provider_object_id text/);
  assert.match(migration, /UPDATE public\.vibe_video_uploads/);
  assert.match(migration, /UPDATE public\.profile_vibe_videos pvv[\s\S]+FROM public\.media_assets ma[\s\S]+ma\.provider_object_id = v_provider_object_id/);
  assert.match(migration, /UPDATE public\.profiles[\s\S]+bunny_video_uid = v_provider_object_id/);
  assert.match(body, /SET media_asset_id = v_media_asset_id/);
  assert.match(body, /media_asset_id = COALESCE\(media_asset_id, v_media_asset_id\)/);
  assert.ok(
    body.indexOf("IF v_old_status = p_new_status THEN") <
      body.indexOf("'idempotent', true"),
    "idempotent status calls should remain successful after projection repair",
  );
  assert.match(migration, /'upload_not_found'/);
  assert.match(migration, /COMMENT ON TABLE public\.draft_media_sessions[\s\S]+LEGACY COMPATIBILITY ONLY/);
  assert.match(supabaseTypes, /update_vibe_video_upload_status/);
  assert.match(reviewFollowupsMigration, /CREATE OR REPLACE FUNCTION public\.update_vibe_video_upload_status/);
  assert.match(reviewFollowupsMigration, /UPDATE public\.profile_vibe_videos pvv[\s\S]+FROM public\.media_assets ma[\s\S]+ma\.provider_object_id = v_provider_object_id/);
  assert.match(migration, /NOTIFY pgrst, 'reload schema'/);
});

test("create-video-upload no longer creates or updates draft media sessions for new uploads", () => {
  assert.doesNotMatch(createVideoUpload, /"create_media_session"/);
  assert.doesNotMatch(createVideoUpload, /update_media_session_status/);
  assert.match(createVideoUpload, /const sessionId:\s*string \| null = null/);
  assert.match(createVideoUpload, /sessionId,\s*\n\s*sessionStatus/);
  assert.match(createVideoUpload, /isDurablyLinkedUploadAttempt[\s\S]+mediaAssetId \|\| providerObjectId === currentProfileVideoId/);
  assert.match(createVideoUpload, /"activate_profile_vibe_video"/);
});

test("webhook and manual sync prefer modern status path and keep legacy DMS fallback", () => {
  assertOrder(videoWebhook, [
    ["modern webhook status update", "\"update_vibe_video_upload_status\""],
    ["legacy DMS webhook fallback", "\"update_media_session_status\""],
    ["legacy profile fallback", ".from(\"profiles\")"],
  ]);
  assert.match(videoWebhook, /uploadRpcError !== "upload_not_found"/);
  assert.match(videoWebhook, /\.from\("draft_media_sessions"\)/);

  assertOrder(syncVibeVideoStatus, [
    ["modern manual sync status update", "\"update_vibe_video_upload_status\""],
    ["legacy DMS manual sync fallback", "\"update_media_session_status\""],
  ]);
  assert.match(syncVibeVideoStatus, /uploadRpcError !== "upload_not_found"/);
  assert.match(syncVibeVideoStatus, /sessionRpcError === "invalid_transition"/);
  assert.match(syncVibeVideoStatus, /legacy_fallback:\s*true/);
  assert.match(syncVibeVideoStatus, /sessionRpcError === "session_not_found"/);
  assert.match(syncVibeVideoStatus, /\.eq\("bunny_video_uid", requestedVideoId\)/);
});

test("profile photo RPC replacements are asset and receipt backed", () => {
  for (const name of [
    "complete_profile_photo_media_upload",
    "publish_photo_set",
    "mark_photo_deleted",
    "mark_photo_drafts_deleted",
  ]) {
    assert.doesNotMatch(functionBody(migration, name), /draft_media_sessions/);
  }

  assert.match(functionBody(migration, "complete_profile_photo_media_upload"), /'media_upload_receipts'/);
  assert.match(functionBody(migration, "complete_profile_photo_media_upload"), /'session_id', NULL/);
  assert.match(functionBody(migration, "complete_profile_photo_media_upload"), /legacy_table = 'media_upload_receipts'/);
  assert.match(functionBody(migration, "complete_profile_photo_media_upload"), /legacy_id = p_receipt_id::text/);
  assert.match(functionBody(migration, "publish_photo_set"), /public\.sync_profile_photo_media/);
  assert.ok(
    functionBody(migration, "publish_photo_set").indexOf("v_sync_result := public.sync_profile_photo_media") <
      functionBody(migration, "publish_photo_set").indexOf("UPDATE public.profiles"),
    "publish_photo_set should sync media references before committing profile-visible photo paths",
  );
  assert.match(functionBody(migration, "mark_photo_deleted"), /public\.mark_media_asset_soft_deleted_if_unreferenced/);
  assert.match(functionBody(migration, "mark_photo_drafts_deleted"), /'sessions_marked', 0/);
});

test("profile photo compatibility RPCs are not executable through PUBLIC grants", () => {
  for (const signature of [
    "public.publish_photo_set(uuid, text[], text)",
    "public.mark_photo_deleted(uuid, text)",
    "public.mark_photo_drafts_deleted(text[])",
  ]) {
    assert.match(
      migration,
      new RegExp(`REVOKE ALL ON FUNCTION ${signature.replace(/[()[\]]/g, "\\$&")} FROM PUBLIC, anon, authenticated`),
    );
  }
  assert.match(functionBody(migration, "publish_photo_set"), /COALESCE\(auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(functionBody(migration, "mark_photo_deleted"), /COALESCE\(auth\.role\(\), ''\) <> 'service_role'/);
});

test("client compatibility is preserved while DMS semantics are deprecated", () => {
  assert.match(uploadImage, /sessionId: reservedSessionId/);
  assert.match(uploadImage, /sessionId,/);
  assert.match(webPhotoDraftReconcile, /historical name is kept for client compatibility/);
  assert.match(nativePhotoBatchController, /Legacy-compatible upload session id/);
  assert.match(deleteVibeVideo, /legacy DMS cleanup below is[\s\S]+best-effort compatibility/);
});
