export interface SniffedMediaUpload {
  mimeType: string;
  extension: string;
}

export type MediaUploadValidationResult =
  | { ok: true; media: SniffedMediaUpload }
  | { ok: false; error: "unsupported_media_bytes" | "declared_mime_mismatch"; detected?: SniffedMediaUpload };

const GENERIC_DECLARED_MIME_TYPES = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
]);

const IMAGE_DECLARATIONS: Record<string, string[]> = {
  "image/jpeg": ["image/jpeg", "image/jpg"],
  "image/png": ["image/png"],
  "image/webp": ["image/webp"],
  "image/heic": ["image/heic", "image/heif"],
  "image/heif": ["image/heif", "image/heic"],
};

const THUMBNAIL_DECLARATIONS: Record<string, string[]> = {
  "image/jpeg": ["image/jpeg", "image/jpg"],
  "image/png": ["image/png"],
  "image/webp": ["image/webp"],
};

const VOICE_DECLARATIONS: Record<string, string[]> = {
  "audio/webm": ["audio/webm"],
  "audio/ogg": ["audio/ogg", "application/ogg"],
  "audio/mp4": ["audio/mp4", "audio/x-m4a", "audio/m4a"],
  "audio/aac": ["audio/aac", "audio/aacp"],
  "audio/mpeg": ["audio/mpeg", "audio/mp3"],
  "audio/wav": ["audio/wav", "audio/wave", "audio/x-wav"],
};

const CHAT_VIDEO_DECLARATIONS: Record<string, string[]> = {
  "video/webm": ["video/webm"],
  "video/mp4": ["video/mp4", "video/x-m4v", "video/m4v"],
  "video/quicktime": ["video/quicktime", "video/mov"],
  "video/x-m4v": ["video/x-m4v", "video/m4v", "video/mp4"],
};

function asBytes(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function normalizeDeclaredMimeType(declaredType: string | null | undefined): string {
  return (declaredType ?? "").split(";")[0].trim().toLowerCase();
}

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((byte, index) => bytes[index] === byte);
}

function asciiAt(bytes: Uint8Array, offset: number, value: string): boolean {
  if (bytes.length < offset + value.length) return false;
  for (let i = 0; i < value.length; i += 1) {
    if (bytes[offset + i] !== value.charCodeAt(i)) return false;
  }
  return true;
}

function asciiSlice(bytes: Uint8Array, offset: number, length: number): string | null {
  if (bytes.length < offset + length) return null;
  let value = "";
  for (let i = 0; i < length; i += 1) {
    value += String.fromCharCode(bytes[offset + i]);
  }
  return value;
}

function uint32be(bytes: Uint8Array, offset: number): number | null {
  if (bytes.length < offset + 4) return null;
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

function isoBmffBrands(bytes: Uint8Array): string[] {
  if (bytes.length < 16 || !asciiAt(bytes, 4, "ftyp")) return [];
  const boxSize = uint32be(bytes, 0);
  if (!boxSize || boxSize < 16 || boxSize > bytes.length || (boxSize - 16) % 4 !== 0) return [];

  const brands: string[] = [];
  const majorBrand = asciiSlice(bytes, 8, 4);
  if (majorBrand) brands.push(majorBrand);

  const maxOffset = Math.min(boxSize, 128);
  for (let offset = 16; offset + 4 <= maxOffset; offset += 4) {
    const brand = asciiSlice(bytes, offset, 4);
    if (brand) brands.push(brand);
  }

  return brands;
}

function isoBmffHandlerTypes(bytes: Uint8Array): string[] {
  if (isoBmffBrands(bytes).length === 0) return [];

  const handlers = new Set<string>();
  for (let offset = 4; offset + 16 <= bytes.length; offset += 1) {
    if (!asciiAt(bytes, offset, "hdlr")) continue;
    const boxStart = offset - 4;
    const boxSize = uint32be(bytes, boxStart);
    if (!boxSize || boxSize < 24 || boxStart + boxSize > bytes.length) continue;
    const handler = asciiSlice(bytes, offset + 12, 4);
    if (handler) handlers.add(handler);
  }
  return [...handlers];
}

function hasAnyBrand(brands: string[], candidates: string[]): boolean {
  return candidates.some((candidate) => brands.includes(candidate));
}

function hasCompatibleHandler(handlers: string[], expected: string): boolean {
  return handlers.length === 0 || handlers.includes(expected);
}

function isEbml(bytes: Uint8Array): boolean {
  return hasPrefix(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
}

function isOgg(bytes: Uint8Array): boolean {
  return asciiAt(bytes, 0, "OggS");
}

function isWav(bytes: Uint8Array): boolean {
  return asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WAVE");
}

function isMp3(bytes: Uint8Array): boolean {
  if (asciiAt(bytes, 0, "ID3")) return true;
  if (bytes.length < 4 || bytes[0] !== 0xff || (bytes[1] & 0xe0) !== 0xe0) return false;
  const versionBits = (bytes[1] >> 3) & 0x03;
  const layerBits = (bytes[1] >> 1) & 0x03;
  const bitrateIndex = (bytes[2] >> 4) & 0x0f;
  const sampleRateIndex = (bytes[2] >> 2) & 0x03;
  return versionBits !== 0x01 && layerBits !== 0x00 && bitrateIndex !== 0x00 && bitrateIndex !== 0x0f && sampleRateIndex !== 0x03;
}

function isAacAdts(bytes: Uint8Array): boolean {
  return bytes.length >= 7 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
}

function sniffImage(bytes: Uint8Array): SniffedMediaUpload | null {
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) {
    return { mimeType: "image/webp", extension: "webp" };
  }

  const brands = isoBmffBrands(bytes);
  if (hasAnyBrand(brands, ["avif", "avis"])) {
    return null;
  }
  if (hasAnyBrand(brands, ["heic", "heix", "hevc", "hevx", "heis", "hevm"])) {
    return { mimeType: "image/heic", extension: "heic" };
  }
  if (hasAnyBrand(brands, ["heif", "mif1", "msf1"])) {
    return { mimeType: "image/heif", extension: "heif" };
  }

  return null;
}

function sniffVoice(bytes: Uint8Array): SniffedMediaUpload | null {
  if (isEbml(bytes)) return { mimeType: "audio/webm", extension: "webm" };
  if (isOgg(bytes)) return { mimeType: "audio/ogg", extension: "ogg" };
  if (isWav(bytes)) return { mimeType: "audio/wav", extension: "wav" };
  if (isAacAdts(bytes)) return { mimeType: "audio/aac", extension: "aac" };
  if (isMp3(bytes)) return { mimeType: "audio/mpeg", extension: "mp3" };

  const brands = isoBmffBrands(bytes);
  const handlers = isoBmffHandlerTypes(bytes);
  if (!hasCompatibleHandler(handlers, "soun")) return null;
  if (hasAnyBrand(brands, ["M4A ", "M4B ", "M4P ", "mp41", "mp42", "isom", "iso2"])) {
    return { mimeType: "audio/mp4", extension: "m4a" };
  }

  return null;
}

function sniffChatVideo(bytes: Uint8Array): SniffedMediaUpload | null {
  if (isEbml(bytes)) return { mimeType: "video/webm", extension: "webm" };

  const brands = isoBmffBrands(bytes);
  const handlers = isoBmffHandlerTypes(bytes);
  if (!hasCompatibleHandler(handlers, "vide")) return null;
  if (hasAnyBrand(brands, ["qt  "])) {
    return { mimeType: "video/quicktime", extension: "mov" };
  }
  if (hasAnyBrand(brands, ["M4V ", "M4VH", "M4VP"])) {
    return { mimeType: "video/x-m4v", extension: "m4v" };
  }
  if (hasAnyBrand(brands, ["mp41", "mp42", "isom", "iso2", "avc1"])) {
    return { mimeType: "video/mp4", extension: "mp4" };
  }

  return null;
}

function validateSniffedMedia(
  bytesInput: ArrayBuffer | Uint8Array,
  declaredType: string | null | undefined,
  sniff: (bytes: Uint8Array) => SniffedMediaUpload | null,
  declarations: Record<string, string[]>,
): MediaUploadValidationResult {
  const media = sniff(asBytes(bytesInput));
  if (!media) {
    return { ok: false, error: "unsupported_media_bytes" };
  }

  const declared = normalizeDeclaredMimeType(declaredType);
  if (GENERIC_DECLARED_MIME_TYPES.has(declared)) {
    return { ok: true, media };
  }

  if (!declarations[media.mimeType]?.includes(declared)) {
    return { ok: false, error: "declared_mime_mismatch", detected: media };
  }

  return { ok: true, media };
}

export function validateImageUploadBytes(
  bytes: ArrayBuffer | Uint8Array,
  declaredType?: string | null,
): MediaUploadValidationResult {
  return validateSniffedMedia(bytes, declaredType, sniffImage, IMAGE_DECLARATIONS);
}

export function validateChatVideoThumbnailBytes(
  bytes: ArrayBuffer | Uint8Array,
  declaredType?: string | null,
): MediaUploadValidationResult {
  return validateSniffedMedia(bytes, declaredType, sniffImage, THUMBNAIL_DECLARATIONS);
}

export function validateVoiceUploadBytes(
  bytes: ArrayBuffer | Uint8Array,
  declaredType?: string | null,
): MediaUploadValidationResult {
  return validateSniffedMedia(bytes, declaredType, sniffVoice, VOICE_DECLARATIONS);
}

export function validateChatVideoUploadBytes(
  bytes: ArrayBuffer | Uint8Array,
  declaredType?: string | null,
): MediaUploadValidationResult {
  return validateSniffedMedia(bytes, declaredType, sniffChatVideo, CHAT_VIDEO_DECLARATIONS);
}
