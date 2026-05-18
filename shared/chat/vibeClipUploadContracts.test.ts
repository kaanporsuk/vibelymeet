import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const copy = read("shared/chat/vibeClipCaptureCopy.ts");
const webRecorder = read("src/components/chat/VideoMessageRecorder.tsx");
const webLibraryHelper = read("src/lib/webVibeClipLibraryUpload.ts");
const webVibeClipOptions = read("src/components/chat/VibeClipSendOptionsSheet.tsx");
const webPhotoOptions = read("src/components/chat/PhotoSendOptionsDialog.tsx");
const webPhotoCamera = read("src/components/chat/PhotoCameraCaptureDialog.tsx");
const webChat = read("src/pages/Chat.tsx");
const webMessagesHook = read("src/hooks/useMessages.ts");
const webOutboxContext = read("src/contexts/WebChatOutboxContext.tsx");
const webOutboxExecute = read("src/lib/webChatOutbox/execute.ts");
const webUploadMime = read("src/lib/webUploadMime.ts");
const webVibeClipBubble = read("src/components/chat/VibeClipBubble.tsx");
const webVideoBubble = read("src/components/chat/VideoMessageBubble.tsx");
const webVideoLightbox = read("src/components/chat/ChatVideoLightbox.tsx");
const webStreamUpload = read("src/services/chatVibeClipStreamUploadService.ts");
const nativeChat = read("apps/mobile/app/chat/[id].tsx");
const nativePhotoOptions = read("apps/mobile/components/chat/PhotoSendOptionsSheet.tsx");
const nativePhotoCamera = read("apps/mobile/components/chat/ChatPhotoCameraModal.tsx");
const nativeVibeClipCard = read("apps/mobile/components/chat/VibeClipCard.tsx");
const nativeUpload = read("apps/mobile/lib/chatMediaUpload.ts");
const nativeOutboxExecute = read("apps/mobile/lib/chatOutbox/execute.ts");
const nativeStreamUpload = read("apps/mobile/lib/chatVibeClipStreamUpload.ts");
const nativeMediaCache = read("apps/mobile/lib/chatOutbox/mediaCache.ts");
const nativeOutboxContext = read("apps/mobile/lib/chatOutbox/ChatOutboxContext.tsx");
const uploadChatVideo = read("supabase/functions/upload-chat-video/index.ts");
const sendMessage = read("supabase/functions/send-message/index.ts");
const createChatVibeClipUpload = read("supabase/functions/create-chat-vibe-clip-upload/index.ts");
const completeChatVibeClipUpload = read("supabase/functions/complete-chat-vibe-clip-upload/index.ts");
const syncChatVibeClipStatus = read("supabase/functions/sync-chat-vibe-clip-status/index.ts");
const chatVibeClipShared = read("supabase/functions/_shared/chat-vibe-clips.ts");
const getChatMediaUrl = read("supabase/functions/get-chat-media-url/index.ts");
const videoWebhook = read("supabase/functions/video-webhook/index.ts");
const chatThreadPage = read("supabase/functions/chat-thread-page/index.ts");
const chatVibeClipMigration = read("supabase/migrations/20260518120000_chat_vibe_clip_bunny_stream.sql");

test("shared Vibe Clip upload limits stay aligned across clients", () => {
  assert.match(copy, /export const VIBE_CLIP_MAX_DURATION_SEC = 30/);
  assert.match(copy, /export const VIBE_CLIP_MAX_SOURCE_BYTES = 200 \* 1024 \* 1024/);
  assert.match(copy, /export const VIBE_CLIP_MAX_SOURCE_MB = 200/);
  assert.match(copy, /export const VIBE_CLIP_SOFT_SOURCE_BYTES = 75 \* 1024 \* 1024/);
  assert.match(copy, /VIBE_CLIP_UPLOAD_TOO_LONG/);
  assert.match(copy, /VIBE_CLIP_UPLOAD_TOO_LARGE/);
  assert.match(copy, /VIBE_CLIP_WEB_TOAST_CAMERA_SWITCH_UNAVAILABLE/);
});

test("web recorder supports saved-video upload with the same constraints", () => {
  assert.match(webRecorder, /type="file"[\s\S]{0,120}accept="video\/\*"/);
  assert.match(webRecorder, /startCamera\(facingMode, \{ cancelOnError: false \}\)/);
  assert.match(webRecorder, /disabled=\{!isRecording && \(!cameraReady \|\| isProcessingUpload\)\}/);
  assert.match(webRecorder, /prepareWebVibeClipLibraryFile/);
  assert.match(webRecorder, /const prepared = await prepareWebVibeClipLibraryFile\(file\)/);
  assert.match(webRecorder, /durationBucketFromSeconds\(prepared\.durationSeconds\)/);
  assert.match(webRecorder, /onRecordingComplete\(prepared\.file, prepared\.durationSeconds, prepared\.meta\)/);
  assert.match(webRecorder, /showLibraryUpload = true/);
});

test("web library helper validates saved-video uploads with the same constraints", () => {
  assert.match(webLibraryHelper, /export function looksLikeVideoFile/);
  assert.match(webLibraryHelper, /normalized !== null && normalized !== GENERIC_UPLOAD_MIME_TYPE/);
  assert.match(webLibraryHelper, /export function readSelectedVideoMetadata/);
  assert.match(webLibraryHelper, /video\.onloadedmetadata = null/);
  assert.match(webLibraryHelper, /URL\.revokeObjectURL\(objectUrl\)/);
  assert.match(webLibraryHelper, /file\.size <= 0/);
  assert.match(webLibraryHelper, /file\.size > VIBE_CLIP_MAX_SOURCE_BYTES/);
  assert.match(webLibraryHelper, /metadata\.durationSeconds > VIBE_CLIP_MAX_DURATION_SEC \+ 0\.25/);
  assert.match(webLibraryHelper, /captureSource: "library"/);
  assert.match(webLibraryHelper, /videoMimeTypeForUpload\(file\.type, file\.name\) \?\? undefined/);
  assert.match(webLibraryHelper, /fileName: file\.name \|\| undefined/);
  assert.match(webLibraryHelper, /aspectRatio: metadata\.aspectRatio/);
});

test("web chat routes media buttons through polished pickers without changing send paths", () => {
  assert.match(webChat, /VibeClipSendOptionsSheet = lazy/);
  assert.match(webChat, /PhotoSendOptionsDialog = lazy/);
  assert.match(webChat, /PhotoCameraCaptureDialog = lazy/);
  assert.match(webChat, /const \[showPhotoOptions, setShowPhotoOptions\] = useState\(false\)/);
  assert.match(webChat, /const \[showPhotoCamera, setShowPhotoCamera\] = useState\(false\)/);
  assert.match(webChat, /const \[showVibeClipOptions, setShowVibeClipOptions\] = useState\(false\)/);
  assert.match(webChat, /setShowPhotoOptions\(true\)/);
  assert.match(webChat, /setShowPhotoCamera\(true\)/);
  assert.match(webChat, /setShowVibeClipOptions\(true\)/);
  assert.doesNotMatch(webChat, /photoCameraInputRef/);
  assert.doesNotMatch(webChat, /capture="environment"/);
  assert.match(webChat, /onTakePhoto=\{openPhotoCamera\}/);
  assert.match(webChat, /onChooseLibrary=\{triggerPhotoFilePicker\}/);
  assert.match(webChat, /onCapturePhoto=\{queuePhotoFile\}/);
  assert.match(webChat, /onLibraryClipReady=\{handleVibeClipLibraryReady\}/);
  assert.match(webChat, /showLibraryUpload=\{false\}/);
});

test("web Vibe Clip options sheet owns library validation and preserves recorder path", () => {
  assert.match(webVibeClipOptions, /type="file"[\s\S]{0,120}accept="video\/\*"/);
  assert.match(webVibeClipOptions, /prepareWebVibeClipLibraryFile/);
  assert.match(webVibeClipOptions, /const prepared = await prepareWebVibeClipLibraryFile\(file\)/);
  assert.match(webVibeClipOptions, /trackVibeClipEvent\("clip_record_started"/);
  assert.match(webVibeClipOptions, /trackVibeClipEvent\("clip_record_completed"/);
  assert.match(webVibeClipOptions, /durationBucketFromSeconds\(prepared\.durationSeconds\)/);
  assert.match(webVibeClipOptions, /await onLibraryClipReady\(prepared\.file, prepared\.durationSeconds, prepared\.meta\)/);
  assert.match(webVibeClipOptions, /onRecord\(\)/);
  assert.match(webVibeClipOptions, /VIBE_CLIP_SHEET_TITLE/);
  assert.match(webVibeClipOptions, /VIBE_CLIP_LIBRARY_HINT/);
});

test("web photo options dialog keeps action routing in the caller", () => {
  assert.match(webPhotoOptions, /Send a photo/);
  assert.match(webPhotoOptions, /Choose how you'd like to add your picture\./);
  assert.match(webPhotoOptions, /onTakePhoto\(\)/);
  assert.match(webPhotoOptions, /onChooseLibrary\(\)/);
  assert.doesNotMatch(webPhotoOptions, /capture=/);
});

test("web take-photo path opens in-app camera capture instead of upload picker", () => {
  assert.match(webPhotoCamera, /SwitchCamera/);
  assert.match(webPhotoCamera, /type PhotoCameraFacingMode = "user" \| "environment"/);
  assert.match(webPhotoCamera, /const \[facingMode, setFacingMode\] = useState<PhotoCameraFacingMode>\("environment"\)/);
  assert.match(webPhotoCamera, /navigator\.mediaDevices\.enumerateDevices/);
  assert.match(webPhotoCamera, /setHasMultipleCameras\(devices\.filter\(\(device\) => device\.kind === "videoinput"\)\.length > 1\)/);
  assert.match(webPhotoCamera, /navigator\.mediaDevices\?\.getUserMedia/);
  assert.match(webPhotoCamera, /startCamera\("environment"\)/);
  assert.match(webPhotoCamera, /exactFacingMode\?: boolean/);
  assert.match(webPhotoCamera, /facingMode:\s*opts\?\.exactFacingMode \? \{ exact: facingMode \} : \{ ideal: facingMode \}/);
  assert.match(webPhotoCamera, /function shouldRetryWithGenericCamera/);
  assert.match(webPhotoCamera, /name !== "NotAllowedError" && name !== "SecurityError"/);
  assert.match(webPhotoCamera, /function facingModeFromStream\(stream: MediaStream, fallback: PhotoCameraFacingMode\)/);
  assert.match(webPhotoCamera, /stream\.getVideoTracks\(\)\[0\]\?\.getSettings\?\.\(\)\.facingMode/);
  assert.match(webPhotoCamera, /setFacingMode\(facingModeFromStream\(stream, nextFacingMode\)\)/);
  assert.match(webPhotoCamera, /getUserMedia\(\{\s*audio: false,\s*video: true/);
  assert.match(webPhotoCamera, /preserveExistingStream/);
  assert.match(webPhotoCamera, /previousStream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(webPhotoCamera, /const nextFacingMode = facingMode === "user" \? "environment" : "user"/);
  assert.match(webPhotoCamera, /exactFacingMode: !!opts\?\.preserveExistingStream/);
  assert.match(webPhotoCamera, /startCamera\(nextFacingMode, \{ preserveExistingStream: true, silentError: true \}\)/);
  assert.match(webPhotoCamera, /streamRef\.current\?\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(webPhotoCamera, /canvas\.toBlob/);
  assert.match(webPhotoCamera, /function dataUrlToBlob/);
  assert.match(webPhotoCamera, /canvas\.toDataURL\(CAPTURE_FILE_TYPE, CAPTURE_QUALITY\)/);
  assert.match(webPhotoCamera, /context\.scale\(-1, 1\)/);
  assert.match(webPhotoCamera, /facingMode === "user" && "scale-x-\[-1\]"/);
  assert.match(webPhotoCamera, /new File\(\[blob\], `chat-photo-\$\{Date\.now\(\)\}\.jpg`, \{ type: CAPTURE_FILE_TYPE \}\)/);
  assert.match(webPhotoCamera, /const CAPTURE_FILE_TYPE = "image\/jpeg"/);
  assert.match(webPhotoCamera, /const CAPTURE_QUALITY = 0\.85/);
  assert.match(webPhotoCamera, /const captureLockRef = useRef\(false\)/);
  assert.match(webPhotoCamera, /const submitLockRef = useRef\(false\)/);
  assert.match(webPhotoCamera, /submitLockRef\.current/);
  assert.match(
    webPhotoCamera,
    /const sent = await onCapturePhoto\(capturedFile\);[\s\S]{0,240}if \(sent\) \{[\s\S]{0,160}onOpenChange\(false\);[\s\S]{0,160}return;[\s\S]{0,240}setErrorMessage\("Could not send the photo\. Please try again\."\)/,
  );
});

test("native chat photo flow uses a dedicated sheet and in-app switchable camera", () => {
  assert.match(nativeChat, /PhotoSendOptionsSheet/);
  assert.match(nativeChat, /ChatPhotoCameraModal/);
  assert.match(nativeChat, /const \[showPhotoOptionsSheet, setShowPhotoOptionsSheet\] = useState\(false\)/);
  assert.match(nativeChat, /const \[showPhotoCameraModal, setShowPhotoCameraModal\] = useState\(false\)/);
  assert.match(nativeChat, /const uploadPhotoUriAndSend = async \(uri: string, mimeType\?: string \| null\): Promise<boolean>/);
  assert.match(nativeChat, /setShowPhotoOptionsSheet\(true\)/);
  assert.match(nativeChat, /runAfterPhotoSheetDismiss/);
  assert.match(nativeChat, /useCameraPermissions/);
  assert.match(nativeChat, /const \[, requestPhotoCameraPermission\] = useCameraPermissions\(\)/);
  assert.match(nativeChat, /const openPhotoCameraModal = async \(\) => \{[\s\S]+requestPhotoCameraPermission\(\)[\s\S]+setShowPhotoCameraModal\(true\)/);
  assert.doesNotMatch(nativeChat, /const openPhotoCameraModal = async \(\) => \{[\s\S]{0,700}ImagePicker\.requestCameraPermissionsAsync/);
  assert.match(nativeChat, /setShowPhotoCameraModal\(true\)/);
  assert.match(nativeChat, /onSendPhoto=\{uploadPhotoUriAndSend\}/);
  assert.doesNotMatch(nativeChat, /title:\s*'Send a photo'/);
  assert.doesNotMatch(nativeChat, /primaryAction:\s*\{\s*label:\s*'Take photo'/);
  assert.doesNotMatch(nativeChat, /launchCameraAsync\(\{\s*quality:\s*0\.85\s*\}\)/);

  assert.match(nativePhotoOptions, /KeyboardAwareBottomSheetModal/);
  assert.match(nativePhotoOptions, /Take Photo/);
  assert.match(nativePhotoOptions, /Choose from library/);
  assert.match(nativePhotoOptions, /onTakePhoto\(\)/);
  assert.match(nativePhotoOptions, /onChooseLibrary\(\)/);

  assert.match(nativePhotoCamera, /CameraView/);
  assert.match(nativePhotoCamera, /type CameraType/);
  assert.match(nativePhotoCamera, /const \[facing, setFacing\] = useState<CameraType>\('back'\)/);
  assert.match(nativePhotoCamera, /const cameraSessionIdRef = useRef\(0\)/);
  assert.match(nativePhotoCamera, /const \[cameraSessionId, setCameraSessionId\] = useState\(0\)/);
  assert.match(nativePhotoCamera, /const cameraViewKey = `\$\{facing\}:\$\{cameraSessionId\}`/);
  assert.match(nativePhotoCamera, /activeCameraKeyRef\.current = nextCameraKey/);
  assert.match(nativePhotoCamera, /setCameraSessionId\(nextSessionId\)/);
  assert.match(nativePhotoCamera, /activeCameraKeyRef\.current !== readyCameraKey/);
  assert.match(nativePhotoCamera, /activeCameraKeyRef\.current !== failedCameraKey/);
  assert.match(nativePhotoCamera, /key=\{cameraViewKey\}/);
  assert.match(nativePhotoCamera, /onCameraReady=\{\(\) => handleCameraReady\(cameraViewKey\)\}/);
  assert.doesNotMatch(nativePhotoCamera, /CAMERA_READY_FALLBACK_MS|setTimeout/);
  assert.match(nativePhotoCamera, /takePictureAsync\(\{/);
  assert.match(nativePhotoCamera, /quality: 0\.85/);
  assert.match(nativePhotoCamera, /const nextFacing = facingRef\.current === 'front' \? 'back' : 'front'/);
  assert.match(nativePhotoCamera, /prepareCameraForFacing\(nextFacing\)/);
  assert.match(nativePhotoCamera, /name="camera-reverse-outline"/);
  assert.match(nativePhotoCamera, /accessibilityLabel="Switch camera"/);
  assert.match(nativePhotoCamera, /onSendPhoto\(capturedUri, CAPTURE_MIME_TYPE\)/);
});

test("web recorder exposes safe camera flip on eligible devices", () => {
  assert.match(webRecorder, /navigator\.mediaDevices\.enumerateDevices/);
  assert.match(webRecorder, /setHasMultipleCameras\(videoInputs\.length > 1\)/);
  assert.match(webRecorder, /<SwitchCamera/);
  assert.match(webRecorder, /hasMultipleCameras && !isRecording/);
  assert.match(webRecorder, /startCamera\(newFacing, \{ cancelOnError: false, silentError: true \}\)/);
  assert.match(webRecorder, /VIBE_CLIP_WEB_TOAST_CAMERA_SWITCH_UNAVAILABLE/);
  assert.match(
    webRecorder,
    /const previousStream = streamRef\.current[\s\S]+getUserMedia[\s\S]+previousStream\?\.getTracks\(\)\.forEach/,
  );
});

test("web queue and upload preserve validated library video metadata", () => {
  assert.match(webChat, /Math\.min\(\s*VIBE_CLIP_MAX_DURATION_SEC/);
  assert.match(webChat, /measuredDurationSeconds > VIBE_CLIP_MAX_DURATION_SEC \+ 0\.25/);
  assert.match(webChat, /toast\.error\(VIBE_CLIP_UPLOAD_TOO_LONG\(\)\)/);
  assert.match(webChat, /const captureSource = meta\?\.captureSource \?\? "web_recorder"/);
  assert.match(webChat, /const videoMimeType =[\s\S]{0,160}videoMimeTypeForUpload\(meta\?\.mimeType \|\| videoBlob\.type, storedVideoName\) \?\? GENERIC_UPLOAD_MIME_TYPE/);
  assert.match(webChat, /mimeType: videoMimeType/);
  assert.match(webChat, /fileName: storedVideoName/);
  assert.doesNotMatch(webChat, /videoBlob\.type \|\| "video\/mp4"/);
  assert.match(webChat, /aspectRatio: meta\?\.aspectRatio \?\? null/);
  assert.match(webChat, /videoBlob\.size > VIBE_CLIP_MAX_SOURCE_BYTES/);
  assert.match(webChat, /videoBlob\.size > VIBE_CLIP_SOFT_SOURCE_BYTES/);
  assert.match(webChat, /videoMimeType === GENERIC_UPLOAD_MIME_TYPE/);
  assert.match(webChat, /VIBE_CLIP_UPLOAD_INVALID_TYPE/);
  assert.match(webOutboxExecute, /videoMimeTypeForUpload\(blob\.type, storedName\)/);
  assert.match(webOutboxExecute, /videoMimeTypeForUpload\(payload\.mimeType, storedName\)/);
  assert.match(webOutboxExecute, /uploadFileNameForMimeType\("video", "chat-vibe-clip", mimeType, storedName\)/);
  assert.match(webOutboxExecute, /uploadAndPublishChatVibeClipToBunnyStream/);
  assert.match(webOutboxExecute, /completePublishedChatVibeClipUpload/);
  assert.match(webOutboxExecute, /ChatVibeClipUploadedButUnpublishedError/);
  assert.match(webOutboxExecute, /isBunnyStreamPlaybackRef\(item\.uploadedMediaUrl\)/);
  assert.doesNotMatch(webOutboxExecute, /invokePublishVibeClip/);
  assert.doesNotMatch(webMessagesHook, /usePublishVibeClip/);
  assert.doesNotMatch(webMessagesHook, /publish-vibe-clip/);
  assert.match(webStreamUpload, /new tus\.Upload\(params\.file/);
  assert.match(webStreamUpload, /chunkSize: TUS_CHUNK_SIZE/);
  assert.match(webStreamUpload, /upload\.findPreviousUploads\(\)/);
  assert.match(webStreamUpload, /class ChatVibeClipUploadedButUnpublishedError/);
  assert.match(webStreamUpload, /completePublishedChatVibeClipUpload/);
  assert.match(webStreamUpload, /providerObjectIdFromPlaybackRef/);
  assert.match(webStreamUpload, /created\.status === "failed"/);
  assert.match(webStreamUpload, /!created\.status \|\| created\.status === "uploading"/);
  assert.match(webStreamUpload, /create-chat-vibe-clip-upload/);
  assert.match(webStreamUpload, /complete-chat-vibe-clip-upload/);
  assert.match(webStreamUpload, /params\.file\.size > VIBE_CLIP_MAX_SOURCE_BYTES/);
  assert.doesNotMatch(webStreamUpload, /params\.file\.type \|\| "video\/mp4"/);
  assert.doesNotMatch(webStreamUpload, /created\.mime_type \|\| params\.file\.type \|\| "video\/mp4"/);
  assert.equal(existsSync(join(root, "src/services/chatVideoUploadService.ts")), false);
  assert.match(webUploadMime, /"video\/mov": "video\/quicktime"/);
  assert.match(webUploadMime, /"video\/m4v": "video\/x-m4v"/);
});

test("web chat image outbox no longer invents JPEG declarations", () => {
  assert.match(webChat, /const imageMimeType = imageMimeTypeForUpload\(file\.type, file\.name\)/);
  assert.match(webChat, /payload: \{ kind: "image", blobKey, mimeType: imageMimeType, fileName: file\.name \|\| undefined \}/);
  assert.doesNotMatch(webChat, /file\.type \|\| "image\/jpeg"/);
  assert.match(webOutboxExecute, /imageMimeTypeForUpload\(blob\.type, storedName\)/);
  assert.match(webOutboxExecute, /imageMimeTypeForUpload\(payload\.mimeType, storedName\)/);
  assert.match(webOutboxExecute, /uploadFileNameForMimeType\("image", "chat", mimeType, storedName\)/);
  assert.doesNotMatch(webOutboxExecute, /"chat\.jpg", \{ type: payload\.mimeType \|\| blob\.type \|\| "image\/jpeg" \}/);
});

test("video bubbles remain adaptive and full-width across web and native chat", () => {
  assert.match(webVibeClipBubble, /w-\[min\(17\.5rem,calc\(100vw-4rem\)\)\] max-w-full/);
  assert.match(webVibeClipBubble, /Math\.max\(0\.5, Math\.min\(1\.2, displayMeta\.aspectRatio\)\)/);
  assert.match(webVibeClipBubble, /<AspectRatio ratio=\{clipAspectRatio\}>/);
  assert.match(webVibeClipBubble, /w-full h-full object-cover bg-black/);
  assert.match(webVibeClipBubble, /syncChatVibeClipStatus/);
  assert.match(webVibeClipBubble, /isAwaitingPlaybackIntent/);
  assert.match(webVibeClipBubble, /const isLocalPreview = isLocalPreviewUrl\(displayMeta\.videoUrl\)/);
  assert.match(webVibeClipBubble, /!isAwaitingPlaybackIntent && !isLocalPreview/);
  assert.match(webVibeClipBubble, /isReady \|\| isLocalPreview \? "opacity-100" : "opacity-0"/);
  assert.match(webVibeClipBubble, /role=\{isSurfaceInteractive \? "button" : undefined\}/);
  assert.match(webVibeClipBubble, /type VibeClipMediaRefreshReason = "preview" \| "playback"/);
  assert.match(webVibeClipBubble, /if \(reason === "preview"\) return !!freshThumbnailUrl/);
  assert.match(webVibeClipBubble, /shouldResolvePosterPreview/);
  assert.match(webVibeClipBubble, /posterRefreshAttemptedForRef/);
  assert.match(webVibeClipBubble, /CLIP_PLAYBACK_LOAD_TIMEOUT_MS/);
  assert.match(webVibeClipBubble, /refreshAttemptedForUrlRef\.current = null;[\s\S]{0,160}setLoadError\(false\)/);
  assert.match(webVibeClipBubble, /aria-label=\{isMuted \? "Unmute clip" : "Mute clip"\}/);
  assert.match(webVibeClipBubble, /aria-label="Open clip full screen"/);
  assert.match(webOutboxContext, /function recoverInterruptedSendingItems/);
  assert.match(webOutboxContext, /activeProcessingIds: processingRef\.current/);
  assert.match(webOutboxContext, /force: true/);

  assert.match(webVideoBubble, /w-\[min\(17\.5rem,calc\(100vw-4rem\)\)\] max-w-full/);
  assert.match(webVideoBubble, /<AspectRatio ratio=\{9 \/ 16\}>/);
  assert.match(webVideoBubble, /w-full h-full object-cover bg-black/);
  assert.match(webVideoBubble, /aria-label=\{isMuted \? "Unmute video" : "Mute video"\}/);
  assert.match(webVideoBubble, /aria-label="Open video full screen"/);
  assert.match(webVideoLightbox, /void refreshMedia\(\)\.then\(\(didRefresh\) => \{[\s\S]{0,120}if \(!didRefresh\) setPhase\("error"\)/);
  assert.match(webVideoLightbox, /setPhase\("error"\);[\s\S]{0,80}return;/);
  assert.match(webVideoLightbox, /CLIP_PLAYBACK_LOAD_TIMEOUT_MS/);
  assert.match(webVideoLightbox, /phase !== "loading" \|\| !canMountPlayer/);

  assert.match(nativeChat, /const MEDIA_CARD_MIN_WIDTH = 150/);
  assert.match(nativeChat, /const MEDIA_CARD_MAX_WIDTH = 280/);
  assert.match(nativeChat, /function getAdaptiveChatMediaWidth/);
  assert.match(nativeChat, /windowWidth - layout\.containerPadding \* 2 - 92/);
  assert.match(nativeChat, /Math\.min\(MEDIA_CARD_MAX_WIDTH, Math\.floor\(availableThreadWidth \* 0\.92\)\)/);
  assert.match(nativeChat, /styles\.mediaContentWrap, \{ width: mediaCardWidth \}/);

  assert.match(nativeVibeClipCard, /width: '100%'/);
  assert.match(nativeVibeClipCard, /const INLINE_CLIP_MIN_ASPECT_RATIO = 0\.78/);
  assert.match(nativeVibeClipCard, /Math\.max\(INLINE_CLIP_MIN_ASPECT_RATIO, Math\.min\(INLINE_CLIP_MAX_ASPECT_RATIO, meta\.aspectRatio\)\)/);
  assert.match(nativeVibeClipCard, /style=\{\[styles\.videoWrap, \{ aspectRatio: cardAspectRatio, maxHeight: INLINE_CLIP_MAX_HEIGHT \}\]\}/);
  assert.match(nativeVibeClipCard, /contentFit="cover"/);
  assert.match(nativeVibeClipCard, /shouldMountPlayer/);
  assert.match(nativeVibeClipCard, /type ClipPreviewState/);
  assert.match(nativeVibeClipCard, /syncChatVibeClipStatus/);
  assert.match(nativeVibeClipCard, /Clip unavailable/);
  assert.doesNotMatch(nativeVibeClipCard, /Tap to play/);
  assert.doesNotMatch(nativeVibeClipCard, /Loading clip/);
  assert.match(nativeVibeClipCard, /const \[hasPlayed, setHasPlayed\] = useState\(false\)/);
  assert.match(nativeVibeClipCard, /if \(ev\.isPlaying\) setHasPlayed\(true\)/);
  assert.doesNotMatch(nativeVibeClipCard, /setPlayRequested\(true\);\s*setHasPlayed\(true\)/);
  assert.doesNotMatch(nativeVibeClipCard, /const showPreviewLoader/);
  assert.match(nativeVibeClipCard, /posterPreviewState\?: VibeClipPosterPreviewState/);
  assert.match(
    nativeVibeClipCard,
    /onPosterPreviewStateChange\?: \(state: VibeClipPosterPreviewState, thumbnailUrl\?: string \| null\) => void/,
  );
  assert.match(nativeVibeClipCard, /onLoad=\{\(\) => onPreviewStateChange\?\.\('ready', uri\)\}/);
  assert.match(nativeVibeClipCard, /onPreviewStateChange\?\.\('failed', uri\)/);
  assert.match(nativeVibeClipCard, /onRefreshClipMedia\('preview'\)/);
  assert.match(nativeVibeClipCard, /onRefreshClipMedia\('playback'\)/);
  assert.match(nativeVibeClipCard, /if \(reason === 'preview'\) return !!freshThumbnailUri/);
  assert.match(nativeVibeClipCard, /freshThumbnailUri !== playableThumbnailUrl/);
  assert.match(nativeVibeClipCard, /posterRefreshAttemptedForRef/);
  assert.match(nativeVibeClipCard, /isResolvableMediaRef\(playableThumbnailUrl\)/);
  assert.match(nativeVibeClipCard, /CLIP_PLAYBACK_LOAD_TIMEOUT_MS/);
  assert.match(nativeVibeClipCard, /onResetPlaybackRefreshAttempt/);
  assert.match(nativeVibeClipCard, /setHasError\(false\)/);
  assert.match(nativeVibeClipCard, /setInlinePlayRequestToken\(\(token\) => token \+ 1\)/);
  assert.match(nativeChat, /function vibeClipPosterCacheKey/);
  assert.match(nativeChat, /vibeClipPosterPreviewByKey/);
  assert.match(nativeChat, /posterPreviewState=\{posterPreviewState\}/);
  assert.match(nativeChat, /onPosterPreviewStateChange=\{\(state, thumbnailUrl\) =>/);
  assert.match(nativeChat, /const shouldMountPlayer = videoViewer\?\.uri === displayClipMeta\.videoUrl/);
  assert.doesNotMatch(nativeChat, /visibleRowKeys\.has\(rowKey\)/);
  assert.match(nativeOutboxContext, /function recoverInterruptedSendingItems/);
  assert.match(nativeOutboxContext, /force: true/);
  assert.match(nativeOutboxContext, /activeProcessingIds: processingRef\.current/);
});

test("native chat validates library and camera video before enqueue", () => {
  assert.match(nativeChat, /function imagePickerDurationSeconds/);
  assert.match(nativeChat, /return durationMs \/ 1000/);
  assert.match(nativeChat, /shouldDownloadFromNetwork: true/);
  assert.match(nativeChat, /videoMaxDuration: VIBE_CLIP_MAX_DURATION_SEC/);
  assert.match(nativeChat, /durationSec == null[\s\S]{0,80}VIBE_CLIP_UPLOAD_DURATION_UNREADABLE/);
  assert.match(nativeChat, /durationSec > VIBE_CLIP_MAX_DURATION_SEC \+ 0\.25/);
  assert.match(nativeChat, /sizeBytes === 0[\s\S]{0,120}cleanupOutboxCacheUri/);
  assert.match(nativeChat, /sizeBytes > VIBE_CLIP_MAX_SOURCE_BYTES/);
  assert.match(nativeChat, /VIBE_CLIP_UPLOAD_LARGE_SOFT_WARNING/);
  assert.match(nativeChat, /cameraType: ImagePicker\.CameraType\.front/);
  assert.match(nativeChat, /aspectRatioForVideoAsset\(asset\)/);
});

test("native upload and cache keep mobile video formats intact", () => {
  assert.doesNotMatch(nativeUpload, /uploadChatVideoMessage/);
  assert.doesNotMatch(nativeUpload, /upload-chat-video/);
  assert.equal(existsSync(join(root, "apps/mobile/lib/chatVibeClipThumbnail.ts")), false);
  assert.match(nativeOutboxExecute, /completePublishedChatVibeClipUpload/);
  assert.match(nativeOutboxExecute, /ChatVibeClipUploadedButUnpublishedError/);
  assert.match(nativeOutboxExecute, /isBunnyStreamPlaybackRef\(item\.uploadedMediaUrl\)/);
  assert.match(nativeStreamUpload, /new tus\.Upload\(rnFileSource as unknown as File/);
  assert.match(nativeStreamUpload, /uploadSize: params\.fileSize/);
  assert.match(nativeStreamUpload, /upload\.findPreviousUploads\(\)/);
  assert.match(nativeStreamUpload, /getFreshCachedAccessToken/);
  assert.match(nativeStreamUpload, /headers: \{ Authorization: `Bearer \$\{params\.accessToken\}` \}/);
  assert.match(nativeStreamUpload, /class ChatVibeClipUploadedButUnpublishedError/);
  assert.match(nativeStreamUpload, /completePublishedChatVibeClipUpload/);
  assert.match(nativeStreamUpload, /providerObjectIdFromPlaybackRef/);
  assert.match(nativeStreamUpload, /const originalExt = extensionFromUri\(params\.uri\) \|\| null/);
  assert.match(nativeStreamUpload, /stableUploadFileUri\(params\.uri, params\.clientRequestId, originalExt\)/);
  assert.match(nativeStreamUpload, /mimeFromExtension\(originalExt \?\? '', params\.mimeType\)/);
  assert.match(nativeStreamUpload, /const completionToken = await getFreshCachedAccessToken\(\)/);
  assert.doesNotMatch(nativeStreamUpload, /extensionFromUri\(stable\.uri\) \|\| 'mp4'/);
  assert.match(nativeStreamUpload, /created\.status === 'failed'/);
  assert.match(nativeStreamUpload, /!created\.status \|\| created\.status === 'uploading'/);
  assert.match(nativeStreamUpload, /if \(!mimeType\) throw new Error\(VIBE_CLIP_UPLOAD_INVALID_TYPE\)/);
  assert.match(nativeStreamUpload, /return null/);
  assert.match(nativeStreamUpload, /create-chat-vibe-clip-upload/);
  assert.match(nativeStreamUpload, /complete-chat-vibe-clip-upload/);
  assert.match(nativeStreamUpload, /info\.size > VIBE_CLIP_MAX_SOURCE_BYTES/);
  assert.match(nativeUpload, /const GENERIC_UPLOAD_MIME_TYPE = 'application\/octet-stream'/);
  assert.match(nativeStreamUpload, /mimeType === 'video\/quicktime'[\s\S]{0,120}return 'mov'/);
  assert.match(nativeStreamUpload, /mimeType === 'video\/x-m4v'[\s\S]{0,120}return 'm4v'/);
  assert.match(nativeStreamUpload, /mimeType === 'video\/webm'[\s\S]{0,120}return 'webm'/);
  assert.match(nativeChat, /mimeForPayload\('video', asset\.mimeType \?\? null, asset\.fileName \?\? asset\.uri\)/);
  assert.doesNotMatch(nativeChat, /asset\.mimeType \?\? 'video\/mp4'/);
  assert.match(nativeMediaCache, /mimeForPayload\('video'/);
  assert.match(nativeMediaCache, /normalized\?\.includes\('x-m4v'\)[\s\S]{0,120}return 'm4v'/);
  assert.match(nativeMediaCache, /normalized\?\.includes\('webm'\)[\s\S]{0,120}return 'webm'/);
  assert.match(nativeMediaCache, /\['mov', 'm4v', 'webm', 'mp4', 'mkv', 'avi', 'wmv', 'flv', 'ts', 'mpeg', 'mpg'\]\.includes/);
  assert.match(nativeMediaCache, /if \(ext === 'jpg' \|\| ext === 'jpeg'\) return 'jpg';[\s\S]{0,80}return 'bin'/);
  assert.doesNotMatch(nativeMediaCache, /return 'mp4';\n\s*\}/);
});

test("server upload and publish paths enforce Bunny Stream Vibe Clip limits", () => {
  assert.match(uploadChatVideo, /const CHAT_VIDEO_MAX_UPLOAD_BYTES = 8 \* 1024 \* 1024/);
  assert.match(uploadChatVideo, /Supabase Edge Function ~10MB request-body cap/);
  assert.match(uploadChatVideo, /Maximum 8MB/);
  assert.match(chatVibeClipShared, /BUNNY_CHAT_STREAM_LIBRARY_ID/);
  assert.match(chatVibeClipShared, /\[89ab\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}/);
  assert.match(createChatVibeClipUpload, /createTusSignature/);
  assert.match(createChatVibeClipUpload, /registerMediaAsset/);
  assert.match(createChatVibeClipUpload, /\.from\("chat_vibe_clip_uploads"\)/);
  assert.match(createChatVibeClipUpload, /existing\.data\.match_id !== matchId/);
  assert.match(createChatVibeClipUpload, /client_request_id_conflict/);
  assert.match(completeChatVibeClipUpload, /ensureChatVibeClipMessage/);
  assert.match(completeChatVibeClipUpload, /data\.client_request_id !== clientRequestId/);
  assert.match(completeChatVibeClipUpload, /client_request_id_conflict/);
  assert.match(syncChatVibeClipStatus, /sync-chat-vibe-clip-status/);
  assert.match(chatVibeClipShared, /CHAT_VIBE_CLIP_MAX_DURATION_MS = 30_000/);
  assert.match(chatVibeClipShared, /CHAT_VIBE_CLIP_DURATION_TOLERANCE_MS = 250/);
  assert.match(chatVibeClipShared, /CHAT_VIBE_CLIP_MAX_SOURCE_BYTES = 200 \* 1024 \* 1024/);
  assert.match(chatVibeClipShared, /mapBunnyStatusToChatClipStatus/);
  assert.match(chatVibeClipShared, /provider: "bunny_stream"/);
  assert.match(chatVibeClipShared, /options: \{ publishIfProcessing\?: boolean \} = \{\}/);
  assert.match(chatVibeClipShared, /!options\.publishIfProcessing/);
  assert.match(chatVibeClipShared, /function isTerminalChatVibeClipStatus/);
  assert.match(
    chatVibeClipShared,
    /isTerminalChatVibeClipStatus\(upload\.status\) && !isTerminalChatVibeClipStatus\(status\)/,
  );
  assert.match(getChatMediaUrl, /BUNNY_CHAT_STREAM_CDN_HOSTNAME/);
  assert.match(getChatMediaUrl, /BUNNY_CHAT_STREAM_TOKEN_SECURITY_KEY/);
  assert.doesNotMatch(getChatMediaUrl, /async function hmacSha256Base64Url/);
  assert.match(getChatMediaUrl, /const signingData = sortedSigningData\(\{ token_path: tokenPath \}\)/);
  assert.match(getChatMediaUrl, /const token = `HS256-\$\{await signPayload/);
  assert.match(getChatMediaUrl, /`\$\{tokenPath\}\$\{params\.expires\}\$\{signingData\}`/);
  assert.match(getChatMediaUrl, /bcdn_token=\$\{token\}&expires=\$\{params\.expires\}&token_path=\$\{encodeURIComponent\(tokenPath\)\}/);
  assert.match(getChatMediaUrl, /playbackKind: mediaKind === "thumbnail" \? "progressive" : "hls"/);
  assert.match(getChatMediaUrl, /expiresInSeconds: TOKEN_TTL_SECONDS/);
  assert.match(videoWebhook, /BUNNY_CHAT_STREAM_LIBRARY_ID/);
  assert.match(videoWebhook, /allowedLibraryIds/);
  assert.match(videoWebhook, /updateChatVibeClipStatusByProvider/);
  assert.match(videoWebhook, /\{ publishIfProcessing: Status === 7 \}/);
  assert.match(syncChatVibeClipStatus, /\{ publishIfProcessing: bunny\.rawStatus === 7 && upload\.sender_id === user\.id \}/);
  assert.match(chatThreadPage, /kind === "thumbnail" && asset\.provider === "bunny_stream" && asset\.media_family === "chat_video"/);
  assert.match(chatVibeClipMigration, /CREATE TABLE IF NOT EXISTS public\.chat_vibe_clip_uploads/);
  assert.match(chatVibeClipMigration, /UNIQUE \(sender_id, client_request_id\)/);
  assert.match(sendMessage, /const VIBE_CLIP_MAX_DURATION_MS = 30_000/);
  assert.match(sendMessage, /durationMs > VIBE_CLIP_MAX_DURATION_MS \+ VIBE_CLIP_DURATION_TOLERANCE_MS/);
  assert.match(sendMessage, /Video must be 30 seconds or shorter/);
  assert.match(sendMessage, /Math\.min\(VIBE_CLIP_MAX_DURATION_MS/);
});
