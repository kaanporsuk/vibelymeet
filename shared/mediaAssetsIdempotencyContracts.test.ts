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
const phase5ClosureMigration = read("supabase/migrations/20260519190000_media_phase_5_11_15.sql");
const mediaLifecycle = read("supabase/functions/_shared/media-lifecycle.ts");
const uploadImage = read("supabase/functions/upload-image/index.ts");
const uploadVoice = read("supabase/functions/upload-voice/index.ts");
const uploadEventCover = read("supabase/functions/upload-event-cover/index.ts");
const webImageUploadService = read("src/services/imageUploadService.ts");
const webVoiceUploadService = read("src/services/voiceUploadService.ts");
const webEventCoverUploadService = read("src/services/eventCoverUploadService.ts");
const webStorageService = read("src/services/storageService.ts");
const webStorageSdkUploads = read("src/lib/mediaSdk/webStorageUploads.ts");
const webOutboxExecute = read("src/lib/webChatOutbox/execute.ts");
const webOutboxContext = read("src/contexts/WebChatOutboxContext.tsx");
const webVoiceRecorder = read("src/components/chat/VoiceRecorder.tsx");
const webAdminEventFormModal = read("src/components/admin/AdminEventFormModal.tsx");
const webAdminEventsPanel = read("src/components/admin/AdminEventsPanel.tsx");
const webOnboardingPhotos = read("src/pages/onboarding/steps/PhotosStep.tsx");
const webPhotoManageDrawer = read("src/components/photos/PhotoManageDrawer.tsx");
const webProfileWizard = read("src/components/wizard/ProfileWizard.tsx");
const nativeChatMediaUpload = read("apps/mobile/lib/chatMediaUpload.ts");
const nativeImageAssetNormalize = read("apps/mobile/lib/imageAssetNormalize.ts");
const nativeOutboxExecute = read("apps/mobile/lib/chatOutbox/execute.ts");
const nativeOutboxContext = read("apps/mobile/lib/chatOutbox/ChatOutboxContext.tsx");
const nativeUploadImage = read("apps/mobile/lib/uploadImage.ts");
const nativeStorageSdkUploads = read("apps/mobile/lib/mediaSdk/nativeStorageUploads.ts");
const nativeChatThread = read("apps/mobile/app/chat/[id].tsx");
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
  assert.match(webOutboxExecute, /options\.mediaV2VoiceEnabled/);
  assert.match(webOutboxExecute, /uploadVoiceWithMediaSdk\(\{[\s\S]+blob,[\s\S]+accessToken: session\.access_token,[\s\S]+matchId,[\s\S]+clientRequestId/);
  assert.match(webOutboxExecute, /uploadVoiceToBunny\(blob, session\.access_token, matchId, clientRequestId\)/);

  assert.match(nativeChatMediaUpload, /uploadVoiceMessage\(audioUri: string, matchId: string, clientRequestId\?: string\)/);
  assert.match(nativeChatMediaUpload, /formData\.append\('client_request_id', stableClientRequestId\)/);
  assert.match(nativeChatMediaUpload, /'x-client-request-id': stableClientRequestId/);
  assert.match(nativeOutboxExecute, /options\.mediaV2VoiceEnabled/);
  assert.match(nativeOutboxExecute, /uploadVoiceWithMediaSdk\(\{ uri: payload\.uri, matchId, clientRequestId \}\)/);
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
  assert.match(webMediaSdkAdapter, /canvasSourceFromImageElement/);
  assert.match(webMediaSdkAdapter, /isHeicWebSource/);
  assert.match(webMediaSdkAdapter, /import\("heic2any"\)/);
  assert.match(webMediaSdkAdapter, /canvasSourceFromBlob\(convertedHeic\)/);
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

  assert.match(nativeImageAssetNormalize, /PROFILE_PHOTO_MAX_EDGE = 2048/);
  assert.match(nativeImageAssetNormalize, /resizeActionsForProfilePhoto/);
  assert.match(nativeImageAssetNormalize, /width: asset\.width/);
  assert.match(nativeImageAssetNormalize, /height: asset\.height/);
  assert.match(nativeImageAssetNormalize, /manipulateAsync\([\s\S]+resizeActionsForProfilePhoto\(normalized\)/);
});

test("phase 5 voice capture hooks are configured for 96 kbps mono without expo-av", () => {
  assert.match(webMediaSdkAdapter, /voiceRecordingConfig/);
  assert.match(webMediaSdkAdapter, /WEB_VOICE_AUDIO_BITS_PER_SECOND = 96_000/);
  assert.match(webMediaSdkAdapter, /WEB_VOICE_CHANNEL_COUNT = 1/);
  assert.match(webMediaSdkAdapter, /audioBitsPerSecond: WEB_VOICE_AUDIO_BITS_PER_SECOND/);
  assert.match(webVoiceRecorder, /webMediaTranscode\.voiceRecordingConfig\(\)/);
  assert.match(webVoiceRecorder, /getUserMedia\(recorderConfig\.constraints\)/);
  assert.match(webVoiceRecorder, /new MediaRecorder\(stream, recorderConfig\.options\)/);

  assert.match(nativeMediaSdkAdapter, /voiceRecordingOptions/);
  assert.match(nativeMediaSdkAdapter, /numberOfChannels: 1/);
  assert.match(nativeMediaSdkAdapter, /bitRate: 96000/);
  assert.match(nativeMediaSdkAdapter, /audioEncoder: "aac"/);
  assert.match(nativeMediaSdkAdapter, /phase_5_voice_record_native/);
  assert.match(nativeChatThread, /nativeMediaTranscodeHooks\.voiceRecordingOptions\(\)/);
  assert.match(nativeChatThread, /useAudioRecorder\(CHAT_VOICE_RECORDING_OPTIONS\)/);
  assert.doesNotMatch(nativeChatThread, /RecordingPresets\.HIGH_QUALITY/);
  assert.doesNotMatch(nativeChatThread, /expo-av/);
});

test("photo and voice callers are cut to storage SDK wrappers behind durable flags", () => {
  assert.match(webStorageSdkUploads, /createWebMediaSdk/);
  assert.match(webStorageSdkUploads, /media_v2_photo: true/);
  assert.match(webStorageSdkUploads, /media_v2_voice: true/);
  assert.match(webStorageSdkUploads, /uploadProfilePhoto: uploadWebPhotoViaLegacyService/);
  assert.match(webStorageSdkUploads, /uploadChatPhoto: uploadWebPhotoViaLegacyService/);
  assert.match(webStorageSdkUploads, /uploadVoiceNote: uploadWebVoiceViaLegacyService/);

  assert.match(webOutboxContext, /useFeatureFlag\("media_v2_photo"\)/);
  assert.match(webOutboxContext, /useFeatureFlag\("media_v2_voice"\)/);
  assert.match(webOutboxContext, /mediaV2PhotoEnabled: mediaV2Photo\.enabled/);
  assert.match(webOutboxContext, /mediaV2VoiceEnabled: mediaV2Voice\.enabled/);
  assert.match(webOutboxExecute, /options\.mediaV2PhotoEnabled/);
  assert.match(webOutboxExecute, /uploadImageWithMediaSdk\(\{[\s\S]+file,[\s\S]+accessToken: session\.access_token,[\s\S]+context: "chat"/);
  assert.match(webOutboxExecute, /uploadImageToBunny\(file, session\.access_token, "chat", matchId, clientRequestId\)/);

  assert.match(nativeStorageSdkUploads, /createNativeMediaSdk/);
  assert.match(nativeStorageSdkUploads, /media_v2_photo: true/);
  assert.match(nativeStorageSdkUploads, /media_v2_voice: true/);
  assert.match(nativeStorageSdkUploads, /imageManipulator: nativeImageManipulator/);
  assert.match(nativeStorageSdkUploads, /uploadProfilePhoto: uploadNativePhotoViaLegacyService/);
  assert.match(nativeStorageSdkUploads, /uploadChatPhoto: uploadNativePhotoViaLegacyService/);
  assert.match(nativeStorageSdkUploads, /uploadVoiceNote: uploadNativeVoiceViaLegacyService/);

  assert.match(nativeOutboxContext, /useFeatureFlag\('media_v2_photo'\)/);
  assert.match(nativeOutboxContext, /useFeatureFlag\('media_v2_voice'\)/);
  assert.match(nativeOutboxContext, /mediaV2PhotoEnabled: mediaV2Photo\.enabled/);
  assert.match(nativeOutboxContext, /mediaV2VoiceEnabled: mediaV2Voice\.enabled/);
  assert.match(nativeOutboxExecute, /options\.mediaV2PhotoEnabled/);
  assert.match(nativeOutboxExecute, /uploadChatImageWithMediaSdk\(\{[\s\S]+uri: payload\.uri,[\s\S]+mimeType: payload\.mimeType/);
});

test("uploaded orphan cleanup is worker-owned and guarded against late active references", () => {
  const worker = read("supabase/functions/process-media-delete-jobs/index.ts");
  assert.match(phase5ClosureMigration, /CREATE OR REPLACE FUNCTION public\.enqueue_uploaded_media_orphan_deletes/);
  assert.match(phase5ClosureMigration, /a\.status = 'uploaded'/);
  assert.match(phase5ClosureMigration, /interval '24 hours'/);
  assert.match(phase5ClosureMigration, /interval '7 days'/);
  assert.match(phase5ClosureMigration, /job_type = 'orphan_sweep'/);
  assert.match(phase5ClosureMigration, /DELETE FROM public\.media_delete_jobs[\s\S]+job_type = 'orphan_sweep'[\s\S]+status IN \('pending', 'failed'\)/);
  assert.match(phase5ClosureMigration, /CREATE OR REPLACE FUNCTION public\.attach_chat_media_asset_to_match/);
  assert.match(phase5ClosureMigration, /RAISE EXCEPTION 'chat_media_reference_attach_failed:%'/);
  assert.match(phase5ClosureMigration, /GRANT EXECUTE ON FUNCTION public\.attach_chat_media_asset_to_match\(uuid, uuid\)[\s\S]+TO service_role/);
  assert.match(phase5ClosureMigration, /CREATE OR REPLACE FUNCTION public\.claim_media_delete_jobs/);
  assert.match(phase5ClosureMigration, /NOT EXISTS \([\s\S]+FROM public\.media_references r[\s\S]+r\.asset_id = a\.id[\s\S]+r\.is_active = true/);
  assert.match(phase5ClosureMigration, /AND a\.status <> 'purged'/);
  assert.match(phase5ClosureMigration, /SET status = 'purging'/);
  assert.match(phase5ClosureMigration, /JOIN marked_assets ON marked_assets\.id = claimable\.asset_id/);
  assert.match(phase5ClosureMigration, /SET status = 'purge_ready'[\s\S]+AND status = 'purging'/);
  assert.match(worker, /enqueue_uploaded_media_orphan_deletes/);
  assert.match(worker, /stats\.uploadedOrphans/);
  assert.match(worker, /\.from\("media_references"\)[\s\S]+\.eq\("asset_id", job\.asset_id\)[\s\S]+\.eq\("is_active", true\)/);
  assert.match(worker, /\.from\("media_assets"\)[\s\S]+\.update\(\{[\s\S]+status: "active"/);
  assert.match(worker, /\.from\("media_delete_jobs"\)[\s\S]+\.delete\(\)[\s\S]+\.eq\("id", job\.id\)/);
});

test("web and native chat image retries pass durable outbox ids to upload-image", () => {
  assert.match(webImageUploadService, /clientRequestId\?: string/);
  assert.match(webImageUploadService, /export function newUploadClientRequestId/);
  assert.match(webImageUploadService, /export function clientRequestIdForUploadFile/);
  assert.match(webImageUploadService, /formData\.append\("client_request_id", stableClientRequestId\)/);
  assert.match(webImageUploadService, /"x-client-request-id": stableClientRequestId/);
  assert.match(webOutboxExecute, /uploadImageWithMediaSdk/);
  assert.match(webOutboxExecute, /uploadImageToBunny\(file, session\.access_token, "chat", matchId, clientRequestId\)/);

  assert.match(nativeChatMediaUpload, /clientRequestId\?: string/);
  assert.match(nativeChatMediaUpload, /formData\.append\('client_request_id', stableClientRequestId\)/);
  assert.match(nativeChatMediaUpload, /'x-client-request-id': stableClientRequestId/);
  assert.match(nativeOutboxExecute, /uploadChatImageWithMediaSdk/);
  assert.match(nativeOutboxExecute, /uploadChatImageMessage\(payload\.uri, payload\.mimeType, matchId, clientRequestId\)/);
});

test("profile photo retry surfaces keep the same client request id for failed retries", () => {
  assert.match(webOnboardingPhotos, /mediaV2Photo\.enabled/);
  assert.match(webOnboardingPhotos, /uploadImageWithMediaSdk\(\{[\s\S]+file: item\.file,[\s\S]+clientRequestId: item\.id/);
  assert.match(webOnboardingPhotos, /uploadImageToBunny\(item\.file, session\.access_token, "onboarding", undefined, item\.id\)/);
  assert.match(webOnboardingPhotos, /newUploadClientRequestId\(\)/);
  assert.match(webPhotoManageDrawer, /clientRequestId: string/);
  assert.match(webPhotoManageDrawer, /const clientRequestId = newUploadClientRequestId\(\)/);
  assert.match(webPhotoManageDrawer, /failed\.clientRequestId/);
  assert.match(webPhotoManageDrawer, /uploadImageWithMediaSdk/);
  assert.match(webStorageService, /clientRequestIdForUploadFile\(file, `profile-studio:\$\{userId\}:\$\{i\}`\)/);
  assert.match(webStorageService, /mediaV2PhotoEnabled/);
  assert.match(webProfileWizard, /clientRequestIdForUploadFile\(file, `profile-wizard:\$\{userId\}:\$\{i\}`\)/);
  assert.match(webProfileWizard, /clientRequestIdForUploadFile\(file, `profile-wizard:\$\{user\.id\}:\$\{i\}`\)/);
  assert.match(webProfileWizard, /uploadImageWithMediaSdk/);

  assert.match(nativeUploadImage, /clientRequestId\?: string/);
  assert.match(nativeUploadImage, /formData\.append\('client_request_id', stableClientRequestId\)/);
  assert.match(nativePhotoBatchController, /mediaV2Photo\.enabled/);
  assert.match(nativePhotoBatchController, /uploadProfilePhotoWithMediaSdk/);
  assert.match(nativePhotoBatchController, /clientRequestId: draftId/);
  assert.match(nativeGamesApi, /export function newGameClientRequestId/);
  assert.match(nativeGamesApi, /sendScavengerChoice\(vars\.view, vars\.matchId, vars\.receiverPhotoUrl, vars\.clientRequestId\)/);
  assert.match(nativeScavengerStartSheet, /mediaV2Photo\.enabled/);
  assert.match(nativeScavengerStartSheet, /uploadChatImageWithMediaSdk/);
  assert.match(nativeScavengerStartSheet, /uploadChatImageMessage\(asset\.uri, asset\.mimeType \?\? null, matchId, clientRequestId\)/);
  assert.match(nativeScavengerStartSheet, /clientRequestId: senderPhotoClientRequestId \?\? undefined/);
  assert.match(nativeScavengerBubble, /mediaV2Photo\.enabled/);
  assert.match(nativeScavengerBubble, /uploadChatImageWithMediaSdk/);
  assert.match(nativeScavengerBubble, /uploadChatImageMessage\(asset\.uri, asset\.mimeType \?\? null, matchId, clientRequestId\)/);
  assert.match(nativeScavengerBubble, /clientRequestId: selectedPhotoClientRequestId \?\? undefined/);
});
