import {
  adminJsonResponse,
  authenticateAdminRequest,
  sanitizeErrorMessage,
} from "../_shared/adminAuth.ts";
import {
  isBrowserOriginRejected,
  preflightResponse,
} from "../_shared/cors.ts";

type VerifiedAdminAuth = Extract<Awaited<ReturnType<typeof authenticateAdminRequest>>, { ok: true }>;

async function resolveDeniedAdminStatus(auth: VerifiedAdminAuth) {
  if (auth.context.isAdmin) {
    return { status: "not_admin", message: "Admin role is required." };
  }

  const { data, error } = await auth.context.adminClient
    .from("admin_session_invalidation_events")
    .select("event_type, role, previous_role")
    .eq("user_id", auth.context.user.id)
    .in("event_type", ["role_revoked", "role_changed", "session_invalidated"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Verify admin invalidation lookup failed:", sanitizeErrorMessage(error.message));
    return { status: "not_admin", message: "Admin role is required." };
  }

  const eventType = typeof data?.event_type === "string" ? data.event_type : "";
  const role = typeof data?.role === "string" ? data.role : null;
  const previousRole = typeof data?.previous_role === "string" ? data.previous_role : null;
  const revokedAdminRole =
    eventType === "session_invalidated" ||
    (eventType === "role_revoked" && (role === "admin" || previousRole === "admin")) ||
    (eventType === "role_changed" && previousRole === "admin" && role !== "admin");

  if (revokedAdminRole) {
    return {
      status: "revoked",
      message: "Admin access was revoked for this account. Sign out and use an active admin account.",
    };
  }

  return { status: "not_admin", message: "Admin role is required." };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return preflightResponse(req);
  }
  if (isBrowserOriginRejected(req)) {
    return adminJsonResponse(req, {
      isAdmin: false,
      status: "origin_rejected",
      error: "ORIGIN_NOT_ALLOWED",
    }, 403);
  }
  if (req.method !== "POST") {
    return adminJsonResponse(req, {
      isAdmin: false,
      status: "method_not_allowed",
      error: "METHOD_NOT_ALLOWED",
    }, 405);
  }

  try {
    const auth = await authenticateAdminRequest(req, { requireAdmin: false });
    if (!auth.ok) {
      return adminJsonResponse(req, {
        isAdmin: false,
        status: auth.code === "UNAUTHENTICATED" ? "unauthenticated" : "verification_failed",
        error: auth.code,
        message: auth.message,
      }, auth.status);
    }

    const denied = auth.context.isAdmin ? null : await resolveDeniedAdminStatus(auth);

    return adminJsonResponse(req, {
      isAdmin: auth.context.isAdmin,
      status: auth.context.isAdmin ? "admin" : denied?.status,
      message: denied?.message,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Verify admin error:", sanitizeErrorMessage(error));
    return adminJsonResponse(req, {
      isAdmin: false,
      status: "verification_failed",
      error: "ADMIN_VERIFICATION_FAILED",
      message: "Admin role verification failed.",
    }, 500);
  }
});
