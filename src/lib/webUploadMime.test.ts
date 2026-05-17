import assert from "node:assert/strict";
import test from "node:test";

import {
  GENERIC_UPLOAD_MIME_TYPE,
  imageExtensionForMimeType,
  imageMimeTypeForUpload,
  uploadFileNameForMimeType,
  videoExtensionForMimeType,
  videoMimeTypeForUpload,
} from "./webUploadMime";

test("web image upload MIME normalization accepts only supported image declarations and safe fallbacks", () => {
  assert.equal(imageMimeTypeForUpload("image/jpg", "photo.JPG"), "image/jpeg");
  assert.equal(imageMimeTypeForUpload("image/png; charset=binary"), "image/png");
  assert.equal(imageMimeTypeForUpload("", "photo.heic"), "image/heic");
  assert.equal(imageMimeTypeForUpload(GENERIC_UPLOAD_MIME_TYPE, "photo.heif"), "image/heif");
  assert.equal(imageMimeTypeForUpload("", undefined), GENERIC_UPLOAD_MIME_TYPE);
  assert.equal(imageMimeTypeForUpload("text/html", "photo.jpg"), null);
  assert.equal(imageMimeTypeForUpload(GENERIC_UPLOAD_MIME_TYPE, "payload.html"), null);
});

test("web video upload MIME normalization preserves supported mobile/browser containers", () => {
  assert.equal(videoMimeTypeForUpload("video/mp4; codecs=avc1", "clip.mp4"), "video/mp4");
  assert.equal(videoMimeTypeForUpload("video/mov", "clip.mov"), "video/quicktime");
  assert.equal(videoMimeTypeForUpload("", "clip.m4v"), "video/x-m4v");
  assert.equal(videoMimeTypeForUpload(GENERIC_UPLOAD_MIME_TYPE, "clip.webm"), "video/webm");
  assert.equal(videoMimeTypeForUpload("", undefined), GENERIC_UPLOAD_MIME_TYPE);
  assert.equal(videoMimeTypeForUpload("video/x-msvideo", "clip.avi"), null);
  assert.equal(videoMimeTypeForUpload(GENERIC_UPLOAD_MIME_TYPE, "clip.mkv"), null);
});

test("web upload filenames use normalized extensions without pretending unknown bytes are media", () => {
  assert.equal(imageExtensionForMimeType("image/jpg"), "jpg");
  assert.equal(imageExtensionForMimeType(GENERIC_UPLOAD_MIME_TYPE), "bin");
  assert.equal(videoExtensionForMimeType("video/mov"), "mov");
  assert.equal(videoExtensionForMimeType(GENERIC_UPLOAD_MIME_TYPE), "bin");
  assert.equal(uploadFileNameForMimeType("image", "chat", "image/jpeg", "camera.jpeg"), "chat.jpeg");
  assert.equal(uploadFileNameForMimeType("image", "chat", "image/jpeg", "camera.mp4"), "chat.jpg");
  assert.equal(uploadFileNameForMimeType("video", "chat-video", "video/x-m4v", "clip.M4V"), "chat-video.m4v");
  assert.equal(uploadFileNameForMimeType("video", "chat-video", GENERIC_UPLOAD_MIME_TYPE), "chat-video.bin");
});
