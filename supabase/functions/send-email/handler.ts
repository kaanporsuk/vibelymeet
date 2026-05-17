export type EmailTemplate =
  | "welcome"
  | "new_match"
  | "event_confirmation"
  | "deletion_scheduled";

export interface EmailRequest {
  to?: string;
  subject?: string;
  html?: string;
  template?: EmailTemplate;
  data?: Record<string, unknown>;
}

export interface ProviderEmailInput {
  from: string;
  to: string;
  subject: string;
  html: string;
}

export interface ProviderEmailResult {
  ok: boolean;
  id?: string;
  status?: number;
  bodyLength?: number;
}

interface CorsDependencies {
  corsHeadersForRequest(req: Request): Record<string, string>;
  isBrowserOriginRejected(req: Request): boolean;
  preflightResponse(req: Request): Response;
}

interface SendEmailLogger {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

interface SendEmailHandlerDependencies {
  appUrl: string;
  authenticateUser(authHeader: string): Promise<{ email: string } | null>;
  cors: CorsDependencies;
  fromEmail: string;
  logger?: SendEmailLogger;
  resendConfigured: boolean;
  sendEmail(input: ProviderEmailInput): Promise<ProviderEmailResult>;
  serviceRoleKey: string;
}

type AuthorizationResult =
  | { ok: true; isServiceRole: true }
  | { ok: true; isServiceRole: false; canonicalEmail: string }
  | { ok: false; message: "Unauthorized" | "Forbidden" };

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizedDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value
    .split("")
    .map((char) => {
      const code = char.charCodeAt(0);
      return code <= 31 || code === 127 ? " " : char;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return name ? name : "there";
}

function displayName(data: Record<string, unknown>): string {
  return sanitizedDisplayName(data.name) ?? "there";
}

function timingSafeEqualString(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  const maxLength = Math.max(left.length, right.length);

  for (let i = 0; i < maxLength; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }

  return diff === 0;
}

function renderTemplate(
  appUrl: string,
  template: EmailTemplate,
  data: Record<string, unknown>,
): { subject: string; html: string } | null {
  if (template === "welcome") {
    const name = displayName(data);
    const safeName = escapeHtml(name);
    return {
      subject: `Welcome to Vibely, ${name}! 🎉`,
      html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: #e5e5e5; padding: 40px 24px; border-radius: 16px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="color: #8B5CF6; font-size: 28px; margin: 0;">Welcome to Vibely</h1>
        </div>
        <p style="font-size: 16px; line-height: 1.6;">Hey ${safeName},</p>
        <p style="font-size: 16px; line-height: 1.6;">You're in! Vibely is where real connections happen — through video dates at live events.</p>
        <p style="font-size: 16px; line-height: 1.6;">Here's how to get started:</p>
        <ul style="font-size: 15px; line-height: 1.8; color: #a3a3a3;">
          <li><strong style="color: #e5e5e5;">Complete your profile</strong> — add photos and a Vibe Video</li>
          <li><strong style="color: #e5e5e5;">Browse events</strong> — find ones that match your vibe</li>
          <li><strong style="color: #e5e5e5;">Start swiping</strong> — mutual vibes lead to video dates</li>
        </ul>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${appUrl}" style="background: linear-gradient(135deg, #8B5CF6, #E84393); color: white; padding: 14px 32px; border-radius: 99px; text-decoration: none; font-weight: 600; font-size: 16px;">Open Vibely</a>
        </div>
        <p style="font-size: 13px; color: #737373; text-align: center;">You're receiving this because you signed up for Vibely.</p>
      </div>
    `,
    };
  }

  if (template === "new_match") {
    return {
      subject: "You have a new match on Vibely! 🎉",
      html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: #e5e5e5; padding: 40px 24px; border-radius: 16px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="color: #E84393; font-size: 28px; margin: 0;">It's a match! 🎉</h1>
        </div>
        <p style="font-size: 16px; line-height: 1.6;">Great news — you and someone both vibed!</p>
        <p style="font-size: 16px; line-height: 1.6;">Open Vibely to start chatting and plan a video date.</p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${appUrl}/matches" style="background: linear-gradient(135deg, #8B5CF6, #E84393); color: white; padding: 14px 32px; border-radius: 99px; text-decoration: none; font-weight: 600; font-size: 16px;">See Your Match</a>
        </div>
        <p style="font-size: 13px; color: #737373; text-align: center;">You're receiving this because you have notifications enabled on Vibely.</p>
      </div>
    `,
    };
  }

  return null;
}

function safeTemplateData(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function jsonResponse(
  req: Request,
  deps: SendEmailHandlerDependencies,
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...deps.cors.corsHeadersForRequest(req),
      "Content-Type": "application/json",
    },
  });
}

function isEmailRequest(value: unknown): value is EmailRequest {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function authorizeRequest(
  req: Request,
  body: EmailRequest,
  deps: SendEmailHandlerDependencies,
): Promise<AuthorizationResult> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, message: "Unauthorized" };
  }

  const token = authHeader.slice("Bearer ".length);
  if (deps.serviceRoleKey && timingSafeEqualString(token, deps.serviceRoleKey)) {
    return { ok: true, isServiceRole: true };
  }

  const user = await deps.authenticateUser(authHeader);
  if (!user?.email) {
    return { ok: false, message: "Unauthorized" };
  }

  if (body.template !== "welcome") {
    return { ok: false, message: "Forbidden" };
  }

  if (typeof body.to !== "string" || normalizeEmail(body.to) !== normalizeEmail(user.email)) {
    return { ok: false, message: "Forbidden" };
  }

  if (body.subject != null || body.html != null) {
    return { ok: false, message: "Forbidden" };
  }

  return { ok: true, isServiceRole: false, canonicalEmail: user.email };
}

function safeUnexpectedError(error: unknown): Record<string, string> {
  if (error instanceof Error) {
    return { name: error.name || "Error" };
  }
  return { name: typeof error };
}

export function createSendEmailHandler(deps: SendEmailHandlerDependencies): (req: Request) => Promise<Response> {
  const logger = deps.logger ?? console;

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return deps.cors.preflightResponse(req);
    }

    if (deps.cors.isBrowserOriginRejected(req)) {
      return jsonResponse(req, deps, { success: false, error: "Forbidden origin" }, 403);
    }

    try {
      let body: EmailRequest;
      try {
        const parsed = await req.json();
        if (!isEmailRequest(parsed)) {
          return jsonResponse(req, deps, { success: false, error: "Invalid request" });
        }
        body = parsed;
      } catch {
        return jsonResponse(req, deps, { success: false, error: "Invalid JSON" });
      }

      const auth = await authorizeRequest(req, body, deps);
      if (!auth.ok) {
        return jsonResponse(
          req,
          deps,
          { success: false, error: auth.message },
          auth.message === "Forbidden" ? 403 : 401,
        );
      }

      const finalTo = auth.isServiceRole ? body.to : auth.canonicalEmail;
      let finalSubject = body.subject;
      let finalHtml = body.html;

      if (body.template) {
        const rendered = renderTemplate(deps.appUrl, body.template, safeTemplateData(body.data));
        if (!rendered) {
          return jsonResponse(req, deps, { success: false, error: "Unknown template" });
        }
        finalSubject = rendered.subject;
        finalHtml = rendered.html;
      }

      if (
        typeof finalTo !== "string"
        || typeof finalSubject !== "string"
        || typeof finalHtml !== "string"
        || !finalTo.trim()
        || !finalSubject.trim()
        || !finalHtml.trim()
      ) {
        return jsonResponse(req, deps, { success: false, error: "Missing to, subject, or html" });
      }

      if (!deps.resendConfigured) {
        logger.warn("send-email: RESEND_API_KEY not set, skipping");
        return jsonResponse(req, deps, { success: false, error: "Email not configured" });
      }

      const result = await deps.sendEmail({
        from: deps.fromEmail,
        to: finalTo,
        subject: finalSubject,
        html: finalHtml,
      });

      if (!result.ok) {
        logger.error("send-email resend_failed", {
          bodyLength: result.bodyLength ?? 0,
          status: result.status ?? 0,
        });
        return jsonResponse(req, deps, { success: false, error: "Email provider error" });
      }

      logger.log("send-email:", result.id || "sent");
      return jsonResponse(req, deps, { success: true, id: result.id });
    } catch (error) {
      logger.error("send-email error", safeUnexpectedError(error));
      return jsonResponse(req, deps, { success: false, error: "Internal error" });
    }
  };
}
