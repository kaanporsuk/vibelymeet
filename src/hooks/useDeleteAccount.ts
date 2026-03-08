import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export const useDeleteAccount = () => {
  const [isDeleting, setIsDeleting] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const deleteAccount = async (reason: string | null = null) => {
    setIsDeleting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        toast.error("You must be logged in to delete your account");
        setIsDeleting(false);
        return false;
      }

      const { data, error } = await supabase.functions.invoke("delete-account", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: { reason },
      });

      if (error) {
        console.error("Delete account error:", error);
        toast.error("Failed to delete account. Please try again.");
        setIsDeleting(false);
        return false;
      }

      if (!data?.success) {
        toast.error(data?.error || "Failed to delete account");
        setIsDeleting(false);
        return false;
      }

      // Success - clean up
      console.log("Account deletion scheduled, cleaning up...");

      await supabase.auth.signOut();
      queryClient.clear();
      localStorage.clear();
      sessionStorage.clear();

      toast.success("Account scheduled for deletion");

      window.history.replaceState(null, "", "/");
      navigate("/", { replace: true });

      return true;
    } catch (err) {
      console.error("Unexpected error deleting account:", err);
      toast.error("An unexpected error occurred. Please try again.");
      setIsDeleting(false);
      return false;
    }
  };

  return { deleteAccount, isDeleting };
};
