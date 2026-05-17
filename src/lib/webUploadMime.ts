export const GENERIC_UPLOAD_MIME_TYPE = "application/octet-stream";

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

const VIDEO_MIME_BY_EXTENSION: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  webm: "video/webm",
};

const IMAGE_MIME_ALIASES: Record<string, string> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/heic": "image/heic",
  "image/heif": "image/heif",
};

const VIDEO_MIME_ALIASES: Record<string, string> = {
  "video/mp4": "video/mp4",
  "video/quicktime": "video/quicktime",
  "video/mov": "video/quicktime",
  "video/x-m4v": "video/x-m4v",
  "video/m4v": "video/x-m4v",
  "video/webm": "video/webm",
};

export function baseMimeType(value: string | null | undefined): string {
  return (value ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

export function extensionFromFileName(fileName: string | null | undefined): string | null {
  const cleanName = (fileName ?? "").split(/[?#]/)[0]?.trim().toLowerCase() ?? "";
  const match = /\.([a-z0-9]+)$/.exec(cleanName);
  return match?.[1] ?? null;
}

export function imageMimeTypeForUpload(
  mimeType: string | null | undefined,
  fileName?: string | null,
): string | null {
  const declared = baseMimeType(mimeType);
  if (!declared || declared === GENERIC_UPLOAD_MIME_TYPE) {
    const ext = extensionFromFileName(fileName);
    if (!ext) return GENERIC_UPLOAD_MIME_TYPE;
    return IMAGE_MIME_BY_EXTENSION[ext] ?? null;
  }
  return IMAGE_MIME_ALIASES[declared] ?? null;
}

export function videoMimeTypeForUpload(
  mimeType: string | null | undefined,
  fileName?: string | null,
): string | null {
  const declared = baseMimeType(mimeType);
  if (!declared || declared === GENERIC_UPLOAD_MIME_TYPE) {
    const ext = extensionFromFileName(fileName);
    if (!ext) return GENERIC_UPLOAD_MIME_TYPE;
    return VIDEO_MIME_BY_EXTENSION[ext] ?? null;
  }
  return VIDEO_MIME_ALIASES[declared] ?? null;
}

export function imageExtensionForMimeType(mimeType: string): string {
  const normalized = imageMimeTypeForUpload(mimeType);
  if (normalized === "image/png") return "png";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/heic") return "heic";
  if (normalized === "image/heif") return "heif";
  if (normalized === "image/jpeg") return "jpg";
  return "bin";
}

export function videoExtensionForMimeType(mimeType: string): string {
  const normalized = videoMimeTypeForUpload(mimeType);
  if (normalized === "video/quicktime") return "mov";
  if (normalized === "video/x-m4v") return "m4v";
  if (normalized === "video/mp4") return "mp4";
  if (normalized === "video/webm") return "webm";
  return "bin";
}

export function uploadFileNameForMimeType(
  kind: "image" | "video",
  prefix: string,
  mimeType: string,
  originalName?: string | null,
): string {
  const originalExt = extensionFromFileName(originalName);
  const originalMime =
    kind === "image"
      ? originalExt ? IMAGE_MIME_BY_EXTENSION[originalExt] : null
      : originalExt ? VIDEO_MIME_BY_EXTENSION[originalExt] : null;
  const normalizedMime =
    kind === "image"
      ? imageMimeTypeForUpload(mimeType)
      : videoMimeTypeForUpload(mimeType);
  if (originalExt && originalMime && originalMime === normalizedMime) {
    return `${prefix}.${originalExt}`;
  }

  const ext = kind === "image" ? imageExtensionForMimeType(mimeType) : videoExtensionForMimeType(mimeType);
  return `${prefix}.${ext}`;
}
