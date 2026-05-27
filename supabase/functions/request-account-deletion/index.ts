import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import {
  isBrowserOriginRejected,
  jsonResponse,
  preflightResponse,
} from "../_shared/cors.ts";

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("cf-connecting-ip")?.trim()
    || "unknown";
}

async function verifyTurnstile(token: unknown, ip: string): Promise<boolean> {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY")?.trim();
  if (!secret) {
    console.error("request-account-deletion missing TURNSTILE_SECRET_KEY");
    return false;
  }
  if (typeof token !== "string" || token.trim() === "") return false;

  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token.trim());
  if (ip && ip !== "unknown") form.append("remoteip", ip);

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  const data = await res.json().catch(() => null) as { success?: boolean } | null;
  return res.ok && data?.success === true;
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return preflightResponse(req);
  }
  if (isBrowserOriginRejected(req)) {
    return jsonResponse(req, { success: true }, { status: 200 });
  }

  try {
    const { email, reason, source, captchaToken } = await req.json().catch(() => ({}));
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      return jsonResponse(req, { success: true }, { status: 200 });
    }

    const ip = clientIp(req);
    const captchaOk = await verifyTurnstile(captchaToken, ip);
    if (!captchaOk) {
      return jsonResponse(req, { success: true }, { status: 200 });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const pepper = Deno.env.get("ACCOUNT_DELETION_RATE_LIMIT_PEPPER")
      || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
      || "vibely";
    const [ipHash, emailHash] = await Promise.all([
      sha256Hex(`${pepper}:ip:${ip}`),
      sha256Hex(`${pepper}:email:${normalizedEmail}`),
    ]);

    const { data: limitResult, error: limitError } = await supabaseAdmin.rpc(
      "record_public_account_deletion_request",
      { p_ip_hash: ipHash, p_email_hash: emailHash },
    );
    if (limitError) {
      console.error("request-account-deletion rate limit error:", limitError.message);
      return jsonResponse(req, { success: true }, { status: 200 });
    }
    if ((limitResult as { allowed?: boolean } | null)?.allowed !== true) {
      return jsonResponse(req, { success: true }, { status: 200 });
    }

    const { data: userId, error: lookupError } = await supabaseAdmin.rpc(
      "resolve_account_deletion_user_id_by_email",
      { p_email: normalizedEmail },
    );
    if (lookupError) {
      console.error("request-account-deletion lookup error:", lookupError.message);
      return jsonResponse(req, { success: true }, { status: 200 });
    }
    if (typeof userId !== "string" || !userId) {
      return jsonResponse(req, { success: true }, { status: 200 });
    }

    const safeSource = typeof source === "string" && source.trim() ? source.trim().slice(0, 40) : "public_web";
    const safeReason = typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 2000) : "No reason provided";
    const { error: insertError } = await supabaseAdmin.from("account_deletion_requests").insert({
      user_id: userId,
      reason: `[${safeSource}] ${safeReason}`,
      status: "pending",
    });

    if (insertError && insertError.code !== "23505") {
      console.error("request-account-deletion insert error:", insertError.message);
    }

    return jsonResponse(req, { success: true }, { status: 200 });
  } catch (err) {
    console.error("request-account-deletion error:", safeErrorMessage(err));
    return jsonResponse(req, { success: true }, { status: 200 });
  }
});
