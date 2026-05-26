import { useState } from "react";
import { motion } from "framer-motion";
import { StopCircle, Plus, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import AdminConfirmDialog from "./AdminConfirmDialog";
import { callAdminRpc, createAdminTargetIdempotencyKey } from "@/lib/adminRpc";
import { formatAdminUtcTime } from "@/lib/adminTime";
import { adminToast } from "@/lib/adminToast";

interface AdminEventControlsProps {
  eventId: string;
  eventTitle: string;
  rawStatus: string | null;
  computedStatus: string;
  endedAt?: string | null;
  archivedAt?: string | null;
  isInFinalizationGrace?: boolean;
  autoFinalizeAt?: Date | null;
}

type PendingEventControlAction =
  | { kind: "go-live" }
  | { kind: "end" }
  | { kind: "extend"; minutes: number }
  | { kind: "reminder" }
  | null;

const AdminEventControls = ({
  eventId,
  eventTitle,
  rawStatus,
  computedStatus,
  endedAt,
  archivedAt,
  isInFinalizationGrace = false,
  autoFinalizeAt,
}: AdminEventControlsProps) => {
  const queryClient = useQueryClient();
  const [pendingAction, setPendingAction] = useState<PendingEventControlAction>(null);
  const [reminderSentAt, setReminderSentAt] = useState<number | null>(null);
  const [isSendingReminder, setIsSendingReminder] = useState(false);
  const [isGoingLive, setIsGoingLive] = useState(false);
  const eventStateIntent = {
    raw_status: rawStatus ?? null,
    computed_status: computedStatus,
    ended_at: endedAt ?? null,
    archived_at: archivedAt ?? null,
    auto_finalize_at: autoFinalizeAt?.toISOString() ?? null,
  };

  const broadcastEventEnded = () => {
    const channel = supabase.channel(`event-status-${eventId}`);
    void channel
      .send({
        type: "broadcast",
        event: "event_ended",
        payload: { eventId },
      })
      .catch(() => undefined)
      .finally(() => {
        void supabase.removeChannel(channel);
      });
  };

  const endEvent = useMutation({
    mutationFn: async () => {
      await callAdminRpc("admin_end_event", {
        p_event_id: eventId,
        p_reason: "Ended from /kaan dashboard",
        p_idempotency_key: createAdminTargetIdempotencyKey("admin_end_event", eventId, {
          action: "manual-end",
          ...eventStateIntent,
        }),
      });
    },
    onSuccess: () => {
      broadcastEventEnded();
      queryClient.invalidateQueries({ queryKey: ["admin-events"] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
      queryClient.invalidateQueries({ queryKey: ["visible-events"] });
      adminToast.success({
        id: `event-ended-${eventId}`,
        title: `"${eventTitle}" has been ended`,
      });
    },
    onError: () => adminToast.error({
      id: `event-end-failed-${eventId}`,
      title: "Failed to end event",
    }),
  });

  const extendEvent = useMutation({
    mutationFn: async (extraMinutes: number) => {
      await callAdminRpc("admin_extend_event", {
        p_event_id: eventId,
        p_minutes: extraMinutes,
        p_reason: "Extended from /kaan dashboard",
        p_idempotency_key: createAdminTargetIdempotencyKey("admin_extend_event", eventId, {
          extraMinutes,
          ...eventStateIntent,
        }),
      });
      return extraMinutes;
    },
    onSuccess: (extraMinutes) => {
      queryClient.invalidateQueries({ queryKey: ["admin-events"] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
      adminToast.success({
        id: `event-extended-${eventId}`,
        title: `Extended "${eventTitle}" by ${extraMinutes} minutes`,
      });
    },
    onError: () => adminToast.error({
      id: `event-extend-failed-${eventId}`,
      title: "Failed to extend event",
    }),
  });

  const normalizedRawStatus = rawStatus?.toLowerCase() || "";
  const normalizedComputedStatus = computedStatus.toLowerCase();
  const isArchived = Boolean(archivedAt) || normalizedRawStatus === "archived";
  const isDraft = normalizedRawStatus === "draft";
  const isCancelled = normalizedRawStatus === "cancelled";
  const isCompleted = normalizedRawStatus === "completed";
  const isComputedEnded = normalizedComputedStatus === "ended";
  const isUpcoming = normalizedComputedStatus === "upcoming";
  const isLive = normalizedComputedStatus === "live";
  const showWrapUpGrace = isComputedEnded && isInFinalizationGrace && !endedAt;
  const showGoLive = normalizedComputedStatus === "live" && normalizedRawStatus !== "live";
  const reminderCooldown = reminderSentAt && Date.now() - reminderSentAt < 15 * 60 * 1000;
  const autoFinalizeLabel = autoFinalizeAt ? formatAdminUtcTime(autoFinalizeAt) : null;

  const handleGoLive = async () => {
    setIsGoingLive(true);
    try {
      const payload = await callAdminRpc("admin_go_live_event", {
        p_event_id: eventId,
        p_reason: "Set live from /kaan dashboard",
        p_idempotency_key: createAdminTargetIdempotencyKey("admin_go_live_event", eventId, {
          action: "go-live",
          ...eventStateIntent,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ["admin-events"] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
      adminToast.success({
        id: `event-go-live-${eventId}`,
        title: `"${eventTitle}" is live`,
        description: payload.notifications_not_queued
          ? "Backend lifecycle update succeeded. User notifications were not queued by the event lifecycle backend."
          : undefined,
      });
    } catch (error) {
      adminToast.error({
        id: `event-go-live-failed-${eventId}`,
        title: "Failed to set event live",
      });
      throw error;
    } finally {
      setIsGoingLive(false);
    }
  };

  const handleSendReminder = async () => {
    setIsSendingReminder(true);
    try {
      const payload = await callAdminRpc("admin_send_event_reminder", {
        p_event_id: eventId,
        p_reason: "Reminder requested from /kaan dashboard",
        p_idempotency_key: createAdminTargetIdempotencyKey("admin_send_event_reminder", eventId, {
          action: "dashboard-reminder",
          reminder_window: Math.floor(Date.now() / (15 * 60 * 1000)),
        }),
      });
      setReminderSentAt(Date.now());
      adminToast.success({
        id: `event-control-reminder-recorded-${eventId}`,
        title: "Reminder request recorded",
        description: payload.notifications_not_queued
          ? "No user notifications were queued because a backend dispatcher did not handle this reminder."
          : undefined,
      });
    } catch {
      adminToast.error({
        id: `event-control-reminder-failed-${eventId}`,
        title: "Failed to send reminder",
      });
      throw new Error("Failed to send reminder");
    } finally {
      setIsSendingReminder(false);
    }
  };

  if (isArchived || isDraft || isCancelled || isCompleted || endedAt) return null;
  if (!showGoLive && !showWrapUpGrace && !isLive && !isUpcoming) return null;

  const getPendingActionCopy = () => {
    switch (pendingAction?.kind) {
      case "go-live":
        return {
          title: `Set "${eventTitle}" live?`,
          description:
            "This calls admin_go_live_event. The backend validates the scheduled event window, writes the lifecycle state, and audits the action. User notifications are only sent if a backend dispatcher supports them.",
          confirmLabel: "Go Live",
        };
      case "end":
        return {
          title: `End "${eventTitle}"?`,
          description:
            "This calls admin_end_event. The backend writes events.status = ended and ended_at, audits the action, then the client broadcasts the local event-ended signal.",
          confirmLabel: "End Event",
        };
      case "extend":
        return {
          title: `Extend "${eventTitle}" by ${pendingAction.minutes} minutes?`,
          description:
            "This calls admin_extend_event. The backend allows extension only during the live window or the 10 minute finalization grace, updates events.duration_minutes, and audits the action.",
          confirmLabel: `Extend +${pendingAction.minutes}`,
        };
      case "reminder":
        return {
          title: `Send reminder for "${eventTitle}"?`,
          description:
            "This calls admin_send_event_reminder. The backend records and audits the request, then reports whether a notification dispatcher queued user sends.",
          confirmLabel: "Send Reminder",
        };
      default:
        return { title: "", description: "", confirmLabel: "Confirm" };
    }
  };

  const handleConfirmAction = async () => {
    if (!pendingAction) return;
    if (pendingAction.kind === "go-live") return handleGoLive();
    if (pendingAction.kind === "end") return endEvent.mutateAsync();
    if (pendingAction.kind === "extend") return extendEvent.mutateAsync(pendingAction.minutes);
    return handleSendReminder();
  };

  const pendingCopy = getPendingActionCopy();
  const isActionPending = endEvent.isPending || extendEvent.isPending || isSendingReminder || isGoingLive;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        className="flex items-center gap-2 flex-wrap"
      >
        {showGoLive && (
          <Button
            size="sm"
            variant="default"
            className="gap-1.5"
            onClick={() => setPendingAction({ kind: "go-live" })}
            disabled={isGoingLive}
            title="Sets the event live during its scheduled window and notifies confirmed attendees only. Waitlisted users do not get a live push."
          >
            Go Live
          </Button>
        )}
        {showWrapUpGrace && (
          <>
            <span
              className="inline-flex items-center rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-300"
              title="The scheduled window has ended. Users are closed out; operators can extend during the 10 minute grace."
            >
              Wrap-up{autoFinalizeLabel ? ` · auto-finalizes ${autoFinalizeLabel}` : ""}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setPendingAction({ kind: "extend", minutes: 15 })}
              disabled={extendEvent.isPending}
            >
              <Plus className="w-3.5 h-3.5" />
              +15 min
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="gap-1.5"
              onClick={() => setPendingAction({ kind: "end" })}
              disabled={endEvent.isPending}
            >
              <StopCircle className="w-3.5 h-3.5" />
              End now
            </Button>
          </>
        )}
        {isLive && (
          <>
            <Button
              size="sm"
              variant="destructive"
              className="gap-1.5"
              onClick={() => setPendingAction({ kind: "end" })}
              disabled={endEvent.isPending}
            >
              <StopCircle className="w-3.5 h-3.5" />
              End Event
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setPendingAction({ kind: "extend", minutes: 15 })}
              disabled={extendEvent.isPending}
            >
              <Plus className="w-3.5 h-3.5" />
              +15 min
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setPendingAction({ kind: "extend", minutes: 30 })}
              disabled={extendEvent.isPending}
            >
              <Plus className="w-3.5 h-3.5" />
              +30 min
            </Button>
          </>
        )}
        {(isLive || isUpcoming) && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setPendingAction({ kind: "reminder" })}
            disabled={isSendingReminder || !!reminderCooldown}
            title="Notifies confirmed attendees with lobby access copy and waitlisted users with status-only copy."
          >
            <Bell className="w-3.5 h-3.5" />
            {reminderCooldown ? "Sent" : "Reminder (confirmed + waitlist)"}
          </Button>
        )}
      </motion.div>
      <AdminConfirmDialog
        open={!!pendingAction}
        title={pendingCopy.title}
        description={pendingCopy.description}
        confirmLabel={pendingCopy.confirmLabel}
        variant={pendingAction?.kind === "go-live" || pendingAction?.kind === "extend" || pendingAction?.kind === "reminder" ? "default" : "destructive"}
        isPending={isActionPending}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null);
        }}
        onConfirm={handleConfirmAction}
      />
    </>
  );
};

export default AdminEventControls;
