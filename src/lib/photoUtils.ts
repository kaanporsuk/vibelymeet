import { getImageUrl } from "@/utils/imageUrl";

/**
 * Resolves any photo value to a displayable URL.
 * Delegates to getImageUrl which handles Bunny CDN paths,
 * full URLs (http/blob/data), and fallbacks.
 *
 * @deprecated Prefer importing getImageUrl / avatarUrl / thumbnailUrl
 * directly from "@/utils/imageUrl" for size-optimised variants.
 */
export const resolvePhotoUrl = (photo: string | null | undefined): string => {
  if (!photo || photo.trim() === "") return "";
  return getImageUrl(photo.trim());
};

/**
 * Resolves an array of photo values.
 */
export const resolvePhotoUrls = (photos: (string | null)[] | null): string[] => {
  if (!photos) return [];
  return photos.map(p => resolvePhotoUrl(p)).filter(url => url !== "");
};

/** HTML `accept` for profile photo pickers — excludes HEIC/HEIF and other non-web-safe types. */
export const PROFILE_PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";

/** Validates Files from `<input type="file">` or drag/drop for profile photo uploads. */
export function isAllowedProfilePhotoUploadFile(file: File): boolean {
  const type = (file.type || "").toLowerCase().trim();
  const name = file.name.toLowerCase();
  if (
    type === "image/heic" ||
    type === "image/heif" ||
    name.endsWith(".heic") ||
    name.endsWith(".heif")
  ) {
    return false;
  }
  const allowed = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
  if (allowed.has(type)) return true;
  if (!type || type === "application/octet-stream") {
    return /\.(jpe?g|png|webp)$/i.test(file.name);
  }
  return false;
}
