import { supabase } from "@/integrations/supabase/client";

export type NotificationDispatchAckResult = {
  ok: boolean;
  firstAck: boolean;
  dispatchGroupId: string | null;
};

export type NotificationOpenedV2Result = {
  ok: boolean;
  firstOpen: boolean;
  openedAt: string | null;
  notificationId: string | null;
};

export async function ackNotificationDispatchFromPayload(
  payload: unknown,
  ackSource: string,
  providerNotificationId?: string | null,
): Promise<NotificationDispatchAckResult> {
  const dispatchGroupId = dispatchGroupIdFromPayload(payload);
  if (!dispatchGroupId) return { ok: true, firstAck: true, dispatchGroupId: null };
  try {
    const { data, error } = await supabase.rpc("ack_notification_dispatch", {
      p_dispatch_group_id: dispatchGroupId,
      p_provider_notification_id: providerNotificationId ?? null,
      p_ack_source: ackSource,
      p_payload: payload && typeof payload === "object" ? payload : {},
    });
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

export async function markNotificationOpenedV2FromPayload(
  payload: unknown,
): Promise<NotificationOpenedV2Result> {
  const notificationId = notificationIdFromPayload(payload);
  if (!notificationId) return { ok: true, firstOpen: true, openedAt: null, notificationId: null };
  try {
    const { data, error } = await supabase.rpc("mark_notification_opened_v2", {
      notification_id: notificationId,
    });
    if (error) return { ok: false, firstOpen: false, openedAt: null, notificationId };
    const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const ok = record.ok !== false;
    return {
      ok,
      firstOpen: ok && record.first_open === true,
      openedAt: typeof record.opened_at === "string" ? record.opened_at : null,
      notificationId,
    };
  } catch {
    return { ok: false, firstOpen: false, openedAt: null, notificationId };
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
  const nested =
    typeof preload?.dispatchGroupId === "string"
      ? preload.dispatchGroupId.trim()
      : typeof preload?.dispatch_group_id === "string"
        ? preload.dispatch_group_id.trim()
        : "";
  return nested || null;
}

function notificationIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const direct = typeof record.notification_id === "string" ? record.notification_id.trim() : "";
  if (direct) return direct;
  const alias = typeof record.in_app_notification_id === "string" ? record.in_app_notification_id.trim() : "";
  return alias || null;
}
