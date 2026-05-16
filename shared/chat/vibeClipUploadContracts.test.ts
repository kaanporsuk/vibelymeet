import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const webVibeClipBubble = read("src/components/chat/VibeClipBubble.tsx");
const webVideoBubble = read("src/components/chat/VideoMessageBubble.tsx");
const webUpload = read("src/services/chatVideoUploadService.ts");
const nativeChat = read("apps/mobile/app/chat/[id].tsx");
const nativePhotoOptions = read("apps/mobile/components/chat/PhotoSendOptionsSheet.tsx");
const nativePhotoCamera = read("apps/mobile/components/chat/ChatPhotoCameraModal.tsx");
const nativeVibeClipCard = read("apps/mobile/components/chat/VibeClipCard.tsx");
const nativeUpload = read("apps/mobile/lib/chatMediaUpload.ts");
const nativeMediaCache = read("apps/mobile/lib/chatOutbox/mediaCache.ts");
const uploadChatVideo = read("supabase/functions/upload-chat-video/index.ts");
const sendMessage = read("supabase/functions/send-message/index.ts");

test("shared Vibe Clip upload limits stay aligned across clients", () => {
  assert.match(copy, /export const VIBE_CLIP_MAX_DURATION_SEC = 30/);
  assert.match(copy, /HOSTED_EDGE_FUNCTION_BODY_LIMIT_BYTES = 10 \* 1024 \* 1024/);
  assert.match(copy, /export const VIBE_CLIP_MAX_UPLOAD_BYTES = 8 \* 1024 \* 1024/);
  assert.match(copy, /export const VIBE_CLIP_MAX_UPLOAD_MB = 8/);
  assert.match(copy, /vibeClipMultipartFitsEdgeLimit/);
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
  assert.match(webLibraryHelper, /export function readSelectedVideoMetadata/);
  assert.match(webLibraryHelper, /video\.onloadedmetadata = null/);
  assert.match(webLibraryHelper, /URL\.revokeObjectURL\(objectUrl\)/);
  assert.match(webLibraryHelper, /file\.size <= 0/);
  assert.match(webLibraryHelper, /file\.size > VIBE_CLIP_MAX_UPLOAD_BYTES/);
  assert.match(webLibraryHelper, /metadata\.durationSeconds > VIBE_CLIP_MAX_DURATION_SEC \+ 0\.25/);
  assert.match(webLibraryHelper, /captureSource: "library"/);
  assert.match(webLibraryHelper, /mimeType: file\.type \|\| undefined/);
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
  assert.match(webPhotoCamera, /await onCapturePhoto\(capturedFile\)/);
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
  assert.match(nativePhotoCamera, /takePictureAsync\(\{/);
  assert.match(nativePhotoCamera, /quality: 0\.85/);
  assert.match(nativePhotoCamera, /setFacing\(\(current\) => \(current === 'front' \? 'back' : 'front'\)\)/);
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
  assert.match(webChat, /const captureSource = meta\?\.captureSource \?\? "web_recorder"/);
  assert.match(webChat, /mimeType: meta\?\.mimeType \|\| videoBlob\.type \|\| "video\/mp4"/);
  assert.match(webChat, /aspectRatio: meta\?\.aspectRatio \?\? null/);
  assert.match(webUpload, /videoBlob\.size <= 0/);
  assert.match(webUpload, /videoBlob\.size > VIBE_CLIP_MAX_UPLOAD_BYTES/);
  assert.match(webUpload, /vibeClipMultipartFitsEdgeLimit/);
  assert.match(webUpload, /function videoMimeTypeForBlob/);
  assert.match(webUpload, /video_metadata_timeout/);
  assert.match(webUpload, /baseType === "video\/quicktime"\) return "mov"/);
});

test("video bubbles remain adaptive and full-width across web and native chat", () => {
  assert.match(webVibeClipBubble, /w-\[min\(17\.5rem,calc\(100vw-4rem\)\)\] max-w-full/);
  assert.match(webVibeClipBubble, /Math\.max\(0\.5, Math\.min\(1\.2, meta\.aspectRatio\)\)/);
  assert.match(webVibeClipBubble, /<AspectRatio ratio=\{clipAspectRatio\}>/);
  assert.match(webVibeClipBubble, /w-full h-full object-cover bg-black/);
  assert.match(webVibeClipBubble, /aria-label=\{isMuted \? "Unmute clip" : "Mute clip"\}/);
  assert.match(webVibeClipBubble, /aria-label="Open clip full screen"/);

  assert.match(webVideoBubble, /w-\[min\(17\.5rem,calc\(100vw-4rem\)\)\] max-w-full/);
  assert.match(webVideoBubble, /<AspectRatio ratio=\{9 \/ 16\}>/);
  assert.match(webVideoBubble, /w-full h-full object-cover bg-black/);
  assert.match(webVideoBubble, /aria-label=\{isMuted \? "Unmute video" : "Mute video"\}/);
  assert.match(webVideoBubble, /aria-label="Open video full screen"/);

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
  assert.match(nativeVibeClipCard, /Tap to play/);
});

test("native chat validates library and camera video before enqueue", () => {
  assert.match(nativeChat, /function imagePickerDurationSeconds/);
  assert.match(nativeChat, /return durationMs \/ 1000/);
  assert.match(nativeChat, /shouldDownloadFromNetwork: true/);
  assert.match(nativeChat, /videoMaxDuration: VIBE_CLIP_MAX_DURATION_SEC/);
  assert.match(nativeChat, /durationSec == null[\s\S]{0,80}VIBE_CLIP_UPLOAD_DURATION_UNREADABLE/);
  assert.match(nativeChat, /durationSec > VIBE_CLIP_MAX_DURATION_SEC \+ 0\.25/);
  assert.match(nativeChat, /sizeBytes === 0[\s\S]{0,120}cleanupOutboxCacheUri/);
  assert.match(nativeChat, /sizeBytes > VIBE_CLIP_MAX_UPLOAD_BYTES/);
  assert.match(nativeChat, /cameraType: ImagePicker\.CameraType\.front/);
  assert.match(nativeChat, /aspectRatioForVideoAsset\(asset\)/);
});

test("native upload and cache keep mobile video formats intact", () => {
  assert.match(nativeUpload, /FileSystem\.getInfoAsync\(videoUri\)/);
  assert.match(nativeUpload, /info\.size <= 0/);
  assert.match(nativeUpload, /info\.size > VIBE_CLIP_MAX_UPLOAD_BYTES/);
  assert.match(nativeUpload, /vibeClipMultipartFitsEdgeLimit/);
  assert.match(nativeUpload, /mimeType\.includes\('quicktime'\)[\s\S]{0,80}'mov'/);
  assert.match(nativeUpload, /mimeType\.includes\('x-m4v'\)[\s\S]{0,80}'m4v'/);
  assert.match(nativeUpload, /mimeType\.includes\('webm'\)[\s\S]{0,80}'webm'/);
  assert.match(nativeMediaCache, /mime\?\.includes\('x-m4v'\)[\s\S]{0,80}return 'm4v'/);
  assert.match(nativeMediaCache, /mime\?\.includes\('webm'\)[\s\S]{0,80}return 'webm'/);
});

test("server upload and publish paths enforce final Vibe Clip limits", () => {
  assert.match(uploadChatVideo, /const CHAT_VIDEO_MAX_UPLOAD_BYTES = 8 \* 1024 \* 1024/);
  assert.match(uploadChatVideo, /Supabase Edge Function ~10MB request-body cap/);
  assert.match(uploadChatVideo, /Maximum 8MB/);
  assert.match(uploadChatVideo, /file\.size <= 0/);
  assert.match(uploadChatVideo, /file\.size > CHAT_VIDEO_MAX_UPLOAD_BYTES/);
  assert.match(uploadChatVideo, /"video\/quicktime": "mov"/);
  assert.match(sendMessage, /const VIBE_CLIP_MAX_DURATION_MS = 30_000/);
  assert.match(sendMessage, /durationMs > VIBE_CLIP_MAX_DURATION_MS \+ VIBE_CLIP_DURATION_TOLERANCE_MS/);
  assert.match(sendMessage, /Video must be 30 seconds or shorter/);
  assert.match(sendMessage, /Math\.min\(VIBE_CLIP_MAX_DURATION_MS/);
});
