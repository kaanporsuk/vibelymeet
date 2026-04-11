import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const EMAIL_VERIFICATION_FROM_EMAIL =
  Deno.env.get("EMAIL_VERIFICATION_FROM_EMAIL") ||
  "Vibely <hello@vibelymeet.com>";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SendOtpRequest {
  email: string;
}

interface VerifyOtpRequest {
  email: string;
  code: string;
}

interface ApiErrorPayload {
  error: string;
  code?: string;
  status?: number;
}

function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function logStage(stage: string, meta: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      source: "email-verification",
      stage,
      ...meta,
    }),
  );
}

function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const normalized = input.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

// Generate a 6-digit OTP using cryptographically secure random
function generateOtp(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  // Generate 6-digit number from cryptographically secure random
  const otp = (array[0] % 900000) + 100000;
  return otp.toString();
}

// Hash OTP code using bcrypt
async function hashOtp(otp: string): Promise<string> {
  return await bcrypt.hash(otp);
}

// Verify OTP code against hash
async function verifyOtpHash(otp: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(otp, hash);
}

// Send email via Resend API
async function sendEmail(
  to: string,
  otp: string,
  requestId: string,
): Promise<{ ok: true } | { ok: false; status: number; payload: ApiErrorPayload }> {
  if (!RESEND_API_KEY) {
    logStage("resend_missing_api_key", { requestId });
    return {
      ok: false,
      status: 500,
      payload: {
        error: "Email provider is not configured.",
        code: "resend_api_key_missing",
      },
    };
  }

  logStage("resend_request_start", { requestId, to, from: EMAIL_VERIFICATION_FROM_EMAIL });
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: EMAIL_VERIFICATION_FROM_EMAIL,
      to: [to],
      subject: "Your Vibely Verification Code",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0a0a0a; color: #ffffff; padding: 40px 20px; margin: 0;">
          <div style="max-width: 400px; margin: 0 auto; background: linear-gradient(145deg, #1a1a2e, #16162a); border-radius: 24px; padding: 40px; border: 1px solid rgba(139, 92, 246, 0.2);">
            <div style="text-align:center;margin-bottom:24px;">
              <img src="https://vibelymeet.com/vibely-logo-full-gradient.png" alt="Vibely" height="36" style="height:36px;display:inline-block;" />
            </div>
            
            <h2 style="font-size: 20px; font-weight: 600; text-align: center; margin-bottom: 16px; color: #ffffff;">Verify Your Email</h2>
            
            <p style="color: #a1a1aa; text-align: center; margin-bottom: 32px; font-size: 14px;">
              Enter this code to verify your email address
            </p>
            
            <div style="background: rgba(139, 92, 246, 0.1); border: 2px solid rgba(139, 92, 246, 0.3); border-radius: 16px; padding: 24px; text-align: center; margin-bottom: 32px;">
              <p style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #8b5cf6; margin: 0; font-family: monospace;">${otp}</p>
            </div>
            
            <p style="color: #71717a; text-align: center; font-size: 12px; margin: 0;">
              This code expires in 10 minutes.<br>
              If you didn't request this, please ignore this email.
            </p>
          </div>
        </body>
        </html>
      `,
    }),
  });

  const responseText = await response.text();
  let responseBody: unknown = null;
  try {
    responseBody = responseText ? JSON.parse(responseText) : null;
  } catch {
    responseBody = responseText;
  }

  logStage("resend_response", {
    requestId,
    status: response.status,
    ok: response.ok,
    body: responseBody,
  });

  if (!response.ok) {
    const resendMessage =
      typeof responseBody === "object" && responseBody !== null
        ? ((responseBody as { message?: unknown; error?: unknown }).message ??
          (responseBody as { message?: unknown; error?: unknown }).error)
        : responseBody;
    const errorMessage =
      typeof resendMessage === "string" && resendMessage.trim().length > 0
        ? resendMessage
        : "Email provider rejected the verification send request.";

    return {
      ok: false,
      status: response.status >= 500 ? 502 : response.status,
      payload: {
        error: `Unable to send verification email: ${errorMessage}`,
        code: "resend_rejected",
        status: response.status,
      },
    };
  }

  return { ok: true };
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const requestId = crypto.randomUUID();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Get the authorization header to identify the user
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      logStage("auth_header_missing", { requestId, method: req.method, path: req.url });
      return jsonResponse({ error: "Missing authorization header" }, 401);
    }

    // Create Supabase client with service role for admin operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    // Create client with user token to get user info
    const supabaseClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    // Get current user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      console.error("User error:", userError);
      logStage("auth_user_resolution_failed", {
        requestId,
        authError: userError?.message ?? "unknown",
      });
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const url = new URL(req.url);
    const action = url.pathname.split("/").pop();

    if (action === "send" && req.method === "POST") {
      // Send OTP
      logStage("send_entered", { requestId, userId: user.id });
      const { email }: SendOtpRequest = await req.json();
      const requestedEmail = normalizeEmail(email);
      const authEmail = normalizeEmail(user.email);
      logStage("send_user_resolved", {
        requestId,
        userId: user.id,
        authEmail,
        requestedEmail,
        emailConfirmedAt: user.email_confirmed_at ?? null,
      });
      
      if (!requestedEmail) {
        return jsonResponse({ error: "Email is required" }, 400);
      }

      if (!authEmail) {
        return jsonResponse({ error: "Add an email to your account before verifying it in-app." }, 200);
      }

      if (!user.email_confirmed_at) {
        return jsonResponse(
          { error: "Confirm the inbox link for your account email first, then verify it in-app." },
          200,
        );
      }

      if (requestedEmail !== authEmail) {
        return jsonResponse({ error: "Only the current email on your account can be verified." }, 200);
      }

      const otp = generateOtp();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      console.log(`Generating OTP for user ${user.id}, email: ${authEmail}`);

      // Delete any existing codes for this user
      const { error: deleteError } = await supabaseAdmin
        .from("email_verifications")
        .delete()
        .eq("user_id", user.id);
      if (deleteError) {
        console.error("Delete old verification code error:", deleteError);
        logStage("send_delete_existing_failed", {
          requestId,
          userId: user.id,
          error: deleteError.message,
        });
        return jsonResponse(
          { error: "Failed to reset previous verification code.", code: "delete_existing_failed" },
          500,
        );
      }

      // Hash the OTP before storing
      const hashedOtp = await hashOtp(otp);

      // Insert new verification code (hashed)
      const { error: insertError } = await supabaseAdmin
        .from("email_verifications")
        .insert({
          user_id: user.id,
          email: authEmail,
          code: hashedOtp,
          expires_at: expiresAt.toISOString(),
        });

      if (insertError) {
        console.error("Insert error:", insertError);
        logStage("send_insert_failed", {
          requestId,
          userId: user.id,
          error: insertError.message,
        });
        return jsonResponse(
          { error: "Failed to create verification code", code: "insert_failed" },
          500,
        );
      }
      logStage("send_insert_success", { requestId, userId: user.id });

      // Send email
      const resendResult = await sendEmail(authEmail, otp, requestId);
      if (!resendResult.ok) {
        return jsonResponse(resendResult.payload, resendResult.status);
      }

      console.log(`OTP sent successfully to ${authEmail}`);
      logStage("send_completed", { requestId, userId: user.id, email: authEmail });

      return jsonResponse({ success: true, message: "Verification code sent" }, 200);
    }

    if (action === "verify" && req.method === "POST") {
      // Verify OTP
      const { email, code }: VerifyOtpRequest = await req.json();
      const requestedEmail = normalizeEmail(email);
      const authEmail = normalizeEmail(user.email);

      if (!requestedEmail || !code) {
        return jsonResponse({ error: "Email and code are required" }, 400);
      }

      if (!authEmail) {
        return jsonResponse({ error: "Add an email to your account before verifying it in-app." }, 200);
      }

      if (!user.email_confirmed_at) {
        return jsonResponse(
          { error: "Confirm the inbox link for your account email first, then verify it in-app." },
          200,
        );
      }

      if (requestedEmail !== authEmail) {
        return jsonResponse({ error: "Only the current email on your account can be verified." }, 200);
      }

      console.log(`Verifying OTP for user ${user.id}, email: ${authEmail}`);

      // Check failed attempt count (max 7 per hour)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count: attemptCount, error: countError } = await supabaseAdmin
        .from("verification_attempts")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gte("attempt_at", oneHourAgo);

      if (countError) {
        console.error("Failed attempt count error:", countError);
      }

      const MAX_ATTEMPTS = 7;
      if ((attemptCount ?? 0) >= MAX_ATTEMPTS) {
        console.log(`User ${user.id} exceeded max verification attempts (${attemptCount})`);
        return jsonResponse(
          {
            error: "Too many failed attempts. Please try again later.",
            retryAfter: 3600,
          },
          429,
        );
      }

      // Find the verification record (without matching code - we'll verify the hash)
      const { data: verification, error: findError } = await supabaseAdmin
        .from("email_verifications")
        .select("*")
        .eq("user_id", user.id)
        .eq("email", authEmail)
        .is("verified_at", null)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

      if (findError) {
        console.error("Find error:", findError);
        return jsonResponse({ error: "Verification failed" }, 500);
      }

      if (!verification) {
        return jsonResponse({ error: "Invalid or expired verification code" }, 400);
      }

      // Verify the OTP against the stored hash
      const isValidCode = await verifyOtpHash(code, verification.code);
      
      if (!isValidCode) {
        // Record failed attempt
        await supabaseAdmin
          .from("verification_attempts")
          .insert({ user_id: user.id });
        
        const remainingAttempts = MAX_ATTEMPTS - ((attemptCount ?? 0) + 1);
        console.log(`Invalid OTP attempt for user ${user.id}. Remaining attempts: ${remainingAttempts}`);
        
        return jsonResponse(
          {
            error: "Invalid or expired verification code",
            remainingAttempts: Math.max(0, remainingAttempts),
          },
          400,
        );
      }

      // Success - clear failed attempts for this user
      await supabaseAdmin
        .from("verification_attempts")
        .delete()
        .eq("user_id", user.id);

      // Mark as verified and delete the verification record for security
      await supabaseAdmin
        .from("email_verifications")
        .delete()
        .eq("id", verification.id);

      // Update profile
      const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .update({ 
          email_verified: true,
          verified_email: user.email ?? authEmail,
        })
        .eq("id", user.id);

      if (profileError) {
        console.error("Profile update error:", profileError);
      }

      console.log(`Email verified successfully for user ${user.id}`);

      return jsonResponse({ success: true, message: "Email verified successfully" }, 200);
    }

    return jsonResponse({ error: "Invalid action" }, 400);

  } catch (error: any) {
    console.error("Error in email-verification function:", error);
    return jsonResponse({ error: error.message }, 500);
  }
};

serve(handler);
