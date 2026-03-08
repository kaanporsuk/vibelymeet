const BUNNY_CDN = `https://${import.meta.env.VITE_BUNNY_CDN_HOSTNAME}`;

interface ImageUrlOptions {
  width?: number;
  height?: number;
  quality?: number;
  crop?: "center" | "top" | "bottom" | "left" | "right";
}

export function getImageUrl(
  path: string | null | undefined,
  opts?: ImageUrlOptions
): string {
  if (!path) return "/placeholder-avatar.png";

  // Already a full URL (blob:, https:, data:) — return as-is
  if (path.startsWith("http") || path.startsWith("blob:") || path.startsWith("data:")) {
    return path;
  }

  const params = new URLSearchParams();
  if (opts?.width) params.set("width", String(opts.width));
  if (opts?.height) params.set("height", String(opts.height));
  if (opts?.crop) params.set("crop_gravity", opts.crop);
  params.set("quality", String(opts?.quality ?? 85));

  return `${BUNNY_CDN}/${path}?${params.toString()}`;
}

// Convenience presets for common use cases
export const avatarUrl = (path: string | null | undefined) =>
  getImageUrl(path, { width: 200, height: 200, crop: "center" });

export const swipeCardUrl = (path: string | null | undefined) =>
  getImageUrl(path, { width: 720, crop: "center" });

export const thumbnailUrl = (path: string | null | undefined) =>
  getImageUrl(path, { width: 400, height: 400, crop: "center" });

export const fullScreenUrl = (path: string | null | undefined) =>
  getImageUrl(path, { width: 1200 });
