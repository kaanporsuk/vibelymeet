import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { checkRateLimit, createRateLimitResponse } from "../_shared/rate-limiter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface VibeNotificationRequest {
  receiver_id: string;
  event_id: string;
  is_mutual: boolean;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Get the authorization header to identify the sender
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create client with user's auth to get sender info
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const senderId = user.id;

    // Rate limiting: 20 vibe notifications per hour per user
    const rateLimitResult = await checkRateLimit(senderId, {
      functionName: "vibe-notification",
      maxRequests: 20,
      windowMs: 60 * 60 * 1000, // 1 hour
    });

    if (!rateLimitResult.allowed) {
      return createRateLimitResponse(rateLimitResult, corsHeaders);
    }
    // Parse request body
    const body: VibeNotificationRequest = await req.json();
    const { receiver_id, event_id, is_mutual } = body;

    if (!receiver_id || !event_id) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create service client for database operations
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Get sender's profile
    const { data: senderProfile, error: senderError } = await serviceClient
      .from("profiles")
      .select("name, avatar_url")
      .eq("id", senderId)
      .single();

    if (senderError) {
      console.error("Error fetching sender profile:", senderError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch sender profile" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get event details
    const { data: event, error: eventError } = await serviceClient
      .from("events")
      .select("title, event_date")
      .eq("id", event_id)
      .single();

    if (eventError) {
      console.error("Error fetching event:", eventError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch event" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create an admin notification for the receiver
    // In a production app, you'd send a push notification here via FCM/APNs
    // For now, we'll create an in-app notification record

    const notificationTitle = is_mutual
      ? `💜 It's a Mutual Vibe!`
      : `💫 Someone sent you a Vibe!`;

    const notificationMessage = is_mutual
      ? `You and ${senderProfile.name} both vibed each other for "${event.title}"! Make sure to connect at the event.`
      : `${senderProfile.name} is interested in meeting you at "${event.title}"! Send a vibe back to create a mutual connection.`;

    console.warn("vibe-notification: recording push_notification_events row (in-app path)");

    // Create a push notification event record for tracking
    const { error: insertError } = await serviceClient
      .from("push_notification_events")
      .insert({
        user_id: receiver_id,
        platform: "web",
        status: "sent",
        sent_at: new Date().toISOString(),
      });

    if (insertError) {
      console.error("Error creating notification event:", insertError);
      // Don't fail the request, just log the error
    }

    // Return success with notification details
    return new Response(
      JSON.stringify({
        success: true,
        notification: {
          title: notificationTitle,
          message: notificationMessage,
          receiver_id,
          event_id,
          is_mutual,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Vibe notification error"); // Sanitized - no detailed error message
    return new Response(
      JSON.stringify({ error: "An error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
