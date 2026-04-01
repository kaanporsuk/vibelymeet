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

    if (!VideoGuid) {
      console.error(`[video-webhook] no VideoGuid projectRef=${projectRef} — refusing to finalize`);
      return new Response("ok", { status: 200 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let mappedStatus = "processing";
    if (Status === 3) mappedStatus = "ready";
    if (Status === 4) mappedStatus = "ready";
    if (Status === 5) mappedStatus = "failed";

    // ── Update draft_media_sessions (new session model) ──────────────────────
    const { data: sessionResult, error: sessionError } = await supabase.rpc(
      "update_media_session_status",
      {
        p_provider_id: VideoGuid,
        p_new_status: mappedStatus,
        p_error_detail: mappedStatus === "failed" ? `bunny_status_${Status}` : null,
      },
    );

    if (sessionError) {
      console.error(
        `[video-webhook] session update error projectRef=${projectRef} videoGuid=${VideoGuid} err=${sessionError.message}`,
      );
    } else {
      const sr = sessionResult as Record<string, unknown> | null;
      if (sr?.success) {
        console.log(
          `[video-webhook] session updated projectRef=${projectRef} videoGuid=${VideoGuid} sessionId=${sr.session_id} ${sr.previous_status}→${sr.new_status}`,
        );
      } else {
        console.warn(
          `[video-webhook] no session found for videoGuid=${VideoGuid} — legacy upload or session expired`,
        );
      }
    }

    // ── Update profiles (backward compat) ────────────────────────────────────
    const { data: updated, error } = await supabase
      .from("profiles")
      .update({ bunny_video_status: mappedStatus })
      .eq("bunny_video_uid", VideoGuid)
      .select("id");

    if (error) {
      console.error(
        `[video-webhook] db update error projectRef=${projectRef} videoGuid=${VideoGuid} mappedStatus=${mappedStatus} err=${error.message}`,
      );
      return new Response("error", { status: 500 });
    }

    const n = updated?.length ?? 0;
    if (n === 0) {
      // Check if session was found — if so, the profile was already cleared
      // (e.g. user started a new upload). Not a hard failure.
      const sr = sessionResult as Record<string, unknown> | null;
      if (sr?.success) {
        console.log(
          `[video-webhook] profile row not found but session exists projectRef=${projectRef} videoGuid=${VideoGuid} — profile uid may have been replaced`,
        );
        return new Response("ok", { status: 200 });
      }

      console.error(
        `[video-webhook] HARD_FAILURE zero rows matched projectRef=${projectRef} videoGuid=${VideoGuid} status=${String(Status)} mappedStatus=${mappedStatus} libraryId=${VideoLibraryId ?? "n/a"}`,
      );
      return new Response("error", { status: 500 });
    } else {
      console.log(
        `[video-webhook] finalized projectRef=${projectRef} videoGuid=${VideoGuid} rows=${n} mappedStatus=${mappedStatus}`,
      );
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("[video-webhook] error:", err);
    return new Response("error", { status: 500 });
  }
});
