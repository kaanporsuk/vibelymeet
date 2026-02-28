import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) {
    console.log("RESEND_API_KEY not set, skipping email");
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
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
  if (!res.ok) {
    console.error(`Failed to send to ${to}:`, await res.text());
  }
}

function profileCompleteEmail(name: string, unsubscribeUrl: string): { subject: string; html: string } {
  return {
    subject: "Your Vibely profile is live! Here's what to do next 🚀",
    html: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0a0a0a; color: #ffffff; padding: 40px 20px; margin: 0;">
        <div style="max-width: 500px; margin: 0 auto; background: linear-gradient(145deg, #1a1a2e, #16162a); border-radius: 24px; padding: 40px; border: 1px solid rgba(139, 92, 246, 0.2);">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="font-size: 28px; font-weight: bold; background: linear-gradient(135deg, #8b5cf6, #ec4899); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin: 0;">Vibely</h1>
          </div>
          <h2 style="font-size: 20px; font-weight: 600; text-align: center; margin-bottom: 16px; color: #ffffff;">You're live, ${name}! 🎉</h2>
          <p style="color: #a1a1aa; text-align: center; font-size: 14px; margin-bottom: 24px;">Your profile is looking great. Here's how to get your first match:</p>
          <div style="background: rgba(139, 92, 246, 0.1); border-radius: 16px; padding: 20px; margin-bottom: 24px;">
            <p style="color: #d1d5db; font-size: 14px; margin: 0 0 12px 0;">📅 <strong>Join an event</strong> — Speed date with real people live</p>
            <p style="color: #d1d5db; font-size: 14px; margin: 0 0 12px 0;">📸 <strong>Add more photos</strong> — Profiles with 3+ photos get 2x more matches</p>
            <p style="color: #d1d5db; font-size: 14px; margin: 0;">📱 <strong>Verify your phone</strong> — Get a trust badge on your profile</p>
          </div>
          <div style="text-align: center; margin-bottom: 32px;">
            <a href="https://vibelymeet.com/events" style="display: inline-block; background: linear-gradient(135deg, #8b5cf6, #ec4899); color: white; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 600;">Browse Events</a>
          </div>
          <p style="color: #71717a; text-align: center; font-size: 11px;">
            <a href="${unsubscribeUrl}" style="color: #71717a; text-decoration: underline;">Unsubscribe</a> · 
            <a href="https://vibelymeet.com" style="color: #8b5cf6; text-decoration: none;">vibelymeet.com</a>
          </p>
        </div>
      </body>
      </html>
    `,
  };
}

function firstEventNudgeEmail(name: string, unsubscribeUrl: string): { subject: string; html: string } {
  return {
    subject: "Your first Vibely event is waiting 💜",
    html: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0a0a0a; color: #ffffff; padding: 40px 20px; margin: 0;">
        <div style="max-width: 500px; margin: 0 auto; background: linear-gradient(145deg, #1a1a2e, #16162a); border-radius: 24px; padding: 40px; border: 1px solid rgba(139, 92, 246, 0.2);">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="font-size: 28px; font-weight: bold; background: linear-gradient(135deg, #8b5cf6, #ec4899); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin: 0;">Vibely</h1>
          </div>
          <h2 style="font-size: 20px; font-weight: 600; text-align: center; margin-bottom: 16px; color: #ffffff;">Hey ${name}, ready to vibe? 💜</h2>
          <p style="color: #a1a1aa; text-align: center; font-size: 14px; line-height: 1.6; margin-bottom: 24px;">
            The best connections happen face-to-face. Vibely events are live video speed dating sessions where you meet real people — no endless swiping.
          </p>
          <p style="color: #d1d5db; text-align: center; font-size: 14px; margin-bottom: 24px;">Your first event could be the start of something amazing.</p>
          <div style="text-align: center; margin-bottom: 32px;">
            <a href="https://vibelymeet.com/events" style="display: inline-block; background: linear-gradient(135deg, #8b5cf6, #ec4899); color: white; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 600;">Join an Event</a>
          </div>
          <p style="color: #71717a; text-align: center; font-size: 11px;">
            <a href="${unsubscribeUrl}" style="color: #71717a; text-decoration: underline;">Unsubscribe</a> · 
            <a href="https://vibelymeet.com" style="color: #8b5cf6; text-decoration: none;">vibelymeet.com</a>
          </p>
        </div>
      </body>
      </html>
    `,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const now = new Date();
    let totalSent = 0;

    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // ── EMAIL A: "Profile is live" ──
    const { data: profileCompleteUsers } = await supabase
      .from("profiles")
      .select("id, name, verified_email, photos")
      .neq("gender", "prefer_not_to_say")
      .eq("email_unsubscribed", false)
      .gte("created_at", sevenDaysAgo)
      .lte("created_at", oneHourAgo)
      .not("verified_email", "is", null);

    if (profileCompleteUsers) {
      for (const u of profileCompleteUsers) {
        const photoCount = (u.photos as string[] | null)?.filter(
          (p: string) => p && p !== ""
        ).length ?? 0;
        if (photoCount < 2) continue;

        const { data: existing } = await supabase
          .from("email_drip_log")
          .select("id")
          .eq("user_id", u.id)
          .eq("email_key", "profile-complete")
          .maybeSingle();
        if (existing) continue;

        const unsubUrl = `${supabaseUrl}/functions/v1/unsubscribe?uid=${u.id}`;
        const email = profileCompleteEmail(u.name || "there", unsubUrl);
        await sendEmail(u.verified_email, email.subject, email.html);
        await supabase.from("email_drip_log").insert({
          user_id: u.id,
          email_key: "profile-complete",
        });
        totalSent++;
      }
    }

    // ── EMAIL B: "First event nudge" ──
    const { data: nudgeUsers } = await supabase
      .from("profiles")
      .select("id, name, verified_email")
      .eq("email_unsubscribed", false)
      .gte("created_at", sevenDaysAgo)
      .lte("created_at", oneDayAgo)
      .not("verified_email", "is", null);

    if (nudgeUsers) {
      for (const u of nudgeUsers) {
        const { count } = await supabase
          .from("event_registrations")
          .select("*", { count: "exact", head: true })
          .eq("profile_id", u.id);
        if ((count ?? 0) > 0) continue;

        const { data: existing } = await supabase
          .from("email_drip_log")
          .select("id")
          .eq("user_id", u.id)
          .eq("email_key", "first-event-nudge")
          .maybeSingle();
        if (existing) continue;

        const unsubUrl = `${supabaseUrl}/functions/v1/unsubscribe?uid=${u.id}`;
        const email = firstEventNudgeEmail(u.name || "there", unsubUrl);
        await sendEmail(u.verified_email, email.subject, email.html);
        await supabase.from("email_drip_log").insert({
          user_id: u.id,
          email_key: "first-event-nudge",
        });
        totalSent++;
      }
    }

    console.log(`Email drip: sent ${totalSent} emails`);

    return new Response(
      JSON.stringify({ success: true, sent: totalSent }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Email drip error:", error);
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
