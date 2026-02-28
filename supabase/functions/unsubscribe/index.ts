import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const url = new URL(req.url);
  const uid = url.searchParams.get("uid");

  if (!uid) {
    return new Response(
      "<html><body style='font-family:sans-serif;text-align:center;padding:60px'><h2>Invalid unsubscribe link</h2></body></html>",
      { headers: { "Content-Type": "text/html" } }
    );
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
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
