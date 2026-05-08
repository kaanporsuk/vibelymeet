const DEFAULT_ALLOWED_ORIGINS = [
  "https://www.vibelymeet.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];

const DEFAULT_ALLOWED_HEADERS = [
  "authorization",
  "x-client-info",
  "apikey",
  "content-type",
  "x-supabase-client-platform",
  "x-supabase-client-platform-version",
  "x-supabase-client-runtime",
  "x-supabase-client-runtime-version",
].join(", ");

function envOrigins(): string[] {
  return (Deno.env.get("ALLOWED_WEB_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

export function allowedOrigins(): Set<string> {
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...envOrigins()]);
}

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return true;
  return allowedOrigins().has(origin.replace(/\/+$/, ""));
}

export function isBrowserOriginRejected(req: Request): boolean {
  const origin = req.headers.get("Origin");
  return Boolean(origin && !isAllowedOrigin(origin));
}

export function corsHeadersForRequest(
  req: Request,
  options: { allowedHeaders?: string; methods?: string } = {},
): Record<string, string> {
  const origin = req.headers.get("Origin")?.replace(/\/+$/, "") ?? null;
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": options.allowedHeaders ?? DEFAULT_ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": options.methods ?? "GET,POST,OPTIONS",
    "Vary": "Origin",
  };

  if (origin && isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

export function preflightResponse(req: Request): Response {
  if (isBrowserOriginRejected(req)) {
    return new Response(null, { status: 403, headers: corsHeadersForRequest(req) });
  }
  return new Response(null, { status: 204, headers: corsHeadersForRequest(req) });
}

export function jsonResponse(
  req: Request,
  body: unknown,
  init: ResponseInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...corsHeadersForRequest(req),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

export function requestOriginOrDefault(req: Request): string {
  const origin = req.headers.get("Origin")?.replace(/\/+$/, "") ?? null;
  if (origin && isAllowedOrigin(origin)) return origin;
  return Deno.env.get("PUBLIC_SITE_URL")?.replace(/\/+$/, "") || "https://www.vibelymeet.com";
}
