import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  MEDIA_FAMILIES,
  PROVIDERS,
  REF_TYPES,
  registerMediaAsset,
  createMediaReference,
  releaseMediaReference,
} from "../_shared/media-lifecycle.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "No authorization header" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    // Verify user is admin via user_roles table
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleRow) {
      return new Response(
        JSON.stringify({ success: false, error: "Admin access required" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const eventId = formData.get("event_id") as string | null;

    if (!file) {
      return new Response(
        JSON.stringify({ success: false, error: "No file provided" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate image type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
    const baseType = file.type.split(";")[0].trim();
    if (!allowedTypes.includes(baseType) && !file.type.startsWith("image/")) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid file type. Image files only." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Max 20MB for event covers (high-res hero images)
    if (file.size > 20 * 1024 * 1024) {
      return new Response(
        JSON.stringify({ success: false, error: "File too large. Maximum 20MB." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const extMap: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/heic": "heic",
      "image/heif": "heif",
    };
    const ext = extMap[baseType] ?? "jpg";
    const timestamp = Date.now();

    // Path: events/{eventId}/{timestamp}.ext or events/covers/{timestamp}.ext
    const folder = eventId ? `events/${eventId}` : `events/covers`;
    const storagePath = `${folder}/${timestamp}.${ext}`;

    const storageZone = Deno.env.get("BUNNY_STORAGE_ZONE")!;
    const apiKey = Deno.env.get("BUNNY_STORAGE_API_KEY")!;

    const fileBuffer = await file.arrayBuffer();
    const uploadRes = await fetch(
      `https://storage.bunnycdn.com/${storageZone}/${storagePath}`,
      {
        method: "PUT",
        headers: {
          AccessKey: apiKey,
          "Content-Type": file.type || "image/jpeg",
        },
        body: fileBuffer,
      }
    );

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error("[upload-event-cover] Bunny upload failed:", uploadRes.status, errText);
      return new Response(
        JSON.stringify({ success: false, error: "Upload to CDN failed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cdnHostname = Deno.env.get("BUNNY_CDN_HOSTNAME")!;
    const coverUrl = `https://${cdnHostname}/${storagePath}`;

    // ── Media lifecycle registration ─────────────────────────────────────────
    const adminSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    try {
      const lifecycle = await registerMediaAsset(adminSupabase, {
        provider: PROVIDERS.BUNNY_STORAGE,
        mediaFamily: MEDIA_FAMILIES.EVENT_COVER,
        ownerUserId: user.id,
        providerPath: storagePath,
        mimeType: file.type,
        bytes: file.size,
        legacyTable: "events",
        legacyId: eventId ?? null,
        status: "active",
      });

      if (!lifecycle.success) {
        console.error(`[upload-event-cover] media asset registration failed path=${storagePath} err=${lifecycle.error}`);
      } else if (lifecycle.assetId && eventId) {
        // Release any existing event_cover references for this event
        const { data: existingRefs } = await adminSupabase
          .from("media_references")
          .select("id")
          .eq("ref_type", REF_TYPES.EVENT_COVER)
          .eq("ref_table", "events")
          .eq("ref_id", eventId)
          .eq("is_active", true);

        for (const ref of existingRefs ?? []) {
          await releaseMediaReference(adminSupabase, ref.id, "replace");
        }

        // Create new reference
        const refResult = await createMediaReference(adminSupabase, {
          assetId: lifecycle.assetId,
          refType: REF_TYPES.EVENT_COVER,
          refTable: "events",
          refId: eventId,
          refKey: "cover_image",
        });

        if (!refResult.success) {
          console.error(`[upload-event-cover] media reference creation failed assetId=${lifecycle.assetId} eventId=${eventId} err=${refResult.error}`);
        }
      }
    } catch (e) {
      console.error("[upload-event-cover] lifecycle tracking error:", e);
    }

    return new Response(
      JSON.stringify({ success: true, path: storagePath, url: coverUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[upload-event-cover] Unexpected error:", err);
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
