export type MediaTelemetryValue = string | number | boolean | null | undefined;
export type MediaTelemetryProperties = Record<string, MediaTelemetryValue>;

export const MEDIA_TELEMETRY_SENSITIVE_KEY_PATTERN =
  /(auth|authorization|bearer|token|secret|signature|url|uri|path|(?:^|_)(?:file|filename)(?:$|_)|headers?)/i;

export type MediaTelemetrySanitizeOptions = {
  defaults?: MediaTelemetryProperties;
  allowSensitiveKeys?: readonly string[];
};

export function sanitizeMediaTelemetryProperties(
  properties: MediaTelemetryProperties = {},
  options: MediaTelemetrySanitizeOptions = {},
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  const allowedSensitiveKeys = new Set(options.allowSensitiveKeys ?? []);

  for (const source of [options.defaults, properties]) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) continue;
      if (MEDIA_TELEMETRY_SENSITIVE_KEY_PATTERN.test(key) && !allowedSensitiveKeys.has(key)) continue;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
        out[key] = value;
      }
    }
  }

  return out;
}
