import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePushNotifications } from "./usePushNotifications";

interface InactiveUser {
  id: string;
  name: string;
  lastDropDate: string;
  inactiveDays: number;
}

const REENGAGEMENT_INTERVALS = [3, 7, 14]; // Days of inactivity to trigger notifications

export function useReengagementNotifications() {
  const { user } = useAuth();
  const { sendNotification, isSupported, permission } = usePushNotifications();

  // Check if user hasn't responded to daily drops in 3+ days
  const { data: lastDropActivity } = useQuery({
    queryKey: ['last-drop-activity', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;

      // Get user's most recent daily drop interaction
      const { data: drops, error } = await supabase
        .from('daily_drops')
        .select('created_at, status')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) throw error;
      
      if (!drops?.length) {
        // User has never interacted with drops
        return { lastActivity: null, inactiveDays: 999 };
      }

      const lastDrop = drops[0];
      const lastActivityDate = new Date(lastDrop.created_at);
      const now = new Date();
      const diffTime = now.getTime() - lastActivityDate.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      return {
        lastActivity: lastDrop.created_at,
        status: lastDrop.status,
        inactiveDays: diffDays,
      };
    },
    enabled: !!user?.id,
    staleTime: 1000 * 60 * 60, // Check once per hour
  });

  // Send re-engagement notification based on inactivity
  useEffect(() => {
    if (!lastDropActivity || !isSupported || permission !== 'granted') return;

    const { inactiveDays } = lastDropActivity;
    
    // Check if we should send a re-engagement notification
    const shouldNotify = REENGAGEMENT_INTERVALS.includes(inactiveDays);
    
    if (!shouldNotify) return;

    // Check if we've already sent a notification for this interval
    const notificationKey = `reengagement-${inactiveDays}-${new Date().toDateString()}`;
    const alreadyNotified = localStorage.getItem(notificationKey);
    
    if (alreadyNotified) return;

    // Send the notification
    const messages = getReengagementMessage(inactiveDays);
    sendNotification(messages.title, {
      body: messages.body,
      tag: `reengagement-${inactiveDays}`,
      icon: '/favicon.ico',
    });

    // Mark as sent
    localStorage.setItem(notificationKey, 'true');
  }, [lastDropActivity, isSupported, permission, sendNotification]);

  return {
    lastDropActivity,
    inactiveDays: lastDropActivity?.inactiveDays || 0,
  };
}

function getReengagementMessage(days: number): { title: string; body: string } {
  switch (days) {
    case 3:
      return {
        title: "Your daily vibe is waiting! 💫",
        body: "You haven't checked your daily drop in a while. Someone special might be waiting for you!",
      };
    case 7:
      return {
        title: "We miss you! 💝",
        body: "It's been a week since your last daily drop. Come back and discover new connections!",
      };
    case 14:
      return {
        title: "Your matches are waiting 🌟",
        body: "2 weeks without a vibe check? Your perfect match could be just one swipe away!",
      };
    default:
      return {
        title: "Time for your daily drop! ✨",
        body: "Your daily match is ready. Don't miss out on a potential connection!",
      };
  }
}

// Admin function to get all inactive users
export async function getInactiveUsers(daysInactive: number = 3): Promise<InactiveUser[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysInactive);

  // Get all users
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, name');

  if (profilesError) throw profilesError;

  // Get latest drop activity for each user
  const { data: latestDropsA, error: dropsErrorA } = await supabase
    .from('daily_drops')
    .select('user_a_id, user_b_id, created_at')
    .order('created_at', { ascending: false });

  if (dropsErrorA) throw dropsErrorA;

  // Create a map of user_id to latest activity
  const activityMap = new Map<string, string>();
  latestDropsA?.forEach(drop => {
    if (!activityMap.has(drop.user_a_id)) {
      activityMap.set(drop.user_a_id, drop.created_at);
    }
    if (!activityMap.has(drop.user_b_id)) {
      activityMap.set(drop.user_b_id, drop.created_at);
    }
  });

  // Filter to inactive users
  const inactiveUsers: InactiveUser[] = [];
  const now = new Date();

  profiles?.forEach(profile => {
    const lastActivity = activityMap.get(profile.id);
    
    if (!lastActivity) {
      // Never interacted - definitely inactive
      inactiveUsers.push({
        id: profile.id,
        name: profile.name,
        lastDropDate: 'Never',
        inactiveDays: 999,
      });
    } else {
      const lastDate = new Date(lastActivity);
      const diffDays = Math.floor((now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
      
      if (diffDays >= daysInactive) {
        inactiveUsers.push({
          id: profile.id,
          name: profile.name,
          lastDropDate: lastActivity,
          inactiveDays: diffDays,
        });
      }
    }
  });

  return inactiveUsers.sort((a, b) => b.inactiveDays - a.inactiveDays);
}

// Function to send bulk re-engagement notifications (for admin use)
export async function sendBulkReengagementNotifications(
  userIds: string[],
  title: string,
  body: string
): Promise<{ sent: number; failed: number }> {
  // In a real implementation, this would:
  // 1. Store the notification in a queue
  // 2. Use a push notification service (e.g., Firebase Cloud Messaging)
  // 3. Track delivery and open rates
  
  // For now, we log the action and return mock stats
  console.log(`Sending re-engagement to ${userIds.length} users:`, { title, body });
  
  return {
    sent: userIds.length,
    failed: 0,
  };
}
