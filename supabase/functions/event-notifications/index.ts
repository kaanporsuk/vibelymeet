import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { checkRateLimit, createRateLimitResponse } from "../_shared/rate-limiter.ts";
import {
  authenticateAdminRequest,
  sanitizeErrorMessage,
} from "../_shared/adminAuth.ts";
import {
  corsHeadersForRequest,
  isBrowserOriginRejected,
  jsonResponse,
  preflightResponse,
} from "../_shared/cors.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const EMAIL_BATCH_SIZE = 25;

interface EventNotificationRequest {
  type: "event_created" | "capacity_alert";
  eventId: string;
  capacityPercent?: number;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncateText(value: unknown, maxLength: number): string {
  const text = String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function emailSubjectText(value: unknown, fallback: string): string {
  const text = String(value ?? fallback)
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return text || fallback;
}

function isValidCapacityPercent(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1000;
}

function formatEventDateUtc(value: unknown): string {
  const date = typeof value === "string" ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function eventScheduleEndMs(event: Record<string, unknown>): number | null {
  const rawDate = typeof event.event_date === "string" ? event.event_date : "";
  const startsAt = new Date(rawDate);
  if (Number.isNaN(startsAt.getTime())) return null;
  const duration =
    typeof event.duration_minutes === "number" && Number.isFinite(event.duration_minutes)
      ? event.duration_minutes
      : 60;
  return startsAt.getTime() + duration * 60 * 1000;
}

function eventNotificationBlockReason(event: Record<string, unknown>): string | null {
  const status = String(event.status ?? "").trim().toLowerCase();
  const endsAtMs = eventScheduleEndMs(event);
  if (event.archived_at || status === "archived") return "event_archived";
  if (event.ended_at || status === "ended" || status === "completed") return "event_ended";
  if (status === "draft") return "event_draft";
  if (status === "cancelled") return "event_cancelled";
  if (endsAtMs == null) return "event_date_invalid";
  if (Date.now() >= endsAtMs) return "event_closed";
  return null;
}

function announcementAudienceSkipReason(event: Record<string, unknown>): string | null {
  const visibility = String(event.visibility ?? "all").trim().toLowerCase() || "all";
  const scope = String(event.scope ?? "global").trim().toLowerCase() || "global";
  const isLocationSpecific = event.is_location_specific === true;
  if (visibility !== "all") return "restricted_visibility_requires_targeting";
  if (scope !== "global" || isLocationSpecific) return "restricted_location_requires_targeting";
  return null;
}

// Send email via Resend API
async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.log("Resend email provider not configured, skipping event notification email");
    return false;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "Vibely <notifications@vibelymeet.com>",
      to: [to],
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("event-notifications resend_failed", {
      status: response.status,
      bodyLength: error.length,
    });
    return false;
  }

  return true;
}

function providerNotConfiguredResponse(req: Request): Response {
  return jsonResponse(req, {
    success: false,
    error: "email_provider_not_configured",
    message: "Event notification email provider is not configured.",
  }, { status: 503 });
}

function deliverySummary(attempted: number, notified: number): Record<string, unknown> {
  const failed = Math.max(0, attempted - notified);
  if (failed === 0) return { success: true, notified, attempted, failed };
  return {
    success: false,
    error: failed === attempted ? "email_delivery_failed" : "email_delivery_partial_failure",
    notified,
    attempted,
    failed,
  };
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight
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
    const auth = await authenticateAdminRequest(req);
    if (!auth.ok) return auth.response;

    // Rate limiting: 5 notification requests per hour
    const rateLimitResult = await checkRateLimit(auth.context.user.id, {
      functionName: "event-notifications",
      maxRequests: 5,
      windowMs: 60 * 60 * 1000, // 1 hour
    });

    if (!rateLimitResult.allowed) {
      return createRateLimitResponse(rateLimitResult, corsHeadersForRequest(req));
    }

    const body = (await req.json().catch(() => null)) as Partial<EventNotificationRequest> | null;
    const type = body?.type;
    const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
    const capacityPercent = body?.capacityPercent;

    if ((type !== "event_created" && type !== "capacity_alert") || !eventId) {
      return jsonResponse(req, { success: false, error: "invalid_request" }, { status: 400 });
    }
    if (type === "capacity_alert" && !isValidCapacityPercent(capacityPercent)) {
      return jsonResponse(req, { success: false, error: "invalid_capacity_percent" }, { status: 400 });
    }

    // Fetch event details
    const { data: event, error: eventError } = await auth.context.adminClient
      .from("events")
      .select("*")
      .eq("id", eventId)
      .single();

    if (eventError || !event) {
      if (eventError) console.error("event-notifications event lookup failed", sanitizeErrorMessage(eventError.message));
      return jsonResponse(req, { success: false, error: "event_not_found" }, { status: 404 });
    }

    const lifecycleBlockReason = eventNotificationBlockReason(event);
    if (lifecycleBlockReason) {
      return jsonResponse(req, {
        success: false,
        error: lifecycleBlockReason,
        message: "Event notifications are only allowed for active, non-draft, non-archived event rows.",
      }, { status: 409 });
    }

    const formattedDate = formatEventDateUtc(event.event_date);
    const safeEventId = encodeURIComponent(String(event.id ?? eventId));
    const safeEventTitle = escapeHtml(event.title);
    const rawCityContext = [event.city, event.country]
      .map((part) => String(part ?? "").trim())
      .filter(Boolean)
      .join(", ");
    const safeCityContext = escapeHtml(rawCityContext);
    const safeDescription = escapeHtml(truncateText(event.description, 150));
    const eventTitleForSubject = emailSubjectText(event.title, "Vibely Event");

    if (type === "event_created") {
      const skipReason = announcementAudienceSkipReason(event);
      if (skipReason) {
        console.log("event-notifications event_created audience skipped", {
          reason: skipReason,
          eventId: safeEventId,
        });
        return jsonResponse(req, { success: true, notified: 0, skipped_reason: skipReason }, { status: 200 });
      }

      // Broad announcements are restricted to globally visible, all-tier events.
      const { data: profiles, error: profilesError } = await auth.context.adminClient
        .from("profiles")
        .select("id, name, verified_email")
        .eq("email_verified", true)
        .eq("email_unsubscribed", false)
        .not("verified_email", "is", null);
      if (profilesError) {
        console.error("event-notifications profile lookup failed", sanitizeErrorMessage(profilesError.message));
        return jsonResponse(req, { success: false, error: "recipient_lookup_failed" }, { status: 502 });
      }
      if ((profiles?.length ?? 0) > 0 && !RESEND_API_KEY) {
        return providerNotConfiguredResponse(req);
      }

      console.log(`Sending new event notification to ${profiles?.length || 0} users`);

      let notified = 0;
      let attempted = 0;
      for (let index = 0; index < (profiles?.length ?? 0); index += EMAIL_BATCH_SIZE) {
        const batch = (profiles ?? []).slice(index, index + EMAIL_BATCH_SIZE);
        attempted += batch.filter((profile) => Boolean(profile.verified_email)).length;
        const results = await Promise.allSettled(batch.map(async (profile) => {
          if (!profile.verified_email) return false;
          const safeProfileName = escapeHtml(profile.name || "there");

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
                Hey ${safeProfileName}, a new event just dropped!
              </p>

              <div style="background: rgba(139, 92, 246, 0.1); border: 2px solid rgba(139, 92, 246, 0.3); border-radius: 16px; padding: 24px; margin-bottom: 24px;">
                <h3 style="font-size: 18px; font-weight: bold; color: #8b5cf6; margin: 0 0 12px 0;">${safeEventTitle}</h3>
                <p style="color: #d1d5db; font-size: 14px; margin: 0 0 8px 0;">📅 ${escapeHtml(formattedDate)}</p>
                ${safeCityContext ? `<p style="color: #d1d5db; font-size: 14px; margin: 0 0 8px 0;">🌐 Online event · For ${safeCityContext}</p>` : '<p style="color: #d1d5db; font-size: 14px; margin: 0 0 8px 0;">🌐 Online event</p>'}
                ${event.description ? `<p style="color: #9ca3af; font-size: 13px; margin: 12px 0 0 0;">${safeDescription}</p>` : ''}
              </div>

              <div style="text-align: center;">
                <a href="https://www.vibelymeet.com/events/${safeEventId}" style="display: inline-block; background: linear-gradient(135deg, #8b5cf6, #ec4899); color: white; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 600;">View Event</a>
              </div>

              <p style="color: #71717a; text-align: center; font-size: 12px; margin-top: 32px;">
                Don't miss out on meeting amazing people!
              </p>
            </div>
          </body>
          </html>
        `;

          return await sendEmail(profile.verified_email, `🎉 New Event: ${eventTitleForSubject}`, html);
        }));
        notified += results.filter((result) => result.status === "fulfilled" && result.value === true).length;
      }

      return jsonResponse(req, deliverySummary(attempted, notified), { status: 200 });
    }

    if (type === "capacity_alert") {
      // Fetch registered users for this event
      const { data: registrations, error: registrationsError } = await auth.context.adminClient
        .from("event_registrations")
        .select("profile_id")
        .eq("event_id", eventId)
        .eq("admission_status", "confirmed");
      if (registrationsError) {
        console.error("event-notifications registration lookup failed", sanitizeErrorMessage(registrationsError.message));
        return jsonResponse(req, { success: false, error: "recipient_lookup_failed" }, { status: 502 });
      }

      const profileIds = registrations?.map(r => r.profile_id) || [];
      
      if (profileIds.length === 0) {
        return jsonResponse(req, { success: true, notified: 0 }, { status: 200 });
      }

      const { data: profiles, error: profilesError } = await auth.context.adminClient
        .from("profiles")
        .select("id, name, verified_email")
        .in("id", profileIds)
        .eq("email_verified", true)
        .eq("email_unsubscribed", false)
        .not("verified_email", "is", null);
      if (profilesError) {
        console.error("event-notifications profile lookup failed", sanitizeErrorMessage(profilesError.message));
        return jsonResponse(req, { success: false, error: "recipient_lookup_failed" }, { status: 502 });
      }
      if ((profiles?.length ?? 0) > 0 && !RESEND_API_KEY) {
        return providerNotConfiguredResponse(req);
      }

      console.log(`Sending capacity alert to ${profiles?.length || 0} registered users`);

      let notified = 0;
      let attempted = 0;
      for (let index = 0; index < (profiles?.length ?? 0); index += EMAIL_BATCH_SIZE) {
        const batch = (profiles ?? []).slice(index, index + EMAIL_BATCH_SIZE);
        attempted += batch.filter((profile) => Boolean(profile.verified_email)).length;
        const results = await Promise.allSettled(batch.map(async (profile) => {
          if (!profile.verified_email) return false;
          const safeProfileName = escapeHtml(profile.name || "there");
          const safeCapacityPercent = escapeHtml(capacityPercent);

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
                Hey ${safeProfileName}, "${safeEventTitle}" is ${safeCapacityPercent}% full!
              </p>

              <div style="background: rgba(251, 146, 60, 0.1); border: 2px solid rgba(251, 146, 60, 0.3); border-radius: 16px; padding: 24px; text-align: center; margin-bottom: 24px;">
                <p style="font-size: 36px; font-weight: bold; color: #fb923c; margin: 0;">${safeCapacityPercent}%</p>
                <p style="color: #d1d5db; font-size: 14px; margin: 8px 0 0 0;">Capacity Filled</p>
              </div>

              <p style="color: #9ca3af; text-align: center; font-size: 14px; margin-bottom: 24px;">
                Good news - you're already registered! 🎉<br>
                Invite your friends before spots run out.
              </p>

              <div style="text-align: center;">
                <a href="https://www.vibelymeet.com/events/${safeEventId}" style="display: inline-block; background: linear-gradient(135deg, #fb923c, #f97316); color: white; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 600;">View Event</a>
              </div>
            </div>
          </body>
          </html>
        `;

          return await sendEmail(profile.verified_email, `🔥 "${eventTitleForSubject}" is ${capacityPercent}% Full!`, html);
        }));
        notified += results.filter((result) => result.status === "fulfilled" && result.value === true).length;
      }

      return jsonResponse(req, deliverySummary(attempted, notified), { status: 200 });
    }

    return jsonResponse(req, { success: false, error: "invalid_notification_type" }, { status: 400 });

  } catch (error) {
    console.error("Error in event-notifications function", sanitizeErrorMessage(error));
    return jsonResponse(req, { success: false, error: "server_error" }, { status: 500 });
  }
};

serve(handler);
