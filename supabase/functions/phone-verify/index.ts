import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const TWILIO_VERIFY_SERVICE_SID = Deno.env.get("TWILIO_VERIFY_SERVICE_SID")!;

function isValidPhoneNumber(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action, phoneNumber, code } = body;

    const twilioAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

    // ═══════════════════════════════════════════════════════════
    // ACTION 1: Send OTP via Twilio Verify
    // ═══════════════════════════════════════════════════════════
    if (action === "send_otp") {
      if (!phoneNumber || !isValidPhoneNumber(phoneNumber)) {
        return new Response(JSON.stringify({ error: "Invalid phone number format. Must start with + followed by 8-15 digits." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check if this phone number is already verified by ANOTHER user
      const { data: existingUser } = await supabase
        .from("profiles")
        .select("id")
        .eq("phone_number", phoneNumber)
        .eq("phone_verified", true)
        .neq("id", user.id)
        .maybeSingle();

      if (existingUser) {
        return new Response(JSON.stringify({ error: "This phone number is already associated with another account." }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Rate limit: check if user recently requested an OTP (within 60s)
      const { data: profile } = await supabase
        .from("profiles")
        .select("phone_number, updated_at")
        .eq("id", user.id)
        .maybeSingle();

      if (profile?.phone_number === phoneNumber && profile?.updated_at) {
        const lastUpdate = new Date(profile.updated_at).getTime();
        const now = Date.now();
        if (now - lastUpdate < 60000) {
          return new Response(JSON.stringify({ error: "Please wait before requesting a new code." }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // Store the phone number (unverified) so we can rate-limit
      await supabase
        .from("profiles")
        .update({ phone_number: phoneNumber })
        .eq("id", user.id);

      // Call Twilio Verify API to send SMS
      const twilioRes = await fetch(
        `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/Verifications`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${twilioAuth}`,
          },
          body: new URLSearchParams({ To: phoneNumber, Channel: "sms" }),
        }
      );

      const twilioData = await twilioRes.json();

      if (!twilioRes.ok) {
        const twilioCode = twilioData?.code;
        const twilioMessage = twilioData?.message || "Unknown error";
        console.error("Twilio send error:", twilioCode, twilioMessage);

        let userMessage = "Failed to send verification code.";
        if (twilioCode === 21608 || twilioMessage.includes("unverified")) {
          userMessage = "Phone number not enabled. Please contact support.";
        } else if (twilioCode === 21211) {
          userMessage = "Invalid phone number format. Please check and try again.";
        } else if (twilioCode === 21614) {
          userMessage = "This phone number cannot receive SMS.";
        } else if (twilioCode === 60203 || twilioMessage.includes("Max")) {
          userMessage = "Too many attempts. Please wait 10 minutes.";
        } else if (twilioCode === 20003 || twilioMessage.includes("Authenticate")) {
          userMessage = "Verification service error. Please try again later.";
        }

        return new Response(JSON.stringify({ error: userMessage, debug: twilioCode }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════════════════════
    // ACTION 2: Verify OTP via Twilio Verify
    // ═══════════════════════════════════════════════════════════
    if (action === "verify_otp") {
      if (!phoneNumber || !isValidPhoneNumber(phoneNumber)) {
        return new Response(JSON.stringify({ error: "Invalid phone number." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!code || !/^\d{6}$/.test(code)) {
        return new Response(JSON.stringify({ error: "Invalid code format. Must be 6 digits." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Call Twilio Verify API to check code
      const twilioRes = await fetch(
        `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${twilioAuth}`,
          },
          body: new URLSearchParams({ To: phoneNumber, Code: code }),
        }
      );

      const twilioData = await twilioRes.json();

      if (twilioData.status === "approved") {
        // Update profile with verified phone
        await supabase
          .from("profiles")
          .update({
            phone_number: phoneNumber,
            phone_verified: true,
            phone_verified_at: new Date().toISOString(),
          })
          .eq("id", user.id);

        return new Response(JSON.stringify({ success: true, verified: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: false, error: "Invalid code. Please try again." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Phone verify error:", error);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
