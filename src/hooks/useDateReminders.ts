/**
 * Computes upcoming accepted date-proposal countdowns for in-app UI (Schedule / Dashboard cards).
 * Push reminders for real dates are server-owned (`date-reminder-cron` → `send-notification`, category `date_reminder`).
 */
import { useState, useEffect } from 'react';
import { DateProposal } from '@/hooks/useSchedule';
import {
  differenceInSeconds,
  differenceInMinutes,
  differenceInHours,
  differenceInDays,
  isAfter,
} from 'date-fns';

export interface DateReminder {
  id: string;
  proposalId: string;
  matchName: string;
  matchAvatar?: string;
  date: Date;
  mode: 'video' | 'in-person';
  timeUntil: {
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
    totalSeconds: number;
  };
  urgency: 'none' | 'soon' | 'imminent' | 'now';
  formattedCountdown: string;
}

// Calculate countdown
function calculateTimeUntil(date: Date): DateReminder['timeUntil'] {
  const now = new Date();
  const totalSeconds = Math.max(0, differenceInSeconds(date, now));

  const days = differenceInDays(date, now);
  const hours = differenceInHours(date, now) % 24;
  const minutes = differenceInMinutes(date, now) % 60;
  const seconds = totalSeconds % 60;

  return { days, hours, minutes, seconds, totalSeconds };
}

function getUrgency(totalSeconds: number): DateReminder['urgency'] {
  if (totalSeconds <= 0) return 'now';
  if (totalSeconds <= 15 * 60) return 'imminent'; // 15 min
  if (totalSeconds <= 60 * 60) return 'soon'; // 1 hour
  return 'none';
}

function formatCountdown(timeUntil: DateReminder['timeUntil']): string {
  const { days, hours, minutes, seconds, totalSeconds } = timeUntil;

  if (totalSeconds <= 0) return 'Starting now!';
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function useDateReminders(upcomingDates: DateProposal[]) {
  const [reminders, setReminders] = useState<DateReminder[]>([]);

  useEffect(() => {
    const updateReminders = () => {
      const now = new Date();

      const activeReminders: DateReminder[] = upcomingDates
        .filter((p) => p.status === 'accepted' && isAfter(p.date, now))
        .map((proposal) => {
          const timeUntil = calculateTimeUntil(proposal.date);
          return {
            id: `reminder-${proposal.id}`,
            proposalId: proposal.id,
            matchName: proposal.senderName || 'Your match',
            matchAvatar: proposal.senderAvatar,
            date: proposal.date,
            mode: proposal.mode,
            timeUntil,
            urgency: getUrgency(timeUntil.totalSeconds),
            formattedCountdown: formatCountdown(timeUntil),
          };
        })
        .sort((a, b) => a.timeUntil.totalSeconds - b.timeUntil.totalSeconds);

      setReminders(activeReminders);
    };

    updateReminders();
    const interval = setInterval(updateReminders, 1000);

    return () => clearInterval(interval);
  }, [upcomingDates]);

  const nextReminder = reminders[0] || null;

  const imminentReminders = reminders.filter(
    (r) => r.urgency === 'imminent' || r.urgency === 'now',
  );
  const soonReminders = reminders.filter((r) => r.urgency === 'soon');

  return {
    reminders,
    nextReminder,
    imminentReminders,
    soonReminders,
  };
}
