import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const responseHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    // ── Step 1: Parse request ──
    const body = await req.json();
    const { action, phoneNumber, code } = body;
    console.log("📱 Phone verify request:", { action, phoneNumber: phoneNumber?.replace(/\d(?=\d{4})/g, "*") });

    if (!action || !phoneNumber) {
      return new Response(
        JSON.stringify({ error: "Missing action or phoneNumber" }),
        { status: 400, headers: responseHeaders }
      );
    }

    // ── Step 2: Verify Twilio credentials exist ──
    const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
    const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
    const TWILIO_VERIFY_SERVICE_SID = Deno.env.get("TWILIO_VERIFY_SERVICE_SID");

    console.log("🔑 Twilio credentials check:", {
      hasAccountSid: !!TWILIO_ACCOUNT_SID,
      accountSidPrefix: TWILIO_ACCOUNT_SID?.substring(0, 4) || "MISSING",
      hasAuthToken: !!TWILIO_AUTH_TOKEN,
      authTokenLength: TWILIO_AUTH_TOKEN?.length || 0,
      hasVerifyServiceSid: !!TWILIO_VERIFY_SERVICE_SID,
      verifyServicePrefix: TWILIO_VERIFY_SERVICE_SID?.substring(0, 4) || "MISSING",
    });

    // ── Health check endpoint ──
    if (action === "health_check") {
      return new Response(
        JSON.stringify({
          healthy: true,
          hasTwilioSid: !!TWILIO_ACCOUNT_SID,
          hasTwilioToken: !!TWILIO_AUTH_TOKEN,
          hasVerifyService: !!TWILIO_VERIFY_SERVICE_SID,
          timestamp: new Date().toISOString(),
        }),
        { status: 200, headers: responseHeaders }
      );
    }

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_VERIFY_SERVICE_SID) {
      const missing: string[] = [];
      if (!TWILIO_ACCOUNT_SID) missing.push("TWILIO_ACCOUNT_SID");
      if (!TWILIO_AUTH_TOKEN) missing.push("TWILIO_AUTH_TOKEN");
      if (!TWILIO_VERIFY_SERVICE_SID) missing.push("TWILIO_VERIFY_SERVICE_SID");

      console.error("❌ Missing Twilio secrets:", missing.join(", "));
      return new Response(
        JSON.stringify({
          error: "SMS service not configured. Please contact support.",
          debug: `Missing: ${missing.join(", ")}`,
        }),
        { status: 500, headers: responseHeaders }
      );
    }

    // ── Step 3: Authenticate user ──
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers: responseHeaders }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      console.error("❌ Auth error:", userError?.message);
      return new Response(
        JSON.stringify({ error: "Authentication failed" }),
        { status: 401, headers: responseHeaders }
      );
    }
    console.log("✅ User authenticated:", user.id);

    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // ═══════════════════════════════════════════════════════════
    // ACTION: send_otp
    // ═══════════════════════════════════════════════════════════
    if (action === "send_otp") {
      // Check if phone already verified by another user
      const { data: existingUser } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("phone_number", phoneNumber)
        .eq("phone_verified", true)
        .neq("id", user.id)
        .maybeSingle();

      if (existingUser) {
        console.log("⚠️ Phone already verified by another user");
        return new Response(
          JSON.stringify({ error: "This phone number is already verified by another account." }),
          { status: 400, headers: responseHeaders }
        );
      }

      // Call Twilio Verify API to send OTP
      const twilioUrl = `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/Verifications`;
      const twilioBody = new URLSearchParams({ To: phoneNumber, Channel: "sms" });

      console.log("📤 Sending Twilio request:", {
        url: twilioUrl,
        to: phoneNumber,
        channel: "sms",
        serviceSid: TWILIO_VERIFY_SERVICE_SID.substring(0, 6) + "...",
      });

      const twilioAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

      const twilioResponse = await fetch(twilioUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${twilioAuth}`,
        },
        body: twilioBody.toString(),
      });

      const twilioData = await twilioResponse.json();
      console.log("📥 Twilio response:", {
        status: twilioResponse.status,
        ok: twilioResponse.ok,
        sid: twilioData?.sid?.substring(0, 8) || "none",
        twilioStatus: twilioData?.status,
        code: twilioData?.code,
        message: twilioData?.message,
      });

      if (!twilioResponse.ok) {
        const twilioCode = twilioData?.code;
        const twilioMessage = twilioData?.message || "Unknown Twilio error";

        console.error("❌ Twilio API error:", { code: twilioCode, message: twilioMessage });

        let userMessage = "Failed to send verification code.";

        if (twilioCode === 60200) {
          userMessage = "Verification service error. Please try again in a minute.";
        } else if (twilioCode === 60203) {
          userMessage = "Too many attempts. Please wait 10 minutes and try again.";
        } else if (twilioCode === 60205) {
          userMessage = "Too many SMS sent. Please wait and try again later.";
        } else if (twilioCode === 21211) {
          userMessage = "Invalid phone number. Please check the number and try again.";
        } else if (twilioCode === 21408) {
          userMessage = "Cannot send SMS to this region. Please contact support.";
        } else if (twilioCode === 21610) {
          userMessage = "This number has opted out of SMS. Reply START to re-enable.";
        } else if (twilioCode === 21614) {
          userMessage = "This number cannot receive SMS messages.";
        } else if (twilioCode === 20003) {
          userMessage = "SMS service authentication error. Please contact support.";
        } else if (twilioCode === 20404) {
          userMessage = "SMS service not found. Please contact support.";
        } else if (twilioMessage.includes("not a valid phone number")) {
          userMessage = "Invalid phone number format. Please check and try again.";
        } else if (twilioMessage.includes("has not been enabled")) {
          userMessage = "SMS to this country is not enabled. Please contact support.";
        } else if (twilioMessage.includes("unverified")) {
          userMessage = "Twilio account needs upgrade. Please contact support.";
        } else {
          userMessage = `SMS failed: ${twilioMessage}`;
        }

        return new Response(
          JSON.stringify({ error: userMessage, debug: { code: twilioCode, message: twilioMessage } }),
          { status: 400, headers: responseHeaders }
        );
      }

      console.log("✅ OTP sent successfully. Twilio status:", twilioData.status);
      return new Response(
        JSON.stringify({ success: true, message: "Verification code sent" }),
        { status: 200, headers: responseHeaders }
      );
    }

    // ═══════════════════════════════════════════════════════════
    // ACTION: verify_otp
    // ═══════════════════════════════════════════════════════════
    if (action === "verify_otp") {
      if (!code) {
        return new Response(
          JSON.stringify({ error: "Verification code is required" }),
          { status: 400, headers: responseHeaders }
        );
      }

      const twilioUrl = `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`;
      const twilioBody = new URLSearchParams({ To: phoneNumber, Code: code });

      console.log("🔍 Verifying OTP for:", phoneNumber.replace(/\d(?=\d{4})/g, "*"));

      const twilioAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

      const twilioResponse = await fetch(twilioUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${twilioAuth}`,
        },
        body: twilioBody.toString(),
      });

      const twilioData = await twilioResponse.json();
      console.log("📥 Twilio verify response:", {
        status: twilioResponse.status,
        verifyStatus: twilioData?.status,
        valid: twilioData?.valid,
        code: twilioData?.code,
      });

      if (!twilioResponse.ok) {
        const twilioCode = twilioData?.code;
        let userMessage = "Verification failed. Please try again.";

        if (twilioCode === 60202) {
          userMessage = "Max verification attempts reached. Request a new code.";
        } else if (twilioCode === 20404) {
          userMessage = "Verification expired. Please request a new code.";
        }

        return new Response(
          JSON.stringify({ error: userMessage }),
          { status: 400, headers: responseHeaders }
        );
      }

      if (twilioData.status !== "approved") {
        console.log("❌ OTP not approved. Status:", twilioData.status);
        return new Response(
          JSON.stringify({ error: "Invalid verification code. Please check and try again." }),
          { status: 400, headers: responseHeaders }
        );
      }

      // Update profile
      console.log("✅ OTP verified. Updating profile for user:", user.id);

      const { error: updateError } = await supabaseAdmin
        .from("profiles")
        .update({
          phone_number: phoneNumber,
          phone_verified: true,
        })
        .eq("id", user.id);

      if (updateError) {
        console.error("❌ Profile update failed:", updateError.message);
        return new Response(
          JSON.stringify({ error: "Verified but failed to update profile. Please try again." }),
          { status: 500, headers: responseHeaders }
        );
      }

      console.log("✅ Phone verified and profile updated for user:", user.id);
      return new Response(
        JSON.stringify({ success: true, verified: true, message: "Phone number verified" }),
        { status: 200, headers: responseHeaders }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action. Use 'send_otp' or 'verify_otp'." }),
      { status: 400, headers: responseHeaders }
    );
  } catch (error) {
    console.error("💥 Unhandled error in phone-verify:", error);
    return new Response(
      JSON.stringify({
        error: "An unexpected error occurred. Please try again.",
        debug: error?.message || String(error),
      }),
      { status: 500, headers: responseHeaders }
    );
  }
});
