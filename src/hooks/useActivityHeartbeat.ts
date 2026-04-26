import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";

export const useActivityHeartbeat = () => {
  const { user } = useUserProfile();

  useEffect(() => {
    if (!user?.id || user.isPaused) return;

    const update = () => {
      supabase
        .rpc("mark_my_activity_seen")
        .then(() => {});
    };

    update();
    const interval = setInterval(update, 60000);

    return () => clearInterval(interval);
  }, [user?.id, user?.isPaused]);
};
