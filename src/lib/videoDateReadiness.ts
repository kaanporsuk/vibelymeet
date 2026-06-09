import { supabase } from "@/integrations/supabase/client";
import type { VideoDateReadinessStatus } from "@clientShared/matching/videoDateReadinessV2";

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
