import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";

const ACTIVITY_HEARTBEAT_MS = 5 * 60_000;

export const useActivityHeartbeat = () => {
  const { user } = useUserProfile();

  useEffect(() => {
    if (!user?.id || user.isPaused) return;

    const update = () => {
      if (document.visibilityState !== "visible") return;
      supabase
        .rpc("mark_my_activity_seen")
        .then(() => {});
    };

    update();
    const interval = setInterval(update, ACTIVITY_HEARTBEAT_MS);
    document.addEventListener("visibilitychange", update);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", update);
    };
  }, [user?.id, user?.isPaused]);
};
