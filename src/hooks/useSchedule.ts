import { useState, useMemo, useCallback, useEffect } from "react";
import { addDays, format, startOfWeek, startOfDay } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

export type TimeBlock = "morning" | "afternoon" | "evening" | "night";
export type SlotStatus = "busy" | "open" | "event";

export interface TimeSlot {
  date: Date;
  block: TimeBlock;
  status: SlotStatus;
  eventName?: string;
  eventId?: string;
}

export interface ScheduleData {
  [key: string]: TimeSlot;
}

export interface DateProposal {
  id: string;
  date: Date;
  block: TimeBlock;
  mode: "video" | "in-person";
  message: string;
  status: "pending" | "accepted" | "declined";
  sentAt: Date;
  isIncoming?: boolean;
  senderName?: string;
  senderAvatar?: string;
  matchId?: string;
}

const TIME_BLOCK_INFO: Record<TimeBlock, { label: string; hours: string }> = {
  morning: { label: "Morning", hours: "08:00 - 12:00" },
  afternoon: { label: "Afternoon", hours: "12:00 - 17:00" },
  evening: { label: "Evening", hours: "17:00 - 21:00" },
  night: { label: "Night", hours: "21:00 - 00:00" },
};

export const getTimeBlockInfo = (block: TimeBlock) => TIME_BLOCK_INFO[block];

const generateSlotKey = (date: Date, block: TimeBlock): string => {
  return `${format(date, "yyyy-MM-dd")}_${block}`;
};

export const useSchedule = () => {
  const [mySchedule, setMySchedule] = useState<ScheduleData>({});
  const [proposals, setProposals] = useState<DateProposal[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load schedule from database on mount
  useEffect(() => {
    const loadSchedule = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setIsLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("user_schedules")
        .select("slot_key, slot_date, time_block, status")
        .eq("user_id", user.id);

      if (!error && data) {
        const schedule: ScheduleData = {};
        data.forEach((row) => {
          const date = new Date(`${row.slot_date}T00:00:00`);
          schedule[row.slot_key] = {
            date,
            block: row.time_block as TimeBlock,
            status: row.status as SlotStatus,
          };
        });
        setMySchedule(schedule);
      }
      setIsLoading(false);
    };

    loadSchedule();
  }, []);

  const dateRange = useMemo(() => {
    const today = startOfDay(new Date());
    return Array.from({ length: 14 }, (_, i) => addDays(today, i));
  }, []);

  const toggleSlot = useCallback(async (date: Date, block: TimeBlock) => {
    const key = generateSlotKey(date, block);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setMySchedule((prev) => {
      const currentSlot = prev[key];
      if (currentSlot?.status === "event") return prev;

      if (currentSlot?.status === "open") {
        // Remove from DB
        supabase.from("user_schedules").delete().eq("user_id", user.id).eq("slot_key", key).then();
        const { [key]: _, ...rest } = prev;
        return rest;
      }

      // Insert to DB
      supabase.from("user_schedules").upsert({
        user_id: user.id,
        slot_key: key,
        slot_date: format(date, "yyyy-MM-dd"),
        time_block: block,
        status: "open",
      }).then();

      return { ...prev, [key]: { date, block, status: "open" } };
    });
  }, []);

  const getSlotStatus = useCallback(
    (date: Date, block: TimeBlock): TimeSlot | null => {
      const key = generateSlotKey(date, block);
      return mySchedule[key] || null;
    },
    [mySchedule]
  );

  const copyPreviousWeek = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const today = startOfDay(new Date());
    const currentWeekStart = startOfWeek(today, { weekStartsOn: 1 });
    const newSlots: Array<{ user_id: string; slot_key: string; slot_date: string; time_block: string; status: string }> = [];

    setMySchedule((prev) => {
      const newSchedule = { ...prev };
      for (let i = 0; i < 7; i++) {
        const sourceDate = addDays(currentWeekStart, i);
        const targetDate = addDays(currentWeekStart, i + 7);

        (["morning", "afternoon", "evening", "night"] as TimeBlock[]).forEach((block) => {
          const sourceKey = generateSlotKey(sourceDate, block);
          const targetKey = generateSlotKey(targetDate, block);
          const sourceSlot = prev[sourceKey];

          if (sourceSlot?.status === "open") {
            newSchedule[targetKey] = { date: targetDate, block, status: "open" };
            newSlots.push({
              user_id: user.id,
              slot_key: targetKey,
              slot_date: format(targetDate, "yyyy-MM-dd"),
              time_block: block,
              status: "open",
            });
          }
        });
      }
      return newSchedule;
    });

    if (newSlots.length > 0) {
      supabase.from("user_schedules").upsert(newSlots).then();
    }
  }, []);

  const sendProposal = useCallback(
    (
      date: Date,
      block: TimeBlock,
      mode: "video" | "in-person",
      message: string,
      matchName?: string,
      matchId?: string
    ): DateProposal => {
      const proposal: DateProposal = {
        id: `proposal-${Date.now()}`,
        date,
        block,
        mode,
        message,
        status: "pending",
        sentAt: new Date(),
        isIncoming: false,
        senderName: matchName,
        matchId,
      };

      setProposals((prev) => [...prev, proposal]);
      return proposal;
    },
    []
  );

  const respondToProposal = useCallback((proposalId: string, accept: boolean) => {
    setProposals((prev) =>
      prev.map((p) => (p.id === proposalId ? { ...p, status: accept ? "accepted" : "declined" } : p))
    );
  }, []);

  return {
    mySchedule,
    dateRange,
    toggleSlot,
    getSlotStatus,
    copyPreviousWeek,
    proposals,
    sendProposal,
    respondToProposal,
    getTimeBlockInfo,
    isLoading,
  };
};


// Hook for viewing mutual availability with a match
export const useMutualAvailability = (_matchId: string) => {
  const { mySchedule, dateRange } = useSchedule();
  // Empty schedule for now until we have actual match schedules from DB
  const [matchSchedule] = useState<ScheduleData>({});

  const getMutualSlots = useMemo(() => {
    const slots: Array<{
      date: Date;
      block: TimeBlock;
      type: "golden" | "available";
    }> = [];

    dateRange.forEach(date => {
      (['morning', 'afternoon', 'evening', 'night'] as TimeBlock[]).forEach(block => {
        const key = `${format(date, "yyyy-MM-dd")}_${block}`;
        const mySlot = mySchedule[key];
        const matchSlot = matchSchedule[key];

        // Only show slots where match is open
        if (matchSlot?.status === "open") {
          if (mySlot?.status === "open") {
            slots.push({ date, block, type: "golden" });
          } else if (!mySlot || mySlot.status === "busy") {
            slots.push({ date, block, type: "available" });
          }
        }
      });
    });

    return slots;
  }, [mySchedule, matchSchedule, dateRange]);

  return {
    mutualSlots: getMutualSlots,
    dateRange,
  };
};
