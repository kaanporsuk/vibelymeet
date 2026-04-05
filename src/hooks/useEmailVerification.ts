import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface UseEmailVerificationResult {
  sendOtp: (email: string) => Promise<boolean>;
  verifyOtp: (email: string, code: string) => Promise<boolean>;
  isSending: boolean;
  isVerifying: boolean;
}

export const useEmailVerification = (): UseEmailVerificationResult => {
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  const sendOtp = async (email: string): Promise<boolean> => {
    setIsSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("email-verification/send", {
        body: { email },
      });

      if (error) {
        console.error("Send OTP error:", error);
        toast.error("Failed to send verification code");
        return false;
      }

      if (data?.error) {
        toast.error(data.error);
        return false;
      }

      toast.success("Verification code sent to your current account email.");
      return true;
    } catch (error) {
      console.error("Send OTP error:", error);
      toast.error("Failed to send verification code");
      return false;
    } finally {
      setIsSending(false);
    }
  };

  const verifyOtp = async (email: string, code: string): Promise<boolean> => {
    setIsVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke("email-verification/verify", {
        body: { email, code },
      });

      if (error) {
        console.error("Verify OTP error:", error);
        toast.error("Verification failed");
        return false;
      }

      if (data?.error) {
        toast.error(data.error);
        return false;
      }

      toast.success("Current account email verified for your profile.");
      return true;
    } catch (error) {
      console.error("Verify OTP error:", error);
      toast.error("Verification failed");
      return false;
    } finally {
      setIsVerifying(false);
    }
  };

  return {
    sendOtp,
    verifyOtp,
    isSending,
    isVerifying,
  };
};
