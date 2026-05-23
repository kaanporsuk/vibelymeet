/**
 * Media lifecycle helpers for Edge Functions.
 *
 * Provides typed constants and helper functions that Edge Functions use to
 * interact with the media_assets / media_references / media_delete_jobs
 * tables via service-role Supabase client.
 *
 * Sprint 2/3: used by profile media, chat media, and account-deletion helpers
 * for dual-write / lifecycle coordination while legacy product contracts remain active.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Provider identifiers used in media_assets.provider */
export const PROVIDERS = {
  BUNNY_STREAM: "bunny_stream",
  BUNNY_STORAGE: "bunny_storage",
  SUPABASE_STORAGE: "supabase_storage",
} as const;

/** Media family identifiers used in media_assets.media_family / media_retention_settings */
export const MEDIA_FAMILIES = {
  VIBE_VIDEO: "vibe_video",
  PROFILE_PHOTO: "profile_photo",
  EVENT_COVER: "event_cover",
  CHAT_IMAGE: "chat_image",
  CHAT_VIDEO: "chat_video",
  VOICE_MESSAGE: "voice_message",
  CHAT_VIDEO_THUMBNAIL: "chat_video_thumbnail",
  VERIFICATION_SELFIE: "verification_selfie",
} as const;

/** Reference types used in media_references.ref_type */
export const REF_TYPES = {
  PROFILE_VIBE_VIDEO: "profile_vibe_video",
  PROFILE_PHOTO_SLOT: "profile_photo_slot",
  PROFILE_AVATAR: "profile_avatar",
  MESSAGE_ATTACHMENT: "message_attachment",
  CHAT_PARTICIPANT_RETENTION: "chat_participant_retention",
  EVENT_COVER: "event_cover",
  VERIFICATION_SELFIE: "verification_selfie",
  VERIFICATION_REFERENCE: "verification_reference",
} as const;

/** Release reasons used in media_references.released_by */
export const RELEASE_REASONS = {
  USER_ACTION: "user_action",
  REPLACE: "replace",
  UNMATCH: "unmatch",
  ACCOUNT_DELETE: "account_delete",
  ADMIN: "admin",
} as const;

// ─── Admin service client ───────────────────────────────────────────────────

export function getAdminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// ─── Asset registration ─────────────────────────────────────────────────────

export interface RegisterAssetParams {
  provider: string;
  mediaFamily: string;
  ownerUserId: string;
  providerObjectId?: string | null;
  providerPath?: string | null;
  mimeType?: string | null;
  bytes?: number | null;
  contentSha256?: string | null;
  legacyTable?: string | null;
  legacyId?: string | null;
  status?: "uploading" | "uploaded" | "active" | "soft_deleted";
}

/**
 * Register a new media asset. Returns the asset ID.
 * Designed for use in upload Edge Functions after a successful provider upload.
 *
 * Sprint 2/3 integrate this into existing upload functions.
 */
export async function registerMediaAsset(
  admin: SupabaseClient,
  params: RegisterAssetParams,
): Promise<{ success: boolean; assetId?: string; created?: boolean; error?: string }> {
  if (!params.providerObjectId && !params.providerPath) {
    return { success: false, error: "providerObjectId or providerPath is required" };
  }

  const { data, error } = await admin.rpc("upsert_media_asset", {
    p_provider: params.provider,
    p_media_family: params.mediaFamily,
    p_owner_user_id: params.ownerUserId,
    p_provider_object_id: params.providerObjectId ?? null,
    p_provider_path: params.providerPath ?? null,
    p_mime_type: params.mimeType ?? null,
    p_bytes: params.bytes ?? null,
    p_content_sha256: params.contentSha256 ?? null,
    p_status: params.status ?? "active",
    p_legacy_table: params.legacyTable ?? null,
    p_legacy_id: params.legacyId ?? null,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  const result = data as Record<string, unknown> | null;
  if (!result?.success) {
    return {
      success: false,
      error: typeof result?.error === "string" ? result.error : "media_asset_upsert_failed",
    };
  }

  const assetId = typeof result.asset_id === "string" ? result.asset_id : null;
  if (!assetId) {
    return { success: false, error: "media_asset_upsert_missing_id" };
  }

  return {
    success: true,
    assetId,
    created: result.created === true,
  };
}

// ─── Reference management ───────────────────────────────────────────────────

export interface CreateReferenceParams {
  assetId: string;
  refType: string;
  refTable: string;
  refId: string;
  refKey?: string | null;
}

/**
 * Create an active reference from a product entity to a media asset.
 */
export async function createMediaReference(
  admin: SupabaseClient,
  params: CreateReferenceParams,
): Promise<{ success: boolean; referenceId?: string; error?: string }> {
  const { data, error } = await admin.rpc("attach_media_reference", {
    p_asset_id: params.assetId,
    p_ref_type: params.refType,
    p_ref_table: params.refTable,
    p_ref_id: params.refId,
    p_ref_key: params.refKey ?? null,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  const result = data as Record<string, unknown> | null;
  if (!result?.success) {
    return {
      success: false,
      error: typeof result?.error === "string" ? result.error : "media_reference_attach_failed",
    };
  }

  const referenceId = typeof result.reference_id === "string" ? result.reference_id : null;
  if (!referenceId) {
    return { success: false, error: "media_reference_attach_missing_id" };
  }

  return { success: true, referenceId };
}

/**
 * Release a media reference and let the DB RPC handle asset lifecycle transition.
 */
export async function releaseMediaReference(
  admin: SupabaseClient,
  referenceId: string,
  releasedBy: string = "user_action",
): Promise<{ success: boolean; assetTransitioned?: boolean; error?: string }> {
  const { data, error } = await admin.rpc("release_media_reference", {
    p_reference_id: referenceId,
    p_released_by: releasedBy,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  const result = data as Record<string, unknown>;
  return {
    success: result?.success === true,
    assetTransitioned: result?.asset_transitioned === true,
    error: result?.error as string | undefined,
  };
}

export async function syncChatMessageMedia(
  admin: SupabaseClient,
  messageId: string,
): Promise<{ success: boolean; assetsSynced?: number; refsCreated?: number; refsReactivated?: number; error?: string }> {
  const { data, error } = await admin.rpc("sync_chat_message_media", {
    p_message_id: messageId,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  const result = data as Record<string, unknown> | null;
  return {
    success: result?.success === true,
    assetsSynced: typeof result?.assets_synced === "number" ? result.assets_synced as number : undefined,
    refsCreated: typeof result?.refs_created === "number" ? result.refs_created as number : undefined,
    refsReactivated: typeof result?.refs_reactivated === "number" ? result.refs_reactivated as number : undefined,
    error: typeof result?.error === "string" ? result.error : undefined,
  };
}

export async function applyAccountDeletionMediaHold(
  admin: SupabaseClient,
  userId: string,
): Promise<{ success: boolean; matchesTouched?: number; refsReleased?: number; error?: string }> {
  const { data, error } = await admin.rpc("apply_account_deletion_media_hold", {
    p_user_id: userId,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  const result = data as Record<string, unknown> | null;
  return {
    success: result?.success === true,
    matchesTouched:
      typeof result?.matches_touched === "number" ? result.matches_touched as number : undefined,
    refsReleased:
      typeof result?.refs_released === "number" ? result.refs_released as number : undefined,
    error: typeof result?.error === "string" ? result.error : undefined,
  };
}

export async function cancelAccountDeletionMediaHold(
  admin: SupabaseClient,
  userId: string,
): Promise<{
  success: boolean;
  matchesTouched?: number;
  refsCreated?: number;
  refsReactivated?: number;
  assetsReactivated?: number;
  error?: string;
}> {
  const { data, error } = await admin.rpc("cancel_account_deletion_media_hold", {
    p_user_id: userId,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  const result = data as Record<string, unknown> | null;
  return {
    success: result?.success === true,
    matchesTouched:
      typeof result?.matches_touched === "number" ? result.matches_touched as number : undefined,
    refsCreated:
      typeof result?.refs_created === "number" ? result.refs_created as number : undefined,
    refsReactivated:
      typeof result?.refs_reactivated === "number" ? result.refs_reactivated as number : undefined,
    assetsReactivated:
      typeof result?.assets_reactivated === "number" ? result.assets_reactivated as number : undefined,
    error: typeof result?.error === "string" ? result.error : undefined,
  };
}

// ─── Media model mapping documentation ──────────────────────────────────────
//
// This section documents how existing Vibely tables map to the canonical media
// model. draft_media_sessions remains listed for historical traceability only;
// new Sprint 4+ uploads use media_upload_receipts, media_assets,
// media_references, vibe_video_uploads, and profile_vibe_videos.
//
// ┌─────────────────────────────┬──────────────────┬──────────────────────────┬─────────────────────────┐
// │ Legacy surface              │ Provider         │ Media family             │ Reference type          │
// ├─────────────────────────────┼──────────────────┼──────────────────────────┼─────────────────────────┤
// │ profiles.bunny_video_uid    │ bunny_stream     │ vibe_video               │ profile_vibe_video      │
// │ profiles.photos[n]          │ bunny_storage    │ profile_photo            │ profile_photo_slot      │
// │ profiles.avatar_url         │ bunny_storage    │ profile_photo            │ profile_avatar          │
// │ chat media by participant   │ bunny_storage    │ chat_*                   │ chat_participant_retention │
// │ events.cover_image          │ bunny_storage    │ event_cover              │ event_cover             │
// │ photo_verifications.selfie  │ bunny_storage    │ verification_selfie      │ verification_selfie     │
// │ draft_media_sessions        │ bunny_*          │ (legacy compatibility)   │ (no new source writes)   │
// └─────────────────────────────┴──────────────────┴──────────────────────────┴─────────────────────────┘
//
// Backfill strategy (Sprint 2):
//   1. Scan profiles with non-null bunny_video_uid → insert media_asset + reference
//   2. Scan profiles.photos[] arrays → insert media_asset + reference per slot
//   3. Scan chat messages with image/video/audio payloads → insert media_asset + participant retention refs
//   4. Scan events with non-null cover_image → insert media_asset + reference
//   5. Mark all backfilled assets with legacy_table + legacy_id for traceability
//
// Compatibility:
//   - Existing surfaces may still read published snapshot columns (profiles.photos, etc.)
//   - New uploads write canonical media state first, then update published snapshots
//   - draft_media_sessions/RPCs are compatibility-only for old in-flight uploads
//   - Source of truth for media lifecycle = media_assets/media_references/family tables
