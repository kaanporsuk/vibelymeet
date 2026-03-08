const BUNNY_CDN = `https://${import.meta.env.VITE_BUNNY_CDN_HOSTNAME}`;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

const PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' fill='%231F1F2E'/%3E%3Ccircle cx='100' cy='80' r='35' fill='%234B4B6B'/%3E%3Cellipse cx='100' cy='160' rx='55' ry='40' fill='%234B4B6B'/%3E%3C/svg%3E";

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
  if (!path || path.trim() === "") return PLACEHOLDER;

  const p = path.trim();

  // Already a full Supabase URL (signed or public) — serve directly
  if (p.includes("supabase.co") || p.includes("supabase.in")) {
    return p;
  }

  // Already a full URL pointing somewhere else (blob:, data:, cdn, etc)
  if (
    p.startsWith("http://") ||
    p.startsWith("https://") ||
    p.startsWith("blob:") ||
    p.startsWith("data:")
  ) {
    return p;
  }

  // Bunny path — starts with "photos/" (new uploads)
  if (p.startsWith("photos/")) {
    const params = new URLSearchParams();
    if (opts?.width) params.set("width", String(opts.width));
    if (opts?.height) params.set("height", String(opts.height));
    if (opts?.crop) params.set("crop_gravity", opts.crop);
    params.set("quality", String(opts?.quality ?? 85));
    return `${BUNNY_CDN}/${p}?${params.toString()}`;
  }

  // Legacy Supabase storage path (relative path, no domain)
  const bucket = p.startsWith("profile-photos/") ? "" : "profile-photos/";
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}${p}`;
}

// Convenience presets
export const avatarUrl = (path: string | null | undefined) =>
  getImageUrl(path, { width: 200, height: 200, crop: "center" });

export const swipeCardUrl = (path: string | null | undefined) =>
  getImageUrl(path, { width: 720, crop: "center" });

export const thumbnailUrl = (path: string | null | undefined) =>
  getImageUrl(path, { width: 400, height: 400, crop: "center" });

export const fullScreenUrl = (path: string | null | undefined) =>
  getImageUrl(path, { width: 1200 });
