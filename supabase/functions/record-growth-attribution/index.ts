import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import {
  isBrowserOriginRejected,
  jsonResponse,
  preflightResponse,
} from "../_shared/cors.ts";

type GrowthAttributionBody = {
  referral_token?: unknown;
  event_type?: unknown;
  surface?: unknown;
  context?: unknown;
};

function asText(value: unknown, fallback: string | null = null): string | null {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return preflightResponse(req);
  }
  if (isBrowserOriginRejected(req)) {
    return jsonResponse(req, { success: false, error: "origin_not_allowed" }, { status: 403 });
  }
  if (req.method !== "POST") {
    return jsonResponse(req, { success: false, error: "method_not_allowed" }, { status: 405 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as GrowthAttributionBody;
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data, error } = await supabase.rpc("record_growth_attribution_event", {
      p_referral_token: asText(body.referral_token),
      p_event_type: asText(body.event_type, "landing"),
      p_surface: asText(body.surface, "unknown"),
      p_context:
        body.context && typeof body.context === "object" && !Array.isArray(body.context)
          ? body.context
          : {},
    });

    if (error) {
      console.error("record-growth-attribution RPC failed", error.message);
      return jsonResponse(req, { success: false, error: "record_failed" }, { status: 200 });
    }

    return jsonResponse(req, data ?? { success: true }, { status: 200 });
  } catch (error) {
    console.error("record-growth-attribution error", error);
    return jsonResponse(req, { success: false, error: "server_error" }, { status: 500 });
  }
});
