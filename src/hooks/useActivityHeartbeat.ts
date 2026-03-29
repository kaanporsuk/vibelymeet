import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";

export const useActivityHeartbeat = () => {
  const { user } = useUserProfile();

  useEffect(() => {
    if (!user?.id || user.isPaused) return;

    const update = () => {
      supabase
        .from("profiles")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", user.id)
        .then(() => {});
    };

    update();
    const interval = setInterval(update, 60000);

    return () => clearInterval(interval);
  }, [user?.id, user?.isPaused]);
};
