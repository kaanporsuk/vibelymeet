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

function getProjectRef(url: string | undefined): string {
  if (!url) return "unknown";
  try {
    const host = new URL(url).hostname;
    return host.split(".")[0] || "unknown";
  } catch {
    return "unknown";
  }
}

serve(async (req) => {
  const projectRef = getProjectRef(Deno.env.get("SUPABASE_URL"));
  const webhookToken = Deno.env.get("BUNNY_VIDEO_WEBHOOK_TOKEN");
  if (!webhookToken || webhookToken.trim() === "") {
    console.error(`[video-webhook] BUNNY_VIDEO_WEBHOOK_TOKEN is not set projectRef=${projectRef}`);
    return new Response("Service unavailable", { status: 503 });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token || !constantTimeCompare(token, webhookToken)) {
    console.error(
      `[video-webhook] auth failed projectRef=${projectRef}: missing or invalid token`,
    );
    return new Response("Unauthorized", { status: 401 });
  }
  console.log(`[video-webhook] auth ok projectRef=${projectRef}`);

  try {
    const body = await req.json() as {
      VideoGuid?: string;
      Status?: number;
      VideoLibraryId?: number | string;
    };

    const { VideoGuid, Status, VideoLibraryId } = body;
    console.log(
      `[video-webhook] inbound projectRef=${projectRef} Status=${String(Status)} VideoLibraryId=${VideoLibraryId ?? "n/a"} VideoGuid=${VideoGuid ?? "n/a"}`,
    );

    // Bunny sends: { VideoLibraryId, VideoGuid, Status }
    // Official Bunny webhook statuses:
    // 0 = queued
    // 7 = presigned upload finished
    // 3 = finished
    // 4 = resolution finished and now playable
    // 5 = failed
    if (!VideoGuid) {
      console.error(`[video-webhook] no VideoGuid projectRef=${projectRef} — refusing to finalize`);
      return new Response("ok", { status: 200 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let status = "processing";
    if (Status === 3) status = "ready";
    if (Status === 4) status = "ready";
    if (Status === 5) status = "failed";

    const { data: updated, error } = await supabase
      .from("profiles")
      .update({ bunny_video_status: status })
      .eq("bunny_video_uid", VideoGuid)
      .select("id");

    if (error) {
      console.error(
        `[video-webhook] db update error projectRef=${projectRef} videoGuid=${VideoGuid} mappedStatus=${status} err=${error.message}`,
      );
      return new Response("error", { status: 500 });
    }

    const n = updated?.length ?? 0;
    if (n === 0) {
      console.error(
        `[video-webhook] HARD_FAILURE zero rows matched projectRef=${projectRef} videoGuid=${VideoGuid} status=${String(Status)} mappedStatus=${status} libraryId=${VideoLibraryId ?? "n/a"}`,
      );
      return new Response("error", { status: 500 });
    } else {
      console.log(
        `[video-webhook] finalized projectRef=${projectRef} videoGuid=${VideoGuid} rows=${n} mappedStatus=${status}`,
      );
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("[video-webhook] error:", err);
    return new Response("error", { status: 500 });
  }
});
