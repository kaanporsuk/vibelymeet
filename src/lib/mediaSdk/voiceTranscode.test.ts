import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { transcodeVoiceForUpload } from "./voiceTranscode";

const source = readFileSync(new URL("./voiceTranscode.ts", import.meta.url), "utf8");

// These run under Node (tsx), where there is no `window`/AudioContext. That exercises both
// the passthrough branch (already-universal types) and the fail-safe branch (a webm/ogg blob
// in an environment that cannot decode it must return the original blob, never throw).

test("already-universal voice blobs pass through unchanged", async () => {
  for (const type of ["audio/mp4", "audio/aac", "audio/mpeg", "audio/m4a", "audio/x-m4a"]) {
    const blob = new Blob(["fake-audio"], { type });
    const result = await transcodeVoiceForUpload(blob);
    assert.equal(result, blob, `expected passthrough for ${type}`);
  }
});

test("mime parameters are ignored when detecting universal types", async () => {
  const blob = new Blob(["fake-audio"], { type: "audio/mp4; codecs=mp4a.40.2" });
  const result = await transcodeVoiceForUpload(blob);
  assert.equal(result, blob);
});

test("unknown/empty types are left untouched (iOS Safari already records audio/mp4)", async () => {
  const blob = new Blob(["fake-audio"], { type: "" });
  const result = await transcodeVoiceForUpload(blob);
  assert.equal(result, blob);
});

test("webm/ogg fall back to the original blob when decoding is unavailable", async () => {
  for (const type of ["audio/webm", "audio/webm;codecs=opus", "audio/ogg"]) {
    const blob = new Blob(["fake-audio"], { type });
    const result = await transcodeVoiceForUpload(blob);
    // No AudioContext in Node -> fail-safe returns the original blob without throwing.
    assert.equal(result, blob, `expected fail-safe passthrough for ${type}`);
  }
});

test("web voice transcode stays under the upload contract", () => {
  assert.match(source, /const MP3_BITRATE_KBPS = 96;/);
  assert.match(source, /const VOICE_UPLOAD_MAX_BYTES = 10 \* 1024 \* 1024;/);
  assert.match(source, /mp3Blob\.size <= 0 \|\| mp3Blob\.size > VOICE_UPLOAD_MAX_BYTES/);
});
