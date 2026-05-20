export const MEDIA_STORAGE_PRESIGN_PHASE = "phase_8_bunny_storage_presign_followup" as const;
export const MEDIA_STORAGE_PRESIGN_DECIDED_AT = "2026-05-20" as const;
export const MEDIA_STORAGE_PRESIGN_REVIEW_AFTER = "2026-11-20" as const;
export const MEDIA_STORAGE_PRESIGN_PRODUCTION_ENABLED = false as const;
export const MEDIA_STORAGE_PRESIGN_SOURCE_OF_TRUTH =
  "edge_function_put_with_server_sha256_receipts_and_bunny_checksum" as const;

export type MediaStoragePresignDecision = "no_go_documented_api_gap";

export type MediaStoragePresignPolicy = {
  readonly phase: typeof MEDIA_STORAGE_PRESIGN_PHASE;
  readonly decidedAt: typeof MEDIA_STORAGE_PRESIGN_DECIDED_AT;
  readonly reviewAfter: typeof MEDIA_STORAGE_PRESIGN_REVIEW_AFTER;
  readonly productionCutover: MediaStoragePresignDecision;
  readonly productionEnabled: false;
  readonly sourceOfTruth: typeof MEDIA_STORAGE_PRESIGN_SOURCE_OF_TRUTH;
  readonly blockingReason: string;
  readonly protectedFamilies: readonly ["chat_image", "voice_message", "profile_photo", "event_cover"];
  readonly requiredIfReopened: readonly string[];
};

export const MEDIA_STORAGE_PRESIGN_POLICY: MediaStoragePresignPolicy = {
  phase: MEDIA_STORAGE_PRESIGN_PHASE,
  decidedAt: MEDIA_STORAGE_PRESIGN_DECIDED_AT,
  reviewAfter: MEDIA_STORAGE_PRESIGN_REVIEW_AFTER,
  productionCutover: "no_go_documented_api_gap",
  productionEnabled: MEDIA_STORAGE_PRESIGN_PRODUCTION_ENABLED,
  sourceOfTruth: MEDIA_STORAGE_PRESIGN_SOURCE_OF_TRUTH,
  blockingReason:
    "Bunny Edge Storage documents server-authorized AccessKey PUT uploads, not S3-style direct presigned upload URLs.",
  protectedFamilies: ["chat_image", "voice_message", "profile_photo", "event_cover"],
  requiredIfReopened: [
    "Documented Bunny Storage direct-upload presign API with no client storage credential exposure.",
    "Server-side receipt reservation and content hash binding before client upload begins.",
    "Provider checksum or equivalent end-to-end integrity verification.",
    "No regression to upload-image, upload-voice, or upload-event-cover idempotency contracts.",
  ],
};

export function shouldEnableBunnyStoragePresignUploads(): false {
  return MEDIA_STORAGE_PRESIGN_PRODUCTION_ENABLED;
}

export function getMediaStoragePresignPolicy(): MediaStoragePresignPolicy {
  return MEDIA_STORAGE_PRESIGN_POLICY;
}

export function mediaStoragePresignPolicyReviewWarning(nowMs = Date.now()): string | null {
  const reviewAfterMs = Date.parse(`${MEDIA_STORAGE_PRESIGN_POLICY.reviewAfter}T23:59:59.999Z`);
  if (!Number.isFinite(reviewAfterMs) || nowMs <= reviewAfterMs) return null;
  return `Phase 8 Bunny Storage presign decision review is overdue; review_after=${MEDIA_STORAGE_PRESIGN_POLICY.reviewAfter}`;
}
