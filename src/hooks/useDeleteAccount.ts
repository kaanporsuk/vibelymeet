import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { captureSupabaseError } from "@/lib/errorTracking";

export const useDeleteAccount = () => {
  const [isDeleting, setIsDeleting] = useState(false);

  const deleteAccount = async (reason: string | null = null) => {
    setIsDeleting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        toast.error("You must be logged in to delete your account");
        setIsDeleting(false);
        return false;
      }

      const email = session.user.email ?? "";
      if (!email.includes("@")) {
        toast.error("A valid account email is required to schedule deletion.");
        setIsDeleting(false);
        return false;
      }

      const { data, error } = await supabase.functions.invoke("request-account-deletion", {
        body: {
          email,
          reason,
          source: "web_settings",
        },
      });

      if (error) {
        console.error("Delete account error:", error);
        captureSupabaseError("request-account-deletion", error);
        toast.error("Failed to schedule account deletion. Please try again.");
        setIsDeleting(false);
        return false;
      }

      if (!data?.success) {
        toast.error(data?.error || "Failed to schedule account deletion");
        setIsDeleting(false);
        return false;
      }

      window.dispatchEvent(new Event("vibely:deletion-state-changed"));
      toast.success("Account deletion scheduled. You can cancel it before the removal date.");

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
