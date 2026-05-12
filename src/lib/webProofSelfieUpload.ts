export type WebProofSelfieUploadPayload = {
  body: ArrayBuffer;
  contentType: "image/jpeg";
  byteLength: number;
};

export class WebProofSelfiePayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebProofSelfiePayloadError";
  }
}

function payloadError(message: string): WebProofSelfiePayloadError {
  return new WebProofSelfiePayloadError(message);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const normalized = base64.replace(/\s/g, "");
  if (!normalized) {
    throw payloadError("Selfie data was empty. Please retake the photo.");
  }

  const atobFn =
    typeof globalThis !== "undefined" && typeof globalThis.atob === "function"
      ? globalThis.atob.bind(globalThis)
      : undefined;

  if (!atobFn) {
    throw payloadError("Your browser could not prepare the selfie. Please try again.");
  }

  let binaryString: string;
  try {
    binaryString = atobFn(normalized);
  } catch {
    throw payloadError("Selfie data was invalid. Please retake the photo.");
  }

  if (!binaryString.length) {
    throw payloadError("Selfie data was empty. Please retake the photo.");
  }

  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return bytes.buffer;
}

export function prepareWebProofSelfieUploadPayload(dataUrl: string): WebProofSelfieUploadPayload {
  const trimmed = dataUrl.trim();
  const commaIndex = trimmed.indexOf(",");

  if (commaIndex <= 0) {
    throw payloadError("Selfie data was invalid. Please retake the photo.");
  }

  const header = trimmed.slice(0, commaIndex).toLowerCase();
  if (!/^data:image\/jpe?g;base64$/.test(header)) {
    throw payloadError("Selfie data was invalid. Please retake the photo.");
  }

  const body = base64ToArrayBuffer(trimmed.slice(commaIndex + 1));
  if (body.byteLength === 0) {
    throw payloadError("Selfie data was empty. Please retake the photo.");
  }

  const bytes = new Uint8Array(body);
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw payloadError("Selfie data was invalid. Please retake the photo.");
  }

  return {
    body,
    contentType: "image/jpeg",
    byteLength: body.byteLength,
  };
}
