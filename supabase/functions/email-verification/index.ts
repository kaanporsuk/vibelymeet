import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import {
  normalizeEmailAddress,
  resolveCanonicalAuthEmail,
} from "../_shared/verificationSemantics.ts";
import { fetchWithProviderTimeout, providerFetchTimeoutMs } from "../_shared/provider-fetch.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const EMAIL_VERIFICATION_FROM_EMAIL =
  Deno.env.get("EMAIL_VERIFICATION_FROM_EMAIL") ||
  "Vibely <hello@vibelymeet.com>";
const EMAIL_OTP_VERIFY_FLOW = "email_otp_verify";

/** Preferred secret for new OTP sends (dedicated pepper, else service role). */
function getOtpHmacSecret(): string | null {
  return (
    Deno.env.get("EMAIL_VERIFICATION_OTP_SECRET") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    null
  );
}

/** All secrets to try at verify time so rows issued with SRK still work after EMAIL_VERIFICATION_OTP_SECRET is added. */
function otpVerificationSecrets(): string[] {
  const dedicated = Deno.env.get("EMAIL_VERIFICATION_OTP_SECRET");
  const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const set = new Set<string>();
  if (dedicated) set.add(dedicated);
  if (srk) set.add(srk);
  return [...set];
}

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

function jsonResponse(payload: unknown, status = 200): Response {
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

function identityProvidersForLog(user: {
  identities?: Array<{ provider?: string | null }> | null;
}): string[] {
  return (user.identities ?? [])
    .map((i) => (typeof i.provider === "string" ? i.provider : null))
    .filter((p): p is string => !!p);
}

function parsedObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(value: Record<string, unknown> | null, field: string): string | null {
  const raw = value?.[field];
  return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return typeof error === "string" ? error : "Unknown error";
}

// Generate a 6-digit OTP using cryptographically secure random
function generateOtp(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  // Generate 6-digit number from cryptographically secure random
  const otp = (array[0] % 900000) + 100000;
  return otp.toString();
}

const OTP_HASH_PREFIX = "h1:";

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i]!.toString(16).padStart(2, "0");
  }
  return s;
}

function timingSafeEqualUtf8(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) {
    diff |= ea[i]! ^ eb[i]!;
  }
  return diff === 0;
}

/**
 * HMAC-SHA256(otp) with a server secret (pepper). Edge-safe (Web Crypto only).
 * Avoids bcrypt, which uses Workers and crashes on Supabase Edge ("Worker is not defined").
 */
async function hmacOtpStoredFormWithSecret(
  otp: string,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(otp),
    ),
  );
  return `${OTP_HASH_PREFIX}${bytesToHex(sig)}`;
}

async function hmacOtpStoredForm(otp: string): Promise<string> {
  const secret = getOtpHmacSecret();
  if (!secret) {
    throw new Error("OTP signing is not configured");
  }
  return await hmacOtpStoredFormWithSecret(otp, secret);
}

async function verifyOtpHash(
  otp: string,
  stored: string,
  requestId: string,
): Promise<boolean> {
  if (!stored.startsWith(OTP_HASH_PREFIX)) {
    logStage("verify_otp_stored_format_unknown", {
      requestId,
      hint: "legacy_or_corrupt_hash",
    });
    return false;
  }
  const secrets = otpVerificationSecrets();
  if (secrets.length === 0) {
    logStage("verify_otp_hmac_secret_missing", { requestId });
    return false;
  }
  for (const secret of secrets) {
    try {
      const expected = await hmacOtpStoredFormWithSecret(otp, secret);
      if (timingSafeEqualUtf8(expected, stored)) return true;
    } catch {
      // try next secret
    }
  }
  return false;
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

  logStage("resend_request_start", {
    requestId,
    fromConfigured: EMAIL_VERIFICATION_FROM_EMAIL.trim().length > 0,
  });
  let response: Response;
  try {
    response = await fetchWithProviderTimeout("https://api.resend.com/emails", {
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
              <img src="https://www.vibelymeet.com/vibely-logo-full-gradient.png" alt="Vibely" height="36" style="height:36px;display:inline-block;" />
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
    }, {
      provider: "resend",
      operation: "email_send",
      timeoutMs: providerFetchTimeoutMs("resend", "email_send", 8_000),
    });
  } catch (error) {
    logStage("resend_fetch_failed", {
      requestId,
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return {
      ok: false,
      status: 503,
      payload: {
        error: "Email provider is temporarily unavailable.",
        code: "resend_fetch_failed",
      },
    };
  }

  const responseText = await response.text();
  let responseBody: unknown = null;
  try {
    responseBody = responseText ? JSON.parse(responseText) : null;
  } catch {
    responseBody = responseText;
  }
  const responseObject = parsedObject(responseBody);

  logStage("resend_response", {
    requestId,
    status: response.status,
    ok: response.ok,
    providerId: stringField(responseObject, "id"),
    providerRequestId: response.headers.get("x-request-id"),
    bodyLength: responseText.length,
  });

  if (!response.ok) {
    return {
      ok: false,
      status: response.status >= 500 ? 502 : response.status,
      payload: {
        error: "Unable to send verification email. Please try again later.",
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

  let requestId: string | undefined;
  try {
    requestId = crypto.randomUUID();
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
      console.error("User error:", safeErrorMessage(userError));
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
      const requestedEmail = normalizeEmailAddress(email);

      const { data: adminUserData, error: adminUserError } = await supabaseAdmin.auth.admin.getUserById(
        user.id,
      );
      const resolvedUser = adminUserData?.user ?? user;
      const jwtAuthEmail = normalizeEmailAddress(user.email);
      const canonicalAuthEmail = resolveCanonicalAuthEmail(resolvedUser) ?? jwtAuthEmail;

      logStage("send_user_resolved", {
        requestId,
        userId: user.id,
        jwtAuthEmailPresent: !!jwtAuthEmail,
        canonicalAuthEmailPresent: !!canonicalAuthEmail,
        requestedEmailPresent: !!requestedEmail,
        requestedMatchesCanonical: !!requestedEmail && requestedEmail === canonicalAuthEmail,
        emailConfirmedAt: resolvedUser.email_confirmed_at ?? user.email_confirmed_at ?? null,
        adminUserFetchError: adminUserError?.message ?? null,
        identityProviders: identityProvidersForLog(resolvedUser),
      });

      if (!requestedEmail) {
        logStage("send_rejected", { requestId, userId: user.id, branch: "missing_requested_email" });
        return jsonResponse({ error: "Email is required", code: "missing_requested_email" }, 400);
      }

      if (!canonicalAuthEmail) {
        logStage("send_rejected", { requestId, userId: user.id, branch: "no_canonical_auth_email" });
        return jsonResponse(
          { error: "Add an email to your account before verifying it in-app.", code: "no_canonical_auth_email" },
          200,
        );
      }

      if (requestedEmail !== canonicalAuthEmail) {
        logStage("send_rejected", {
          requestId,
          userId: user.id,
          branch: "requested_mismatch_canonical",
          requestedEmailPresent: !!requestedEmail,
          canonicalAuthEmailPresent: !!canonicalAuthEmail,
        });
        return jsonResponse(
          { error: "Only the current email on your account can be verified.", code: "email_mismatch" },
          200,
        );
      }

      const authEmail = canonicalAuthEmail;

      logStage("canonical_email_resolved", {
        requestId,
        userId: user.id,
        canonicalAuthEmailPresent: !!authEmail,
        requestedMatchesCanonical: true,
      });

      const otp = generateOtp();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      logStage("otp_generated", {
        requestId,
        userId: user.id,
        // Never log the raw OTP
        otpLength: otp.length,
      });

      // Delete any existing codes for this user
      const { error: deleteError } = await supabaseAdmin
        .from("email_verifications")
        .delete()
        .eq("user_id", user.id);
      if (deleteError) {
        console.error("Delete old verification code error:", safeErrorMessage(deleteError));
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

      logStage("otp_hash_start", { requestId, userId: user.id });
      let hashedOtp: string;
      try {
        hashedOtp = await hmacOtpStoredForm(otp);
        logStage("otp_hash_success", { requestId, userId: user.id });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logStage("otp_hash_failed", {
          requestId,
          userId: user.id,
          error: msg,
          reason: msg.includes("not configured") ? "otp_hmac_secret_missing" : "hash_error",
        });
        return jsonResponse(
          {
            error: "Verification could not be prepared. Please try again later.",
            code: "otp_hash_failed",
          },
          500,
        );
      }

      const { error: insertError } = await supabaseAdmin
        .from("email_verifications")
        .insert({
          user_id: user.id,
          email: authEmail,
          code: hashedOtp,
          expires_at: expiresAt.toISOString(),
        });

      if (insertError) {
        console.error("Insert error:", safeErrorMessage(insertError));
        logStage("otp_row_insert_fail", {
          requestId,
          userId: user.id,
          error: insertError.message,
        });
        return jsonResponse(
          { error: "Failed to create verification code", code: "insert_failed" },
          500,
        );
      }
      logStage("otp_row_insert_success", { requestId, userId: user.id });

      // Send email
      const resendResult = await sendEmail(authEmail, otp, requestId);
      if (!resendResult.ok) {
        return jsonResponse(resendResult.payload, resendResult.status);
      }

      logStage("send_completed", { requestId, userId: user.id });

      return jsonResponse({ success: true, message: "Verification code sent" }, 200);
    }

    if (action === "verify" && req.method === "POST") {
      // Verify OTP
      const { email, code }: VerifyOtpRequest = await req.json();
      const requestedEmail = normalizeEmailAddress(email);

      const { data: verifyAdminData, error: verifyAdminError } = await supabaseAdmin.auth.admin.getUserById(
        user.id,
      );
      const verifyResolvedUser = verifyAdminData?.user ?? user;
      const jwtAuthEmailVerify = normalizeEmailAddress(user.email);
      const canonicalAuthEmailVerify =
        resolveCanonicalAuthEmail(verifyResolvedUser) ?? jwtAuthEmailVerify;

      logStage("verify_user_resolved", {
        requestId,
        userId: user.id,
        jwtAuthEmailPresent: !!jwtAuthEmailVerify,
        canonicalAuthEmailPresent: !!canonicalAuthEmailVerify,
        requestedEmailPresent: !!requestedEmail,
        requestedMatchesCanonical: !!requestedEmail && requestedEmail === canonicalAuthEmailVerify,
        emailConfirmedAt: verifyResolvedUser.email_confirmed_at ?? user.email_confirmed_at ?? null,
        adminUserFetchError: verifyAdminError?.message ?? null,
        identityProviders: identityProvidersForLog(verifyResolvedUser),
      });

      if (!requestedEmail || !code) {
        return jsonResponse({ error: "Email and code are required", code: "missing_fields" }, 400);
      }

      if (!canonicalAuthEmailVerify) {
        return jsonResponse(
          { error: "Add an email to your account before verifying it in-app.", code: "no_canonical_auth_email" },
          200,
        );
      }

      if (requestedEmail !== canonicalAuthEmailVerify) {
        return jsonResponse(
          { error: "Only the current email on your account can be verified.", code: "email_mismatch" },
          200,
        );
      }

      const authEmail = canonicalAuthEmailVerify;

      logStage("verify_entered", { requestId, userId: user.id });

      // Check failed attempt count (max 7 per hour)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count: attemptCount, error: countError } = await supabaseAdmin
        .from("verification_attempts")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("flow", EMAIL_OTP_VERIFY_FLOW)
        .gte("attempt_at", oneHourAgo);

      if (countError) {
        console.error("Failed attempt count error:", safeErrorMessage(countError));
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
        console.error("Find error:", safeErrorMessage(findError));
        logStage("verify_lookup_failed", {
          requestId,
          userId: user.id,
          error: findError.message,
        });
        return jsonResponse(
          {
            error: "Could not load verification state. Please try again.",
            code: "verification_lookup_failed",
          },
          500,
        );
      }

      if (!verification) {
        return jsonResponse({ error: "Invalid or expired verification code" }, 400);
      }

      const storedCode = String(verification.code ?? "");
      const isLegacyBcryptHash =
        storedCode.startsWith("$2a$") ||
        storedCode.startsWith("$2b$") ||
        storedCode.startsWith("$2y$");
      if (isLegacyBcryptHash) {
        logStage("verify_legacy_bcrypt_row", { requestId, userId: user.id });
        return jsonResponse(
          {
            error:
              "This code was issued before an app update and can’t be checked anymore. Tap Send Code again for a new email.",
            code: "legacy_verification_code",
          },
          400,
        );
      }

      const isValidCode = await verifyOtpHash(code, storedCode, requestId);

      if (!isValidCode) {
        // Record failed attempt
        await supabaseAdmin
          .from("verification_attempts")
          .insert({ user_id: user.id, flow: EMAIL_OTP_VERIFY_FLOW });
        
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

      const verifiedEmail = verifyResolvedUser.email ?? user.email ?? authEmail;
      const { error: profileError } = await supabaseAdmin.rpc(
        "mark_profile_email_verified_from_server",
        {
          p_user_id: user.id,
          p_verified_email: verifiedEmail,
        },
      );

      if (profileError) {
        console.error("Profile update error:", safeErrorMessage(profileError));
        logStage("verify_profile_update_failed", {
          requestId,
          userId: user.id,
          error: profileError.message,
        });
        return jsonResponse(
          {
            error: "Could not mark your email as verified. Please try again.",
            code: "profile_verification_update_failed",
          },
          500,
        );
      }

      // Success - clear failed attempts for this user
      await supabaseAdmin
        .from("verification_attempts")
        .delete()
        .eq("user_id", user.id)
        .eq("flow", EMAIL_OTP_VERIFY_FLOW);

      // Mark as verified and delete the verification record for security
      await supabaseAdmin
        .from("email_verifications")
        .delete()
        .eq("id", verification.id);

      console.log(`Email verified successfully for user ${user.id}`);

      return jsonResponse({ success: true, message: "Email verified successfully" }, 200);
    }

    return jsonResponse({ error: "Invalid action" }, 400);

  } catch (error: unknown) {
    const message = safeErrorMessage(error);
    console.error("Error in email-verification function:", message);
    logStage("handler_unhandled_error", {
      requestId: requestId ?? null,
      error: message,
      code:
        message === "Worker is not defined"
          ? "runtime_worker_unavailable"
          : "internal_error",
    });
    const code =
      message === "Worker is not defined" ? "runtime_worker_unavailable" : "internal_error";
    return jsonResponse(
      {
        error: "Something went wrong. Please try again.",
        code,
      },
      500,
    );
  }
};

serve(handler);
