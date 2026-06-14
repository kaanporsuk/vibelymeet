export const VIDEO_DATE_REMOTE_SEEN_RENDER_EVIDENCE_SOURCES = [
  "loadeddata",
  "playing",
  "remote_track_mounted",
  "first_remote_frame",
  "request_video_frame_callback",
] as const;

export type VideoDateRemoteSeenRenderEvidenceSource =
  (typeof VIDEO_DATE_REMOTE_SEEN_RENDER_EVIDENCE_SOURCES)[number];

export const VIDEO_DATE_REMOTE_SEEN_PENDING_EVIDENCE_TTL_MS = 180_000;

const renderEvidenceSources = new Set<string>(
  VIDEO_DATE_REMOTE_SEEN_RENDER_EVIDENCE_SOURCES,
);

export function normalizeVideoDateRemoteSeenEvidenceSource(
  source: string,
): string {
  return source.replace(/(?:_owner_ready|_retry_\d+)+$/g, "");
}

export function isVideoDateRemoteSeenRenderEvidenceSource(
  source: string | null | undefined,
): source is VideoDateRemoteSeenRenderEvidenceSource {
  return typeof source === "string" && renderEvidenceSources.has(source);
}

export function buildVideoDateRemoteSeenProviderMissingPayload(input: {
  code: string;
  retryAfterMs: number;
  terminal: boolean;
}): Record<string, unknown> {
  const retryable = !input.terminal;
  return {
    ok: false,
    error: input.code.toLowerCase(),
    code: input.code,
    retryable,
    retry_after_ms: retryable ? input.retryAfterMs : 0,
    provider_presence_required: true,
    provider_presence_missing: true,
    provider_presence_terminal: input.terminal,
  };
}
