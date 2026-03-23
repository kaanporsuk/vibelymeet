/**
 * Chat text `content` helpers — no `image_url` column; we tag image sends in-band.
 */

export const CHAT_IMAGE_MESSAGE_PREFIX = '__IMAGE__|';

/** Returns image URL when this text should render as a photo bubble. */
export function parseChatImageMessageContent(content: string): string | null {
  const t = content.trim();
  if (t.startsWith(CHAT_IMAGE_MESSAGE_PREFIX)) {
    const u = t.slice(CHAT_IMAGE_MESSAGE_PREFIX.length).trim();
    if (/^https?:\/\//i.test(u)) return u;
    return null;
  }
  // Legacy / plain URL-only photo sends (Supabase storage or CDN)
  if (/^https?:\/\/\S+$/i.test(t) && /\.(jpe?g|png|gif|webp)(\?|#|$)/i.test(t)) {
    return t;
  }
  return null;
}

export function formatChatImageMessageContent(publicUrl: string): string {
  return `${CHAT_IMAGE_MESSAGE_PREFIX}${publicUrl}`;
}
