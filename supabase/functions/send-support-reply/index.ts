import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type AdminCreateSupportReplyPayload = {
  success?: boolean;
  error?: string;
  message?: string;
  idempotent_replay?: boolean;
  ticket_id?: string;
  reply?: {
    id?: string;
  };
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sanitizeErrorMessage(reason: unknown): string {
  return String(reason instanceof Error ? reason.message : reason || "Unknown error")
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[token]")
    .replace(/\b(?:Bearer|Token)\s+[A-Za-z0-9._~+/=-]+/gi, "[token]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function statusForRpcError(error: string | undefined) {
  switch (error) {
    case "UNAUTHENTICATED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "VALIDATION_ERROR":
      return 400;
    default:
      return 400;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const service = createClient(supabaseUrl, serviceKey);

    const requestBody = await req.json().catch(() => ({}));
    const ticketId = typeof requestBody.ticket_id === "string" ? requestBody.ticket_id : "";
    const replyMessage = typeof requestBody.reply_message === "string" ? requestBody.reply_message.trim() : "";
    const sendEmail = requestBody.send_email !== false;
    const idempotencyKey = typeof requestBody.idempotency_key === "string" ? requestBody.idempotency_key : null;

    if (!ticketId || !replyMessage) {
      return jsonResponse({ error: "ticket_id and reply_message required" }, 400);
    }

    const { data: replyPayloadRaw, error: replyRpcError } = await userClient.rpc("admin_create_support_reply", {
      p_ticket_id: ticketId,
      p_message: replyMessage,
      p_idempotency_key: idempotencyKey,
    });

    if (replyRpcError) {
      return jsonResponse(
        {
          success: false,
          error: "RPC_ERROR",
          message: sanitizeErrorMessage(replyRpcError.message || "Failed to save support reply."),
        },
        400,
      );
    }

    const replyPayload = replyPayloadRaw as AdminCreateSupportReplyPayload | null;
    if (!replyPayload?.success) {
      return jsonResponse(
        {
          success: false,
          error: replyPayload?.error ?? "SAVE_FAILED",
          message: sanitizeErrorMessage(replyPayload?.message ?? "Failed to save support reply."),
        },
        statusForRpcError(replyPayload?.error),
      );
    }

    if (replyPayload.idempotent_replay) {
      return jsonResponse({
        success: true,
        idempotent_replay: true,
        ticket_id: replyPayload.ticket_id ?? ticketId,
        reply_id: replyPayload.reply?.id ?? null,
        notification_warning: null,
        email_warning: null,
      });
    }

    const { data: ticket, error: ticketError } = await service
      .from("support_tickets")
      .select("id, reference_id, user_id, user_email")
      .eq("id", ticketId)
      .single();

    if (ticketError || !ticket) {
      return jsonResponse({
        success: true,
        ticket_id: ticketId,
        reply_id: replyPayload.reply?.id ?? null,
        notification_warning: "Reply saved but notification context could not be loaded.",
        email_warning: sendEmail ? "Reply saved but email context could not be loaded." : null,
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
        console.error("send-notification failed:", notifyRes.status, sanitizeErrorMessage(txt));
        notificationWarning = "Reply saved but push notification could not be delivered.";
      }
    } catch (notifyError) {
      console.error("send-notification error for support reply:", notifyError);
      notificationWarning = "Reply saved but push notification could not be delivered.";
    }

    if (sendEmail && ticket.user_email) {
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey) {
        const safeBody = escapeHtml(replyMessage).replace(/\n/g, "<br/>");
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
               Settings -> Support & Feedback -> Your Requests.</p>
            <p style="color: #888; font-size: 12px;">
              Ref: ${escapeHtml(ticket.reference_id)} - vibelymeet.com
            </p>
          </div>
        `,
            }),
          });

          if (!emailRes.ok) {
            const body = await emailRes.text();
            console.error("Resend email non-OK response for support reply:", emailRes.status, sanitizeErrorMessage(body));
            emailWarning = "Reply saved but email notification could not be sent.";
          }
        } catch (emailError) {
          console.error("Resend email failed for support reply:", emailError);
          emailWarning = "Reply saved but email notification could not be sent.";
        }
      } else {
        emailWarning = "Reply saved but email notification is not configured.";
      }
    }

    return jsonResponse({
      success: true,
      ticket_id: ticketId,
      reply_id: replyPayload.reply?.id ?? null,
      notification_warning: notificationWarning,
      email_warning: emailWarning,
    });
  } catch (e) {
    console.error("send-support-reply:", e);
    return jsonResponse({ error: "INTERNAL_ERROR", message: sanitizeErrorMessage(e) }, 500);
  }
});
