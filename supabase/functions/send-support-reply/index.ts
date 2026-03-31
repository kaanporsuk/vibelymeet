import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callerId = userData.user.id;

    const service = createClient(supabaseUrl, serviceKey);

    const { data: adminRow } = await service
      .from("user_roles")
      .select("id")
      .eq("user_id", callerId)
      .eq("role", "admin")
      .maybeSingle();

    if (!adminRow) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { ticket_id, reply_message, send_email } = await req.json();
    if (!ticket_id || typeof reply_message !== "string") {
      return new Response(JSON.stringify({ error: "ticket_id and reply_message required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: ticket, error: tErr } = await service
      .from("support_tickets")
      .select("id, reference_id, user_id, user_email")
      .eq("id", ticket_id)
      .single();

    if (tErr || !ticket) {
      return new Response(JSON.stringify({ error: "ticket not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: prof } = await service.from("profiles").select("name").eq("id", ticket.user_id).maybeSingle();
    const displayName = prof?.name ?? "there";

    let notificationWarning: string | null = null;
    let emailWarning: string | null = null;

    try {
      const notifyRes = await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: ticket.user_id,
          category: "support_reply",
          title: "Vibely Support",
          body: `We've replied to your request ${ticket.reference_id}`,
          data: {
            type: "support_reply",
            ticket_id: ticket.id,
            reference_id: ticket.reference_id,
            url: `/settings/ticket/${ticket.id}`,
          },
          bypass_preferences: true,
        }),
      });

      if (!notifyRes.ok) {
        const txt = await notifyRes.text();
        console.error("send-notification failed:", notifyRes.status, txt);
        notificationWarning = "Reply saved but push notification could not be delivered.";
      }
    } catch (notifyError) {
      console.error("send-notification error for support reply:", notifyError);
      notificationWarning = "Reply saved but push notification could not be delivered.";
    }

    if (send_email && ticket.user_email) {
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey) {
        const safeBody = escapeHtml(reply_message).replace(/\n/g, "<br/>");
        try {
          const emailRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${resendKey}`,
            },
            body: JSON.stringify({
              from: "Vibely Support <support@vibelymeet.com>",
              to: ticket.user_email,
              subject: `Re: Your request ${ticket.reference_id}`,
              html: `
          <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto;">
            <h2 style="color: #8B5CF6;">Vibely Support</h2>
            <p>Hi ${escapeHtml(displayName)},</p>
            <p>We've replied to your request <strong>${escapeHtml(ticket.reference_id)}</strong>.</p>
            <div style="background: #f9f9f9; border-left: 3px solid #8B5CF6;
                        padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
              ${safeBody}
            </div>
            <p>You can view the full conversation in the Vibely app under
               Settings → Support & Feedback → Your Requests.</p>
            <p style="color: #888; font-size: 12px;">
              Ref: ${escapeHtml(ticket.reference_id)} · vibelymeet.com
            </p>
          </div>
        `,
            }),
          });

          if (!emailRes.ok) {
            const body = await emailRes.text();
            console.error("Resend email non-OK response for support reply:", emailRes.status, body);
            emailWarning = "Reply saved but email notification could not be sent.";
          }
        } catch (emailError) {
          console.error("Resend email failed for support reply:", emailError);
          emailWarning = "Reply saved but email notification could not be sent.";
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        notification_warning: notificationWarning,
        email_warning: emailWarning,
      }),
      {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error("send-support-reply:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
