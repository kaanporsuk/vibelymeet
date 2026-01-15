import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const resendApiKey = Deno.env.get("RESEND_API_KEY");

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get the authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("No authorization header provided");
      return new Response(
        JSON.stringify({ error: "Unauthorized - No token provided" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create a Supabase client with the user's JWT to verify identity
    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    // Get the authenticated user
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    
    if (userError || !user) {
      console.error("Failed to get user:", userError?.message);
      return new Response(
        JSON.stringify({ error: "Unauthorized - Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = user.id;
    const userEmail = user.email;
    console.log(`Starting account deletion for user: ${userId}`);

    // Create admin client for privileged operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Delete user data in order (child tables first)
    
    // 1a. Delete blocked_users (both directions - user blocked others or was blocked)
    const { error: blockedError1 } = await supabaseAdmin
      .from("blocked_users")
      .delete()
      .eq("blocker_id", userId);
    
    const { error: blockedError2 } = await supabaseAdmin
      .from("blocked_users")
      .delete()
      .eq("blocked_id", userId);

    if (blockedError1 || blockedError2) {
      console.error("Error deleting blocked_users:", blockedError1?.message || blockedError2?.message);
    } else {
      console.log("Deleted blocked_users records");
    }

    // 1b. Delete match_mutes
    const { error: mutesError } = await supabaseAdmin
      .from("match_mutes")
      .delete()
      .eq("user_id", userId);

    if (mutesError) {
      console.error("Error deleting match_mutes:", mutesError.message);
    } else {
      console.log("Deleted match_mutes records");
    }

    // 1c. Delete daily_drops (both directions)
    const { error: dropsError1 } = await supabaseAdmin
      .from("daily_drops")
      .delete()
      .eq("user_id", userId);
    
    const { error: dropsError2 } = await supabaseAdmin
      .from("daily_drops")
      .delete()
      .eq("candidate_id", userId);

    if (dropsError1 || dropsError2) {
      console.error("Error deleting daily_drops:", dropsError1?.message || dropsError2?.message);
    } else {
      console.log("Deleted daily_drops records");
    }

    // 1d. Delete date_proposals (both directions)
    const { error: proposalsError1 } = await supabaseAdmin
      .from("date_proposals")
      .delete()
      .eq("proposer_id", userId);
    
    const { error: proposalsError2 } = await supabaseAdmin
      .from("date_proposals")
      .delete()
      .eq("recipient_id", userId);

    if (proposalsError1 || proposalsError2) {
      console.error("Error deleting date_proposals:", proposalsError1?.message || proposalsError2?.message);
    } else {
      console.log("Deleted date_proposals records");
    }

    // 1e. Delete user_schedules
    const { error: schedulesError } = await supabaseAdmin
      .from("user_schedules")
      .delete()
      .eq("user_id", userId);

    if (schedulesError) {
      console.error("Error deleting user_schedules:", schedulesError.message);
    } else {
      console.log("Deleted user_schedules records");
    }

    // 1f. Delete email_verifications
    const { error: verificationsError } = await supabaseAdmin
      .from("email_verifications")
      .delete()
      .eq("user_id", userId);

    if (verificationsError) {
      console.error("Error deleting email_verifications:", verificationsError.message);
    } else {
      console.log("Deleted email_verifications records");
    }

    // 2. Delete messages where user is sender (matches will cascade the rest)
    const { error: messagesError } = await supabaseAdmin
      .from("messages")
      .delete()
      .eq("sender_id", userId);
    
    if (messagesError) {
      console.error("Error deleting messages:", messagesError.message);
    } else {
      console.log("Deleted user messages");
    }

    // 2. Delete matches where user is participant
    const { error: matchesError1 } = await supabaseAdmin
      .from("matches")
      .delete()
      .eq("profile_id_1", userId);
    
    const { error: matchesError2 } = await supabaseAdmin
      .from("matches")
      .delete()
      .eq("profile_id_2", userId);

    if (matchesError1 || matchesError2) {
      console.error("Error deleting matches:", matchesError1?.message || matchesError2?.message);
    } else {
      console.log("Deleted user matches");
    }

    // 3. Delete event registrations
    const { error: registrationsError } = await supabaseAdmin
      .from("event_registrations")
      .delete()
      .eq("profile_id", userId);

    if (registrationsError) {
      console.error("Error deleting registrations:", registrationsError.message);
    } else {
      console.log("Deleted event registrations");
    }

    // 4. Delete video sessions
    const { error: videoError1 } = await supabaseAdmin
      .from("video_sessions")
      .delete()
      .eq("participant_1_id", userId);

    const { error: videoError2 } = await supabaseAdmin
      .from("video_sessions")
      .delete()
      .eq("participant_2_id", userId);

    if (videoError1 || videoError2) {
      console.error("Error deleting video sessions:", videoError1?.message || videoError2?.message);
    } else {
      console.log("Deleted video sessions");
    }

    // 5. Delete profile vibes
    const { error: vibesError } = await supabaseAdmin
      .from("profile_vibes")
      .delete()
      .eq("profile_id", userId);

    if (vibesError) {
      console.error("Error deleting profile vibes:", vibesError.message);
    } else {
      console.log("Deleted profile vibes");
    }

    // 6. Delete rate limits
    const { error: rateLimitsError } = await supabaseAdmin
      .from("rate_limits")
      .delete()
      .eq("user_id", userId);

    if (rateLimitsError) {
      console.error("Error deleting rate limits:", rateLimitsError.message);
    } else {
      console.log("Deleted rate limits");
    }

    // 7. Delete user roles
    const { error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", userId);

    if (rolesError) {
      console.error("Error deleting user roles:", rolesError.message);
    } else {
      console.log("Deleted user roles");
    }

    // 8. Delete profile (parent table)
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .delete()
      .eq("id", userId);

    if (profileError) {
      console.error("Error deleting profile:", profileError.message);
    } else {
      console.log("Deleted user profile");
    }

    // 9. Send farewell email
    if (resendApiKey && userEmail) {
      try {
        const resend = new Resend(resendApiKey);
        await resend.emails.send({
          from: "Vibely <onboarding@resend.dev>",
          to: [userEmail],
          subject: "Your Vibely account has been deleted",
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
              <h1 style="color: #1a1a2e; margin-bottom: 24px;">Goodbye from Vibely</h1>
              <p style="color: #4a4a68; font-size: 16px; line-height: 1.6;">
                Your Vibely account has been permanently deleted. All your data, matches, and conversations have been removed from our systems.
              </p>
              <p style="color: #4a4a68; font-size: 16px; line-height: 1.6;">
                We're sorry to see you go. If you ever want to reconnect with amazing people, you're always welcome back.
              </p>
              <p style="color: #888; font-size: 14px; margin-top: 40px;">
                — The Vibely Team
              </p>
            </div>
          `,
        });
        console.log("Farewell email sent to:", userEmail);
      } catch (emailError) {
        console.error("Failed to send farewell email:", emailError);
        // Don't fail the deletion if email fails
      }
    } else {
      console.log("Email not sent - RESEND_API_KEY not configured or no user email");
    }

    // 10. Finally, delete the auth user
    const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (authDeleteError) {
      console.error("Error deleting auth user:", authDeleteError.message);
      return new Response(
        JSON.stringify({ error: "Failed to delete user account" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Successfully deleted user: ${userId}`);

    return new Response(
      JSON.stringify({ success: true, message: "Account deleted successfully" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Unexpected error in delete-account:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
