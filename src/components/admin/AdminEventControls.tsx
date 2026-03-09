import { useState } from "react";
import { motion } from "framer-motion";
import { StopCircle, Clock, Plus, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sendNotification } from "@/lib/notifications";

interface AdminEventControlsProps {
  eventId: string;
  eventTitle: string;
  eventStatus: string | null;
  durationMinutes: number | null;
}

const AdminEventControls = ({
  eventId,
  eventTitle,
  eventStatus,
  durationMinutes,
}: AdminEventControlsProps) => {
  const queryClient = useQueryClient();
  const [isEnding, setIsEnding] = useState(false);

  const endEvent = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("events")
        .update({ status: "ended" })
        .eq("id", eventId);
      if (error) throw error;

      // Broadcast event ended via Realtime so all clients see EventEndedModal
      const channel = supabase.channel(`event-status-${eventId}`);
      await channel.send({
        type: "broadcast",
        event: "event_ended",
        payload: { eventId },
      });
      supabase.removeChannel(channel);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-events"] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
      toast.success(`"${eventTitle}" has been ended`);
      setIsEnding(false);
    },
    onError: () => toast.error("Failed to end event"),
  });

  const extendEvent = useMutation({
    mutationFn: async (extraMinutes: number) => {
      const newDuration = (durationMinutes || 60) + extraMinutes;
      const { error } = await supabase
        .from("events")
        .update({ duration_minutes: newDuration })
        .eq("id", eventId);
      if (error) throw error;
      return extraMinutes;
    },
    onSuccess: (extraMinutes) => {
      queryClient.invalidateQueries({ queryKey: ["admin-events"] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
      toast.success(`Extended "${eventTitle}" by ${extraMinutes} minutes`);
    },
    onError: () => toast.error("Failed to extend event"),
  });

  const isLive = eventStatus === "live" || eventStatus === "upcoming";
  const isEnded = eventStatus === "ended" || eventStatus === "completed";

  if (isEnded) return null;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      className="flex items-center gap-2 flex-wrap"
    >
      {isEnding ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-destructive">End this event?</span>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => endEvent.mutate()}
            disabled={endEvent.isPending}
          >
            {endEvent.isPending ? "Ending..." : "Confirm"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setIsEnding(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <>
          <Button
            size="sm"
            variant="destructive"
            className="gap-1.5"
            onClick={() => setIsEnding(true)}
          >
            <StopCircle className="w-3.5 h-3.5" />
            End Event
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => extendEvent.mutate(15)}
            disabled={extendEvent.isPending}
          >
            <Plus className="w-3.5 h-3.5" />
            +15 min
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => extendEvent.mutate(30)}
            disabled={extendEvent.isPending}
          >
            <Plus className="w-3.5 h-3.5" />
            +30 min
          </Button>
        </>
      )}
    </motion.div>
  );
};

export default AdminEventControls;
