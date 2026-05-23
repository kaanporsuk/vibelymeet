import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { bunnyStorageConfigForTier } from "../_shared/bunny-media.ts";
import { signBunnyStreamDirectoryUrl } from "../_shared/bunny-stream-tokens.ts";
import {
  createImagePlaceholderMetadata,
  type MediaPlaceholderMetadata,
} from "../_shared/media-placeholders.ts";

type AdminSupabaseClient = SupabaseClient<any, "public", any>;

type MediaAssetRow = {
  id: string;
  provider: string | null;
  provider_path: string | null;
  provider_object_id: string | null;
  media_family: string | null;
  storage_zone: string | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-backfill-token, content-type",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bearerToken(req: Request): string | null {
  const auth = req.headers.get("Authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return match?.[1]?.trim() || null;
}

function isAuthorized(req: Request): boolean {
  const backfillToken = Deno.env.get("MEDIA_PLACEHOLDER_BACKFILL_TOKEN")?.trim() ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET")?.trim() ?? "";
  const headerToken = req.headers.get("x-backfill-token")?.trim() ?? "";
  if (backfillToken && headerToken === backfillToken) return true;
  const bearer = bearerToken(req);
  if (!bearer) return false;
  return Boolean(backfillToken && bearer === backfillToken) || Boolean(cronSecret && bearer === cronSecret);
}

function boundedLimit(value: unknown): number {
  const parsed = typeof value === "number" ? Math.trunc(value) : Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(50, parsed)) : 20;
}

function encodeStoragePath(storagePath: string): string {
  return storagePath.trim().replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
}

async function placeholderForStorageAsset(asset: MediaAssetRow): Promise<MediaPlaceholderMetadata | null> {
  const path = asset.provider_path?.trim();
  if (!path || path.startsWith("/") || path.includes("..") || path.includes("://")) return null;
  const config = bunnyStorageConfigForTier(asset.storage_zone);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(`https://storage.bunnycdn.com/${config.zone}/${encodeStoragePath(path)}`, {
      headers: { AccessKey: config.apiKey },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return createImagePlaceholderMetadata(await response.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function streamConfigForAsset(asset: MediaAssetRow): { hostname: string; securityKey: string } | null {
  const chat = asset.media_family === "chat_video" || asset.media_family === "chat_video_thumbnail";
  const hostname = Deno.env.get(chat ? "BUNNY_CHAT_STREAM_CDN_HOSTNAME" : "BUNNY_STREAM_CDN_HOSTNAME")?.trim() ?? "";
  const securityKey = Deno.env.get(chat ? "BUNNY_CHAT_STREAM_TOKEN_SECURITY_KEY" : "BUNNY_STREAM_TOKEN_SECURITY_KEY")?.trim() ?? "";
  return hostname && securityKey ? { hostname, securityKey } : null;
}

async function placeholderForStreamAsset(asset: MediaAssetRow): Promise<MediaPlaceholderMetadata | null> {
  const videoId = asset.provider_object_id?.trim();
  if (!videoId) return null;
  const config = streamConfigForAsset(asset);
  if (!config) return null;
  const url = await signBunnyStreamDirectoryUrl({
    hostname: config.hostname,
    securityKey: config.securityKey,
    videoId,
    fileName: "thumbnail.jpg",
    expires: Math.floor(Date.now() / 1000) + 120,
  });
  const response = await fetch(url);
  if (!response.ok) return null;
  return createImagePlaceholderMetadata(await response.arrayBuffer());
}

async function placeholderForAsset(asset: MediaAssetRow): Promise<MediaPlaceholderMetadata | null> {
  if (asset.provider === "bunny_storage") return placeholderForStorageAsset(asset);
  if (asset.provider === "bunny_stream") return placeholderForStreamAsset(asset);
  return null;
}

async function updateAssetPlaceholder(
  admin: AdminSupabaseClient,
  assetId: string,
  placeholder: MediaPlaceholderMetadata,
): Promise<boolean> {
  const { error } = await admin
    .from("media_assets")
    .update({
      placeholder_kind: placeholder.placeholder_kind,
      placeholder_hash: placeholder.placeholder_hash,
      dominant_color: placeholder.dominant_color,
      placeholder_updated_at: new Date().toISOString(),
    })
    .eq("id", assetId);
  return !error;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "method_not_allowed" }, 405);

  if (
    !Deno.env.get("MEDIA_PLACEHOLDER_BACKFILL_TOKEN")?.trim() &&
    !Deno.env.get("CRON_SECRET")?.trim()
  ) {
    return json({ success: false, error: "backfill_auth_not_configured" }, 503);
  }
  if (!isAuthorized(req)) return json({ success: false, error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const limit = boundedLimit(body.limit);
  const dryRun = body.dryRun === true;
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await admin
    .from("media_assets")
    .select("id,provider,provider_path,provider_object_id,media_family,storage_zone")
    .in("provider", ["bunny_storage", "bunny_stream"])
    .in("media_family", ["profile_photo", "chat_image", "event_cover", "chat_video", "chat_video_thumbnail", "vibe_video"])
    .in("status", ["active", "uploaded"])
    .or("placeholder_kind.is.null,placeholder_kind.neq.blurhash,placeholder_hash.is.null")
    .order("updated_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) return json({ success: false, error: "asset_query_failed" }, 500);

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const assetIds: string[] = [];
  for (const asset of (data ?? []) as MediaAssetRow[]) {
    const placeholder = await placeholderForAsset(asset).catch(() => null);
    if (!placeholder) {
      skipped += 1;
      continue;
    }
    if (!dryRun) {
      const ok = await updateAssetPlaceholder(admin, asset.id, placeholder);
      if (!ok) {
        failed += 1;
        continue;
      }
    }
    updated += 1;
    assetIds.push(asset.id);
  }

  return json({
    success: true,
    dryRun,
    scanned: (data ?? []).length,
    updated,
    skipped,
    failed,
    assetIds,
  });
});
