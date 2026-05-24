import { supabase } from "@/integrations/supabase/client";

export type NotificationDispatchAckResult = {
  ok: boolean;
  firstAck: boolean;
  dispatchGroupId: string | null;
};

export async function ackNotificationDispatchFromPayload(
  payload: unknown,
  ackSource: string,
  providerNotificationId?: string | null,
): Promise<NotificationDispatchAckResult> {
  const dispatchGroupId = dispatchGroupIdFromPayload(payload);
  if (!dispatchGroupId) return { ok: true, firstAck: true, dispatchGroupId: null };
  try {
    const { data, error } = await supabase.rpc("ack_notification_dispatch" as never, {
      p_dispatch_group_id: dispatchGroupId,
      p_provider_notification_id: providerNotificationId ?? null,
      p_ack_source: ackSource,
      p_payload: payload && typeof payload === "object" ? payload : {},
    } as never);
    if (error) return { ok: false, firstAck: true, dispatchGroupId };
    const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
    return {
      ok: record.ok !== false,
      firstAck: record.first_ack !== false,
      dispatchGroupId,
    };
  } catch {
    return { ok: false, firstAck: true, dispatchGroupId };
  }
}

function dispatchGroupIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const direct = typeof record.dispatch_group_id === "string" ? record.dispatch_group_id.trim() : "";
  if (direct) return direct;
  const preload = record.video_date_preload && typeof record.video_date_preload === "object"
    ? record.video_date_preload as Record<string, unknown>
    : null;
  const nested = typeof preload?.dispatchGroupId === "string" ? preload.dispatchGroupId.trim() : "";
  return nested || null;
}
