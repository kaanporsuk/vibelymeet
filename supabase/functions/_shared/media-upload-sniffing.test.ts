import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  validateChatVideoThumbnailBytes,
  validateChatVideoUploadBytes,
  validateImageUploadBytes,
  validateVoiceUploadBytes,
} from "./media-upload-sniffing.ts";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function bytes(values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

function ascii(value: string): Uint8Array {
  return Uint8Array.from([...value].map((char) => char.charCodeAt(0)));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function boxBrand(brand: string, compatibleBrands: string[] = []): Uint8Array {
  const size = 16 + compatibleBrands.length * 4;
  const out = new Uint8Array(size);
  out[0] = (size >>> 24) & 0xff;
  out[1] = (size >>> 16) & 0xff;
  out[2] = (size >>> 8) & 0xff;
  out[3] = size & 0xff;
  out.set(ascii("ftyp"), 4);
  out.set(ascii(brand.padEnd(4, " ").slice(0, 4)), 8);
  for (let i = 0; i < compatibleBrands.length; i += 1) {
    out.set(ascii(compatibleBrands[i].padEnd(4, " ").slice(0, 4)), 16 + i * 4);
  }
  return out;
}

function hdlrBox(handler: string): Uint8Array {
  const size = 32;
  const out = new Uint8Array(size);
  out[0] = (size >>> 24) & 0xff;
  out[1] = (size >>> 16) & 0xff;
  out[2] = (size >>> 8) & 0xff;
  out[3] = size & 0xff;
  out.set(ascii("hdlr"), 4);
  out.set(ascii(handler.padEnd(4, " ").slice(0, 4)), 16);
  return out;
}

const samples = {
  html: ascii("<script>alert(1)</script>"),
  jpeg: bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
  png: bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
  webp: concat(ascii("RIFF"), bytes([0x1a, 0x00, 0x00, 0x00]), ascii("WEBPVP8 ")),
  heic: boxBrand("heic", ["mif1"]),
  heif: boxBrand("mif1", ["heif"]),
  avif: boxBrand("avif", ["mif1"]),
  webm: bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]),
  ogg: concat(ascii("OggS"), bytes([0x00, 0x02, 0x00, 0x00])),
  mp4: boxBrand("isom", ["mp42", "avc1"]),
  mp4Video: concat(boxBrand("isom", ["mp42", "avc1"]), hdlrBox("vide")),
  mp4Audio: concat(boxBrand("isom", ["mp42"]), hdlrBox("soun")),
  mov: boxBrand("qt  "),
  m4v: boxBrand("M4V ", ["mp42"]),
  m4a: boxBrand("M4A ", ["isom"]),
  m4aAudio: concat(boxBrand("M4A ", ["isom"]), hdlrBox("soun")),
  aac: bytes([0xff, 0xf1, 0x50, 0x80, 0x00, 0x1f, 0xfc]),
  mp3: concat(ascii("ID3"), bytes([0x03, 0x00, 0x00, 0x00])),
  wav: concat(ascii("RIFF"), bytes([0x24, 0x00, 0x00, 0x00]), ascii("WAVEfmt ")),
  malformedFtyp: concat(bytes([0x00, 0x00, 0x00, 0x08]), ascii("ftypisommp42")),
};

test("fake active content is rejected even when declared as allowed media", () => {
  assert.equal(validateImageUploadBytes(samples.html, "image/jpeg").ok, false);
  assert.equal(validateVoiceUploadBytes(samples.html, "audio/webm").ok, false);
  assert.equal(validateChatVideoUploadBytes(samples.html, "video/mp4").ok, false);
  assert.equal(validateChatVideoThumbnailBytes(samples.html, "image/png").ok, false);
  assert.equal(validateChatVideoUploadBytes(samples.malformedFtyp, "video/mp4").ok, false);
  assert.equal(validateVoiceUploadBytes(samples.malformedFtyp, "audio/mp4").ok, false);
  assert.equal(validateImageUploadBytes(samples.malformedFtyp, "image/heic").ok, false);
  assert.equal(validateVoiceUploadBytes(samples.mp4Video, "audio/mp4").ok, false);
  assert.equal(validateChatVideoUploadBytes(samples.mp4Audio, "video/mp4").ok, false);
});

test("image upload validator accepts supported image bytes and normalizes MIME", () => {
  assert.deepEqual(validateImageUploadBytes(samples.jpeg, "image/jpg"), {
    ok: true,
    media: { mimeType: "image/jpeg", extension: "jpg" },
  });
  assert.deepEqual(validateImageUploadBytes(samples.png, "application/octet-stream"), {
    ok: true,
    media: { mimeType: "image/png", extension: "png" },
  });
  assert.deepEqual(validateImageUploadBytes(samples.webp, "image/webp"), {
    ok: true,
    media: { mimeType: "image/webp", extension: "webp" },
  });
  assert.deepEqual(validateImageUploadBytes(samples.heic, "image/heic"), {
    ok: true,
    media: { mimeType: "image/heic", extension: "heic" },
  });
  assert.deepEqual(validateImageUploadBytes(samples.heif, "image/heif"), {
    ok: true,
    media: { mimeType: "image/heif", extension: "heif" },
  });
  assert.equal(validateImageUploadBytes(samples.avif, "application/octet-stream").ok, false);
});

test("voice upload validator accepts supported audio containers and normalizes MIME", () => {
  assert.deepEqual(validateVoiceUploadBytes(samples.webm, "audio/webm"), {
    ok: true,
    media: { mimeType: "audio/webm", extension: "webm" },
  });
  assert.deepEqual(validateVoiceUploadBytes(samples.ogg, "audio/ogg"), {
    ok: true,
    media: { mimeType: "audio/ogg", extension: "ogg" },
  });
  assert.deepEqual(validateVoiceUploadBytes(samples.mp4, "audio/mp4"), {
    ok: true,
    media: { mimeType: "audio/mp4", extension: "m4a" },
  });
  assert.deepEqual(validateVoiceUploadBytes(samples.m4a, "audio/x-m4a"), {
    ok: true,
    media: { mimeType: "audio/mp4", extension: "m4a" },
  });
  assert.deepEqual(validateVoiceUploadBytes(samples.m4aAudio, "application/octet-stream"), {
    ok: true,
    media: { mimeType: "audio/mp4", extension: "m4a" },
  });
  assert.deepEqual(validateVoiceUploadBytes(samples.aac, "audio/aac"), {
    ok: true,
    media: { mimeType: "audio/aac", extension: "aac" },
  });
  assert.deepEqual(validateVoiceUploadBytes(samples.mp3, "audio/mpeg"), {
    ok: true,
    media: { mimeType: "audio/mpeg", extension: "mp3" },
  });
  assert.deepEqual(validateVoiceUploadBytes(samples.wav, "audio/wav"), {
    ok: true,
    media: { mimeType: "audio/wav", extension: "wav" },
  });
});

test("chat video upload validator accepts supported video containers", () => {
  assert.deepEqual(validateChatVideoUploadBytes(samples.webm, "video/webm"), {
    ok: true,
    media: { mimeType: "video/webm", extension: "webm" },
  });
  assert.deepEqual(validateChatVideoUploadBytes(samples.mp4, "video/mp4"), {
    ok: true,
    media: { mimeType: "video/mp4", extension: "mp4" },
  });
  assert.deepEqual(validateChatVideoUploadBytes(samples.mp4Video, "application/octet-stream"), {
    ok: true,
    media: { mimeType: "video/mp4", extension: "mp4" },
  });
  assert.deepEqual(validateChatVideoUploadBytes(samples.mov, "video/quicktime"), {
    ok: true,
    media: { mimeType: "video/quicktime", extension: "mov" },
  });
  assert.deepEqual(validateChatVideoUploadBytes(samples.m4v, "video/mp4"), {
    ok: true,
    media: { mimeType: "video/x-m4v", extension: "m4v" },
  });
});

test("thumbnail upload validator accepts image thumbnails but not HEIC", () => {
  assert.equal(validateChatVideoThumbnailBytes(samples.jpeg, "image/jpeg").ok, true);
  assert.equal(validateChatVideoThumbnailBytes(samples.png, "image/png").ok, true);
  assert.equal(validateChatVideoThumbnailBytes(samples.webp, "image/webp").ok, true);
  assert.equal(validateChatVideoThumbnailBytes(samples.heic, "image/heic").ok, false);
});

test("declared MIME conflicts are rejected", () => {
  assert.equal(validateImageUploadBytes(samples.jpeg, "image/png").ok, false);
  assert.equal(validateVoiceUploadBytes(samples.ogg, "audio/webm").ok, false);
  assert.equal(validateChatVideoUploadBytes(samples.mov, "video/mp4").ok, false);
  assert.equal(validateChatVideoThumbnailBytes(samples.webp, "image/jpeg").ok, false);
});

test("upload functions reject malformed multipart files and sanitize provider failures", () => {
  const uploadImage = read("supabase/functions/upload-image/index.ts");
  const uploadVoice = read("supabase/functions/upload-voice/index.ts");
  const uploadChatVideo = read("supabase/functions/upload-chat-video/index.ts");
  const combined = `${uploadImage}\n${uploadVoice}\n${uploadChatVideo}`;

  assert.match(combined, /function isUploadFile/);
  assert.doesNotMatch(combined, /formData\.get\("file"\) as File/);
  assert.doesNotMatch(combined, /formData\.get\("thumbnail"\) as File/);
  assert.doesNotMatch(combined, /\berrText\b|\bthumbErr\b/);
  assert.doesNotMatch(combined, /error: String\(err\)/);
  assert.match(combined, /providerErrorMeta/);
  assert.match(uploadImage, /Empty image file\./);
  assert.match(uploadVoice, /Empty audio file\./);
  assert.match(uploadChatVideo, /Empty video file\./);
});
