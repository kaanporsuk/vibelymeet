import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// IMPORTANT: Always return HTTP 200. Use { success: false, error: "..." }
// for errors. The Supabase SDK discards response bodies for non-2xx codes.
function jsonResponse(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, phoneNumber, code } = body;
    console.log("📱 Request:", { action, phone: phoneNumber?.slice(0, 6) + "****" });

    if (!action || !phoneNumber) {
      return jsonResponse({ success: false, error: "Missing action or phone number." });
    }

    const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
    const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
    const TWILIO_VERIFY_SID = Deno.env.get("TWILIO_VERIFY_SERVICE_SID");

    console.log("🔑 Secrets:", {
      sid: TWILIO_SID ? TWILIO_SID.slice(0, 6) + "..." : "MISSING",
      token: TWILIO_TOKEN ? `${TWILIO_TOKEN.length} chars` : "MISSING",
      verify: TWILIO_VERIFY_SID ? TWILIO_VERIFY_SID.slice(0, 6) + "..." : "MISSING",
    });

    if (action === "health_check") {
      return jsonResponse({
        success: true,
        hasSid: !!TWILIO_SID,
        hasToken: !!TWILIO_TOKEN,
        hasVerify: !!TWILIO_VERIFY_SID,
      });
    }

    if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_VERIFY_SID) {
      const missing = [
        !TWILIO_SID && "TWILIO_ACCOUNT_SID",
        !TWILIO_TOKEN && "TWILIO_AUTH_TOKEN",
        !TWILIO_VERIFY_SID && "TWILIO_VERIFY_SERVICE_SID",
      ].filter(Boolean);
      console.error("❌ Missing secrets:", missing);
      return jsonResponse({
        success: false,
        error: "SMS service not configured. Missing: " + missing.join(", "),
      });
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return jsonResponse({ success: false, error: "Not authenticated." });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error("❌ Auth failed:", authError?.message);
      return jsonResponse({ success: false, error: "Authentication failed. Please log in again." });
    }
    console.log("✅ User:", user.id);

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
        const lookupRes = await fetch(lookupUrl, {
          headers: { "Authorization": `Basic ${twilioAuth}` },
        });
        const lookupData = await lookupRes.json();
        const lineType = lookupData?.line_type_intelligence?.type;
        console.log("📞 Lookup:", { lineType, phone: phoneNumber.slice(0, 6) });

        if (lineType && lineType !== "mobile" && lineType !== "cellphone") {
          return jsonResponse({
            success: false,
            error: "Please use a real mobile phone number. Virtual numbers, VoIP, and landlines are not accepted.",
            errorType: "invalid_number_type",
          });
        }
      } catch (lookupErr) {
        // If Lookup fails, continue anyway (don't block legitimate users)
        console.warn("⚠️ Lookup failed, continuing:", lookupErr);
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
        return jsonResponse({
          success: false,
          error: "This number is already verified by another account.",
          errorType: "phone_already_claimed",
        });
      }

      // Log attempt
      await admin.from("verification_attempts").insert({
        user_id: user.id,
        ip_address: req.headers.get("x-forwarded-for") || "unknown",
      });

      const url = `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SID}/Verifications`;
      console.log("📤 Twilio send:", { to: phoneNumber, url: url.slice(0, 60) });

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${twilioAuth}`,
        },
        body: new URLSearchParams({ To: phoneNumber, Channel: "sms" }).toString(),
      });

      const data = await res.json();
      console.log("📥 Twilio:", { status: res.status, sid: data?.sid?.slice(0, 8), code: data?.code, msg: data?.message });

      if (!res.ok) {
        const twilioCode = data?.code;
        const msg = data?.message || "Unknown error";
        console.error("❌ Twilio error:", twilioCode, msg);

        const errorMap: Record<number, string> = {
          20003: "SMS authentication error — check Twilio credentials.",
          20404: "Verify service not found — check TWILIO_VERIFY_SERVICE_SID.",
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
          error: errorMap[twilioCode] || `Twilio error: ${msg}`,
          twilioCode,
        });
      }

      console.log("✅ OTP sent:", data.status);
      return jsonResponse({ success: true });
    }

    // ═══ VERIFY OTP ═══
    if (action === "verify_otp") {
      if (!code || code.length !== 6) {
        return jsonResponse({ success: false, error: "Enter the 6-digit code." });
      }

      const url = `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SID}/VerificationCheck`;
      console.log("🔍 Verify OTP for:", phoneNumber.slice(0, 6) + "****");

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${twilioAuth}`,
        },
        body: new URLSearchParams({ To: phoneNumber, Code: code }).toString(),
      });

      const data = await res.json();
      console.log("📥 Verify:", { status: res.status, approved: data?.status, code: data?.code });

      if (!res.ok) {
        const errCode = data?.code;
        if (errCode === 60202) return jsonResponse({ success: false, error: "Max attempts reached. Request a new code." });
        if (errCode === 20404) return jsonResponse({ success: false, error: "Code expired. Request a new one." });
        return jsonResponse({ success: false, error: data?.message || "Verification failed." });
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

      const { error: updateErr } = await admin
        .from("profiles")
        .update({
          phone_number: phoneNumber,
          phone_verified: true,
          phone_verified_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      if (updateErr) {
        console.error("❌ Profile update:", updateErr.message);
        return jsonResponse({ success: false, error: "Verified but profile update failed. Try again." });
      }

      console.log("✅ Phone verified for:", user.id);
      return jsonResponse({ success: true, verified: true });
    }

    return jsonResponse({ success: false, error: "Invalid action." });
  } catch (err) {
    console.error("💥 Crash:", err);
    return jsonResponse({ success: false, error: "An unexpected error occurred. Please try again." });
  }
});
