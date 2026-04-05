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
    // The RPC also updates profiles.bunny_video_status for processing/ready/failed
    // when profiles.bunny_video_uid still matches this provider.
    const { data: sessionResult, error: sessionError } = await supabase.rpc(
      "update_media_session_status",
      {
        p_provider_id: VideoGuid,
        p_new_status: mappedStatus,
        p_error_detail: mappedStatus === "failed" ? `bunny_status_${Status}` : null,
      },
    );

    const sr = sessionResult as Record<string, unknown> | null;
    const sessionRpcError = typeof sr?.error === "string" ? sr.error : null;

    if (sessionError) {
      console.error(
        `[video-webhook] session update error projectRef=${projectRef} videoGuid=${VideoGuid} err=${sessionError.message}`,
      );
      return new Response("error", { status: 500 });
    }

    if (sr?.success) {
      console.log(
        `[video-webhook] session updated projectRef=${projectRef} videoGuid=${VideoGuid} sessionId=${sr.session_id} ${sr.previous_status}→${sr.new_status}`,
      );
      // The RPC is authoritative for active sessions and now keeps the profile
      // snapshot in sync for processing/ready/failed with a UID guard.
      return new Response("ok", { status: 200 });
    }

    if (sessionRpcError === "invalid_transition") {
      console.warn(
        `[video-webhook] ignored out-of-order status projectRef=${projectRef} videoGuid=${VideoGuid} mappedStatus=${mappedStatus} error=${sessionRpcError}`,
      );
      return new Response("ok", { status: 200 });
    }

    if (sessionRpcError !== "session_not_found") {
      console.error(
        `[video-webhook] unexpected session RPC failure projectRef=${projectRef} videoGuid=${VideoGuid} mappedStatus=${mappedStatus} error=${sessionRpcError ?? "unknown"}`,
      );
      return new Response("error", { status: 500 });
    }

    // ── Narrow legacy fallback: only for pre-session uploads ──────────────────
    const { data: updated, error } = await supabase
      .from("profiles")
      .update({ bunny_video_status: mappedStatus })
      .eq("bunny_video_uid", VideoGuid)
      .select("id");

    if (error) {
      console.error(
        `[video-webhook] legacy profile update error projectRef=${projectRef} videoGuid=${VideoGuid} mappedStatus=${mappedStatus} err=${error.message}`,
      );
      return new Response("error", { status: 500 });
    }

    const n = updated?.length ?? 0;
    if (n === 0) {
      console.log(
        `[video-webhook] legacy event matched no current profile row projectRef=${projectRef} videoGuid=${VideoGuid} mappedStatus=${mappedStatus} — likely superseded or already cleared`,
      );
      return new Response("ok", { status: 200 });
    }

    console.log(
      `[video-webhook] legacy profile update projectRef=${projectRef} videoGuid=${VideoGuid} rows=${n} mappedStatus=${mappedStatus}`,
    );
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("[video-webhook] error:", err);
    return new Response("error", { status: 500 });
  }
});
