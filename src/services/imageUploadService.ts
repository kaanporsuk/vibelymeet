import { createMediaClientRequestId } from "@clientShared/media-sdk";
import { rememberImageDerivatives } from "@/utils/imageUrl";
import { encode as encodeBlurhash } from "blurhash";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export type UploadImageContext = "onboarding" | "profile_studio" | "chat";

export type UploadImageToBunnyResult = {
  path: string;
  sessionId: string | null;
  url?: string | null;
  assetId?: string | null;
  contentSha256?: string | null;
  receiptId?: string | null;
  placeholder?: {
    kind: "dominant_color" | "blurhash";
    hash: string;
    dominantColor: string | null;
  } | null;
  derivatives?: {
    thumb?: string;
    hero?: string;
  } | null;
};

const uploadClientRequestIds = new WeakMap<File, Map<string, string>>();

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

async function derivativeFileForImage(file: File, maxEdge: number, label: "thumb" | "hero"): Promise<File | null> {
  if (!file.type.startsWith("image/") || file.type === "image/heic" || file.type === "image/heif") return null;
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return null;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap || bitmap.width <= 0 || bitmap.height <= 0) return null;
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, "image/jpeg", label === "thumb" ? 0.78 : 0.84);
    if (!blob || blob.size <= 0) return null;
    const baseName = file.name.replace(/\.[^.]+$/i, "") || "photo";
    return new File([blob], `${baseName}-${label}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
  } finally {
    bitmap.close();
  }
}

async function dominantColorForImage(file: File): Promise<string | null> {
  if (!file.type.startsWith("image/") || file.type === "image/heic" || file.type === "image/heif") return null;
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return null;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap || bitmap.width <= 0 || bitmap.height <= 0) return null;
  try {
    const edge = 24;
    const canvas = document.createElement("canvas");
    canvas.width = edge;
    canvas.height = edge;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, edge, edge);
    const { data } = ctx.getImageData(0, 0, edge, edge);
    let red = 0;
    let green = 0;
    let blue = 0;
    let alphaTotal = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] / 255;
      if (alpha <= 0.05) continue;
      red += data[i] * alpha;
      green += data[i + 1] * alpha;
      blue += data[i + 2] * alpha;
      alphaTotal += alpha;
    }
    if (alphaTotal <= 0) return null;
    const toHex = (value: number) => Math.max(0, Math.min(255, Math.round(value / alphaTotal)))
      .toString(16)
      .padStart(2, "0");
    return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
  } finally {
    bitmap.close();
  }
}

export async function imagePlaceholderForImage(file: File): Promise<{
  kind: "blurhash" | "dominant_color";
  hash: string;
  dominantColor: string;
} | null> {
  if (!file.type.startsWith("image/") || file.type === "image/heic" || file.type === "image/heif") return null;
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return null;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap || bitmap.width <= 0 || bitmap.height <= 0) return null;
  try {
    const maxEdge = 32;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    let red = 0;
    let green = 0;
    let blue = 0;
    let alphaTotal = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] / 255;
      if (alpha <= 0.05) continue;
      red += data[i] * alpha;
      green += data[i + 1] * alpha;
      blue += data[i + 2] * alpha;
      alphaTotal += alpha;
    }
    if (alphaTotal <= 0) return null;
    const toHex = (value: number) => Math.max(0, Math.min(255, Math.round(value / alphaTotal)))
      .toString(16)
      .padStart(2, "0");
    const dominantColor = `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
    const componentX = Math.max(1, Math.min(4, width));
    const componentY = Math.max(1, Math.min(4, height, Math.round(componentX * (height / width))));
    const blurhash = encodeBlurhash(data, width, height, componentX, componentY);
    return { kind: "blurhash", hash: blurhash, dominantColor };
  } catch {
    const dominantColor = await dominantColorForImage(file);
    return dominantColor ? { kind: "dominant_color", hash: dominantColor, dominantColor } : null;
  } finally {
    bitmap.close();
  }
}

async function appendImageDerivatives(formData: FormData, file: File): Promise<void> {
  try {
    const [thumb, hero, placeholder] = await Promise.all([
      derivativeFileForImage(file, 420, "thumb"),
      derivativeFileForImage(file, 1400, "hero"),
      imagePlaceholderForImage(file),
    ]);
    if (thumb && hero) {
      formData.append("derivative_thumb", thumb);
      formData.append("derivative_hero", hero);
    }
    if (placeholder) {
      formData.append("placeholder_kind", placeholder.kind);
      formData.append("placeholder_hash", placeholder.hash);
      formData.append("dominant_color", placeholder.dominantColor);
    }
  } catch {
    // Derivatives are an acceleration layer; never block the canonical upload.
  }
}

export function newUploadClientRequestId(): string {
  return createMediaClientRequestId();
}

export function clientRequestIdForUploadFile(file: File, scope: string): string {
  let scopedIds = uploadClientRequestIds.get(file);
  if (!scopedIds) {
    scopedIds = new Map();
    uploadClientRequestIds.set(file, scopedIds);
  }

  const stableScope = scope.trim() || "default";
  const existing = scopedIds.get(stableScope);
  if (existing) return existing;

  const next = newUploadClientRequestId();
  scopedIds.set(stableScope, next);
  return next;
}

/**
 * @deprecated Use uploadImageWithMediaSdk so durable queueing, reconciliation,
 * and receipt telemetry remain active. This remains as the SDK delegate.
 */
export async function uploadImageToBunny(
  file: File,
  accessToken: string,
  context?: UploadImageContext,
  matchId?: string,
  clientRequestId?: string,
): Promise<UploadImageToBunnyResult> {
  const formData = new FormData();
  formData.append("file", file);
  await appendImageDerivatives(formData, file);
  if (context) {
    formData.append("context", context);
  }
  if (context === "chat" && matchId) {
    formData.append("match_id", matchId);
  }
  const stableClientRequestId = clientRequestId?.trim();
  if (stableClientRequestId) {
    formData.append("client_request_id", stableClientRequestId);
  }

  let data: {
    success?: boolean;
    path?: string;
    url?: string | null;
    assetId?: string | null;
    contentSha256?: string | null;
    receiptId?: string | null;
    sessionId?: string | null;
    placeholder?: UploadImageToBunnyResult["placeholder"];
    derivatives?: UploadImageToBunnyResult["derivatives"];
    error?: string;
  };
  try {
    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/upload-image`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(stableClientRequestId ? { "x-client-request-id": stableClientRequestId } : {}),
          // Note: do NOT set Content-Type here — browser sets it with boundary for FormData
        },
        body: formData,
      }
    );

    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      console.error("[uploadImageToBunny] Non-JSON response:", text.slice(0, 200));
      throw new Error("Upload service unavailable. Please try again.");
    }
  } catch (fetchErr) {
    if (fetchErr instanceof Error && fetchErr.message.includes("unavailable")) throw fetchErr;
    throw new Error("Network error during upload. Check your connection.");
  }

  if (!data.success) {
    throw new Error(data.error || "Image upload failed");
  }

  if (!data.path) {
    throw new Error("Image upload failed");
  }

  rememberImageDerivatives(data.path, data.derivatives);

  return {
    path: data.path,
    sessionId: data.sessionId ?? null,
    url: data.url ?? null,
    assetId: data.assetId ?? null,
    contentSha256: data.contentSha256 ?? null,
    receiptId: data.receiptId ?? null,
    placeholder: data.placeholder ?? null,
    derivatives: data.derivatives ?? null,
  };
}
