import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function assertAttemptMarkerAfterRefresh(source: string, awaitExpression: string, assignment: string): void {
  const awaitIndex = source.indexOf(awaitExpression);
  assert.ok(awaitIndex >= 0, `${awaitExpression} should be present`);
  assert.ok(source.indexOf(assignment, awaitIndex) > awaitIndex, `${assignment} should happen after refresh succeeds`);
}

const migration = read("supabase/migrations/20260519150000_media_atomic_idempotency.sql");
const phase5Migration = read("supabase/migrations/20260519170000_media_phase_5_6_10.sql");
const phase5ClosureMigration = read("supabase/migrations/20260519190000_media_phase_5_11_15.sql");
const phase5BulletproofMigration = read("supabase/migrations/20260520170000_media_phase5_bulletproof_closure.sql");
const mediaUxAccelerationMigration = read("supabase/migrations/20260522161000_media_derivatives_placeholders_realtime.sql");
const mediaBlurhashMigration = read("supabase/migrations/20260523100000_media_blurhash_placeholders.sql");
const sharedMediaPlaceholders = read("shared/media/placeholders.ts");
const mediaLifecycle = read("supabase/functions/_shared/media-lifecycle.ts");
const mediaUploadTelemetry = read("supabase/functions/_shared/media-upload-telemetry.ts");
const uploadImage = read("supabase/functions/upload-image/index.ts");
const getChatMediaUrl = read("supabase/functions/get-chat-media-url/index.ts");
const uploadVoice = read("supabase/functions/upload-voice/index.ts");
const uploadEventCover = read("supabase/functions/upload-event-cover/index.ts");
const backfillMediaPlaceholders = read("supabase/functions/backfill-media-placeholders/index.ts");
const supabaseConfig = read("supabase/config.toml");
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
const nativePhotoManageDrawer = read("apps/mobile/components/photos/PhotoManageDrawer.tsx");
const nativeChatMediaUpload = read("apps/mobile/lib/chatMediaUpload.ts");
const nativeImageAssetNormalize = read("apps/mobile/lib/imageAssetNormalize.ts");
const nativeOutboxExecute = read("apps/mobile/lib/chatOutbox/execute.ts");
const nativeOutboxContext = read("apps/mobile/lib/chatOutbox/ChatOutboxContext.tsx");
const nativeUploadImage = read("apps/mobile/lib/uploadImage.ts");
const webImageUrl = read("src/utils/imageUrl.ts");
const nativeImageUrl = read("apps/mobile/lib/imageUrl.ts");
const webFetchUserProfile = read("src/services/fetchUserProfile.ts");
const nativeFetchUserProfile = read("apps/mobile/lib/fetchUserProfile.ts");
const webMyProfileSettings = read("src/services/myProfileSettings.ts");
const nativeMyProfileSettings = read("apps/mobile/lib/myProfileSettings.ts");
const webUseMessages = read("src/hooks/useMessages.ts");
const nativeChatApi = read("apps/mobile/lib/chatApi.ts");
const sharedProfilePhotoDerivatives = read("shared/profile/photoDerivatives.ts");
const webMediaAssetResolver = read("src/lib/mediaAssetResolver.ts");
const nativeMediaAssetResolver = read("apps/mobile/lib/mediaAssetResolver.ts");
const webMediaAssetHook = read("src/hooks/useMediaAsset.ts");
const nativeMediaAssetHook = read("apps/mobile/hooks/useMediaAsset.ts");
const webChatPhotoLightbox = read("src/components/chat/ChatPhotoLightbox.tsx");
const nativeChatThreadMediaViewer = read("apps/mobile/components/chat/ChatThreadMediaViewer.tsx");
const nativeStorageSdkUploads = read("apps/mobile/lib/mediaSdk/nativeStorageUploads.ts");
const nativeChatThread = read("apps/mobile/app/chat/[id].tsx");
const nativePhotoBatchController = read("apps/mobile/lib/photoBatchController.ts");
const nativeGamesApi = read("apps/mobile/lib/gamesApi.ts");
const nativeScavengerStartSheet = read("apps/mobile/components/chat/games/ScavengerStartSheet.tsx");
const nativeScavengerBubble = read("apps/mobile/components/chat/games/ScavengerBubble.tsx");
const webMediaSdkAdapter = read("shared/media-sdk/adapters/web.ts");
const nativeMediaSdkAdapter = read("shared/media-sdk/adapters/native.ts");
const mediaArchitectureDoc = read("docs/architecture/media.md");

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
  assert.match(uploadImage, /\.slice\(0, 32\)/);
  assert.match(uploadImage, /`photos\/match-\$\{matchId\}\/\$\{user\.id\}\/req-\$\{requestPathToken\}\.\$\{ext\}`/);
  assert.match(uploadImage, /`photos\/\$\{user\.id\}\/req-\$\{requestPathToken\}\.\$\{ext\}`/);
  assert.match(uploadImage, /const uploadPath = reservedPath/);
  assert.match(uploadImage, /storageZone\}\/\$\{uploadPath\}/);
  assert.match(uploadImage, /p_provider_path: uploadPath/);
  assert.match(uploadImage, /"Checksum": contentSha256\.toUpperCase\(\)/);
  assert.match(uploadImage, /mark_media_upload_receipt_failed/);
  assert.match(uploadImage, /complete_profile_photo_media_upload/);
  assert.match(uploadImage, /complete_storage_media_upload/);
  assert.match(uploadImage, /\(reservedStatus === "uploaded" \|\| reservedStatus === "attached"\)[\s\S]+!reservedSessionId/);
  assert.doesNotMatch(uploadImage, /\.from\("draft_media_sessions"\)[\s\S]+\.maybeSingle\(\)/);
  assert.match(uploadImage, /contentSha256,/);
  assert.match(uploadImage, /assetId,/);
  assert.match(uploadImage, /receiptId,/);
  assert.match(uploadImage, /sessionId,/);
  assert.match(uploadImage, /url: bunnyCdnUrl/);
  assert.match(uploadImage, /captureReceiptTransition/);
  assert.match(mediaUploadTelemetry, /media_upload_receipt_transition/);
});

test("image derivatives are best-effort acceleration and never canonical upload requirements", () => {
  assert.match(uploadImage, /readDerivativeFile\(formData, "derivative_thumb", "thumb"\)/);
  assert.match(uploadImage, /readDerivativeFile\(formData, "derivative_hero", "hero"\)/);
  assert.match(uploadImage, /value\.size > 2 \* 1024 \* 1024/);
  assert.match(uploadImage, /return thumb && hero \? \{ thumb, hero \} : null/);
  assert.match(uploadImage, /const uploadRes = await fetch\([\s\S]+body: fileBuffer/);
  assert.match(uploadImage, /for \(const derivative of derivativeUploads\)[\s\S]+continue;[\s\S]+catch \(error\)/);
  assert.match(uploadImage, /\.\.\.\(derivativeUploads\.length \? \{ derivative_targets: derivativeUploads\.map/);
  assert.match(uploadImage, /\.\.\.\(Object\.keys\(derivatives\)\.length \? \{ derivatives \} : \{\}\)/);
  assert.match(webImageUploadService, /catch \{[\s\S]+Derivatives are an acceleration layer; never block the canonical upload/);
  assert.match(nativeImageAssetNormalize, /if \(derivatives\.length === specs\.length\) return derivatives/);
  assert.match(nativeImageAssetNormalize, /for \(const derivative of derivatives\) derivative\.cleanup\(\)/);
  assert.match(nativeUploadImage, /rememberImageDerivatives\(data\.path, data\.derivatives\)/);
  assert.match(nativeChatMediaUpload, /rememberImageDerivatives\(data\.path, data\.derivatives\)/);
  const voiceUploadBody = nativeChatMediaUpload.slice(
    nativeChatMediaUpload.indexOf("export async function uploadVoiceMessage"),
    nativeChatMediaUpload.indexOf("export async function uploadChatImageMessage"),
  );
  assert.doesNotMatch(voiceUploadBody, /rememberImageDerivatives/);
});

test("media placeholders and derivative refs are durable without Bunny Image Optimizer", () => {
  assert.match(mediaUxAccelerationMigration, /derivative_thumb_path/);
  assert.match(mediaUxAccelerationMigration, /derivative_hero_path/);
  assert.match(mediaUxAccelerationMigration, /placeholder_kind/);
  assert.match(mediaUxAccelerationMigration, /dominant_color/);
  assert.match(mediaUxAccelerationMigration, /broadcast_media_asset_event_v1/);
  assert.match(mediaUxAccelerationMigration, /realtime\.send/);
  assert.match(mediaUxAccelerationMigration, /profile_photo_derivatives_for_paths/);
  assert.match(mediaUxAccelerationMigration, /'photo_derivatives', COALESCE\(v_photo_derivatives/);
  assert.match(mediaUxAccelerationMigration, /CREATE OR REPLACE FUNCTION public\.get_my_profile_settings\(\)/);
  assert.doesNotMatch(mediaUxAccelerationMigration, /BUNNY_IMAGE_OPTIMIZER|image_optimizer/i);
  assert.match(mediaBlurhashMigration, /placeholder_kind IN \('dominant_color', 'blurhash'\)/);
  assert.match(mediaBlurhashMigration, /WHEN placeholder_kind IN \('dominant_color', 'blurhash'\)/);
  assert.match(mediaBlurhashMigration, /broadcast_media_asset_event_v1/);
  assert.match(sharedMediaPlaceholders, /export type MediaPlaceholderKind = "dominant_color" \| "blurhash"/);

  assert.match(uploadImage, /readImagePlaceholderMetadata\(formData\)/);
  assert.match(uploadImage, /const serverPlaceholderMetadata = await createImagePlaceholderMetadata\(fileBuffer\);/);
  assert.doesNotMatch(uploadImage, /clientPlaceholderMetadata\?\.placeholder_kind === "blurhash"[\s\S]{0,120}\? null/);
  assert.match(uploadImage, /updateMediaAssetPresentation\(adminSupabase, assetId/);
  assert.match(uploadImage, /derivative_thumb_path/);
  assert.match(uploadImage, /derivative_hero_path/);
  assert.match(uploadImage, /dominant_color/);
  assert.match(uploadEventCover, /createImagePlaceholderMetadata\(fileBuffer\)/);
  assert.match(uploadEventCover, /readImagePlaceholderMetadata\(formData\)/);
  assert.match(uploadEventCover, /updateMediaAssetPlaceholder/);
  assert.match(webEventCoverUploadService, /imagePlaceholderForImage/);
  assert.match(webEventCoverUploadService, /formData\.append\("placeholder_kind", placeholder\.kind\)/);
  assert.match(backfillMediaPlaceholders, /MEDIA_PLACEHOLDER_BACKFILL_TOKEN/);
  assert.match(backfillMediaPlaceholders, /placeholderForStorageAsset/);
  assert.match(backfillMediaPlaceholders, /placeholderForStreamAsset/);
  assert.match(backfillMediaPlaceholders, /placeholder_kind\.is\.null,placeholder_kind\.neq\.blurhash,placeholder_hash\.is\.null/);
  assert.match(supabaseConfig, /\[functions\.backfill-media-placeholders\][\s\S]{0,80}verify_jwt = false/);

  assert.match(webImageUploadService, /dominantColorForImage/);
  assert.match(webImageUploadService, /encodeBlurhash/);
  assert.match(webImageUploadService, /formData\.append\("placeholder_kind", placeholder\.kind\)/);
  assert.match(webImageUploadService, /if \(thumb && hero\)/);
  assert.match(nativeChatMediaUpload, /prepareProfilePhotoAssetForUpload/);

  assert.match(getChatMediaUrl, /MEDIA_ASSET_RESOLVE_SELECT/);
  assert.match(getChatMediaUrl, /derivative_hero_path/);
  assert.match(getChatMediaUrl, /storageObjectForAssetKind/);
  assert.match(getChatMediaUrl, /mimeTypeForStoragePath/);
  assert.match(getChatMediaUrl, /variant\?: unknown/);
  assert.match(getChatMediaUrl, /body\?\.variant === "original"/);
  assert.match(getChatMediaUrl, /assetPresentationPayload/);
  assert.match(getChatMediaUrl, /placeholderKind/);

  assert.match(webMediaAssetResolver, /placeholderKind: MediaPlaceholderKind \| null/);
  assert.match(webMediaAssetResolver, /variant\?: "display" \| "original"/);
  assert.match(webMediaAssetResolver, /prefetchRenderableAsset/);
  assert.match(webMediaAssetResolver, /media_placeholder/);
  assert.match(nativeMediaAssetResolver, /placeholderKind: MediaPlaceholderKind \| null/);
  assert.match(nativeMediaAssetResolver, /variant\?: 'display' \| 'original'/);
  assert.match(nativeMediaAssetResolver, /Image\.prefetch/);
  assert.match(nativeMediaAssetResolver, /media_placeholder/);
  assert.match(webMediaAssetHook, /media_asset_event/);
  assert.match(nativeMediaAssetHook, /media_asset_event/);
  assert.match(webMediaAssetHook, /dominantColor/);
  assert.match(nativeMediaAssetHook, /dominantColor/);
  assert.match(nativeChatThread, /chatMediaPlaceholder/);
  assert.match(nativeChatThread, /MediaPlaceholder/);
  assert.match(nativeChatThread, /variant: 'original'/);
  assert.match(webPhotoManageDrawer, /PhotoUploadSkeleton/);
  assert.doesNotMatch(webPhotoManageDrawer, /Loader2/);
  assert.match(nativePhotoManageDrawer, /uploadSkeleton/);
  assert.doesNotMatch(nativePhotoManageDrawer, /ActivityIndicator/);
  assert.match(webChatPhotoLightbox, /void refreshCurrent\(\)/);
  assert.match(webChatPhotoLightbox, /refreshInFlightForUrlRef\.current === currentUrl/);
  assertAttemptMarkerAfterRefresh(
    webChatPhotoLightbox,
    "const freshUrl = await onRefreshItem(current);",
    "refreshAttemptedForUrlRef.current = currentUrl;",
  );
  assert.match(nativeChatThreadMediaViewer, /void refreshCurrent\(\)/);
  assert.match(nativeChatThreadMediaViewer, /refreshInFlightForUriRef\.current === currentUri/);
  assertAttemptMarkerAfterRefresh(
    nativeChatThreadMediaViewer,
    "const freshUri = await onRefreshItem(current);",
    "refreshAttemptedForUriRef.current = currentUri;",
  );

  assert.match(sharedProfilePhotoDerivatives, /normalizeProfilePhotoDerivatives/);
  assert.match(webFetchUserProfile, /rememberProfilePhotoDerivativeMap\(row\.photo_derivatives\)/);
  assert.match(nativeFetchUserProfile, /rememberProfilePhotoDerivativeMap\(row\.photo_derivatives\)/);
  assert.match(webMyProfileSettings, /rememberProfilePhotoDerivativeMap\(row\.photo_derivatives\)/);
  assert.match(nativeMyProfileSettings, /rememberProfilePhotoDerivativeMap\(row\.photo_derivatives\)/);
  assert.match(webUseMessages, /rememberProfilePhotoDerivativeMap\(payload\.other_user\?\.photo_derivatives\)/);
  assert.match(nativeChatApi, /rememberProfilePhotoDerivativeMap\(payload\.other_user\?\.photo_derivatives\)/);
});

test("image derivative selection only uses server-confirmed derivative paths", () => {
  assert.match(webImageUrl, /rememberImageDerivatives/);
  assert.match(nativeImageUrl, /rememberImageDerivatives/);
  assert.doesNotMatch(webImageUrl, /@orig\\\.|@thumb\.\$1|@hero\.\$1/);
  assert.doesNotMatch(nativeImageUrl, /@orig\\\.|@thumb\.\$1|@hero\.\$1/);
});

test("upload-voice is receipt-backed, hash-bound, and wired to durable outbox ids", () => {
  assert.match(uploadVoice, /function clientRequestIdForUpload/);
  assert.match(uploadVoice, /client_request_id_conflict/);
  assert.match(uploadVoice, /const contentSha256 = await sha256Hex\(fileBuffer\)/);
  assert.match(uploadVoice, /const mediaFamily = MEDIA_FAMILIES\.VOICE_MESSAGE/);
  assert.match(uploadVoice, /const scopeKey = `match:\$\{conversationId\}`/);
  assert.match(uploadVoice, /adminSupabase\.rpc\("reserve_media_upload"/);
  assert.match(uploadVoice, /p_client_request_id: clientRequestId/);
  assert.match(uploadVoice, /\.slice\(0, 32\)/);
  assert.match(uploadVoice, /const storagePath = `voice\/match-\$\{conversationId\}\/\$\{user\.id\}\/req-\$\{requestPathToken\}\.\$\{sniffedMedia\.extension\}`/);
  assert.match(uploadVoice, /const uploadPath = reservedPath/);
  assert.match(uploadVoice, /storageZone\}\/\$\{uploadPath\}/);
  assert.match(uploadVoice, /p_provider_path: uploadPath/);
  assert.match(uploadVoice, /"Checksum": contentSha256\.toUpperCase\(\)/);
  assert.match(uploadVoice, /complete_storage_media_upload/);
  assert.match(uploadVoice, /mark_media_upload_receipt_failed/);
  assert.match(uploadVoice, /contentSha256,/);
  assert.match(uploadVoice, /assetId,/);
  assert.match(uploadVoice, /receiptId,/);
  assert.match(uploadVoice, /sessionId: null/);
  assert.match(uploadVoice, /url: audioUrl/);

  assert.match(webVoiceUploadService, /clientRequestId\?: string/);
  assert.match(webVoiceUploadService, /formData\.append\("client_request_id", stableClientRequestId\)/);
  assert.match(webVoiceUploadService, /"x-client-request-id": stableClientRequestId/);
  assert.doesNotMatch(webOutboxExecute, /options\.mediaV2VoiceEnabled/);
  assert.match(webOutboxExecute, /uploadVoiceWithMediaSdk\(\{[\s\S]+blob,[\s\S]+accessToken: session\.access_token,[\s\S]+matchId,[\s\S]+clientRequestId/);
  assert.doesNotMatch(webOutboxExecute, /uploadVoiceToBunny\(blob, session\.access_token, matchId, clientRequestId\)/);
  assert.match(webStorageSdkUploads, /evaluateClientFeatureFlagForUpload\("media_v2_voice", \{ userId: uploadUserId \}\)/);
  assert.match(webStorageSdkUploads, /return \(await uploadVoiceToBunny\(params\.blob, params\.accessToken, matchId, clientRequestId\)\)\.path/);

  assert.match(nativeChatMediaUpload, /uploadVoiceMessage\([\s\S]+audioUri: string,[\s\S]+matchId: string,[\s\S]+clientRequestId\?: string/);
  assert.match(nativeChatMediaUpload, /formData\.append\('client_request_id', stableClientRequestId\)/);
  assert.match(nativeChatMediaUpload, /'x-client-request-id': stableClientRequestId/);
  assert.doesNotMatch(nativeOutboxExecute, /options\.mediaV2VoiceEnabled/);
  assert.match(nativeOutboxExecute, /uploadVoiceWithMediaSdk\(\{ uri: payload\.uri, matchId, clientRequestId \}\)/);
  assert.doesNotMatch(nativeOutboxExecute, /uploadVoiceMessage\(payload\.uri, matchId, clientRequestId\)/);
  assert.match(nativeStorageSdkUploads, /evaluateClientFeatureFlagForUpload\('media_v2_voice', \{ userId: uploadUserId \}\)/);
  assert.match(nativeStorageSdkUploads, /return \(await uploadVoiceMessage\(params\.uri, matchId, clientRequestId\)\)\.path/);
});

test("upload-event-cover uses strong sniffing, stale cover guards, and attached receipts", () => {
  assert.match(uploadEventCover, /\.from\("user_roles"\)[\s\S]+\.eq\("role", "admin"\)/);
  assert.match(mediaArchitectureDoc, /Event-cover uploads remain admin-only[\s\S]+events` schema has no[\s\S]+owner\/host column/);
  assert.match(uploadEventCover, /validateImageUploadBytes\(fileBuffer, file\.type\)/);
  assert.match(uploadEventCover, /function clientRequestIdForUpload/);
  assert.match(uploadEventCover, /expected_current_cover_asset_id/);
  assert.match(uploadEventCover, /expected_current_cover_asset_id_required/);
  assert.match(uploadEventCover, /stale_cover_update/);
  assert.match(uploadEventCover, /fetchCurrentEventCover/);
  assert.match(uploadEventCover, /const contentSha256 = await sha256Hex\(fileBuffer\)/);
  assert.match(uploadEventCover, /const mediaFamily = MEDIA_FAMILIES\.EVENT_COVER/);
  assert.match(uploadEventCover, /adminSupabase\.rpc\("reserve_media_upload"/);
  assert.match(uploadEventCover, /\.slice\(0, 32\)/);
  assert.match(uploadEventCover, /const uploadPath = reservedPath/);
  assert.match(uploadEventCover, /storageZone\}\/\$\{uploadPath\}/);
  assert.match(uploadEventCover, /p_provider_path: uploadPath/);
  assert.match(uploadEventCover, /"Checksum": contentSha256\.toUpperCase\(\)/);
  assert.match(uploadEventCover, /complete_storage_media_upload/);
  assert.match(uploadEventCover, /mark_media_upload_receipt_failed/);
  assert.match(uploadEventCover, /contentSha256,/);
  assert.match(uploadEventCover, /assetId,/);
  assert.match(uploadEventCover, /receiptId,/);
  assert.match(uploadEventCover, /referenceId,/);
  assert.match(uploadEventCover, /sessionId: null/);
  assert.match(uploadEventCover, /reservedStatus === "attached"/);
  assert.match(uploadEventCover, /reservedStatus === "uploaded" && eventId/);
  assert.match(uploadEventCover, /reservedAssetIsCurrent/);
  assert.match(uploadEventCover, /receipt attached repair failed/);
  assert.match(uploadEventCover, /receipt completion failed/);
  assert.match(uploadEventCover, /adminSupabase\.rpc\("replace_event_cover_media_reference"/);
  assert.match(uploadEventCover, /receiptStatus = "attached"/);
  assert.doesNotMatch(uploadEventCover, /\.from\("media_upload_receipts"\)[\s\S]+status: receiptStatus/);

  assert.match(webEventCoverUploadService, /expectedCurrentCoverAssetId\?: string \| null/);
  assert.match(webEventCoverUploadService, /currentCoverAssetId\?: string \| null/);
  assert.match(webEventCoverUploadService, /EventCoverUploadError/);
  assert.match(webEventCoverUploadService, /formData\.append\("expected_current_cover_asset_id", options\.expectedCurrentCoverAssetId\?\.trim\(\) \|\| "__none__"\)/);
  assert.match(webEventCoverUploadService, /formData\.append\("client_request_id", stableClientRequestId\)/);
  assert.match(webEventCoverUploadService, /"x-client-request-id": stableClientRequestId/);
  assert.match(webAdminEventFormModal, /cover_media_asset_id\?: string \| null/);
  assert.match(webAdminEventFormModal, /function isSupportedCoverImageFile/);
  assert.match(webAdminEventFormModal, /clientRequestIdForUploadFile\(file, `event-cover:\$\{event\?\.id \?\? "new"\}`\)/);
  assert.match(webAdminEventFormModal, /uploadEventCoverWithMediaSdk/);
  assert.doesNotMatch(webAdminEventFormModal, /uploadEventCoverToBunny/);
  assert.match(webAdminEventFormModal, /expectedCurrentCoverAssetId: event\?\.id \? currentCoverAssetId : undefined/);
  assert.match(webAdminEventFormModal, /error\.code === "stale_cover_update"/);
  assert.match(webAdminEventFormModal, /setCurrentCoverAssetId\(nextCoverAssetId\)/);
  assert.match(webAdminEventFormModal, /setCurrentCoverAssetId\(uploaded\.assetId\)/);
  assert.match(webStorageSdkUploads, /export async function uploadEventCoverWithMediaSdk/);
  assert.match(webStorageSdkUploads, /uploadEventCover:\s*uploadWebPhotoViaLegacyService/);
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
  assert.doesNotMatch(webStorageSdkUploads, /media_v2_photo: true/);
  assert.doesNotMatch(webStorageSdkUploads, /media_v2_voice: true/);
  assert.match(webStorageSdkUploads, /evaluateClientFeatureFlagForUpload\("media_v2_photo", \{ userId: uploadUserId \}\)/);
  assert.match(webStorageSdkUploads, /MEDIA_UPLOAD_PATH_EVENT_NAMES/);
  assert.match(webStorageSdkUploads, /createMediaUploadPathTelemetryFields/);
  assert.match(webStorageSdkUploads, /waitForMediaUploadTaskTerminal/);
  assert.match(webStorageSdkUploads, /STORAGE_TRANSIENT_STATE_TTL_MS = 60 \* 60 \* 1000/);
  assert.match(webStorageSdkUploads, /scheduleStorageTransientStateCleanup/);
  assert.match(webStorageSdkUploads, /uploadProfilePhoto: uploadWebPhotoViaLegacyService/);
  assert.match(webStorageSdkUploads, /uploadChatPhoto: uploadWebPhotoViaLegacyService/);
  assert.match(webStorageSdkUploads, /uploadVoiceNote: uploadWebVoiceViaLegacyService/);

  assert.doesNotMatch(webOutboxContext, /useFeatureFlag\("media_v2_photo"\)/);
  assert.doesNotMatch(webOutboxContext, /useFeatureFlag\("media_v2_voice"\)/);
  assert.doesNotMatch(webOutboxContext, /mediaV2PhotoEnabled: mediaV2Photo\.enabled/);
  assert.doesNotMatch(webOutboxContext, /mediaV2VoiceEnabled: mediaV2Voice\.enabled/);
  assert.doesNotMatch(webOutboxExecute, /options\.mediaV2PhotoEnabled/);
  assert.match(webOutboxExecute, /uploadImageWithMediaSdk\(\{[\s\S]+file,[\s\S]+accessToken: session\.access_token,[\s\S]+context: "chat"/);
  assert.doesNotMatch(webOutboxExecute, /uploadImageToBunny\(file, session\.access_token, "chat", matchId, clientRequestId\)/);

  assert.match(nativeStorageSdkUploads, /createNativeMediaSdk/);
  assert.doesNotMatch(nativeStorageSdkUploads, /media_v2_photo: true/);
  assert.doesNotMatch(nativeStorageSdkUploads, /media_v2_voice: true/);
  assert.match(nativeStorageSdkUploads, /evaluateClientFeatureFlagForUpload\('media_v2_photo', \{ userId: uploadUserId \}\)/);
  assert.match(nativeStorageSdkUploads, /MEDIA_UPLOAD_PATH_EVENT_NAMES/);
  assert.match(nativeStorageSdkUploads, /createMediaUploadPathTelemetryFields/);
  assert.match(nativeStorageSdkUploads, /waitForMediaUploadTaskTerminal/);
  assert.match(nativeStorageSdkUploads, /STORAGE_TRANSIENT_STATE_TTL_MS = 60 \* 60 \* 1000/);
  assert.match(nativeStorageSdkUploads, /scheduleStorageTransientStateCleanup/);
  assert.match(nativeStorageSdkUploads, /imageManipulator: nativeImageManipulator/);
  assert.match(nativeStorageSdkUploads, /uploadProfilePhoto: uploadNativePhotoViaLegacyService/);
  assert.match(nativeStorageSdkUploads, /uploadChatPhoto: uploadNativePhotoViaLegacyService/);
  assert.match(nativeStorageSdkUploads, /uploadVoiceNote: uploadNativeVoiceViaLegacyService/);

  assert.doesNotMatch(nativeOutboxContext, /useFeatureFlag\('media_v2_photo'\)/);
  assert.doesNotMatch(nativeOutboxContext, /useFeatureFlag\('media_v2_voice'\)/);
  assert.doesNotMatch(nativeOutboxContext, /mediaV2PhotoEnabled: mediaV2Photo\.enabled/);
  assert.doesNotMatch(nativeOutboxContext, /mediaV2VoiceEnabled: mediaV2Voice\.enabled/);
  assert.doesNotMatch(nativeOutboxExecute, /options\.mediaV2PhotoEnabled/);
  assert.match(nativeOutboxExecute, /uploadChatImageWithMediaSdk\(\{[\s\S]+uri: payload\.uri,[\s\S]+mimeType: payload\.mimeType/);
});

test("uploaded orphan cleanup is worker-owned and guarded against late active references", () => {
  const worker = read("supabase/functions/process-media-delete-jobs/index.ts");
  assert.match(phase5ClosureMigration, /CREATE OR REPLACE FUNCTION public\.enqueue_uploaded_media_orphan_deletes/);
  assert.match(phase5BulletproofMigration, /CREATE OR REPLACE FUNCTION public\.enqueue_uploaded_media_orphan_delete_rows/);
  assert.match(phase5BulletproofMigration, /CREATE OR REPLACE FUNCTION public\.preview_media_delete_worker_run/);
  assert.match(phase5BulletproofMigration, /'chat_image', 'voice_message', 'chat_video', 'chat_video_thumbnail', 'profile_photo', 'event_cover'/);
  assert.match(phase5BulletproofMigration, /ON CONFLICT \(media_family\) DO UPDATE[\s\S]+SET worker_enabled = true/);
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
  assert.match(worker, /enqueue_uploaded_media_orphan_delete_rows/);
  assert.match(worker, /preview_media_delete_worker_run/);
  assert.match(worker, /media_uploaded_orphan_delete_enqueued/);
  assert.match(worker, /stats\.uploadedOrphans/);
  assert.match(worker, /\.from\("media_references"\)[\s\S]+\.eq\("asset_id", job\.asset_id\)[\s\S]+\.eq\("is_active", true\)/);
  assert.match(worker, /\.from\("media_assets"\)[\s\S]+\.update\(\{[\s\S]+status: "active"/);
  assert.match(worker, /active_ref_asset_reset_failed/);
  assert.match(worker, /active_ref_job_delete_failed/);
  assert.match(worker, /\.from\("media_delete_jobs"\)[\s\S]+\.delete\(\)[\s\S]+\.eq\("id", job\.id\)/);
  assert.match(worker, /const previewRecord = \(preview \?\? \{\}\) as Record<string, unknown>/);
  assert.match(worker, /preview_count/);
  assert.match(worker, /Dry-run preview failed/);
  assert.doesNotMatch(worker, /DRY_RUN would_delete job=\$\{row\.id\}/);
});

test("phase 5 bulletproof closure exposes owner-scoped receipt reconciliation and coordinated completion RPCs", () => {
  assert.match(phase5BulletproofMigration, /ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0/);
  assert.match(phase5BulletproofMigration, /ADD COLUMN IF NOT EXISTS last_failed_at timestamptz/);
  assert.match(phase5BulletproofMigration, /ADD COLUMN IF NOT EXISTS next_retry_at timestamptz/);
  assert.match(phase5BulletproofMigration, /CREATE OR REPLACE FUNCTION public\.get_media_upload_receipt_status/);
  assert.match(phase5BulletproofMigration, /owner_user_id = v_uid/);
  assert.match(phase5BulletproofMigration, /Compatibility for Phase 5 pre-closure profile SDK queue rows/);
  assert.match(phase5BulletproofMigration, /p_scope_key = 'profile:profile_studio' OR p_scope_key = 'profile:self'/);
  assert.match(phase5BulletproofMigration, /format\('profile:%s:%s', v_uid, split_part\(p_scope_key, ':', 2\)\)/);
  assert.match(phase5BulletproofMigration, /GRANT EXECUTE ON FUNCTION public\.get_media_upload_receipt_status\(text, text, text\)[\s\S]+TO authenticated, service_role/);
  assert.match(phase5BulletproofMigration, /CREATE OR REPLACE FUNCTION public\.complete_storage_media_upload/);
  assert.match(phase5BulletproofMigration, /CREATE OR REPLACE FUNCTION public\.complete_profile_photo_media_upload/);
  assert.match(phase5BulletproofMigration, /FOR UPDATE/);
  assert.match(phase5BulletproofMigration, /provider_mismatch/);
  assert.match(phase5BulletproofMigration, /provider_path_mismatch/);
  assert.match(phase5BulletproofMigration, /public\.upsert_media_asset/);
  assert.match(phase5BulletproofMigration, /public\.draft_media_sessions/);
  assert.ok(
    phase5BulletproofMigration.indexOf("v_asset_result := public.upsert_media_asset") <
      phase5BulletproofMigration.indexOf("FROM public.draft_media_sessions"),
    "profile completion must validate/upsert the asset before writing draft_media_sessions",
  );
  assert.match(phase5BulletproofMigration, /UPDATE public\.media_assets[\s\S]+legacy_table = 'draft_media_sessions'[\s\S]+legacy_id = v_session_id::text/);
  assert.match(phase5BulletproofMigration, /jsonb_build_object\('session_id', v_session_id\)/);
  assert.match(phase5BulletproofMigration, /CREATE OR REPLACE FUNCTION public\.mark_media_upload_receipt_failed/);
  assert.match(phase5BulletproofMigration, /power\(5, LEAST\(v_receipt\.attempt_count, 4\)\)/);
  assert.match(phase5BulletproofMigration, /REVOKE ALL ON FUNCTION public\.complete_storage_media_upload[\s\S]+FROM PUBLIC, anon, authenticated/);
  assert.match(phase5BulletproofMigration, /GRANT EXECUTE ON FUNCTION public\.complete_storage_media_upload[\s\S]+TO service_role/);
});

test("web and native chat image retries pass durable outbox ids to upload-image", () => {
  assert.match(webImageUploadService, /clientRequestId\?: string/);
  assert.match(webImageUploadService, /export function newUploadClientRequestId/);
  assert.match(webImageUploadService, /export function clientRequestIdForUploadFile/);
  assert.match(webImageUploadService, /formData\.append\("client_request_id", stableClientRequestId\)/);
  assert.match(webImageUploadService, /"x-client-request-id": stableClientRequestId/);
  assert.match(webOutboxExecute, /uploadImageWithMediaSdk/);
  assert.doesNotMatch(webOutboxExecute, /uploadImageToBunny\(file, session\.access_token, "chat", matchId, clientRequestId\)/);
  assert.match(webOutboxExecute, /uploadImageWithMediaSdk\(\{[\s\S]+clientRequestId/);

  assert.match(nativeChatMediaUpload, /clientRequestId\?: string/);
  assert.match(nativeChatMediaUpload, /formData\.append\('client_request_id', stableClientRequestId\)/);
  assert.match(nativeChatMediaUpload, /'x-client-request-id': stableClientRequestId/);
  assert.match(nativeOutboxExecute, /uploadChatImageWithMediaSdk/);
  assert.doesNotMatch(nativeOutboxExecute, /uploadChatImageMessage\(payload\.uri, payload\.mimeType, matchId, clientRequestId\)/);
});

test("profile photo retry surfaces keep the same client request id for failed retries", () => {
  assert.doesNotMatch(webOnboardingPhotos, /mediaV2Photo\.enabled/);
  assert.match(webOnboardingPhotos, /uploadImageWithMediaSdk\(\{[\s\S]+file: item\.file,[\s\S]+clientRequestId: item\.id/);
  assert.doesNotMatch(webOnboardingPhotos, /uploadImageToBunny\(item\.file, session\.access_token, "onboarding", undefined, item\.id\)/);
  assert.match(webOnboardingPhotos, /newUploadClientRequestId\(\)/);
  assert.match(webPhotoManageDrawer, /clientRequestId: string/);
  assert.match(webPhotoManageDrawer, /const clientRequestId = newUploadClientRequestId\(\)/);
  assert.match(webPhotoManageDrawer, /failed\.clientRequestId/);
  assert.match(webPhotoManageDrawer, /uploadImageWithMediaSdk/);
  assert.match(webStorageService, /clientRequestIdForUploadFile\(file, `profile-studio:\$\{userId\}:\$\{i\}`\)/);
  assert.doesNotMatch(webStorageService, /mediaV2PhotoEnabled/);
  assert.match(webProfileWizard, /clientRequestIdForUploadFile\(file, `profile-wizard:\$\{userId\}:\$\{i\}`\)/);
  assert.match(webProfileWizard, /clientRequestIdForUploadFile\(file, `profile-wizard:\$\{user\.id\}:\$\{i\}`\)/);
  assert.match(webProfileWizard, /uploadImageWithMediaSdk/);

  assert.match(nativeUploadImage, /clientRequestId\?: string/);
  assert.match(nativeUploadImage, /formData\.append\('client_request_id', stableClientRequestId\)/);
  assert.doesNotMatch(nativePhotoBatchController, /mediaV2Photo\.enabled/);
  assert.match(nativePhotoBatchController, /uploadProfilePhotoWithMediaSdk/);
  assert.match(nativePhotoBatchController, /clientRequestId: draftId/);
  assert.match(nativeGamesApi, /export function newGameClientRequestId/);
  assert.match(nativeGamesApi, /sendScavengerChoice\(vars\.view, vars\.matchId, vars\.receiverPhotoUrl, vars\.clientRequestId\)/);
  assert.doesNotMatch(nativeScavengerStartSheet, /mediaV2Photo\.enabled/);
  assert.match(nativeScavengerStartSheet, /uploadChatImageWithMediaSdk/);
  assert.doesNotMatch(nativeScavengerStartSheet, /uploadChatImageMessage\(asset\.uri, asset\.mimeType \?\? null, matchId, clientRequestId\)/);
  assert.match(nativeScavengerStartSheet, /clientRequestId: senderPhotoClientRequestId \?\? undefined/);
  assert.doesNotMatch(nativeScavengerBubble, /mediaV2Photo\.enabled/);
  assert.match(nativeScavengerBubble, /uploadChatImageWithMediaSdk/);
  assert.doesNotMatch(nativeScavengerBubble, /uploadChatImageMessage\(asset\.uri, asset\.mimeType \?\? null, matchId, clientRequestId\)/);
  assert.match(nativeScavengerBubble, /clientRequestId: selectedPhotoClientRequestId \?\? undefined/);
});
