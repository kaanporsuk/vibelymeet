/**
 * Date reminders from accepted proposals — parity with web useDateReminders.
 * Computes nextReminder, imminentReminders; no browser Notification (native uses push).
 */
import { useState, useEffect, useMemo } from 'react';
import { differenceInSeconds } from 'date-fns';
import type { DateProposal } from '@/lib/useDateProposals';

export type DateReminder = {
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
};

function calculateTimeUntil(date: Date): DateReminder['timeUntil'] {
  const now = new Date();
  const totalSeconds = Math.max(0, differenceInSeconds(date, now));
  const days = Math.floor(totalSeconds / (24 * 60 * 60));
  const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds, totalSeconds };
}

function getUrgency(totalSeconds: number): DateReminder['urgency'] {
  if (totalSeconds <= 0) return 'now';
  if (totalSeconds <= 15 * 60) return 'imminent';
  if (totalSeconds <= 60 * 60) return 'soon';
  return 'none';
}

function formatCountdown(t: DateReminder['timeUntil']): string {
  if (t.totalSeconds <= 0) return 'Starting now!';
  if (t.days > 0) return `${t.days}d ${t.hours}h`;
  if (t.hours > 0) return `${t.hours}h ${t.minutes}m`;
  if (t.minutes > 0) return `${t.minutes}m ${t.seconds}s`;
  return `${t.seconds}s`;
}

export function useDateReminders(upcomingDates: DateProposal[]) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const hasRelevant = upcomingDates.some(
      (p) => p.status === 'accepted' && p.date.getTime() > Date.now() - 2 * 60 * 1000,
    );
    if (!hasRelevant) return;
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, [upcomingDates]);

  const reminders = useMemo(() => {
    const list = upcomingDates
      .filter((p) => p.status === 'accepted' && p.date.getTime() > now.getTime() - 2 * 60 * 1000)
      .map((p) => {
        const timeUntil = calculateTimeUntil(p.date);
        return {
          id: `reminder-${p.id}`,
          proposalId: p.id,
          matchName: p.senderName ?? 'Your match',
          matchAvatar: p.senderAvatar,
          date: p.date,
          mode: p.mode,
          timeUntil,
          urgency: getUrgency(timeUntil.totalSeconds),
          formattedCountdown: formatCountdown(timeUntil),
        };
      })
      .sort((a, b) => a.timeUntil.totalSeconds - b.timeUntil.totalSeconds);
    return list;
  }, [upcomingDates, now.getTime()]);

  const nextReminder = reminders[0] ?? null;
  const imminentReminders = reminders.filter((r) => r.urgency === 'imminent' || r.urgency === 'now');
  const soonReminders = reminders.filter((r) => r.urgency === 'soon');

  return { reminders, nextReminder, imminentReminders, soonReminders };
}
