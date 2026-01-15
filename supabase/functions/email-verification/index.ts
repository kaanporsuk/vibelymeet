import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

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

// Generate a 6-digit OTP
function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
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
async function sendEmail(to: string, otp: string): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "Vibely <onboarding@resend.dev>",
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
            <div style="text-align: center; margin-bottom: 32px;">
              <h1 style="font-size: 28px; font-weight: bold; background: linear-gradient(135deg, #8b5cf6, #ec4899); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin: 0;">Vibely</h1>
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

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to send email: ${error}`);
  }
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Get the authorization header to identify the user
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = new URL(req.url);
    const action = url.pathname.split("/").pop();

    if (action === "send" && req.method === "POST") {
      // Send OTP
      const { email }: SendOtpRequest = await req.json();
      
      if (!email) {
        return new Response(
          JSON.stringify({ error: "Email is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const otp = generateOtp();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      console.log(`Generating OTP for user ${user.id}, email: ${email}`);

      // Delete any existing codes for this user
      await supabaseAdmin
        .from("email_verifications")
        .delete()
        .eq("user_id", user.id);

      // Hash the OTP before storing
      const hashedOtp = await hashOtp(otp);

      // Insert new verification code (hashed)
      const { error: insertError } = await supabaseAdmin
        .from("email_verifications")
        .insert({
          user_id: user.id,
          email,
          code: hashedOtp,
          expires_at: expiresAt.toISOString(),
        });

      if (insertError) {
        console.error("Insert error:", insertError);
        return new Response(
          JSON.stringify({ error: "Failed to create verification code" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Send email
      await sendEmail(email, otp);

      console.log(`OTP sent successfully to ${email}`);

      return new Response(
        JSON.stringify({ success: true, message: "Verification code sent" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "verify" && req.method === "POST") {
      // Verify OTP
      const { email, code }: VerifyOtpRequest = await req.json();

      if (!email || !code) {
        return new Response(
          JSON.stringify({ error: "Email and code are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`Verifying OTP for user ${user.id}, email: ${email}`);

      // Find the verification record (without matching code - we'll verify the hash)
      const { data: verification, error: findError } = await supabaseAdmin
        .from("email_verifications")
        .select("*")
        .eq("user_id", user.id)
        .eq("email", email)
        .is("verified_at", null)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

      if (findError) {
        console.error("Find error:", findError);
        return new Response(
          JSON.stringify({ error: "Verification failed" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!verification) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired verification code" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Verify the OTP against the stored hash
      const isValidCode = await verifyOtpHash(code, verification.code);
      
      if (!isValidCode) {
        console.log(`Invalid OTP attempt for user ${user.id}`);
        return new Response(
          JSON.stringify({ error: "Invalid or expired verification code" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

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
          verified_email: email 
        })
        .eq("id", user.id);

      if (profileError) {
        console.error("Profile update error:", profileError);
      }

      console.log(`Email verified successfully for user ${user.id}`);

      return new Response(
        JSON.stringify({ success: true, message: "Email verified successfully" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Error in email-verification function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
