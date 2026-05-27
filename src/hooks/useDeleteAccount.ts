import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { captureSupabaseError } from "@/lib/errorTracking";

export type DeleteAccountReauthChannel = "email" | "phone";

export interface DeleteAccountReauthChallenge {
  channel: DeleteAccountReauthChannel;
  maskedDestination: string;
  availableChannels?: DeleteAccountReauthChannel[];
}

export const useDeleteAccount = () => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRequestingVerification, setIsRequestingVerification] = useState(false);

  const requestDeleteAccountVerification = async (
    channel?: DeleteAccountReauthChannel,
  ): Promise<DeleteAccountReauthChallenge | null> => {
    setIsRequestingVerification(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        toast.error("You must be logged in to delete your account");
        return null;
      }

      const { data, error } = await supabase.functions.invoke("delete-account", {
        body: {
          action: "request_reauth",
          ...(channel ? { reauthChannel: channel } : {}),
        },
      });

      if (error) {
        console.error("Delete account verification request error:", error);
        captureSupabaseError("delete-account", error);
        toast.error("Failed to send verification code. Please try again.");
        return null;
      }

      if (!data?.success || !data?.reauth?.channel || !data?.reauth?.maskedDestination) {
        toast.error(data?.error || "Failed to send verification code");
        return null;
      }

      toast.success(`Verification code sent to ${data.reauth.maskedDestination}`);
      return data.reauth as DeleteAccountReauthChallenge;
    } catch (err) {
      console.error("Unexpected error requesting delete account verification:", err);
      toast.error("An unexpected error occurred. Please try again.");
      return null;
    } finally {
      setIsRequestingVerification(false);
    }
  };

  const deleteAccount = async (
    reason: string | null = null,
    reauth: { code: string; channel: DeleteAccountReauthChannel },
  ) => {
    setIsDeleting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        toast.error("You must be logged in to delete your account");
        setIsDeleting(false);
        return false;
      }

      const { data, error } = await supabase.functions.invoke("delete-account", {
        body: {
          action: "schedule_deletion",
          reason,
          reauthCode: reauth.code,
          reauthChannel: reauth.channel,
        },
      });

      if (error) {
        console.error("Delete account error:", error);
        captureSupabaseError("delete-account", error);
        toast.error("Failed to schedule account deletion. Please try again.");
        setIsDeleting(false);
        return false;
      }

      if (!data?.success) {
        if (data?.deletion_request_pending === true) {
          window.dispatchEvent(new Event("vibely:deletion-state-changed"));
          toast.info(
            data?.error ||
              "Your deletion request is saved, but some cleanup still needs a retry.",
            { duration: 6500 },
          );
          setIsDeleting(false);
          return true;
        }
        toast.error(data?.error || "Failed to schedule account deletion");
        setIsDeleting(false);
        return false;
      }

      window.dispatchEvent(new Event("vibely:deletion-state-changed"));
      const warning = typeof data?.warning === "string" ? data.warning : null;
      if (warning) {
        toast.info(warning, { duration: 6500 });
      } else {
        toast.success("Account deletion scheduled. You can cancel it before the removal date.");
      }

      setIsDeleting(false);
      return true;
    } catch (err) {
      console.error("Unexpected error deleting account:", err);
      toast.error("An unexpected error occurred. Please try again.");
      setIsDeleting(false);
      return false;
    }
  };

  return { deleteAccount, requestDeleteAccountVerification, isDeleting, isRequestingVerification };
};
