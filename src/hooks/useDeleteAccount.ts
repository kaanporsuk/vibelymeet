import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export const useDeleteAccount = () => {
  const [isDeleting, setIsDeleting] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const deleteAccount = async () => {
    setIsDeleting(true);

    try {
      // Get the current session for authorization
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        toast.error("You must be logged in to delete your account");
        setIsDeleting(false);
        return false;
      }

      // Call the edge function
      const { data, error } = await supabase.functions.invoke("delete-account", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
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

      // Success - clean up everything
      console.log("Account deleted successfully, cleaning up...");

      // Sign out to invalidate the JWT
      await supabase.auth.signOut();

      // Clear all caches
      queryClient.clear();

      // Clear all local storage
      localStorage.clear();
      sessionStorage.clear();

      // Show success toast
      toast.success("Account successfully deleted");

      // Replace history to prevent back navigation
      window.history.replaceState(null, "", "/");
      
      // Navigate to home
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
