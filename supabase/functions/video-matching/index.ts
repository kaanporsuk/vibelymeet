import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
          console.error("Error joining queue:", error);
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
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
          console.error("Error finding match:", error);
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
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
          console.error("Error leaving queue:", error);
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
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
          console.error("Error getting status:", error);
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
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
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
