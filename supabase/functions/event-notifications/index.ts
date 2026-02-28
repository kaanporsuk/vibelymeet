import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, createRateLimitResponse } from "../_shared/rate-limiter.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface EventNotificationRequest {
  type: "event_created" | "capacity_alert";
  eventId: string;
  capacityPercent?: number;
}

// Send email via Resend API
async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!RESEND_API_KEY) {
    console.log("RESEND_API_KEY not configured, skipping email");
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "Vibely <login@vibelymeet.com>",
      to: [to],
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`Failed to send email to ${to}:`, error);
  }
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Authenticate caller (admin only)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Rate limiting: 5 notification requests per hour
    const rateLimitResult = await checkRateLimit(user.id, {
      functionName: "event-notifications",
      maxRequests: 5,
      windowMs: 60 * 60 * 1000, // 1 hour
    });

    if (!rateLimitResult.allowed) {
      return createRateLimitResponse(rateLimitResult, corsHeaders);
    }

    const { type, eventId, capacityPercent }: EventNotificationRequest = await req.json();

    // Fetch event details
    const { data: event, error: eventError } = await supabaseAdmin
      .from("events")
      .select("*")
      .eq("id", eventId)
      .single();

    if (eventError || !event) {
      return new Response(
        JSON.stringify({ error: "Event not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const eventDate = new Date(event.event_date);
    const formattedDate = eventDate.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    if (type === "event_created") {
      // Fetch all users who have email verified (for new event announcement)
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, name, verified_email")
        .eq("email_verified", true)
        .not("verified_email", "is", null);

      console.log(`Sending new event notification to ${profiles?.length || 0} users`);

      const emailPromises = profiles?.map(async (profile) => {
        if (!profile.verified_email) return;

        const html = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0a0a0a; color: #ffffff; padding: 40px 20px; margin: 0;">
            <div style="max-width: 500px; margin: 0 auto; background: linear-gradient(145deg, #1a1a2e, #16162a); border-radius: 24px; padding: 40px; border: 1px solid rgba(139, 92, 246, 0.2);">
              <div style="text-align: center; margin-bottom: 32px;">
                <h1 style="font-size: 28px; font-weight: bold; background: linear-gradient(135deg, #8b5cf6, #ec4899); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin: 0;">Vibely</h1>
              </div>
              
              <h2 style="font-size: 20px; font-weight: 600; text-align: center; margin-bottom: 16px; color: #ffffff;">🎉 New Event Alert!</h2>
              
              <p style="color: #a1a1aa; text-align: center; margin-bottom: 24px; font-size: 14px;">
                Hey ${profile.name}, a new event just dropped!
              </p>
              
              <div style="background: rgba(139, 92, 246, 0.1); border: 2px solid rgba(139, 92, 246, 0.3); border-radius: 16px; padding: 24px; margin-bottom: 24px;">
                <h3 style="font-size: 18px; font-weight: bold; color: #8b5cf6; margin: 0 0 12px 0;">${event.title}</h3>
                <p style="color: #d1d5db; font-size: 14px; margin: 0 0 8px 0;">📅 ${formattedDate}</p>
                ${event.location_name ? `<p style="color: #d1d5db; font-size: 14px; margin: 0 0 8px 0;">📍 ${event.location_name}</p>` : '<p style="color: #d1d5db; font-size: 14px; margin: 0 0 8px 0;">🌐 Virtual Event</p>'}
                ${event.description ? `<p style="color: #9ca3af; font-size: 13px; margin: 12px 0 0 0;">${event.description.slice(0, 150)}${event.description.length > 150 ? '...' : ''}</p>` : ''}
              </div>
              
              <div style="text-align: center;">
                <a href="https://vibelymeet.com/events/${event.id}" style="display: inline-block; background: linear-gradient(135deg, #8b5cf6, #ec4899); color: white; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 600;">View Event</a>
              </div>
              
              <p style="color: #71717a; text-align: center; font-size: 12px; margin-top: 32px;">
                Don't miss out on meeting amazing people!
              </p>
            </div>
          </body>
          </html>
        `;

        await sendEmail(profile.verified_email, `🎉 New Event: ${event.title}`, html);
      }) || [];

      await Promise.allSettled(emailPromises);

      return new Response(
        JSON.stringify({ success: true, notified: profiles?.length || 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (type === "capacity_alert") {
      // Fetch registered users for this event
      const { data: registrations } = await supabaseAdmin
        .from("event_registrations")
        .select("profile_id")
        .eq("event_id", eventId);

      const profileIds = registrations?.map(r => r.profile_id) || [];
      
      if (profileIds.length === 0) {
        return new Response(
          JSON.stringify({ success: true, notified: 0 }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, name, verified_email")
        .in("id", profileIds)
        .eq("email_verified", true)
        .not("verified_email", "is", null);

      console.log(`Sending capacity alert to ${profiles?.length || 0} registered users`);

      const emailPromises = profiles?.map(async (profile) => {
        if (!profile.verified_email) return;

        const html = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0a0a0a; color: #ffffff; padding: 40px 20px; margin: 0;">
            <div style="max-width: 500px; margin: 0 auto; background: linear-gradient(145deg, #1a1a2e, #16162a); border-radius: 24px; padding: 40px; border: 1px solid rgba(251, 146, 60, 0.3);">
              <div style="text-align: center; margin-bottom: 32px;">
                <h1 style="font-size: 28px; font-weight: bold; background: linear-gradient(135deg, #8b5cf6, #ec4899); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin: 0;">Vibely</h1>
              </div>
              
              <h2 style="font-size: 20px; font-weight: 600; text-align: center; margin-bottom: 16px; color: #fb923c;">🔥 Event Almost Full!</h2>
              
              <p style="color: #a1a1aa; text-align: center; margin-bottom: 24px; font-size: 14px;">
                Hey ${profile.name}, "${event.title}" is ${capacityPercent}% full!
              </p>
              
              <div style="background: rgba(251, 146, 60, 0.1); border: 2px solid rgba(251, 146, 60, 0.3); border-radius: 16px; padding: 24px; text-align: center; margin-bottom: 24px;">
                <p style="font-size: 36px; font-weight: bold; color: #fb923c; margin: 0;">${capacityPercent}%</p>
                <p style="color: #d1d5db; font-size: 14px; margin: 8px 0 0 0;">Capacity Filled</p>
              </div>
              
              <p style="color: #9ca3af; text-align: center; font-size: 14px; margin-bottom: 24px;">
                Good news - you're already registered! 🎉<br>
                Invite your friends before spots run out.
              </p>
              
              <div style="text-align: center;">
                <a href="https://vibelymeet.com/events/${event.id}" style="display: inline-block; background: linear-gradient(135deg, #fb923c, #f97316); color: white; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 600;">View Event</a>
              </div>
            </div>
          </body>
          </html>
        `;

        await sendEmail(profile.verified_email, `🔥 "${event.title}" is ${capacityPercent}% Full!`, html);
      }) || [];

      await Promise.allSettled(emailPromises);

      return new Response(
        JSON.stringify({ success: true, notified: profiles?.length || 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid notification type" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in event-notifications function"); // Sanitized
    return new Response(
      JSON.stringify({ error: "An error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
