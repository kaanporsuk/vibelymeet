export type MediaCaptionCue = {
  startMs?: number;
  endMs?: number;
  text: string;
};

export type MediaCaptions =
  | string
  | {
      text?: string;
      cues?: MediaCaptionCue[];
      language?: string;
    };

export const MEDIA_CAPTIONS_MAX_TEXT_LENGTH = 5_000;
export const MEDIA_CAPTIONS_MAX_LANGUAGE_LENGTH = 16;
export const MEDIA_CAPTIONS_MAX_CUES = 120;
export const MEDIA_CAPTIONS_MAX_CUE_TEXT_LENGTH = 1_000;

function cleanCaptionText(value: unknown, maxLength = MEDIA_CAPTIONS_MAX_TEXT_LENGTH): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ");
  if (!text || text.length > maxLength) return null;
  return text;
}

function truncateText(value: string, maxLength: number): string {
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength).trim();
}

function cleanCaptionLanguage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const language = value.trim().slice(0, MEDIA_CAPTIONS_MAX_LANGUAGE_LENGTH);
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,2}$/i.test(language) ? language : undefined;
}

function cleanCaptionMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

export function cleanWebVttCueText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/\r?\n/g, " ")
    .replace(/-->/g, "->")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseMediaCaptions(value: unknown): MediaCaptions | null {
  const direct = cleanCaptionText(value);
  if (direct) return truncateText(direct, MEDIA_CAPTIONS_MAX_TEXT_LENGTH);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const input = value as { text?: unknown; cues?: unknown; language?: unknown };
  const text = cleanCaptionText(input.text);
  const language = cleanCaptionLanguage(input.language);
  if (input.language != null && !language) return null;
  if (Array.isArray(input.cues) && input.cues.length > MEDIA_CAPTIONS_MAX_CUES) return null;
  const cuesInput = Array.isArray(input.cues) ? input.cues : [];
  const cues: MediaCaptionCue[] = [];

  for (const cue of cuesInput) {
    if (!cue || typeof cue !== "object" || Array.isArray(cue)) return null;
    const cueInput = cue as { startMs?: unknown; endMs?: unknown; text?: unknown };
    const cueText = cleanCaptionText(cueInput.text, MEDIA_CAPTIONS_MAX_CUE_TEXT_LENGTH);
    if (!cueText) return null;
    const startMs = cleanCaptionMs(cueInput.startMs);
    const endMs = cleanCaptionMs(cueInput.endMs);
    if (cueInput.startMs != null && startMs == null) return null;
    if (cueInput.endMs != null && endMs == null) return null;
    if (startMs != null && endMs != null && endMs <= startMs) return null;
    cues.push({
      text: truncateText(cueText, MEDIA_CAPTIONS_MAX_CUE_TEXT_LENGTH),
      ...(startMs != null ? { startMs } : {}),
      ...(endMs != null && (startMs == null || endMs > startMs) ? { endMs } : {}),
    });
  }

  if (!text && cues.length === 0) return null;
  return {
    ...(text ? { text } : {}),
    ...(cues.length > 0 ? { cues } : {}),
    ...(language ? { language } : {}),
  };
}

export function mediaCaptionLanguage(captions: unknown): string | undefined {
  const parsed = parseMediaCaptions(captions);
  if (!parsed || typeof parsed === "string") return undefined;
  return parsed.language;
}

export function captionTextFromMediaCaptions(captions: unknown): string | null {
  const parsed = parseMediaCaptions(captions);
  const direct = cleanCaptionText(parsed);
  if (direct) return direct;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const text = cleanCaptionText(parsed.text);
  if (text) return text;
  const cues = parsed.cues;
  if (!Array.isArray(cues)) return null;
  const cueText = cues
    .map((cue) => cleanCaptionText(cue.text))
    .filter((value): value is string => !!value)
    .join(" ");
  return cueText || null;
}

function webVttTimestamp(ms: number): string {
  const safeMs = Math.max(0, Math.floor(ms));
  const hours = Math.floor(safeMs / 3_600_000);
  const minutes = Math.floor((safeMs % 3_600_000) / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1000);
  const millis = safeMs % 1000;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}.${millis.toString().padStart(3, "0")}`;
}

export function mediaCaptionsToWebVtt(captions: unknown, durationMs: number): string | null {
  const fallbackDurationMs = Math.max(1_000, Number.isFinite(durationMs) ? durationMs : 60_000);
  const parsed = parseMediaCaptions(captions);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    if (Array.isArray(parsed.cues) && parsed.cues.length > 0) {
      const body = parsed.cues
        .map((cue, index) => {
          const text = cleanCaptionText(cue.text);
          if (!text) return null;
          const startMs = typeof cue.startMs === "number" ? cue.startMs : 0;
          const endMs = typeof cue.endMs === "number" ? cue.endMs : fallbackDurationMs;
          return `${index + 1}\n${webVttTimestamp(startMs)} --> ${webVttTimestamp(Math.max(startMs + 250, endMs))}\n${cleanWebVttCueText(text)}`;
        })
        .filter((cue): cue is string => !!cue)
        .join("\n\n");
      return body ? `WEBVTT\n\n${body}\n` : null;
    }
  }

  const text = captionTextFromMediaCaptions(parsed);
  return text ? `WEBVTT\n\n1\n00:00:00.000 --> ${webVttTimestamp(fallbackDurationMs)}\n${cleanWebVttCueText(text)}\n` : null;
}
