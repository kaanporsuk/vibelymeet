import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, createRateLimitResponse } from "../_shared/rate-limiter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Get auth token from request
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create client with user's token to verify auth
    const supabaseAuth = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create service role client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { action, eventId } = await req.json();

    // Rate limiting: 100 matching requests per hour per user
    const rateLimitResult = await checkRateLimit(user.id, {
      functionName: `video-matching-${eventId || "general"}`,
      maxRequests: 100,
      windowMs: 60 * 60 * 1000, // 1 hour
    });

    if (!rateLimitResult.allowed) {
      return createRateLimitResponse(rateLimitResult, corsHeaders);
    }

    if (!eventId) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing eventId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let result;

    switch (action) {
      case "join_queue": {
        // Call the database function to join queue
        const { data, error } = await supabase.rpc("join_matching_queue", {
          p_event_id: eventId,
          p_user_id: user.id,
        });

        if (error) {
          console.error("Error joining queue"); // Sanitized
          return new Response(
            JSON.stringify({ success: false, error: "Failed to join queue. Please try again." }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        result = data;
        break;
      }

      case "find_match": {
        // Call the database function to find a match
        const { data, error } = await supabase.rpc("find_video_date_match", {
          p_event_id: eventId,
          p_user_id: user.id,
        });

        if (error) {
          console.error("Error finding match"); // Sanitized
          return new Response(
            JSON.stringify({ success: false, error: "Failed to find match. Please try again." }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        result = data;
        break;
      }

      case "leave_queue": {
        // Call the database function to leave queue
        const { data, error } = await supabase.rpc("leave_matching_queue", {
          p_event_id: eventId,
          p_user_id: user.id,
        });

        if (error) {
          console.error("Error leaving queue"); // Sanitized
          return new Response(
            JSON.stringify({ success: false, error: "Failed to leave queue. Please try again." }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        result = data;
        break;
      }

      case "get_status": {
        // Get current queue status
        const { data, error } = await supabase
          .from("event_registrations")
          .select("queue_status, current_room_id, current_partner_id, dates_completed")
          .eq("event_id", eventId)
          .eq("profile_id", user.id)
          .maybeSingle();

        if (error) {
          console.error("Error getting status"); // Sanitized
          return new Response(
            JSON.stringify({ success: false, error: "Failed to get status. Please try again." }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (!data) {
          return new Response(
            JSON.stringify({ success: false, error: "Not registered for event" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        result = {
          success: true,
          queue_status: data.queue_status,
          room_id: data.current_room_id,
          partner_id: data.current_partner_id,
          dates_completed: data.dates_completed,
        };
        break;
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: "Invalid action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Video matching error"); // Sanitized
    return new Response(
      JSON.stringify({ success: false, error: "An error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
