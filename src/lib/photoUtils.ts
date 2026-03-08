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
