import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const body = await req.json();
    console.log("[video-webhook] received:", JSON.stringify(body));

    // Bunny sends: { VideoLibraryId, VideoGuid, Status }
    // Status 3 = transcoding complete (ready)
    // Status 4 = failed
    const { VideoGuid, Status } = body;

    if (!VideoGuid) {
      return new Response("ok", { status: 200 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let status = "processing";
    if (Status === 3) status = "ready";
    if (Status === 4) status = "failed";

    await supabase
      .from("profiles")
      .update({ bunny_video_status: status })
      .eq("bunny_video_uid", VideoGuid);

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("[video-webhook] error:", err);
    return new Response("error", { status: 500 });
  }
});
