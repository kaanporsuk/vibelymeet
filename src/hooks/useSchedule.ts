import { useState, useMemo, useCallback } from "react";
import { addDays, format, startOfWeek, isSameDay, isAfter, isBefore, startOfDay } from "date-fns";

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
  [key: string]: TimeSlot; // key format: "YYYY-MM-DD_block"
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

// Generate empty schedule for new users - persisted locally
const STORAGE_KEY = "vibely_my_schedule_v1";

const loadPersistedSchedule = (): ScheduleData => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as { openKeys?: string[] };
    const openKeys = parsed?.openKeys ?? [];

    const schedule: ScheduleData = {};
    openKeys.forEach((key) => {
      const [datePart, block] = key.split("_") as [string, TimeBlock];
      if (!datePart || !block) return;

      // datePart is yyyy-MM-dd, safe for Date construction in local time by adding T00:00
      const date = new Date(`${datePart}T00:00:00`);
      schedule[key] = { date, block, status: "open" };
    });

    return schedule;
  } catch {
    return {};
  }
};

const persistSchedule = (schedule: ScheduleData) => {
  try {
    const openKeys = Object.entries(schedule)
      .filter(([, slot]) => slot.status === "open")
      .map(([key]) => key);

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ openKeys }));
  } catch {
    // ignore
  }
};

export const useSchedule = () => {
  const [mySchedule, setMySchedule] = useState<ScheduleData>(() => loadPersistedSchedule());
  const [proposals, setProposals] = useState<DateProposal[]>(generateEmptyProposals);

  // Persist schedule changes
  const persistRef = useMemo(() => ({ t: 0 }), []);
  useMemo(() => {
    // cheap debounce to avoid excessive writes during rapid taps
    window.clearTimeout(persistRef.t);
    persistRef.t = window.setTimeout(() => persistSchedule(mySchedule), 150);
    return undefined;
  }, [mySchedule, persistRef]);

  // Generate 2-week date range
  const dateRange = useMemo(() => {
    const today = startOfDay(new Date());
    return Array.from({ length: 14 }, (_, i) => addDays(today, i));
  }, []);

  const toggleSlot = useCallback((date: Date, block: TimeBlock) => {
    const key = generateSlotKey(date, block);

    setMySchedule((prev) => {
      const currentSlot = prev[key];

      // Can't toggle event slots
      if (currentSlot?.status === "event") {
        return prev;
      }

      // Toggle between open and empty
      if (currentSlot?.status === "open") {
        const { [key]: _, ...rest } = prev;
        return rest;
      }

      return {
        ...prev,
        [key]: { date, block, status: "open" },
      };
    });
  }, []);

  const getSlotStatus = useCallback(
    (date: Date, block: TimeBlock): TimeSlot | null => {
      const key = generateSlotKey(date, block);
      return mySchedule[key] || null;
    },
    [mySchedule]
  );

  const copyPreviousWeek = useCallback(() => {
    setMySchedule((prev) => {
      const newSchedule = { ...prev };
      const today = startOfDay(new Date());
      const currentWeekStart = startOfWeek(today, { weekStartsOn: 1 });

      // Copy from days 0-6 to days 7-13
      for (let i = 0; i < 7; i++) {
        const sourceDate = addDays(currentWeekStart, i);
        const targetDate = addDays(currentWeekStart, i + 7);

        (["morning", "afternoon", "evening", "night"] as TimeBlock[]).forEach((block) => {
          const sourceKey = generateSlotKey(sourceDate, block);
          const targetKey = generateSlotKey(targetDate, block);
          const sourceSlot = prev[sourceKey];

          // Only copy open slots, not events
          if (sourceSlot?.status === "open") {
            newSchedule[targetKey] = {
              date: targetDate,
              block,
              status: "open",
            };
          }
        });
      }

      return newSchedule;
    });
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
  };
};


// Hook for viewing mutual availability with a match
export const useMutualAvailability = (matchId: string) => {
  const { mySchedule, dateRange } = useSchedule();
  const [matchSchedule] = useState<ScheduleData>(generateMockMatchSchedule);

  const getMutualSlots = useMemo(() => {
    const slots: Array<{
      date: Date;
      block: TimeBlock;
      type: "golden" | "available";
    }> = [];

    dateRange.forEach(date => {
      (['morning', 'afternoon', 'evening', 'night'] as TimeBlock[]).forEach(block => {
        const key = generateSlotKey(date, block);
        const mySlot = mySchedule[key];
        const matchSlot = matchSchedule[key];

        // Only show slots where match is open
        if (matchSlot?.status === "open") {
          if (mySlot?.status === "open") {
            // Golden slot - both are open
            slots.push({ date, block, type: "golden" });
          } else if (!mySlot || mySlot.status === "busy") {
            // Available - only match is open
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
