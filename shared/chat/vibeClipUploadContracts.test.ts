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
const webChat = read("src/pages/Chat.tsx");
const webVibeClipBubble = read("src/components/chat/VibeClipBubble.tsx");
const webVideoBubble = read("src/components/chat/VideoMessageBubble.tsx");
const webUpload = read("src/services/chatVideoUploadService.ts");
const nativeChat = read("apps/mobile/app/chat/[id].tsx");
const nativeVibeClipCard = read("apps/mobile/components/chat/VibeClipCard.tsx");
const nativeUpload = read("apps/mobile/lib/chatMediaUpload.ts");
const nativeMediaCache = read("apps/mobile/lib/chatOutbox/mediaCache.ts");
const uploadChatVideo = read("supabase/functions/upload-chat-video/index.ts");
const sendMessage = read("supabase/functions/send-message/index.ts");

test("shared Vibe Clip upload limits stay aligned across clients", () => {
  assert.match(copy, /export const VIBE_CLIP_MAX_DURATION_SEC = 30/);
  assert.match(copy, /export const VIBE_CLIP_MAX_UPLOAD_BYTES = 20 \* 1024 \* 1024/);
  assert.match(copy, /VIBE_CLIP_UPLOAD_TOO_LONG/);
  assert.match(copy, /VIBE_CLIP_UPLOAD_TOO_LARGE/);
  assert.match(copy, /VIBE_CLIP_WEB_TOAST_CAMERA_SWITCH_UNAVAILABLE/);
});

test("web recorder supports saved-video upload with the same constraints", () => {
  assert.match(webRecorder, /type="file"[\s\S]{0,120}accept="video\/\*"/);
  assert.match(webRecorder, /startCamera\(facingMode, \{ cancelOnError: false \}\)/);
  assert.match(webRecorder, /disabled=\{!isRecording && \(!cameraReady \|\| isProcessingUpload\)\}/);
  assert.match(webRecorder, /function looksLikeVideoFile/);
  assert.match(webRecorder, /function readSelectedVideoMetadata/);
  assert.match(webRecorder, /file\.size <= 0/);
  assert.match(webRecorder, /file\.size > VIBE_CLIP_MAX_UPLOAD_BYTES/);
  assert.match(webRecorder, /metadata\.durationSeconds > VIBE_CLIP_MAX_DURATION_SEC \+ 0\.25/);
  assert.match(webRecorder, /onRecordingComplete\(file, metadata\.durationSeconds/);
  assert.match(webRecorder, /captureSource: "library"/);
  assert.match(webRecorder, /mimeType: file\.type \|\| undefined/);
  assert.match(webRecorder, /aspectRatio: metadata\.aspectRatio/);
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
  assert.match(nativeVibeClipCard, /Math\.max\(0\.5, Math\.min\(1\.2, meta\.aspectRatio\)\)/);
  assert.match(nativeVibeClipCard, /style=\{\[styles\.videoWrap, \{ aspectRatio: cardAspectRatio \}\]\}/);
  assert.match(nativeVibeClipCard, /contentFit="cover"/);
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
  assert.match(nativeUpload, /mimeType\.includes\('quicktime'\)[\s\S]{0,80}'mov'/);
  assert.match(nativeUpload, /mimeType\.includes\('x-m4v'\)[\s\S]{0,80}'m4v'/);
  assert.match(nativeUpload, /mimeType\.includes\('webm'\)[\s\S]{0,80}'webm'/);
  assert.match(nativeMediaCache, /mime\?\.includes\('x-m4v'\)[\s\S]{0,80}return 'm4v'/);
  assert.match(nativeMediaCache, /mime\?\.includes\('webm'\)[\s\S]{0,80}return 'webm'/);
});

test("server upload and publish paths enforce final Vibe Clip limits", () => {
  assert.match(uploadChatVideo, /const CHAT_VIDEO_MAX_UPLOAD_BYTES = 20 \* 1024 \* 1024/);
  assert.match(uploadChatVideo, /file\.size <= 0/);
  assert.match(uploadChatVideo, /file\.size > CHAT_VIDEO_MAX_UPLOAD_BYTES/);
  assert.match(uploadChatVideo, /"video\/quicktime": "mov"/);
  assert.match(sendMessage, /const VIBE_CLIP_MAX_DURATION_MS = 30_000/);
  assert.match(sendMessage, /durationMs > VIBE_CLIP_MAX_DURATION_MS \+ VIBE_CLIP_DURATION_TOLERANCE_MS/);
  assert.match(sendMessage, /Video must be 30 seconds or shorter/);
  assert.match(sendMessage, /Math\.min\(VIBE_CLIP_MAX_DURATION_MS/);
});
