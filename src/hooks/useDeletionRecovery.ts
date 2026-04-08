import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

interface DeletionRequest {
  id: string;
  scheduled_deletion_at: string;
  status: string;
}

export const useDeletionRecovery = () => {
  const { user } = useUserProfile();
  const queryClient = useQueryClient();
  const [pendingDeletion, setPendingDeletion] = useState<DeletionRequest | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  const refetchDeletionState = useCallback(async () => {
    if (!user?.id) {
      setPendingDeletion(null);
      return;
    }

    const { data } = await supabase
      .from("account_deletion_requests")
      .select("id, scheduled_deletion_at, status")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .maybeSingle();

    setPendingDeletion(data as DeletionRequest | null);
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setPendingDeletion(null);
      return;
    }

    void refetchDeletionState();
  }, [user?.id, refetchDeletionState]);

  useEffect(() => {
    const handleDeletionStateChanged = () => {
      void refetchDeletionState();
    };

    window.addEventListener("vibely:deletion-state-changed", handleDeletionStateChanged);
    return () => {
      window.removeEventListener("vibely:deletion-state-changed", handleDeletionStateChanged);
    };
  }, [user?.id, refetchDeletionState]);

  const cancelDeletion = async () => {
    setIsCancelling(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("You must be logged in");
        setIsCancelling(false);
        return false;
      }

      const { data, error } = await supabase.functions.invoke("cancel-deletion", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (error || !data?.success) {
        toast.error(data?.error || "Failed to cancel deletion");
        setIsCancelling(false);
        return false;
      }

      setPendingDeletion(null);
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      window.dispatchEvent(new Event("vibely:deletion-state-changed"));
      toast.success("Account deletion cancelled! Welcome back 🎉");
      setIsCancelling(false);
      return true;
    } catch (err) {
      console.error("Cancel deletion error:", err);
      toast.error("An unexpected error occurred");
      setIsCancelling(false);
      return false;
    }
  };

  return { pendingDeletion, cancelDeletion, isCancelling, refetchDeletionState };
};
