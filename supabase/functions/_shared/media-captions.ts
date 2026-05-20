export type NormalizedMediaCaptionCue = {
  text: string;
  startMs?: number;
  endMs?: number;
};

export type NormalizedMediaCaptions =
  | string
  | {
      text?: string;
      language?: string;
      cues?: NormalizedMediaCaptionCue[];
    };

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length > maxLength) return null;
  return text || null;
}

function cleanLanguage(value: unknown): string | undefined {
  const language = cleanText(value, 16);
  return language && /^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,2}$/i.test(language) ? language : undefined;
}

function cleanMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

export function normalizeMediaCaptions(value: unknown): NormalizedMediaCaptions | null {
  const direct = cleanText(value, 5_000);
  if (direct) return direct;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const source = value as Record<string, unknown>;
  const text = cleanText(source.text, 5_000);
  const language = cleanLanguage(source.language);
  if (source.language != null && !language) return null;
  if (Array.isArray(source.cues) && source.cues.length > 120) return null;
  const cuesInput = Array.isArray(source.cues) ? source.cues : [];
  const cues: NormalizedMediaCaptionCue[] = [];
  for (const cue of cuesInput) {
    if (!cue || typeof cue !== "object" || Array.isArray(cue)) return null;
    const cueRecord = cue as Record<string, unknown>;
    const cueText = cleanText(cueRecord.text, 1_000);
    if (!cueText) return null;
    const startMs = cleanMs(cueRecord.startMs);
    const endMs = cleanMs(cueRecord.endMs);
    if (cueRecord.startMs != null && startMs === undefined) return null;
    if (cueRecord.endMs != null && endMs === undefined) return null;
    if (startMs !== undefined && endMs !== undefined && endMs <= startMs) return null;
    cues.push({
      text: cueText,
      ...(startMs !== undefined ? { startMs } : {}),
      ...(endMs !== undefined ? { endMs } : {}),
    });
  }

  if (!text && cues.length === 0) return null;
  return {
    ...(text ? { text } : {}),
    ...(language ? { language } : {}),
    ...(cues.length > 0 ? { cues } : {}),
  };
}
