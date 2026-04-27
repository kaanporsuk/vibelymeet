type VibeVideoLogLevel = "info" | "warn" | "error";
type SafeLogValue = string | number | boolean | null | undefined;
type VibeVideoLogFields = Record<string, SafeLogValue>;

const SENSITIVE_KEY_PATTERN =
  /(auth|authorization|bearer|token|secret|signature|apikey|accesskey|headers?|url|uri|path|(?:^|_)(?:file|filename)(?:$|_))/i;

function sanitizeFields(fields: VibeVideoLogFields = {}): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      out[key] = value;
    }
  }
  return out;
}

export function logVibeVideo(
  level: VibeVideoLogLevel,
  event: string,
  fields: VibeVideoLogFields = {},
): void {
  const payload = JSON.stringify({
    scope: "vibe_video",
    event,
    ...sanitizeFields(fields),
  });

  if (level === "error") {
    console.error(payload);
  } else if (level === "warn") {
    console.warn(payload);
  } else {
    console.log(payload);
  }
}
