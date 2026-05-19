import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const migration = read("supabase/migrations/20260519150000_media_atomic_idempotency.sql");
const phase5Migration = read("supabase/migrations/20260519170000_media_phase_5_6_10.sql");
const mediaLifecycle = read("supabase/functions/_shared/media-lifecycle.ts");
const uploadImage = read("supabase/functions/upload-image/index.ts");
const uploadVoice = read("supabase/functions/upload-voice/index.ts");
const uploadEventCover = read("supabase/functions/upload-event-cover/index.ts");
const webImageUploadService = read("src/services/imageUploadService.ts");
const webVoiceUploadService = read("src/services/voiceUploadService.ts");
const webEventCoverUploadService = read("src/services/eventCoverUploadService.ts");
const webStorageService = read("src/services/storageService.ts");
const webOutboxExecute = read("src/lib/webChatOutbox/execute.ts");
const webAdminEventFormModal = read("src/components/admin/AdminEventFormModal.tsx");
const webAdminEventsPanel = read("src/components/admin/AdminEventsPanel.tsx");
const webOnboardingPhotos = read("src/pages/onboarding/steps/PhotosStep.tsx");
const webPhotoManageDrawer = read("src/components/photos/PhotoManageDrawer.tsx");
const webProfileWizard = read("src/components/wizard/ProfileWizard.tsx");
const nativeChatMediaUpload = read("apps/mobile/lib/chatMediaUpload.ts");
const nativeOutboxExecute = read("apps/mobile/lib/chatOutbox/execute.ts");
const nativeUploadImage = read("apps/mobile/lib/uploadImage.ts");
const nativePhotoBatchController = read("apps/mobile/lib/photoBatchController.ts");
const nativeGamesApi = read("apps/mobile/lib/gamesApi.ts");
const nativeScavengerStartSheet = read("apps/mobile/components/chat/games/ScavengerStartSheet.tsx");
const nativeScavengerBubble = read("apps/mobile/components/chat/games/ScavengerBubble.tsx");
const webMediaSdkAdapter = read("shared/media-sdk/adapters/web.ts");
const nativeMediaSdkAdapter = read("shared/media-sdk/adapters/native.ts");

test("media assets migration adds uploaded status, SHA-256, and provider identity uniqueness", () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS content_sha256 text/);
  assert.match(migration, /media_assets_content_sha256_check/);
  assert.match(migration, /'uploaded'/);
  assert.match(migration, /uniq_media_assets_provider_path/);
  assert.match(migration, /ON public\.media_assets \(provider, provider_path\)[\s\S]+WHERE provider_path IS NOT NULL/);
  assert.match(migration, /uniq_media_assets_provider_object_id/);
  assert.match(migration, /ON public\.media_assets \(provider, provider_object_id\)[\s\S]+WHERE provider_object_id IS NOT NULL/);
  assert.match(migration, /CREATE TEMP TABLE media_asset_duplicate_edges/);
  assert.match(migration, /WITH RECURSIVE connected\(root_id, asset_id\)/);
  assert.doesNotMatch(migration, /min\(root_id\)/i);
  assert.doesNotMatch(migration, /max\(ma\.owner_user_id\)/i);
  assert.match(migration, /WITH duplicate_rollup AS/);
  assert.match(migration, /provider_object_id = COALESCE\(canonical\.provider_object_id, duplicate_rollup\.provider_object_id\)/);
  assert.match(migration, /DELETE FROM public\.media_assets ma[\s\S]+media_asset_dedupe_map mapped/);
});

test("media upload receipts and reserve RPC are scoped, hash-bound, and service-role only", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.media_upload_receipts/);
  assert.match(migration, /UNIQUE \(owner_user_id, media_family, scope_key, client_request_id\)/);
  assert.match(migration, /content_sha256\s+text\s+NOT NULL/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.reserve_media_upload/);
  assert.match(migration, /client_request_id_conflict/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.reserve_media_upload/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.reserve_media_upload[\s\S]+TO service_role/);
});

test("attach media reference is atomic and promotes uploaded assets to active", () => {
  assert.match(migration, /uniq_media_references_active_ref/);
  assert.match(migration, /COALESCE\(ref_key, ''\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.attach_media_reference/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /ON CONFLICT \(asset_id, ref_type, ref_table, ref_id, \(COALESCE\(ref_key, ''\)\)\)/);
  assert.match(migration, /UPDATE public\.media_assets[\s\S]+SET status = 'active'/);
  assert.match(mediaLifecycle, /admin\.rpc\("attach_media_reference"/);
  assert.doesNotMatch(mediaLifecycle, /\.from\("media_references"\)[\s\S]{0,220}\.insert\(/);
});

test("registerMediaAsset routes through explicit SQL ON CONFLICT RPC", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.upsert_media_asset/);
  assert.match(migration, /ON CONFLICT \(provider, provider_path\)[\s\S]+WHERE provider_path IS NOT NULL/);
  assert.match(migration, /ON CONFLICT \(provider, provider_object_id\)[\s\S]+WHERE provider_object_id IS NOT NULL/);
  assert.match(migration, /provider_identity_content_conflict/);
  assert.match(mediaLifecycle, /admin\.rpc\("upsert_media_asset"/);
  assert.match(mediaLifecycle, /contentSha256\?: string \| null/);
  assert.doesNotMatch(mediaLifecycle, /\.from\("media_assets"\)[\s\S]{0,180}\.insert\(/);
});

test("upload-image reserves before PUT, sends Bunny Checksum, and registers uploaded assets", () => {
  assert.match(uploadImage, /client_request_id/);
  assert.match(uploadImage, /function clientRequestIdForUpload/);
  assert.match(uploadImage, /client_request_id_conflict/);
  assert.match(uploadImage, /client_request_id_invalid/);
  assert.match(uploadImage, /return json\(\{ success: false, error: clientRequest\.error \}, 400\)/);
  assert.match(uploadImage, /async function sha256Hex/);
  assert.match(uploadImage, /const contentSha256 = await sha256Hex\(fileBuffer\)/);
  assert.match(uploadImage, /adminSupabase\.rpc\("reserve_media_upload"/);
  assert.match(uploadImage, /const storagePath = `photos\/\$\{user\.id\}\/req-\$\{requestPathToken\}\.\$\{ext\}`/);
  assert.match(uploadImage, /"Checksum": contentSha256\.toUpperCase\(\)/);
  assert.match(uploadImage, /last_error: `provider_upload_failed:\$\{uploadRes\.status\}`/);
  assert.match(uploadImage, /\.from\("draft_media_sessions"\)[\s\S]+\.eq\("provider_id", storagePath\)[\s\S]+\.maybeSingle\(\)/);
  assert.match(uploadImage, /contentSha256,/);
  assert.match(uploadImage, /status: "uploaded"/);
  assert.match(uploadImage, /\.from\("media_upload_receipts"\)[\s\S]+status: "uploaded"/);
});

test("upload-voice is receipt-backed, hash-bound, and wired to durable outbox ids", () => {
  assert.match(uploadVoice, /function clientRequestIdForUpload/);
  assert.match(uploadVoice, /client_request_id_conflict/);
  assert.match(uploadVoice, /const contentSha256 = await sha256Hex\(fileBuffer\)/);
  assert.match(uploadVoice, /const mediaFamily = MEDIA_FAMILIES\.VOICE_MESSAGE/);
  assert.match(uploadVoice, /const scopeKey = `match:\$\{conversationId\}`/);
  assert.match(uploadVoice, /adminSupabase\.rpc\("reserve_media_upload"/);
  assert.match(uploadVoice, /p_client_request_id: clientRequestId/);
  assert.match(uploadVoice, /const storagePath = `voice\/\$\{conversationId\}\/req-\$\{requestPathToken\}\.\$\{sniffedMedia\.extension\}`/);
  assert.match(uploadVoice, /"Checksum": contentSha256\.toUpperCase\(\)/);
  assert.match(uploadVoice, /contentSha256,/);
  assert.match(uploadVoice, /status: "uploaded"/);
  assert.match(uploadVoice, /\.from\("media_upload_receipts"\)[\s\S]+status: "uploaded"/);

  assert.match(webVoiceUploadService, /clientRequestId\?: string/);
  assert.match(webVoiceUploadService, /formData\.append\("client_request_id", stableClientRequestId\)/);
  assert.match(webVoiceUploadService, /"x-client-request-id": stableClientRequestId/);
  assert.match(webOutboxExecute, /uploadVoiceToBunny\(blob, session\.access_token, matchId, clientRequestId\)/);

  assert.match(nativeChatMediaUpload, /uploadVoiceMessage\(audioUri: string, matchId: string, clientRequestId\?: string\)/);
  assert.match(nativeChatMediaUpload, /formData\.append\('client_request_id', stableClientRequestId\)/);
  assert.match(nativeChatMediaUpload, /'x-client-request-id': stableClientRequestId/);
  assert.match(nativeOutboxExecute, /uploadVoiceMessage\(payload\.uri, matchId, clientRequestId\)/);
});

test("upload-event-cover uses strong sniffing, stale cover guards, and attached receipts", () => {
  assert.match(uploadEventCover, /validateImageUploadBytes\(fileBuffer, file\.type\)/);
  assert.match(uploadEventCover, /function clientRequestIdForUpload/);
  assert.match(uploadEventCover, /expected_current_cover_asset_id/);
  assert.match(uploadEventCover, /expected_current_cover_asset_id_required/);
  assert.match(uploadEventCover, /stale_cover_update/);
  assert.match(uploadEventCover, /fetchCurrentEventCover/);
  assert.match(uploadEventCover, /const contentSha256 = await sha256Hex\(fileBuffer\)/);
  assert.match(uploadEventCover, /const mediaFamily = MEDIA_FAMILIES\.EVENT_COVER/);
  assert.match(uploadEventCover, /adminSupabase\.rpc\("reserve_media_upload"/);
  assert.match(uploadEventCover, /"Checksum": contentSha256\.toUpperCase\(\)/);
  assert.match(uploadEventCover, /contentSha256,/);
  assert.match(uploadEventCover, /status: "uploaded"/);
  assert.match(uploadEventCover, /reservedStatus === "attached"/);
  assert.match(uploadEventCover, /reservedStatus === "uploaded" && eventId/);
  assert.match(uploadEventCover, /reservedAssetIsCurrent/);
  assert.match(uploadEventCover, /receipt attached repair failed/);
  assert.match(uploadEventCover, /receipt uploaded mark failed/);
  assert.match(uploadEventCover, /adminSupabase\.rpc\("replace_event_cover_media_reference"/);
  assert.match(uploadEventCover, /receiptStatus = "attached"/);
  assert.match(uploadEventCover, /\.from\("media_upload_receipts"\)[\s\S]+status: receiptStatus/);

  assert.match(webEventCoverUploadService, /expectedCurrentCoverAssetId\?: string \| null/);
  assert.match(webEventCoverUploadService, /formData\.append\("expected_current_cover_asset_id", options\.expectedCurrentCoverAssetId\?\.trim\(\) \|\| "__none__"\)/);
  assert.match(webEventCoverUploadService, /formData\.append\("client_request_id", stableClientRequestId\)/);
  assert.match(webEventCoverUploadService, /"x-client-request-id": stableClientRequestId/);
  assert.match(webAdminEventFormModal, /cover_media_asset_id\?: string \| null/);
  assert.match(webAdminEventFormModal, /function isSupportedCoverImageFile/);
  assert.match(webAdminEventFormModal, /clientRequestIdForUploadFile\(file, `event-cover:\$\{event\?\.id \?\? "new"\}`\)/);
  assert.match(webAdminEventFormModal, /expectedCurrentCoverAssetId: event\?\.id \? currentCoverAssetId : undefined/);
  assert.match(webAdminEventFormModal, /setCurrentCoverAssetId\(uploaded\.assetId\)/);
  assert.match(webAdminEventsPanel, /cover_media_asset_id\?: string \| null/);
});

test("chat media sync and admin event listing consume atomic reference primitives", () => {
  assert.match(phase5Migration, /CREATE OR REPLACE FUNCTION public\.attach_chat_media_asset_to_match/);
  assert.match(phase5Migration, /public\.attach_media_reference\(/);
  assert.match(phase5Migration, /CREATE OR REPLACE FUNCTION public\.replace_event_cover_media_reference/);
  assert.match(phase5Migration, /stale_cover_update/);
  assert.match(phase5Migration, /CREATE OR REPLACE FUNCTION public\.sync_event_cover_media_lifecycle/);
  assert.match(phase5Migration, /public\.upsert_media_asset\(/);
  assert.match(phase5Migration, /CREATE OR REPLACE FUNCTION public\.admin_list_events/);
  assert.match(phase5Migration, /cover\.asset_id AS cover_media_asset_id/);
  assert.match(phase5Migration, /r\.ref_type = 'event_cover'/);
  assert.match(phase5Migration, /r\.ref_key = 'cover_image'/);
});

test("phase 5 photo transcode hooks are real web/native preprocessors", () => {
  assert.match(webMediaSdkAdapter, /export const webMediaTranscode =/);
  assert.match(webMediaSdkAdapter, /createImageBitmap/);
  assert.match(webMediaSdkAdapter, /document\.createElement\("canvas"\)/);
  assert.match(webMediaSdkAdapter, /canvas\.toBlob/);
  assert.match(webMediaSdkAdapter, /inputWithPreparedPhotoSource/);
  assert.match(webMediaSdkAdapter, /photoTranscoder/);
  assert.match(webMediaSdkAdapter, /phase_5_photo_transcode/);

  assert.match(nativeMediaSdkAdapter, /width\?: number \| null/);
  assert.match(nativeMediaSdkAdapter, /height\?: number \| null/);
  assert.match(nativeMediaSdkAdapter, /NativeImageManipulatorLike/);
  assert.match(nativeMediaSdkAdapter, /resizeActionsForNativePhoto/);
  assert.match(nativeMediaSdkAdapter, /manipulateAsync\(source\.uri, actions/);
  assert.match(nativeMediaSdkAdapter, /format: options\.format \?\? "jpeg"/);
  assert.match(nativeMediaSdkAdapter, /inputWithPreparedPhotoSource/);
  assert.match(nativeMediaSdkAdapter, /photoTranscoder/);
});

test("web and native chat image retries pass durable outbox ids to upload-image", () => {
  assert.match(webImageUploadService, /clientRequestId\?: string/);
  assert.match(webImageUploadService, /export function newUploadClientRequestId/);
  assert.match(webImageUploadService, /export function clientRequestIdForUploadFile/);
  assert.match(webImageUploadService, /formData\.append\("client_request_id", stableClientRequestId\)/);
  assert.match(webImageUploadService, /"x-client-request-id": stableClientRequestId/);
  assert.match(webOutboxExecute, /uploadImageToBunny\(file, session\.access_token, "chat", matchId, clientRequestId\)/);

  assert.match(nativeChatMediaUpload, /clientRequestId\?: string/);
  assert.match(nativeChatMediaUpload, /formData\.append\('client_request_id', stableClientRequestId\)/);
  assert.match(nativeChatMediaUpload, /'x-client-request-id': stableClientRequestId/);
  assert.match(nativeOutboxExecute, /uploadChatImageMessage\(payload\.uri, payload\.mimeType, matchId, clientRequestId\)/);
});

test("profile photo retry surfaces keep the same client request id for failed retries", () => {
  assert.match(webOnboardingPhotos, /uploadImageToBunny\(item\.file, session\.access_token, "onboarding", undefined, item\.id\)/);
  assert.match(webOnboardingPhotos, /newUploadClientRequestId\(\)/);
  assert.match(webPhotoManageDrawer, /clientRequestId: string/);
  assert.match(webPhotoManageDrawer, /const clientRequestId = newUploadClientRequestId\(\)/);
  assert.match(webPhotoManageDrawer, /failed\.clientRequestId/);
  assert.match(webStorageService, /clientRequestIdForUploadFile\(file, `profile-studio:\$\{userId\}:\$\{i\}`\)/);
  assert.match(webProfileWizard, /clientRequestIdForUploadFile\(file, `profile-wizard:\$\{userId\}:\$\{i\}`\)/);
  assert.match(webProfileWizard, /clientRequestIdForUploadFile\(file, `profile-wizard:\$\{user\.id\}:\$\{i\}`\)/);

  assert.match(nativeUploadImage, /clientRequestId\?: string/);
  assert.match(nativeUploadImage, /formData\.append\('client_request_id', stableClientRequestId\)/);
  assert.match(nativePhotoBatchController, /clientRequestId: draftId/);
  assert.match(nativeGamesApi, /export function newGameClientRequestId/);
  assert.match(nativeGamesApi, /sendScavengerChoice\(vars\.view, vars\.matchId, vars\.receiverPhotoUrl, vars\.clientRequestId\)/);
  assert.match(nativeScavengerStartSheet, /uploadChatImageMessage\(asset\.uri, asset\.mimeType \?\? null, matchId, clientRequestId\)/);
  assert.match(nativeScavengerStartSheet, /clientRequestId: senderPhotoClientRequestId \?\? undefined/);
  assert.match(nativeScavengerBubble, /uploadChatImageMessage\(asset\.uri, asset\.mimeType \?\? null, matchId, clientRequestId\)/);
  assert.match(nativeScavengerBubble, /clientRequestId: selectedPhotoClientRequestId \?\? undefined/);
});
