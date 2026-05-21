import { supabase } from "@/integrations/supabase/client";
import type { VideoDateReadinessStatus } from "@clientShared/matching/videoDateReadinessV2";

export type VideoDateDiagnosticEntryResult =
  | {
      ok: true;
      roomName: string;
      roomUrl: string;
      token: string;
      tokenExpiresAt: string | null;
      tokenTtlSeconds: number | null;
    }
  | {
      ok: false;
      error: string;
      retryable: boolean;
    };

export async function recordVideoDateHeartbeatV2(
  eventId: string,
  options: {
    foreground?: boolean;
    clientPlatform?: "web" | "ios" | "android";
  } = {},
): Promise<boolean> {
  const { data, error } = await supabase.rpc("record_heartbeat_v2", {
    p_event_id: eventId,
    p_foreground: options.foreground ?? true,
    p_client_platform: options.clientPlatform ?? "web",
  });
  if (error) return false;
  return (data as { ok?: boolean } | null)?.ok !== false;
}

export async function recordVideoDateReadinessCheckV2(params: {
  eventId: string;
  status: VideoDateReadinessStatus;
  capabilities: Record<string, unknown>;
  clientPlatform?: "web" | "ios" | "android";
}): Promise<boolean> {
  const { data, error } = await supabase.rpc("record_readiness_check_v2", {
    p_event_id: params.eventId,
    p_status: params.status,
    p_capabilities: params.capabilities,
    p_client_platform: params.clientPlatform ?? "web",
  });
  if (error) return false;
  return (data as { ok?: boolean } | null)?.ok !== false;
}

export async function prepareVideoDateDiagnosticEntry(): Promise<VideoDateDiagnosticEntryResult> {
  let payload: Record<string, unknown> | null;
  try {
    const { data, error } = await supabase.functions.invoke("daily-room", {
      body: { action: "prepare_diagnostic_entry" },
    });
    if (error) {
      return { ok: false, error: "diagnostic_entry_failed", retryable: true };
    }
    payload = data as Record<string, unknown> | null;
  } catch {
    return { ok: false, error: "diagnostic_entry_failed", retryable: true };
  }
  if (!payload || payload.ok !== true || typeof payload.token !== "string") {
    return {
      ok: false,
      error: typeof payload?.error === "string" ? payload.error : "diagnostic_entry_failed",
      retryable: payload?.retryable !== false,
    };
  }
  const roomName = typeof payload.room_name === "string" ? payload.room_name : "";
  const roomUrl = typeof payload.room_url === "string" ? payload.room_url : "";
  if (!roomName || !roomUrl) {
    return { ok: false, error: "diagnostic_entry_invalid_response", retryable: true };
  }
  return {
    ok: true,
    roomName,
    roomUrl,
    token: payload.token,
    tokenExpiresAt: typeof payload.token_expires_at === "string" ? payload.token_expires_at : null,
    tokenTtlSeconds: typeof payload.token_ttl_seconds === "number" ? payload.token_ttl_seconds : null,
  };
}

export async function persistReadyGateSuppressionV2(
  sessionId: string,
  suppressedUntilMs?: number,
): Promise<boolean> {
  if (!sessionId) return false;
  const { data, error } = await supabase.rpc("persist_ready_gate_suppression_v2", {
    p_session_id: sessionId,
    p_suppressed_until: Number.isFinite(suppressedUntilMs)
      ? new Date(suppressedUntilMs as number).toISOString()
      : null,
  });
  if (error) return false;
  return (data as { ok?: boolean } | null)?.ok !== false;
}
