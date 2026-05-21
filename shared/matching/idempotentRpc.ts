export const VIDEO_DATE_IDEMPOTENCY_KEY_MIN_LENGTH = 8;
export const VIDEO_DATE_IDEMPOTENCY_KEY_MAX_LENGTH = 160;
export const VIDEO_DATE_CLIENT_REQUEST_ID_LENGTH = 36;

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Generate the client request id used inside Video Date idempotency keys.
 * The database accepts composed idempotency keys between 8 and 160 chars; the
 * leaf request id is intentionally a 36-char UUID v4 so composed keys stay
 * well under the server limit and are collision-resistant across web/native.
 */
export function generateIdempotencyKey(): string {
  const nativeUuid = globalThis.crypto?.randomUUID?.();
  if (nativeUuid && UUID_V4_PATTERN.test(nativeUuid)) return nativeUuid;
  return uuidV4FromRandomBytes();
}

export function isUuidV4IdempotencyKey(value: string): boolean {
  return UUID_V4_PATTERN.test(value);
}

function uuidV4FromRandomBytes(): string {
  const bytes = new Uint8Array(16);
  const cryptoLike = globalThis.crypto;
  if (cryptoLike?.getRandomValues) {
    cryptoLike.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}
