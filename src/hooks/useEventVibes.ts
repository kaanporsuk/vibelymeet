import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { toast } from "sonner";

interface EventVibe {
  id: string;
  event_id: string;
  sender_id: string;
  receiver_id: string;
  created_at: string;
}

interface VibeWithProfile extends EventVibe {
  sender?: {
    id: string;
    name: string;
    avatar_url: string | null;
    age: number;
  };
  receiver?: {
    id: string;
    name: string;
    avatar_url: string | null;
    age: number;
  };
}

interface MutualVibe {
  id: string;
  name: string;
  avatar: string | null;
  age: number;
}

export function useEventVibes(eventId: string) {
  const { user } = useUserProfile();
  const queryClient = useQueryClient();
  const { sendNotification, isGranted } = usePushNotifications();

  // Get vibes sent by the current user for this event
  const { data: sentVibes = [], isLoading: loadingSent } = useQuery({
    queryKey: ["event-vibes-sent", eventId, user?.id],
    enabled: !!eventId && !!user?.id,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from("event_vibes")
        .select("receiver_id")
        .eq("event_id", eventId)
        .eq("sender_id", user!.id);

      if (error) {
        console.error("Error fetching sent vibes:", error);
        return [];
      }

      return data?.map((v) => v.receiver_id) || [];
    },
  });

  // Get vibes received by the current user for this event
  const { data: receivedVibes = [], isLoading: loadingReceived } = useQuery({
    queryKey: ["event-vibes-received", eventId, user?.id],
    enabled: !!eventId && !!user?.id,
    queryFn: async (): Promise<VibeWithProfile[]> => {
      const { data, error } = await supabase
        .from("event_vibes")
        .select(`
          id,
          event_id,
          sender_id,
          receiver_id,
          created_at
        `)
        .eq("event_id", eventId)
        .eq("receiver_id", user!.id);

      if (error) {
        console.error("Error fetching received vibes:", error);
        return [];
      }

      // Fetch sender profiles
      if (data && data.length > 0) {
        const senderIds = [...new Set(data.map((v) => v.sender_id))];
        const profiles = await Promise.all(
          senderIds.map(async (id) => {
            const { data: profile } = await supabase.rpc("get_profile_for_viewer", {
              p_target_id: id,
            });
            return profile as { id?: string; name?: string | null; avatar_url?: string | null; age?: number | null } | null;
          }),
        );
        const profileMap = new Map<string, { id?: string; name?: string | null; avatar_url?: string | null; age?: number | null }>();
        profiles.forEach((p) => {
          if (p?.id) profileMap.set(p.id, p);
        });

        return data.map((vibe) => {
          const sender = profileMap.get(vibe.sender_id);
          return {
            ...vibe,
            sender: sender
              ? {
                  id: vibe.sender_id,
                  name: sender.name ?? "Unknown",
                  avatar_url: sender.avatar_url ?? null,
                  age: sender.age ?? 0,
                }
              : undefined,
          };
        });
      }

      return data || [];
    },
  });

  // Check if there's a mutual vibe (both users vibed each other)
  const hasMutualVibe = (receiverId: string): boolean => {
    const userSentVibe = sentVibes.includes(receiverId);
    const userReceivedVibe = receivedVibes.some(
      (v) => v.sender_id === receiverId
    );
    return userSentVibe && userReceivedVibe;
  };

  // Get all mutual vibes with profile data
  const mutualVibes: MutualVibe[] = receivedVibes
    .filter((v) => sentVibes.includes(v.sender_id))
    .map((v) => ({
      id: v.sender_id,
      name: v.sender?.name || "Unknown",
      avatar: v.sender?.avatar_url || null,
      age: v.sender?.age || 0,
    }));

  // Send a vibe to another attendee
  const sendVibeMutation = useMutation({
    mutationFn: async (receiverId: string) => {
      if (!user?.id) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("event_vibes")
        .insert({
          event_id: eventId,
          sender_id: user.id,
          receiver_id: receiverId,
        })
        .select()
        .single();

      if (error) {
        if (error.code === "23505") {
          throw new Error("You already sent a vibe to this person");
        }
        throw error;
      }

      return { vibeData: data, receiverId };
    },
    onSuccess: async ({ receiverId }) => {
      queryClient.invalidateQueries({ queryKey: ["event-vibes-sent", eventId] });
      
      // Check if this creates a mutual vibe
      const isMutual = receivedVibes.some((v) => v.sender_id === receiverId);
      if (isMutual) {
        toast.success("It's a mutual vibe! 💜", {
          description: "You both expressed interest. See you at the event!",
        });
      } else {
        toast.success("Vibe sent! 💫", {
          description: "They'll see your interest before the event.",
        });
      }

      // Send push notification to the receiver (in-app notification)
      // The receiver will get notified via their own query refresh
      // For a full push notification, we'd need to call an edge function
      try {
        await notifyVibeReceiver(receiverId, eventId, isMutual);
      } catch (err) {
        console.error("Failed to send vibe notification:", err);
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to send vibe");
    },
  });

  // Remove a vibe
  const removeVibeMutation = useMutation({
    mutationFn: async (receiverId: string) => {
      if (!user?.id) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("event_vibes")
        .delete()
        .eq("event_id", eventId)
        .eq("sender_id", user.id)
        .eq("receiver_id", receiverId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-vibes-sent", eventId] });
      toast.info("Vibe removed");
    },
    onError: () => {
      toast.error("Failed to remove vibe");
    },
  });

  return {
    sentVibes,
    receivedVibes,
    mutualVibes,
    isLoading: loadingSent || loadingReceived,
    hasSentVibe: (receiverId: string) => sentVibes.includes(receiverId),
    hasReceivedVibe: (senderId: string) =>
      receivedVibes.some((v) => v.sender_id === senderId),
    hasMutualVibe,
    sendVibe: sendVibeMutation.mutate,
    removeVibe: removeVibeMutation.mutate,
    isSendingVibe: sendVibeMutation.isPending,
    mutualVibeCount: mutualVibes.length,
  };
}

/**
 * Pre-event `event_vibes` only — does not create `video_sessions` or `matches`.
 * Mutual interest: route to event lobby, never `/matches` or chat-oriented copy.
 */
async function notifyVibeReceiver(receiverId: string, eventId: string, isMutual: boolean) {
  try {
    const { error } = await supabase.functions.invoke("send-notification", {
      body: {
        user_id: receiverId,
        category: isMutual ? "mutual_vibe" : "someone_vibed_you",
        title: isMutual ? "Mutual vibe! 💜" : "Someone vibed you ✨",
        body: isMutual
          ? "You both showed interest before the event — see you in the lobby!"
          : "Someone at the event is interested in you!",
        data: {
          url: `/event/${eventId}/lobby`,
          event_id: eventId,
        },
      },
    });

    if (error) {
      console.error("Vibe send-notification error:", error);
    }
  } catch (error) {
    console.error("Failed to send vibe notification:", error);
  }
}
