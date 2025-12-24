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

// Generate initial mock data for the current user
const generateMockMySchedule = (): ScheduleData => {
  const schedule: ScheduleData = {};
  const today = startOfDay(new Date());
  
  // Set some open slots
  const openSlots = [
    { daysFromNow: 0, block: "evening" as TimeBlock },
    { daysFromNow: 1, block: "afternoon" as TimeBlock },
    { daysFromNow: 1, block: "evening" as TimeBlock },
    { daysFromNow: 2, block: "morning" as TimeBlock },
    { daysFromNow: 3, block: "evening" as TimeBlock },
    { daysFromNow: 3, block: "night" as TimeBlock },
    { daysFromNow: 5, block: "afternoon" as TimeBlock },
    { daysFromNow: 5, block: "evening" as TimeBlock },
    { daysFromNow: 6, block: "evening" as TimeBlock },
    { daysFromNow: 7, block: "morning" as TimeBlock },
    { daysFromNow: 7, block: "evening" as TimeBlock },
    { daysFromNow: 8, block: "night" as TimeBlock },
  ];

  openSlots.forEach(({ daysFromNow, block }) => {
    const date = addDays(today, daysFromNow);
    const key = generateSlotKey(date, block);
    schedule[key] = { date, block, status: "open" };
  });

  // Add an event (Friday Speed Dating)
  const fridayEvent = addDays(today, (5 - today.getDay() + 7) % 7 || 7); // Next Friday
  const eventKey = generateSlotKey(fridayEvent, "evening");
  schedule[eventKey] = { 
    date: fridayEvent, 
    block: "evening", 
    status: "event",
    eventName: "Speed Dating Night",
    eventId: "event-1"
  };

  return schedule;
};

// Generate mock data for a match's schedule
const generateMockMatchSchedule = (): ScheduleData => {
  const schedule: ScheduleData = {};
  const today = startOfDay(new Date());
  
  const openSlots = [
    { daysFromNow: 0, block: "evening" as TimeBlock }, // Overlaps with user!
    { daysFromNow: 1, block: "morning" as TimeBlock },
    { daysFromNow: 1, block: "evening" as TimeBlock }, // Overlaps with user!
    { daysFromNow: 2, block: "afternoon" as TimeBlock },
    { daysFromNow: 3, block: "evening" as TimeBlock }, // Overlaps with user!
    { daysFromNow: 4, block: "evening" as TimeBlock },
    { daysFromNow: 5, block: "morning" as TimeBlock },
    { daysFromNow: 5, block: "evening" as TimeBlock }, // Overlaps with user!
    { daysFromNow: 6, block: "evening" as TimeBlock }, // Overlaps with user!
    { daysFromNow: 8, block: "afternoon" as TimeBlock },
    { daysFromNow: 8, block: "night" as TimeBlock }, // Overlaps with user!
  ];

  openSlots.forEach(({ daysFromNow, block }) => {
    const date = addDays(today, daysFromNow);
    const key = generateSlotKey(date, block);
    schedule[key] = { date, block, status: "open" };
  });

  return schedule;
};

export const useSchedule = () => {
  const [mySchedule, setMySchedule] = useState<ScheduleData>(generateMockMySchedule);
  const [proposals, setProposals] = useState<DateProposal[]>([]);

  // Generate 2-week date range
  const dateRange = useMemo(() => {
    const today = startOfDay(new Date());
    return Array.from({ length: 14 }, (_, i) => addDays(today, i));
  }, []);

  const toggleSlot = useCallback((date: Date, block: TimeBlock) => {
    const key = generateSlotKey(date, block);
    
    setMySchedule(prev => {
      const currentSlot = prev[key];
      
      // Can't toggle event slots
      if (currentSlot?.status === "event") {
        return prev;
      }
      
      // Toggle between open and busy
      if (currentSlot?.status === "open") {
        const { [key]: _, ...rest } = prev;
        return rest;
      }
      
      return {
        ...prev,
        [key]: { date, block, status: "open" }
      };
    });
  }, []);

  const getSlotStatus = useCallback((date: Date, block: TimeBlock): TimeSlot | null => {
    const key = generateSlotKey(date, block);
    return mySchedule[key] || null;
  }, [mySchedule]);

  const copyPreviousWeek = useCallback(() => {
    setMySchedule(prev => {
      const newSchedule = { ...prev };
      const today = startOfDay(new Date());
      const currentWeekStart = startOfWeek(today, { weekStartsOn: 1 });
      
      // Copy from days 0-6 to days 7-13
      for (let i = 0; i < 7; i++) {
        const sourceDate = addDays(currentWeekStart, i);
        const targetDate = addDays(currentWeekStart, i + 7);
        
        (['morning', 'afternoon', 'evening', 'night'] as TimeBlock[]).forEach(block => {
          const sourceKey = generateSlotKey(sourceDate, block);
          const targetKey = generateSlotKey(targetDate, block);
          const sourceSlot = prev[sourceKey];
          
          // Only copy open slots, not events
          if (sourceSlot?.status === "open") {
            newSchedule[targetKey] = { 
              date: targetDate, 
              block, 
              status: "open" 
            };
          }
        });
      }
      
      return newSchedule;
    });
  }, []);

  const sendProposal = useCallback((
    date: Date, 
    block: TimeBlock, 
    mode: "video" | "in-person",
    message: string
  ): DateProposal => {
    const proposal: DateProposal = {
      id: `proposal-${Date.now()}`,
      date,
      block,
      mode,
      message,
      status: "pending",
      sentAt: new Date(),
    };
    
    setProposals(prev => [...prev, proposal]);
    return proposal;
  }, []);

  return {
    mySchedule,
    dateRange,
    toggleSlot,
    getSlotStatus,
    copyPreviousWeek,
    proposals,
    sendProposal,
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
