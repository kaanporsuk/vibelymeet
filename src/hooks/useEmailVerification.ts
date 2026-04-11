import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { resolveSupabaseFunctionErrorMessage } from "@/lib/supabaseFunctionInvokeErrors";

export type VerifyOtpFailure = { success: false; needsNewCode?: boolean };
export type VerifyOtpSuccess = { success: true };
export type VerifyOtpResult = VerifyOtpSuccess | VerifyOtpFailure;

export function isVerifyOtpFailure(r: VerifyOtpResult): r is VerifyOtpFailure {
  return r.success === false;
}

interface UseEmailVerificationResult {
  sendOtp: (email: string) => Promise<boolean>;
  verifyOtp: (email: string, code: string) => Promise<VerifyOtpResult>;
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
        const message = await resolveSupabaseFunctionErrorMessage(
          error,
          data,
          "Couldn’t reach the server. Check your connection and try again.",
        );
        toast.error(message);
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
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "Couldn’t reach the server. Check your connection and try again.";
      toast.error(message);
      return false;
    } finally {
      setIsSending(false);
    }
  };

  const verifyOtp = async (email: string, code: string): Promise<VerifyOtpResult> => {
    setIsVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke("email-verification/verify", {
        body: { email, code },
      });

      if (error) {
        console.error("Verify OTP error:", error);
        const message = await resolveSupabaseFunctionErrorMessage(
          error,
          data,
          "Couldn’t reach the server. Check your connection and try again.",
        );
        toast.error(message);
        return { success: false };
      }

      if (data?.error) {
        const codeStr = (data as { code?: string }).code;
        toast.error(data.error);
        if (codeStr === "legacy_verification_code") {
          return { success: false, needsNewCode: true };
        }
        return { success: false };
      }

      toast.success("Current account email verified for your profile.");
      return { success: true };
    } catch (error) {
      console.error("Verify OTP error:", error);
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "Couldn’t reach the server. Check your connection and try again.";
      toast.error(message);
      return { success: false };
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
