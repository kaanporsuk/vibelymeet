import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, ArrowLeft, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface PhoneVerificationProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerified: () => void;
}

const COUNTRY_CODES = [
  { code: "+1", label: "🇺🇸 +1", country: "US" },
  { code: "+44", label: "🇬🇧 +44", country: "UK" },
  { code: "+90", label: "🇹🇷 +90", country: "TR" },
  { code: "+49", label: "🇩🇪 +49", country: "DE" },
  { code: "+33", label: "🇫🇷 +33", country: "FR" },
  { code: "+91", label: "🇮🇳 +91", country: "IN" },
  { code: "+61", label: "🇦🇺 +61", country: "AU" },
  { code: "+81", label: "🇯🇵 +81", country: "JP" },
  { code: "+55", label: "🇧🇷 +55", country: "BR" },
  { code: "+34", label: "🇪🇸 +34", country: "ES" },
  { code: "+39", label: "🇮🇹 +39", country: "IT" },
  { code: "+31", label: "🇳🇱 +31", country: "NL" },
  { code: "+46", label: "🇸🇪 +46", country: "SE" },
  { code: "+47", label: "🇳🇴 +47", country: "NO" },
  { code: "+82", label: "🇰🇷 +82", country: "KR" },
];

export function PhoneVerification({ open, onOpenChange, onVerified }: PhoneVerificationProps) {
  const [screen, setScreen] = useState<"phone" | "otp" | "success">("phone");
  const [countryCode, setCountryCode] = useState("+1");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [shakeOtp, setShakeOtp] = useState(false);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  const fullPhoneNumber = `${countryCode}${phoneNumber.replace(/\D/g, "")}`;
  const maskedPhone = fullPhoneNumber.replace(/(\+\d{1,3})\d+(\d{2})$/, "$1 •••• ••$2");

  // Reset state on close
  useEffect(() => {
    if (!open) {
      setScreen("phone");
      setPhoneNumber("");
      setOtp(["", "", "", "", "", ""]);
      setError(null);
      setFailedAttempts(0);
    }
  }, [open]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const handleSendOtp = async () => {
    const cleaned = phoneNumber.replace(/\D/g, "");
    if (cleaned.length < 4) {
      setError("Please enter a valid phone number.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("phone-verify", {
        body: { action: "send_otp", phoneNumber: fullPhoneNumber },
      });

      if (fnError || data?.error) {
        setError(data?.error || "Failed to send code. Please try again.");
        return;
      }

      setScreen("otp");
      setResendCooldown(60);
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = useCallback(async (otpCode: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("phone-verify", {
        body: { action: "verify_otp", phoneNumber: fullPhoneNumber, code: otpCode },
      });

      if (data?.verified) {
        setScreen("success");
        toast.success("Phone verified! ✅");
        setTimeout(() => {
          onVerified();
          onOpenChange(false);
        }, 2000);
        return;
      }

      // Wrong code
      const newAttempts = failedAttempts + 1;
      setFailedAttempts(newAttempts);
      setShakeOtp(true);
      setTimeout(() => setShakeOtp(false), 500);

      if (newAttempts >= 3) {
        setError("Too many attempts. Please request a new code.");
        setScreen("phone");
        setOtp(["", "", "", "", "", ""]);
        setFailedAttempts(0);
        return;
      }

      setError(data?.error || fnError?.message || "Invalid code. Please try again.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [fullPhoneNumber, failedAttempts, onVerified, onOpenChange]);

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);
    setError(null);

    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits filled
    const code = newOtp.join("");
    if (code.length === 6 && newOtp.every((d) => d !== "")) {
      handleVerifyOtp(code);
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) {
      const newOtp = pasted.split("");
      setOtp(newOtp);
      otpRefs.current[5]?.focus();
      handleVerifyOtp(pasted);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="font-display text-center">
            {screen === "phone" && "Verify Phone Number"}
            {screen === "otp" && "Enter Verification Code"}
            {screen === "success" && "Verified!"}
          </DialogTitle>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {/* ── SCREEN 1: Enter Phone ── */}
          {screen === "phone" && (
            <motion.div
              key="phone"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-5 py-2"
            >
              <div className="flex items-center justify-center">
                <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
                  <Phone className="w-8 h-8 text-primary" />
                </div>
              </div>

              <p className="text-center text-sm text-muted-foreground">
                We'll send you a 6-digit code via SMS. Standard messaging rates apply.
              </p>

              <div className="flex gap-2">
                <Select value={countryCode} onValueChange={setCountryCode}>
                  <SelectTrigger className="w-[110px] shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRY_CODES.map((cc) => (
                      <SelectItem key={cc.code} value={cc.code}>
                        {cc.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="tel"
                  placeholder="Phone number"
                  value={phoneNumber}
                  onChange={(e) => {
                    setPhoneNumber(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleSendOtp()}
                  className="flex-1"
                  autoFocus
                />
              </div>

              {error && (
                <p className="text-sm text-destructive text-center">{error}</p>
              )}

              <Button
                className="w-full"
                variant="gradient"
                onClick={handleSendOtp}
                disabled={isLoading || phoneNumber.replace(/\D/g, "").length < 4}
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : null}
                Send Verification Code
              </Button>
            </motion.div>
          )}

          {/* ── SCREEN 2: Enter OTP ── */}
          {screen === "otp" && (
            <motion.div
              key="otp"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-5 py-2"
            >
              <button
                onClick={() => { setScreen("phone"); setOtp(["", "", "", "", "", ""]); setError(null); }}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>

              <p className="text-center text-sm text-muted-foreground">
                Enter the code sent to <span className="text-foreground font-medium">{maskedPhone}</span>
              </p>

              {/* OTP Input Boxes */}
              <motion.div
                className="flex justify-center gap-2"
                animate={shakeOtp ? { x: [0, -8, 8, -8, 8, 0] } : {}}
                transition={{ duration: 0.4 }}
                onPaste={handleOtpPaste}
              >
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => { otpRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    className="w-12 h-14 text-center text-xl font-display font-bold rounded-xl border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
                    disabled={isLoading}
                  />
                ))}
              </motion.div>

              {error && (
                <p className="text-sm text-destructive text-center">{error}</p>
              )}

              {isLoading && (
                <div className="flex justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                </div>
              )}

              {/* Resend */}
              <div className="text-center">
                {resendCooldown > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Resend code in {resendCooldown}s
                  </p>
                ) : (
                  <button
                    onClick={() => {
                      setOtp(["", "", "", "", "", ""]);
                      setError(null);
                      handleSendOtp();
                    }}
                    className="text-sm text-primary hover:underline"
                    disabled={isLoading}
                  >
                    Resend code
                  </button>
                )}
              </div>
            </motion.div>
          )}

          {/* ── SCREEN 3: Success ── */}
          {screen === "success" && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-4 py-8"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200, damping: 15 }}
                className="w-20 h-20 rounded-full bg-neon-cyan/20 flex items-center justify-center"
              >
                <CheckCircle2 className="w-10 h-10 text-neon-cyan" />
              </motion.div>
              <p className="text-lg font-display font-semibold text-foreground">Phone Verified!</p>
              <p className="text-sm text-muted-foreground">Your trust badge is now active.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
