import { supabase } from "@/integrations/supabase/client";
import { queryClient } from "@/lib/queryClient";

export type AdminRpcPayload = {
  success?: boolean;
  ok?: boolean;
  error?: string;
  message?: string;
  [key: string]: unknown;
};

type RpcArgs = Record<string, unknown>;

function fallbackIdempotencyKey(operation: string): string {
  return `${operation}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function stableScopeHash(value: string): string {
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    hashA ^= code;
    hashA = Math.imul(hashA, 0x01000193);
    hashB ^= code + index;
    hashB = Math.imul(hashB, 0x85ebca6b);
  }
  return `${(hashA >>> 0).toString(36)}${(hashB >>> 0).toString(36)}`;
}

function normalizeIdempotencyPart(value: unknown): string {
  if (Array.isArray(value)) return value.map(normalizeIdempotencyPart).sort().join(",");
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${key}:${normalizeIdempotencyPart(entry)}`)
      .join("|");
  }
  return String(value ?? "").trim().slice(0, 500);
}

function maybeInvalidateAdminVerification(reason: unknown) {
  const raw = reason instanceof Error ? reason.message : String(reason || "");
  const isAuthzFailure =
    /\b(UNAUTHENTICATED|UNAUTHORIZED|FORBIDDEN)\b|admin role is required|permission is required|permission denied|not authorized|insufficient/i.test(raw);
  if (isAuthzFailure) {
    void queryClient.invalidateQueries({ queryKey: ["verify-admin-role"] });
  }
}

export function createAdminIdempotencyKey(operation: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${operation}:${crypto.randomUUID()}`;
  }
  return fallbackIdempotencyKey(operation);
}

export function createAdminTargetIdempotencyKey(
  operation: string,
  target: unknown,
  intent: unknown = "default",
): string {
  const targetPart = normalizeIdempotencyPart(target) || "untargeted";
  const intentPart = normalizeIdempotencyPart(intent) || "default";
  return `${operation}:target:${stableScopeHash(`${operation}|${targetPart}|${intentPart}`)}`;
}

export function adminRpcErrorMessage(payload: AdminRpcPayload | null | undefined, fallback: string) {
  if (!payload) return fallback;
  return payload.message || payload.error || fallback;
}

export function sanitizeAdminRpcErrorMessage(reason: unknown): string {
  const raw = reason instanceof Error ? reason.message : String(reason || "Unknown error");
  return raw
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[token]")
    .replace(/\b(?:Bearer|Token)\s+[A-Za-z0-9._~+/=-]+/gi, "[token]")
    .replace(/\b(api[_-]?key|apikey|authorization|secret)\s*[:=]\s*[^,\s)]+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

export async function callAdminRpc<T extends AdminRpcPayload = AdminRpcPayload>(
  fn: string,
  args: RpcArgs,
): Promise<T> {
  const result = await supabase.rpc(fn as never, args as never);
  const { data, error } = result as {
    data: unknown;
    error: { message?: string } | null;
  };

  if (error) {
    maybeInvalidateAdminVerification(error.message);
    throw new Error(error.message || `${fn} failed`);
  }

  const payload = data as T | null;
  if (!payload) throw new Error(`${fn} returned no response`);
  if (payload.success === false || payload.ok === false) {
    maybeInvalidateAdminVerification(payload.error ?? payload.message);
    throw new Error(adminRpcErrorMessage(payload, `${fn} failed`));
  }

  return payload;
}
