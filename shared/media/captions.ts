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

function cleanCaptionText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanWebVttCueText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/\r?\n/g, " ")
    .replace(/-->/g, "->")
    .replace(/\s+/g, " ")
    .trim();
}

export function captionTextFromMediaCaptions(captions: unknown): string | null {
  const direct = cleanCaptionText(captions);
  if (direct) return direct;
  if (!captions || typeof captions !== "object" || Array.isArray(captions)) return null;
  const text = cleanCaptionText((captions as { text?: unknown }).text);
  if (text) return text;
  const cues = (captions as { cues?: unknown }).cues;
  if (!Array.isArray(cues)) return null;
  const cueText = cues
    .map((cue) => (cue && typeof cue === "object" ? cleanCaptionText((cue as { text?: unknown }).text) : null))
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
  if (captions && typeof captions === "object" && !Array.isArray(captions)) {
    const cues = (captions as { cues?: unknown }).cues;
    if (Array.isArray(cues) && cues.length > 0) {
      const body = cues
        .map((cue, index) => {
          if (!cue || typeof cue !== "object") return null;
          const text = cleanCaptionText((cue as { text?: unknown }).text);
          if (!text) return null;
          const startMs = typeof (cue as { startMs?: unknown }).startMs === "number"
            ? (cue as { startMs: number }).startMs
            : 0;
          const endMs = typeof (cue as { endMs?: unknown }).endMs === "number"
            ? (cue as { endMs: number }).endMs
            : fallbackDurationMs;
          return `${index + 1}\n${webVttTimestamp(startMs)} --> ${webVttTimestamp(Math.max(startMs + 250, endMs))}\n${cleanWebVttCueText(text)}`;
        })
        .filter((cue): cue is string => !!cue)
        .join("\n\n");
      return body ? `WEBVTT\n\n${body}\n` : null;
    }
  }

  const text = captionTextFromMediaCaptions(captions);
  return text ? `WEBVTT\n\n1\n00:00:00.000 --> ${webVttTimestamp(fallbackDurationMs)}\n${cleanWebVttCueText(text)}\n` : null;
}
