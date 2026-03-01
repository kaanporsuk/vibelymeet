const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";

/**
 * Resolves any photo value to a displayable URL.
 * Handles: full URLs, storage paths, relative paths, null/empty.
 */
export const resolvePhotoUrl = (photo: string | null | undefined): string => {
  if (!photo || photo.trim() === "") return "";

  const trimmed = photo.trim();

  // Already a full URL (http/https/blob/data)
  if (trimmed.startsWith("http") || trimmed.startsWith("blob:") || trimmed.startsWith("data:")) {
    return trimmed;
  }

  // Remove leading slash
  const cleanPath = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;

  // If it already includes storage path structure
  if (cleanPath.startsWith("storage/")) {
    return `${SUPABASE_URL}/${cleanPath}`;
  }

  // If it starts with a known bucket name, construct full public URL
  if (cleanPath.startsWith("profile-photos/") || cleanPath.startsWith("event-covers/") || cleanPath.startsWith("avatars/")) {
    return `${SUPABASE_URL}/storage/v1/object/public/${cleanPath}`;
  }

  // Fallback: assume it's a path in profile-photos bucket
  return `${SUPABASE_URL}/storage/v1/object/public/profile-photos/${cleanPath}`;
};

/**
 * Resolves an array of photo values.
 */
export const resolvePhotoUrls = (photos: (string | null)[] | null): string[] => {
  if (!photos) return [];
  return photos.map(p => resolvePhotoUrl(p)).filter(url => url !== "");
};
