import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareWebProofSelfieUploadPayload,
  WebProofSelfiePayloadError,
} from "./webProofSelfieUpload";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function jpegDataUrl(bytes: Uint8Array): string {
  return `data:image/jpeg;base64,${bytesToBase64(bytes)}`;
}

test("prepareWebProofSelfieUploadPayload decodes JPEG data URL into upload bytes", () => {
  const expectedBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0xff, 0xd9]);
  const payload = prepareWebProofSelfieUploadPayload(jpegDataUrl(expectedBytes));

  assert.equal(payload.contentType, "image/jpeg");
  assert.equal(payload.byteLength, expectedBytes.byteLength);
  assert.deepEqual(new Uint8Array(payload.body), expectedBytes);
});

test("prepareWebProofSelfieUploadPayload accepts jpg aliases and base64 whitespace", () => {
  const expectedBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0xff, 0xd9]);
  const spacedBase64 = bytesToBase64(expectedBytes).replace(/(.{4})/g, "$1\n");
  const payload = prepareWebProofSelfieUploadPayload(` data:image/jpg;base64,${spacedBase64} `);

  assert.equal(payload.contentType, "image/jpeg");
  assert.deepEqual(new Uint8Array(payload.body), expectedBytes);
});

test("prepareWebProofSelfieUploadPayload rejects non-JPEG data URLs", () => {
  assert.throws(
    () => prepareWebProofSelfieUploadPayload("data:image/png;base64,iVBORw0KGgo="),
    WebProofSelfiePayloadError,
  );
});

test("prepareWebProofSelfieUploadPayload rejects empty or invalid payloads", () => {
  assert.throws(
    () => prepareWebProofSelfieUploadPayload("data:image/jpeg;base64,"),
    WebProofSelfiePayloadError,
  );
  assert.throws(
    () => prepareWebProofSelfieUploadPayload("data:image/jpeg;base64,@@@"),
    WebProofSelfiePayloadError,
  );
});

test("prepareWebProofSelfieUploadPayload rejects JPEG-labeled non-JPEG bytes", () => {
  assert.throws(
    () => prepareWebProofSelfieUploadPayload(jpegDataUrl(Uint8Array.from([1, 2, 3, 4, 5]))),
    WebProofSelfiePayloadError,
  );
});
