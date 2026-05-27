import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import {
  corsHeadersForRequest,
  isBrowserOriginRejected,
  preflightResponse,
} from "../_shared/cors.ts";
import {
  createSendEmailHandler,
  type ProviderEmailInput,
  type ProviderEmailResult,
} from "./handler.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "Vibely <hello@vibelymeet.com>";
const APP_URL = Deno.env.get("APP_URL") || "https://www.vibelymeet.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function authenticateUser(authHeader: string): Promise<{ email: string } | null> {
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data, error } = await userClient.auth.getUser();
  if (error || !data?.user?.email) {
    return null;
  }

  return { email: data.user.email };
}

async function sendViaResend(input: ProviderEmailInput): Promise<ProviderEmailResult> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, bodyLength: text.length };
  }

  try {
    const result = text ? JSON.parse(text) : {};
    const id = typeof result === "object" && result !== null
      && typeof (result as { id?: unknown }).id === "string"
      ? (result as { id: string }).id
      : undefined;
    return { ok: true, id };
  } catch {
    return { ok: true };
  }
}

Deno.serve(
  createSendEmailHandler({
    appUrl: APP_URL,
    authenticateUser,
    cors: {
      corsHeadersForRequest,
      isBrowserOriginRejected,
      preflightResponse,
    },
    fromEmail: FROM_EMAIL,
    resendConfigured: Boolean(RESEND_API_KEY),
    sendEmail: sendViaResend,
    serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  }),
);
