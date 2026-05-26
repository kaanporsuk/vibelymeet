import {
  adminJsonResponse,
  authenticateAdminRequest,
  sanitizeErrorMessage,
} from "../_shared/adminAuth.ts";
import {
  isBrowserOriginRejected,
  preflightResponse,
} from "../_shared/cors.ts";

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

    return adminJsonResponse(req, {
      isAdmin: auth.context.isAdmin,
      status: auth.context.isAdmin ? "admin" : "not_admin",
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
