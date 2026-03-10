import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit } from "../_shared/rate-limiter.ts";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function generateHmac(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return bytesToHex(new Uint8Array(signature));
}

const UNSUB_RATE_LIMIT_REQUESTS = 10;
const UNSUB_RATE_LIMIT_WINDOW_MS = 60 * 1000;

serve(async (req) => {
  const url = new URL(req.url);
  const uid = url.searchParams.get("uid");
  const token = url.searchParams.get("token");

  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";

  if (!uid || !token) {
    return new Response(
      "<html><body style='font-family:sans-serif;text-align:center;padding:60px'><h2>Invalid unsubscribe link</h2></body></html>",
      { headers: { "Content-Type": "text/html" } }
    );
  }

  try {
    const unsubSecret = Deno.env.get("UNSUB_HMAC_SECRET");
    if (!unsubSecret || unsubSecret.trim() === "") {
      console.error("UNSUB_HMAC_SECRET is not set");
      return new Response(
        "<html><body style='font-family:sans-serif;text-align:center;padding:60px'><h2>Service unavailable</h2></body></html>",
        { status: 503, headers: { "Content-Type": "text/html" } }
      );
    }

    const rateResult = await checkRateLimit(clientIp, {
      maxRequests: UNSUB_RATE_LIMIT_REQUESTS,
      windowMs: UNSUB_RATE_LIMIT_WINDOW_MS,
      functionName: "unsubscribe",
    });
    if (!rateResult.allowed) {
      return new Response(
        "<html><body style='font-family:sans-serif;text-align:center;padding:60px'><h2>Too many requests. Try again later.</h2></body></html>",
        { status: 429, headers: { "Content-Type": "text/html" } }
      );
    }

    const expectedToken = await generateHmac(unsubSecret, uid);

    if (token !== expectedToken) {
      return new Response(
        "<html><body style='font-family:sans-serif;text-align:center;padding:60px'><h2>Invalid or expired unsubscribe link</h2></body></html>",
        { headers: { "Content-Type": "text/html" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    await supabase
      .from("profiles")
      .update({ email_unsubscribed: true })
      .eq("id", uid);

    return new Response(
      `<html>
        <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
          <div style="max-width:400px;text-align:center;padding:40px">
            <h2 style="margin-bottom:16px">You've been unsubscribed</h2>
            <p style="color:#a1a1aa;margin-bottom:24px">You won't receive promotional emails from Vibely anymore.</p>
            <p style="color:#71717a;font-size:13px;margin-bottom:24px">You can re-enable notifications in your profile settings.</p>
            <a href="https://vibelymeet.com" style="color:#8b5cf6;text-decoration:none;font-weight:600">Back to Vibely →</a>
          </div>
        </body>
      </html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  } catch {
    return new Response(
      "<html><body style='font-family:sans-serif;text-align:center;padding:60px'><h2>Something went wrong</h2></body></html>",
      { headers: { "Content-Type": "text/html" } }
    );
  }
});
