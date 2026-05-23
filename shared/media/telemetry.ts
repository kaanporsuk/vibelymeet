import { telemetrySafeSourceRef } from "./telemetry-safe-ref";

export type MediaTelemetryValue = string | number | boolean | null | undefined;
export type MediaTelemetryProperties = Record<string, MediaTelemetryValue>;

export const MEDIA_TELEMETRY_SENSITIVE_KEY_PATTERN =
  /(auth|authorization|bearer|token|secret|signature|url|uri|path|hostname|host|(?:^|_)(?:file|filename)(?:$|_)|headers?)/i;

const MEDIA_TELEMETRY_SENSITIVE_EXACT_KEYS = new Set([
  "assetId",
  "asset_id",
  "actorId",
  "actor_id",
  "contentSha256",
  "content_sha256",
  "distinct_id",
  "mediaAssetId",
  "mediaRef",
  "media_asset_id",
  "media_ref",
  "messageId",
  "message_id",
  "jobId",
  "job_id",
  "matchId",
  "match_id",
  "profileId",
  "profile_id",
  "providerObjectId",
  "provider_object_id",
  "requesterId",
  "requester_id",
  "receiptId",
  "receipt_id",
  "signedUrl",
  "signed_url",
  "senderId",
  "sender_id",
  "targetProfileId",
  "target_profile_id",
  "uploadId",
  "upload_id",
  "userId",
  "user_id",
  "viewerId",
  "viewer_id",
  "videoGuid",
  "video_guid",
]);

const MEDIA_TELEMETRY_SENSITIVE_ID_KEY_PATTERN =
  /(^|_)(?:actor|asset|job|match|media_asset|message|profile|provider_object|receipt|requester|sender|target_profile|upload|user|viewer)_(?:id|guid|hash)$/i;

const MEDIA_TELEMETRY_SENSITIVE_CAMEL_ID_KEY_PATTERN =
  /^(actor|asset|job|match|mediaAsset|message|profile|providerObject|receipt|requester|sender|targetProfile|upload|user|viewer)(Id|Guid|Hash)$/;

const MEDIA_TELEMETRY_SAFE_SOURCE_REF_VALUES = new Set([
  "remote_url",
  "local_media",
  "bunny_stream_ref",
  "bunny_storage_ref",
  "profile_vibe_video_ref",
  "encrypted_chat_media_ref",
  "opaque_ref",
  "none",
]);

const MEDIA_TELEMETRY_SAFE_HOSTNAME_SOURCE_KEYS = new Set([
  "stream_hostname_source",
]);

const MEDIA_TELEMETRY_SAFE_HOSTNAME_SOURCE_VALUES = new Set([
  "env",
  "persisted",
  "missing",
]);

export type MediaTelemetrySanitizeOptions = {
  defaults?: MediaTelemetryProperties;
  allowSensitiveKeys?: readonly string[];
};

function isPresenceOrConfigKey(key: string, value: MediaTelemetryValue): boolean {
  if (typeof value !== "boolean") return false;
  return key.endsWith("_present") || key.endsWith("_configured") || key.startsWith("has_");
}

function isSafeHostnameSourceKey(key: string, value: MediaTelemetryValue): boolean {
  return (
    MEDIA_TELEMETRY_SAFE_HOSTNAME_SOURCE_KEYS.has(key) &&
    typeof value === "string" &&
    MEDIA_TELEMETRY_SAFE_HOSTNAME_SOURCE_VALUES.has(value)
  );
}

function isSensitiveTelemetryKey(key: string): boolean {
  if (MEDIA_TELEMETRY_SENSITIVE_EXACT_KEYS.has(key)) return true;
  if (MEDIA_TELEMETRY_SENSITIVE_KEY_PATTERN.test(key)) return true;
  if (MEDIA_TELEMETRY_SENSITIVE_ID_KEY_PATTERN.test(key)) return true;
  if (MEDIA_TELEMETRY_SENSITIVE_CAMEL_ID_KEY_PATTERN.test(key)) return true;
  if (/(^|_)(?:sha256|checksum|digest|hash)$/i.test(key)) return true;
  return false;
}

function sanitizeSourceRefValue(value: MediaTelemetryValue): MediaTelemetryValue {
  if (typeof value !== "string") return value;
  if (MEDIA_TELEMETRY_SAFE_SOURCE_REF_VALUES.has(value)) return value;
  return telemetrySafeSourceRef(value);
}

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
      const normalizedValue = key === "source_ref" || key === "sourceRef" ? sanitizeSourceRefValue(value) : value;
      if (
        isSensitiveTelemetryKey(key) &&
        !allowedSensitiveKeys.has(key) &&
        !isPresenceOrConfigKey(key, normalizedValue) &&
        !isSafeHostnameSourceKey(key, normalizedValue)
      ) {
        continue;
      }
      if (
        typeof normalizedValue === "string" ||
        typeof normalizedValue === "number" ||
        typeof normalizedValue === "boolean" ||
        normalizedValue === null
      ) {
        out[key] = normalizedValue;
      }
    }
  }

  return out;
}
