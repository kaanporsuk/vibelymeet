import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { fetchWithProviderTimeout, providerFetchTimeoutMs } from "../_shared/provider-fetch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};
const PHONE_VERIFY_SEND_FLOW = "phone_verify_send";

// IMPORTANT: Always return HTTP 200. Use { success: false, error: "..." }
// for errors. The Supabase SDK discards response bodies for non-2xx codes.
function jsonResponse(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function maskPhoneForLog(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 0) return "invalid";
  const prefix = value.trim().startsWith("+") ? "+" : "";
  if (digits.length <= 4) return `${prefix}****`;
  return `${prefix}${digits.slice(0, 2)}****${digits.slice(-2)}`;
}

function logInfo(stage: string, meta: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ source: "phone-verify", stage, ...meta }));
}

function logWarn(stage: string, meta: Record<string, unknown> = {}) {
  console.warn(JSON.stringify({ source: "phone-verify", stage, ...meta }));
}

function logError(stage: string, meta: Record<string, unknown> = {}) {
  console.error(JSON.stringify({ source: "phone-verify", stage, ...meta }));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID();

  try {
    const body = await req.json();
    const { action, phoneNumber, code } = body;
    const loggedPhone = maskPhoneForLog(phoneNumber);
    logInfo("request_received", { requestId, action, phone: loggedPhone });

    if (!action || !phoneNumber) {
      return jsonResponse({ success: false, error: "Missing action or phone number." });
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      logWarn("auth_header_missing", { requestId });
      return jsonResponse({ success: false, error: "Not authenticated." });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      logWarn("auth_failed", { requestId, message: authError?.message ?? "missing_user" });
      return jsonResponse({ success: false, error: "Authentication failed. Please log in again." });
    }
    logInfo("auth_resolved", { requestId, userId: user.id });

    if (action !== "send_otp" && action !== "verify_otp") {
      return jsonResponse({ success: false, error: "Invalid action." });
    }

    const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
    const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
    const TWILIO_VERIFY_SID = Deno.env.get("TWILIO_VERIFY_SERVICE_SID");

    if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_VERIFY_SID) {
      const missingCount =
        Number(!TWILIO_SID) +
        Number(!TWILIO_TOKEN) +
        Number(!TWILIO_VERIFY_SID);
      logError("twilio_config_missing", { requestId, missingCount });
      return jsonResponse({
        success: false,
        error: "SMS service is temporarily unavailable. Please try again later.",
      });
    }

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const twilioAuth = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);

    // ═══ SEND OTP ═══
    if (action === "send_otp") {
      // Rate limiting: max 5 SMS per hour per user
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count: attemptCount } = await admin
        .from("verification_attempts")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("flow", PHONE_VERIFY_SEND_FLOW)
        .gte("attempt_at", oneHourAgo);

      if (attemptCount !== null && attemptCount >= 5) {
        return jsonResponse({
          success: false,
          error: "Too many verification attempts. Please try again in an hour.",
          errorType: "rate_limited",
          retry_after: 3600,
        });
      }

      // Anti-VoIP: Twilio Lookup V2
      try {
        const lookupUrl = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(phoneNumber)}?Fields=line_type_intelligence`;
        const lookupRes = await fetchWithProviderTimeout(lookupUrl, {
          headers: { "Authorization": `Basic ${twilioAuth}` },
        }, {
          provider: "twilio",
          operation: "lookup_phone",
          timeoutMs: providerFetchTimeoutMs("twilio", "lookup_phone", 5_000),
        });
        const lookupData = await lookupRes.json();
        const lineType = lookupData?.line_type_intelligence?.type;
        logInfo("lookup_complete", { requestId, lineType: lineType ?? null, phone: loggedPhone });

        if (lineType && lineType !== "mobile" && lineType !== "cellphone") {
          return jsonResponse({
            success: false,
            error: "Please use a real mobile phone number. Virtual numbers, VoIP, and landlines are not accepted.",
            errorType: "invalid_number_type",
          });
        }
      } catch {
        // If Lookup fails, continue anyway (don't block legitimate users)
        logWarn("lookup_failed_continue", { requestId });
      }

      // Check duplicate phone
      const { data: existing } = await admin
        .from("profiles")
        .select("id")
        .eq("phone_number", phoneNumber)
        .eq("phone_verified", true)
        .neq("id", user.id)
        .maybeSingle();

      if (existing) {
        logWarn("duplicate_verified_phone_blocked", { requestId, phone: loggedPhone });
        return jsonResponse({
          success: false,
          error: "We could not send a code to this number. Please try another mobile number.",
          errorType: "verification_unavailable",
        });
      }

      // Log attempt
      await admin.from("verification_attempts").insert({
        user_id: user.id,
        flow: PHONE_VERIFY_SEND_FLOW,
        ip_address: req.headers.get("x-forwarded-for") || "unknown",
      });

      const url = `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SID}/Verifications`;
      logInfo("twilio_send_start", { requestId, phone: loggedPhone });

      let res: Response;
      try {
        res = await fetchWithProviderTimeout(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": `Basic ${twilioAuth}`,
          },
          body: new URLSearchParams({ To: phoneNumber, Channel: "sms" }).toString(),
        }, {
          provider: "twilio",
          operation: "verify_send",
          timeoutMs: providerFetchTimeoutMs("twilio", "verify_send", 8_000),
        });
      } catch (error) {
        logWarn("twilio_send_fetch_failed", {
          requestId,
          errorType: error instanceof Error ? error.name : typeof error,
        });
        return jsonResponse({
          success: false,
          error: "SMS service is temporarily unavailable. Please try again later.",
          errorType: "provider_unavailable",
        });
      }

      const data = await res.json();
      logInfo("twilio_send_response", {
        requestId,
        status: res.status,
        providerStatus: data?.status ?? null,
        hasErrorCode: data?.code !== undefined,
      });

      if (!res.ok) {
        const twilioCode = data?.code;
        logError("twilio_send_error", { requestId, twilioCode: twilioCode ?? null });

        const errorMap: Record<number, string> = {
          20003: "SMS service is temporarily unavailable. Please try again later.",
          20404: "SMS service is temporarily unavailable. Please try again later.",
          21211: "Invalid phone number format.",
          21408: "SMS to this country is not enabled in Twilio.",
          21610: "This number opted out of SMS. Text START to re-enable.",
          21614: "This number cannot receive SMS.",
          60200: "Twilio service error. Try again in 1 minute.",
          60203: "Too many attempts. Wait 10 minutes.",
          60205: "Too many SMS sent to this number. Wait and retry.",
        };

        return jsonResponse({
          success: false,
          error: errorMap[twilioCode] || "SMS service is temporarily unavailable. Please try again later.",
          errorType: "provider_unavailable",
        });
      }

      logInfo("otp_send_accepted", { requestId, providerStatus: data?.status ?? null });
      return jsonResponse({ success: true });
    }

    // ═══ VERIFY OTP ═══
    if (action === "verify_otp") {
      if (!code || code.length !== 6) {
        return jsonResponse({ success: false, error: "Enter the 6-digit code." });
      }

      const url = `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SID}/VerificationCheck`;
      logInfo("twilio_verify_start", { requestId, phone: loggedPhone });

      let res: Response;
      try {
        res = await fetchWithProviderTimeout(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": `Basic ${twilioAuth}`,
          },
          body: new URLSearchParams({ To: phoneNumber, Code: code }).toString(),
        }, {
          provider: "twilio",
          operation: "verify_check",
          timeoutMs: providerFetchTimeoutMs("twilio", "verify_check", 8_000),
        });
      } catch (error) {
        logWarn("twilio_verify_fetch_failed", {
          requestId,
          errorType: error instanceof Error ? error.name : typeof error,
        });
        return jsonResponse({
          success: false,
          error: "Verification service is temporarily unavailable. Please try again later.",
          errorType: "provider_unavailable",
        });
      }

      const data = await res.json();
      logInfo("twilio_verify_response", {
        requestId,
        status: res.status,
        providerStatus: data?.status ?? null,
        hasErrorCode: data?.code !== undefined,
      });

      if (!res.ok) {
        const errCode = data?.code;
        if (errCode === 60202) return jsonResponse({ success: false, error: "Max attempts reached. Request a new code." });
        if (errCode === 20404) return jsonResponse({ success: false, error: "Code expired. Request a new one." });
        return jsonResponse({
          success: false,
          error: "Verification service is temporarily unavailable. Please try again later.",
          errorType: "provider_unavailable",
        });
      }

      if (data.status !== "approved") {
        return jsonResponse({ success: false, error: "Wrong code. Please try again." });
      }

      // 1:1 association check
      const { data: existingProfile } = await admin
        .from("profiles")
        .select("id")
        .eq("phone_number", phoneNumber)
        .eq("phone_verified", true)
        .neq("id", user.id)
        .maybeSingle();

      if (existingProfile) {
        return jsonResponse({
          success: false,
          error: "This phone number is already associated with another account.",
          errorType: "phone_already_claimed",
        });
      }

      const { error: updateErr } = await admin.rpc(
        "mark_profile_phone_verified_from_server",
        {
          p_user_id: user.id,
          p_phone_number: phoneNumber,
          p_verified_at: new Date().toISOString(),
        },
      );

      if (updateErr) {
        logError("profile_update_failed", { requestId, code: updateErr.code ?? "unknown" });
        return jsonResponse({ success: false, error: "Verified but profile update failed. Try again." });
      }

      logInfo("phone_verified", { requestId, userId: user.id });
      return jsonResponse({ success: true, verified: true });
    }

    return jsonResponse({ success: false, error: "Invalid action." });
  } catch (err) {
    logError("unhandled_error", {
      requestId,
      errorType: err instanceof Error ? err.name : typeof err,
    });
    return jsonResponse({ success: false, error: "An unexpected error occurred. Please try again." });
  }
});
