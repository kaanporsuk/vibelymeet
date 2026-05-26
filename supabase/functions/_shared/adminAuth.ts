import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { jsonResponse } from "./cors.ts";

export type AdminSupabaseClient = SupabaseClient<any, "public", any, any, any>;

export type AdminAuthContext = {
  authHeader: string;
  user: User;
  userClient: AdminSupabaseClient;
  adminClient: AdminSupabaseClient;
  roles: string[];
  permissions: string[];
  isAdmin: boolean;
};

export type AdminAuthFailure = {
  ok: false;
  status: number;
  code: string;
  message: string;
  response: Response;
};

export type AdminAuthResult =
  | { ok: true; context: AdminAuthContext }
  | AdminAuthFailure;

type AuthOptions = {
  requireAdmin?: boolean;
  requiredPermission?: string;
};

export function sanitizeErrorMessage(reason: unknown): string {
  return String(reason instanceof Error ? reason.message : reason || "Unknown error")
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[token]")
    .replace(/\b(?:Bearer|Token)\s+[A-Za-z0-9._~+/=-]+/gi, "[token]")
    .replace(/\b(api[_-]?key|apikey|authorization|secret)\s*[:=]\s*[^,\s)]+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

export function statusForAdminError(errorOrCode: unknown, fallback = 500): number {
  const record = errorOrCode && typeof errorOrCode === "object"
    ? errorOrCode as { code?: unknown; message?: unknown; status?: unknown }
    : null;
  if (typeof record?.status === "number" && record.status >= 400 && record.status < 600) {
    return record.status;
  }

  const code = String(
    typeof errorOrCode === "string" ? errorOrCode : record?.code ?? record?.message ?? "",
  ).toUpperCase();

  if (code.includes("UNAUTHENTICATED") || code.includes("UNAUTHORIZED") || code === "401") return 401;
  if (code.includes("FORBIDDEN") || code === "42501" || code === "403") return 403;
  if (code.includes("NOT_FOUND") || code === "404") return 404;
  if (code.includes("CONFLICT") || code.includes("INVALID_TRANSITION") || code === "409") return 409;
  if (code.includes("INTERNAL_ERROR") || code.includes("SERVER_MISCONFIGURED") || code === "500") return 500;
  if (
    code.includes("VALIDATION") ||
    code.includes("BAD_REQUEST") ||
    code === "400" ||
    code.startsWith("22") ||
    code.startsWith("23") ||
    code.startsWith("PGRST")
  ) {
    return 400;
  }
  return fallback;
}

export function adminJsonResponse(
  req: Request,
  body: unknown,
  status = 200,
): Response {
  return jsonResponse(req, body, { status });
}

export function adminErrorResponse(
  req: Request,
  code: string,
  message: string,
  status = statusForAdminError(code),
): Response {
  return adminJsonResponse(req, {
    success: false,
    ok: false,
    error: code,
    message,
  }, status);
}

function authFailure(req: Request, code: string, message: string, status: number): AdminAuthFailure {
  return {
    ok: false,
    code,
    message,
    status,
    response: adminErrorResponse(req, code, message, status),
  };
}

export async function authenticateAdminRequest(
  req: Request,
  options: AuthOptions = {},
): Promise<AdminAuthResult> {
  const requiredPermission = options.requiredPermission?.trim() || null;
  const requireAdmin = options.requireAdmin === true || (options.requireAdmin !== false && !requiredPermission);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return authFailure(req, "UNAUTHENTICATED", "Admin session is required.", 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return authFailure(req, "SERVER_MISCONFIGURED", "Admin verification is not configured.", 500);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });

  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) {
    return authFailure(req, "UNAUTHENTICATED", "Admin session is invalid or expired.", 401);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: roleRows, error: roleError } = await adminClient
    .from("user_roles")
    .select("role")
    .eq("user_id", authData.user.id);

  if (roleError) {
    console.error("[admin-auth] role lookup failed:", sanitizeErrorMessage(roleError.message));
    return authFailure(req, "ADMIN_VERIFICATION_FAILED", "Admin role verification failed.", 500);
  }

  const roles = (roleRows ?? [])
    .map((row: { role?: unknown }) => typeof row.role === "string" ? row.role : null)
    .filter((role): role is string => Boolean(role));
  const isAdmin = roles.includes("admin");

  let permissions: string[] = [];
  if (requiredPermission && roles.length > 0) {
    const { data: permissionRows, error: permissionError } = await adminClient
      .from("admin_role_permissions")
      .select("permission")
      .in("role", roles);

    if (permissionError) {
      console.error("[admin-auth] permission lookup failed:", sanitizeErrorMessage(permissionError.message));
      return authFailure(req, "ADMIN_VERIFICATION_FAILED", "Admin permission verification failed.", 500);
    }

    permissions = Array.from(new Set(
      (permissionRows ?? [])
        .map((row: { permission?: unknown }) => typeof row.permission === "string" ? row.permission : null)
        .filter((permission): permission is string => Boolean(permission)),
    ));
  }

  if (requireAdmin && !isAdmin) {
    return authFailure(req, "FORBIDDEN", "Admin role is required.", 403);
  }

  if (requiredPermission && !permissions.includes("admin.super") && !permissions.includes(requiredPermission)) {
    return authFailure(req, "FORBIDDEN", `${requiredPermission} permission is required.`, 403);
  }

  return {
    ok: true,
    context: {
      authHeader,
      user: authData.user,
      userClient,
      adminClient,
      roles,
      permissions,
      isAdmin,
    },
  };
}
