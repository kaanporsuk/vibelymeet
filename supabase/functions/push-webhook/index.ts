import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

interface FCMDeliveryReceipt {
  messageId: string;
  status: "delivered" | "failed";
  error?: {
    code: string;
    message: string;
  };
  timestamp: string;
}

interface APNsDeliveryReceipt {
  apns_id: string;
  status: "success" | "failure";
  reason?: string;
  timestamp: number;
}

interface WebhookPayload {
  provider: "fcm" | "apns" | "web";
  event_type: "sent" | "delivered" | "opened" | "clicked" | "failed" | "bounced";
  message_id: string;
  user_id?: string;
  device_token?: string;
  platform?: "ios" | "android" | "web" | "pwa";
  error_code?: string;
  error_message?: string;
  timestamp?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const webhookSecret = Deno.env.get("PUSH_WEBHOOK_SECRET");

    // Verify webhook secret if configured
    const providedSecret = req.headers.get("x-webhook-secret");
    if (webhookSecret && providedSecret !== webhookSecret) {
      console.error("Invalid webhook secret");
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json();

    // Handle different webhook formats
    const url = new URL(req.url);
    const provider = url.searchParams.get("provider") || body.provider;

    let events: WebhookPayload[] = [];

    if (provider === "fcm") {
      // Firebase Cloud Messaging delivery receipts
      events = parseFCMWebhook(body);
    } else if (provider === "apns") {
      // Apple Push Notification Service callbacks
      events = parseAPNsWebhook(body);
    } else if (provider === "web") {
      // Web push delivery/interaction events
      events = parseWebPushWebhook(body);
    } else {
      // Generic webhook format
      events = Array.isArray(body) ? body : [body];
    }

    console.log(`Processing ${events.length} notification events from ${provider}`);

    // Process each event
    for (const event of events) {
      await processNotificationEvent(supabase, event);
    }

    return new Response(
      JSON.stringify({ success: true, processed: events.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Webhook processing error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function parseFCMWebhook(body: any): WebhookPayload[] {
  // FCM Data Messages or Delivery Receipts
  if (body.message_id) {
    return [{
      provider: "fcm",
      event_type: body.message_type === "ack" ? "delivered" : 
                  body.message_type === "nack" ? "failed" : "sent",
      message_id: body.message_id,
      platform: body.platform || "android",
      error_code: body.error,
      error_message: body.error_description,
      timestamp: body.sent_timestamp || new Date().toISOString(),
    }];
  }
  
  // Batch delivery receipts
  if (body.receipts && Array.isArray(body.receipts)) {
    return body.receipts.map((receipt: FCMDeliveryReceipt) => ({
      provider: "fcm" as const,
      event_type: receipt.status === "delivered" ? "delivered" : "failed",
      message_id: receipt.messageId,
      platform: "android" as const,
      error_code: receipt.error?.code,
      error_message: receipt.error?.message,
      timestamp: receipt.timestamp,
    }));
  }

  return [];
}

function parseAPNsWebhook(body: any): WebhookPayload[] {
  // APNs feedback/delivery events
  if (body.apns_id) {
    return [{
      provider: "apns",
      event_type: body.status === "success" ? "delivered" : "failed",
      message_id: body.apns_id,
      platform: "ios",
      error_code: body.reason,
      error_message: body.reason,
      timestamp: body.timestamp ? new Date(body.timestamp * 1000).toISOString() : new Date().toISOString(),
    }];
  }

  // Batch feedback
  if (body.notifications && Array.isArray(body.notifications)) {
    return body.notifications.map((notif: APNsDeliveryReceipt) => ({
      provider: "apns" as const,
      event_type: notif.status === "success" ? "delivered" : "failed",
      message_id: notif.apns_id,
      platform: "ios" as const,
      error_code: notif.reason,
      error_message: notif.reason,
      timestamp: notif.timestamp ? new Date(notif.timestamp * 1000).toISOString() : new Date().toISOString(),
    }));
  }

  return [];
}

function parseWebPushWebhook(body: any): WebhookPayload[] {
  // Web Push API events (from service worker)
  return [{
    provider: "web",
    event_type: body.event_type || "delivered",
    message_id: body.message_id || body.tag,
    user_id: body.user_id,
    platform: body.platform || "web",
    timestamp: body.timestamp || new Date().toISOString(),
  }];
}

async function processNotificationEvent(supabase: any, event: WebhookPayload) {
  const statusMap: Record<string, string> = {
    sent: "sent",
    delivered: "delivered",
    opened: "opened",
    clicked: "clicked",
    failed: "failed",
    bounced: "bounced",
  };

  const status = statusMap[event.event_type] || "sent";
  const now = new Date().toISOString();

  // Try to find existing event by message ID
  let query = supabase
    .from("push_notification_events")
    .select("id");

  if (event.provider === "fcm" && event.message_id) {
    query = query.eq("fcm_message_id", event.message_id);
  } else if (event.provider === "apns" && event.message_id) {
    query = query.eq("apns_message_id", event.message_id);
  } else if (event.user_id) {
    query = query.eq("user_id", event.user_id);
  }

  const { data: existingEvent } = await query.maybeSingle();

  if (existingEvent) {
    // Update existing event
    const updateData: Record<string, any> = {
      status,
    };

    if (event.event_type === "sent") updateData.sent_at = event.timestamp || now;
    if (event.event_type === "delivered") updateData.delivered_at = event.timestamp || now;
    if (event.event_type === "opened") updateData.opened_at = event.timestamp || now;
    if (event.event_type === "clicked") updateData.clicked_at = event.timestamp || now;
    if (event.error_code) updateData.error_code = event.error_code;
    if (event.error_message) updateData.error_message = event.error_message;

    const { error } = await supabase
      .from("push_notification_events")
      .update(updateData)
      .eq("id", existingEvent.id);

    if (error) {
      console.error("Failed to update notification event:", error);
    } else {
      console.log(`Updated event ${existingEvent.id} to status: ${status}`);
    }
  } else if (event.user_id) {
    // Create new event if we have user_id
    const insertData: Record<string, any> = {
      user_id: event.user_id,
      platform: event.platform || "web",
      status,
      device_token: event.device_token,
    };

    if (event.provider === "fcm") insertData.fcm_message_id = event.message_id;
    if (event.provider === "apns") insertData.apns_message_id = event.message_id;
    if (event.event_type === "sent") insertData.sent_at = event.timestamp || now;
    if (event.event_type === "delivered") insertData.delivered_at = event.timestamp || now;
    if (event.error_code) insertData.error_code = event.error_code;
    if (event.error_message) insertData.error_message = event.error_message;

    const { error } = await supabase
      .from("push_notification_events")
      .insert(insertData);

    if (error) {
      console.error("Failed to insert notification event:", error);
    } else {
      console.log(`Inserted new event for user ${event.user_id} with status: ${status}`);
    }
  }
}
