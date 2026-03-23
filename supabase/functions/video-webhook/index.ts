import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a[i] ^ b[i];
  return out === 0;
}

function constantTimeCompare(a: string, b: string): boolean {
  const enc = new TextEncoder();
  return timingSafeEqual(enc.encode(a), enc.encode(b));
}

serve(async (req) => {
  const webhookToken = Deno.env.get("BUNNY_VIDEO_WEBHOOK_TOKEN");
  if (!webhookToken || webhookToken.trim() === "") {
    console.error("[video-webhook] BUNNY_VIDEO_WEBHOOK_TOKEN is not set");
    return new Response("Service unavailable", { status: 503 });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token || !constantTimeCompare(token, webhookToken)) {
    console.error(
      "[video-webhook] auth failed: missing or invalid `token` query param (must match secret BUNNY_VIDEO_WEBHOOK_TOKEN; see docs/vibe-video-webhook-operator.md)",
    );
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const body = await req.json() as {
      VideoGuid?: string;
      Status?: number;
      VideoLibraryId?: number | string;
    };

    const { VideoGuid, Status, VideoLibraryId } = body;
    console.log(
      `[video-webhook] inbound auth=ok Status=${String(Status)} VideoLibraryId=${VideoLibraryId ?? "n/a"} hasVideoGuid=${!!VideoGuid}`,
    );

    // Bunny sends: { VideoLibraryId, VideoGuid, Status }
    // Status 3 = transcoding complete (ready)
    // Status 4 = failed
    if (!VideoGuid) {
      console.log("[video-webhook] no VideoGuid — ack without DB write");
      return new Response("ok", { status: 200 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let status = "processing";
    if (Status === 3) status = "ready";
    if (Status === 4) status = "failed";

    const { data: updated, error } = await supabase
      .from("profiles")
      .update({ bunny_video_status: status })
      .eq("bunny_video_uid", VideoGuid)
      .select("id");

    if (error) {
      console.error(`[video-webhook] db update error: ${error.message}`);
      return new Response("error", { status: 500 });
    }

    const n = updated?.length ?? 0;
    if (n === 0) {
      console.warn(
        `[video-webhook] no profile row matched bunny_video_uid (possible wrong project, stale GUID, or test webhook): len(guid)=${VideoGuid.length}`,
      );
    } else {
      console.log(`[video-webhook] db ok rows=${n} bunny_video_status=${status}`);
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("[video-webhook] error:", err);
    return new Response("error", { status: 500 });
  }
});
