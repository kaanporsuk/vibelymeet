/**
 * Media lifecycle helpers for Edge Functions.
 *
 * Provides typed constants and helper functions that Edge Functions use to
 * interact with the media_assets / media_references / media_delete_jobs
 * tables via service-role Supabase client.
 *
 * Sprint 2: used by profile-photo / vibe-video upload flows for dual-write
 * registration into media_assets while legacy profile columns remain active.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  legacyTable?: string | null;
  legacyId?: string | null;
  status?: "uploading" | "active" | "soft_deleted";
}

/**
 * Register a new media asset. Returns the asset ID.
 * Designed for use in upload Edge Functions after a successful provider upload.
 *
 * Sprint 2+ will integrate this into existing upload functions.
 */
export async function registerMediaAsset(
  admin: SupabaseClient,
  params: RegisterAssetParams,
): Promise<{ success: boolean; assetId?: string; created?: boolean; error?: string }> {
  const desiredStatus = params.status ?? "active";

  let lookup = admin
    .from("media_assets")
    .select("id,status")
    .eq("provider", params.provider)
    .limit(1);

  if (params.providerObjectId) {
    lookup = lookup.eq("provider_object_id", params.providerObjectId);
  } else if (params.providerPath) {
    lookup = lookup.eq("provider_path", params.providerPath);
  } else {
    return { success: false, error: "providerObjectId or providerPath is required" };
  }

  const { data: existing, error: lookupError } = await lookup.maybeSingle();
  if (lookupError) {
    return { success: false, error: lookupError.message };
  }

  if (existing?.id) {
    const updates: Record<string, unknown> = {
      media_family: params.mediaFamily,
      owner_user_id: params.ownerUserId,
      provider_object_id: params.providerObjectId ?? null,
      provider_path: params.providerPath ?? null,
      mime_type: params.mimeType ?? null,
      bytes: params.bytes ?? null,
      legacy_table: params.legacyTable ?? null,
      legacy_id: params.legacyId ?? null,
    };

    if (desiredStatus === "active") {
      updates.status = "active";
      updates.deleted_at = null;
      updates.purge_after = null;
      updates.purged_at = null;
      updates.last_error = null;
    } else if (existing.status !== "active") {
      updates.status = desiredStatus;
    }

    const { error: updateError } = await admin
      .from("media_assets")
      .update(updates)
      .eq("id", existing.id);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    return { success: true, assetId: existing.id, created: false };
  }

  const { data, error } = await admin
    .from("media_assets")
    .insert({
      provider: params.provider,
      media_family: params.mediaFamily,
      owner_user_id: params.ownerUserId,
      provider_object_id: params.providerObjectId ?? null,
      provider_path: params.providerPath ?? null,
      mime_type: params.mimeType ?? null,
      bytes: params.bytes ?? null,
      status: desiredStatus,
      legacy_table: params.legacyTable ?? null,
      legacy_id: params.legacyId ?? null,
    })
    .select("id")
    .single();

  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true, assetId: data.id, created: true };
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
  const { data, error } = await admin
    .from("media_references")
    .insert({
      asset_id: params.assetId,
      ref_type: params.refType,
      ref_table: params.refTable,
      ref_id: params.refId,
      ref_key: params.refKey ?? null,
      is_active: true,
    })
    .select("id")
    .single();

  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true, referenceId: data.id };
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

// ─── Legacy mapping documentation ───────────────────────────────────────────
//
// This section documents how existing Vibely tables map to the new media model.
// Sprint 2+ backfill scripts will use these mappings.
//
// ┌─────────────────────────────┬──────────────────┬──────────────────────────┬─────────────────────────┐
// │ Legacy surface              │ Provider         │ Media family             │ Reference type          │
// ├─────────────────────────────┼──────────────────┼──────────────────────────┼─────────────────────────┤
// │ profiles.bunny_video_uid    │ bunny_stream     │ vibe_video               │ profile_vibe_video      │
// │ profiles.photos[n]          │ bunny_storage    │ profile_photo            │ profile_photo_slot      │
// │ profiles.avatar_url         │ bunny_storage    │ profile_photo            │ profile_avatar          │
// │ messages.video_url (clip)   │ bunny_storage    │ chat_video               │ message_attachment      │
// │ messages.audio_url          │ bunny_storage    │ voice_message            │ message_attachment      │
// │ events.cover_image          │ bunny_storage    │ event_cover              │ event_cover             │
// │ photo_verifications.selfie  │ bunny_storage    │ verification_selfie      │ verification_selfie     │
// │ draft_media_sessions        │ bunny_*          │ (maps to media_family)   │ (created at publish)    │
// └─────────────────────────────┴──────────────────┴──────────────────────────┴─────────────────────────┘
//
// Backfill strategy (Sprint 2):
//   1. Scan profiles with non-null bunny_video_uid → insert media_asset + reference
//   2. Scan profiles.photos[] arrays → insert media_asset + reference per slot
//   3. Scan messages with non-null video_url/audio_url → insert media_asset + reference
//   4. Scan events with non-null cover_image → insert media_asset + reference
//   5. Mark all backfilled assets with legacy_table + legacy_id for traceability
//
// Compatibility:
//   - Existing surfaces continue reading from legacy columns (profiles.photos, etc.)
//   - New uploads will write to BOTH legacy columns AND media_assets (dual-write)
//   - Once backfill is verified, reads can migrate to media_assets
//   - Legacy columns become the "published snapshot" only; source of truth = media_assets
