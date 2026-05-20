export function telemetrySafeSourceRef(value: string | null | undefined): string {
  if (!value) return "none";
  if (/^https?:\/\//i.test(value)) return "remote_url";
  if (/^(blob:|file:|content:|assets-library:|ph:|data:)/i.test(value)) return "local_media";
  if (value.startsWith("bunny_stream:")) return "bunny_stream_ref";
  if (value.startsWith("bunny_storage:")) return "bunny_storage_ref";
  if (value.startsWith("profile_vibe_video:")) return "profile_vibe_video_ref";
  if (value.startsWith("encrypted_chat_media:")) return "encrypted_chat_media_ref";
  return "opaque_ref";
}
