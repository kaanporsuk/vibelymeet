import { capture, type PosthogEvent } from "./posthog.ts";

type MediaTelemetryPrimitive = string | number | boolean | null | undefined;
export type MediaTelemetryProperties = Record<string, MediaTelemetryPrimitive | unknown>;

const SENSITIVE_KEY_PATTERN =
  /(auth|authorization|bearer|token|secret|signature|url|uri|path|hostname|host|apikey|accesskey|(?:^|_)(?:file|filename)(?:$|_)|headers?)/i;

const SENSITIVE_EXACT_KEYS = new Set([
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

const SENSITIVE_ID_KEY_PATTERN =
  /(^|_)(?:actor|asset|job|match|media_asset|message|profile|provider_object|receipt|requester|sender|target_profile|upload|user|viewer)_(?:id|guid|hash)$/i;

const SENSITIVE_CAMEL_ID_KEY_PATTERN =
  /^(actor|asset|job|match|mediaAsset|message|profile|providerObject|receipt|requester|sender|targetProfile|upload|user|viewer)(Id|Guid|Hash)$/;

export type MediaTelemetrySanitizeOptions = {
  defaults?: MediaTelemetryProperties;
  allowSensitiveKeys?: readonly string[];
};

function isPresenceOrConfigKey(key: string, value: unknown): boolean {
  if (typeof value !== "boolean") return false;
  return key.endsWith("_present") || key.endsWith("_configured") || key.startsWith("has_");
}

function isSensitiveTelemetryKey(key: string): boolean {
  if (SENSITIVE_EXACT_KEYS.has(key)) return true;
  if (SENSITIVE_KEY_PATTERN.test(key)) return true;
  if (SENSITIVE_ID_KEY_PATTERN.test(key)) return true;
  if (SENSITIVE_CAMEL_ID_KEY_PATTERN.test(key)) return true;
  if (/(^|_)(?:sha256|checksum|digest|hash)$/i.test(key)) return true;
  return false;
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
      if (
        isSensitiveTelemetryKey(key) &&
        !allowedSensitiveKeys.has(key) &&
        !isPresenceOrConfigKey(key, value)
      ) {
        continue;
      }
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
        out[key] = value;
      }
    }
  }

  return out;
}

export async function captureMediaTelemetry(
  event: PosthogEvent & {
    properties?: MediaTelemetryProperties;
    allowSensitiveKeys?: readonly string[];
  },
): Promise<void> {
  await capture({
    event: event.event,
    distinct_id: event.distinct_id,
    properties: sanitizeMediaTelemetryProperties(event.properties, {
      defaults: { feature: "media-sdk" },
      allowSensitiveKeys: event.allowSensitiveKeys,
    }),
  });
}
