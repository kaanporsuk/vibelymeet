import { sanitizeAdminRpcErrorMessage } from "@/lib/adminRpc";
import { resolveSupabaseFunctionErrorMessage } from "@/lib/supabaseFunctionInvokeErrors";

const UNKNOWN_ADMIN_ERROR = "Unable to complete admin request.";

function errorText(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (reason && typeof reason === "object") {
    const record = reason as { message?: unknown; error?: unknown; details?: unknown };
    if (typeof record.message === "string" && record.message.trim()) return record.message;
    if (typeof record.error === "string" && record.error.trim()) return record.error;
    if (typeof record.details === "string" && record.details.trim()) return record.details;
  }
  return String(reason || "Unknown error");
}

function safeFallback(fallback: string): string {
  return sanitizeAdminRpcErrorMessage(fallback || UNKNOWN_ADMIN_ERROR) || UNKNOWN_ADMIN_ERROR;
}

export function resolveAdminErrorMessage(reason: unknown, fallback = UNKNOWN_ADMIN_ERROR): string {
  if (reason == null) return safeFallback(fallback);
  const message = sanitizeAdminRpcErrorMessage(errorText(reason));
  if (!message || message === "Unknown error" || message === "[object Object]") {
    return safeFallback(fallback);
  }
  return message;
}

export async function resolveAdminFunctionErrorMessage(
  invokeError: unknown,
  data: unknown,
  fallback = UNKNOWN_ADMIN_ERROR,
): Promise<string> {
  const message = await resolveSupabaseFunctionErrorMessage(invokeError, data, fallback);
  return resolveAdminErrorMessage(message, fallback);
}
