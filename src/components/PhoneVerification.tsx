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
  /** Optional E.164 value (e.g. +15551234567) to prefill country + local digits. */
  initialPhoneE164?: string | null;
}

const COUNTRY_CODES = [
  { code: "+1", label: "🇺🇸 +1", country: "US", placeholder: "234 567 8900" },
  { code: "+44", label: "🇬🇧 +44", country: "UK", placeholder: "7700 900000" },
  { code: "+90", label: "🇹🇷 +90", country: "TR", placeholder: "532 XXX XXXX" },
  { code: "+49", label: "🇩🇪 +49", country: "DE", placeholder: "170 XXXXXXX" },
  { code: "+33", label: "🇫🇷 +33", country: "FR", placeholder: "6 12 34 56 78" },
  { code: "+91", label: "🇮🇳 +91", country: "IN", placeholder: "98765 43210" },
  { code: "+61", label: "🇦🇺 +61", country: "AU", placeholder: "412 345 678" },
  { code: "+81", label: "🇯🇵 +81", country: "JP", placeholder: "90 1234 5678" },
  { code: "+55", label: "🇧🇷 +55", country: "BR", placeholder: "11 98765 4321" },
  { code: "+34", label: "🇪🇸 +34", country: "ES", placeholder: "612 345 678" },
  { code: "+39", label: "🇮🇹 +39", country: "IT", placeholder: "312 345 6789" },
  { code: "+31", label: "🇳🇱 +31", country: "NL", placeholder: "6 12345678" },
  { code: "+46", label: "🇸🇪 +46", country: "SE", placeholder: "70 123 45 67" },
  { code: "+47", label: "🇳🇴 +47", country: "NO", placeholder: "412 34 567" },
  { code: "+82", label: "🇰🇷 +82", country: "KR", placeholder: "10 1234 5678" },
];

function detectCountryFromLocale(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const tzToCountry: Record<string, string> = {
      "Europe/Istanbul": "TR", "Europe/London": "GB", "Europe/Berlin": "DE",
      "Europe/Paris": "FR", "Europe/Amsterdam": "NL", "Europe/Rome": "IT",
      "Europe/Madrid": "ES", "America/New_York": "US", "America/Chicago": "US",
      "America/Denver": "US", "America/Los_Angeles": "US", "Asia/Dubai": "AE",
      "Asia/Riyadh": "SA", "Australia/Sydney": "AU", "Asia/Tokyo": "JP",
      "Asia/Seoul": "KR", "Asia/Kolkata": "IN", "America/Sao_Paulo": "BR",
      "America/Toronto": "CA", "Europe/Warsaw": "PL", "Europe/Stockholm": "SE",
      "Europe/Zurich": "CH", "Europe/Vienna": "AT", "Europe/Brussels": "BE",
      "Europe/Copenhagen": "DK", "Europe/Helsinki": "FI", "Europe/Athens": "GR",
      "Europe/Lisbon": "PT", "Europe/Prague": "CZ", "Europe/Budapest": "HU",
      "Europe/Bucharest": "RO", "Europe/Sofia": "BG", "Europe/Zagreb": "HR",
      "Europe/Kiev": "UA", "Europe/Moscow": "RU", "Asia/Shanghai": "CN",
      "Asia/Singapore": "SG", "Asia/Bangkok": "TH", "Asia/Jakarta": "ID",
      "Africa/Cairo": "EG", "Africa/Lagos": "NG", "Africa/Johannesburg": "ZA",
      "Pacific/Auckland": "NZ", "America/Mexico_City": "MX",
      "America/Argentina/Buenos_Aires": "AR",
    };
    if (tz && tzToCountry[tz]) return tzToCountry[tz];
    const lang = navigator.language || navigator.languages?.[0];
    if (lang) {
      const parts = lang.split("-");
      if (parts.length > 1) return parts[1].toUpperCase();
    }
  } catch {}
  return "US";
}

export function PhoneVerification({ open, onOpenChange, onVerified, initialPhoneE164 }: PhoneVerificationProps) {
  const detectedCountry = detectCountryFromLocale();
  const defaultDialCode = COUNTRY_CODES.find(c => c.country === detectedCountry)?.code || "+1";

  const [screen, setScreen] = useState<"phone" | "otp" | "success">("phone");
  const [countryCode, setCountryCode] = useState(defaultDialCode);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [shakeOtp, setShakeOtp] = useState(false);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  const cleanedNumber = phoneNumber.replace(/\D/g, "").replace(/^0+/, "");
  const fullPhoneNumber = `${countryCode}${cleanedNumber}`;
  const maskedPhone = fullPhoneNumber.replace(/(\+\d{1,3})\d+(\d{2})$/, "$1 •••• ••$2");
  const selectedCountry = COUNTRY_CODES.find(cc => cc.code === countryCode);

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

  // Prefill from saved number when available (E.164)
  useEffect(() => {
    if (!open) return;
    if (!initialPhoneE164?.trim()) {
      setCountryCode(defaultDialCode);
      return;
    }
    const raw = initialPhoneE164.trim().replace(/\s/g, "");
    const match = raw.match(/^(\+\d{1,3})(.*)$/);
    if (!match) return;
    const cc = match[1];
    const rest = match[2].replace(/\D/g, "");
    const known = COUNTRY_CODES.some((c) => c.code === cc);
    if (known) {
      setCountryCode(cc);
      setPhoneNumber(rest);
    }
  }, [open, initialPhoneE164, defaultDialCode]);

  // Health check (dev-only diagnostic)
  useEffect(() => {
    if (open) {
      const diagOn = typeof window !== "undefined" && window.localStorage?.getItem("__vibely_diag") === "1";
      if (!import.meta.env.DEV || !diagOn) return;
      supabase.functions
        .invoke("phone-verify", { body: { action: "health_check", phoneNumber: "+0" } })
        .then(({ data, error: invokeError }) => {
          if (invokeError) console.error("Phone verify health check failed:", invokeError);
          else if (data && (!data.hasSid || !data.hasToken || !data.hasVerify)) {
            console.error("⚠️ Twilio secrets missing!", data);
          }
        });
    }
  }, [open]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const handleSendOtp = async () => {
    if (cleanedNumber.length < 4) {
      setError("Please enter a valid phone number.");
      return;
    }
    if (fullPhoneNumber.length < 10 || fullPhoneNumber.length > 16) {
      setError("Please enter a valid phone number (without leading zero).");
      return;
    }

    setIsLoading(true);
    setError(null);

    console.log("Sending OTP to:", fullPhoneNumber);

    try {
      const { data, error: invokeError } = await supabase.functions.invoke("phone-verify", {
        body: { action: "send_otp", phoneNumber: fullPhoneNumber },
      });

      console.log("Send OTP response:", JSON.stringify({ data, invokeError }));

      // Network-level failure (offline, CORS, function crashed)
      if (invokeError) {
        console.error("Function invoke error:", invokeError);
        setError("Could not reach server. Check your connection.");
        setIsLoading(false);
        return;
      }

      // Application-level error (always HTTP 200, check data.success)
      if (!data?.success) {
        console.error("Phone verify error:", data?.error, data?.twilioCode);
        setError(data?.error || "Failed to send code.");
        setIsLoading(false);
        return;
      }

      // Success
      console.log("OTP sent successfully");
      setScreen("otp");
      setResendCooldown(60);
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    } catch (err: any) {
      console.error("Unexpected error sending OTP:", err);
      setError("Network error. Please check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = useCallback(async (otpCode: string) => {
    setIsLoading(true);
    setError(null);

    const cleaned = phoneNumber.replace(/\D/g, "").replace(/^0+/, "");
    const fullNumber = `${countryCode}${cleaned}`;

    try {
      const { data, error: invokeError } = await supabase.functions.invoke("phone-verify", {
        body: { action: "verify_otp", phoneNumber: fullNumber, code: otpCode },
      });

      console.log("Verify OTP response:", JSON.stringify({ data, invokeError }));

      if (invokeError) {
        setError("Could not reach server.");
        setIsLoading(false);
        return;
      }

      if (!data?.success) {
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

        setError(data?.error || "Wrong code.");
        setIsLoading(false);
        return;
      }

      // Success
      setScreen("success");
      toast.success("Phone verified! ✅");
      setTimeout(() => {
        onVerified();
        onOpenChange(false);
      }, 2000);
    } catch (err: any) {
      console.error("Unexpected error verifying OTP:", err);
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [countryCode, phoneNumber, failedAttempts, onVerified, onOpenChange]);

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);
    setError(null);

    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }

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
          {screen === "phone" && (
            <motion.div key="phone" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }} className="space-y-5 py-2">
              <div className="flex items-center justify-center">
                <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
                  <Phone className="w-8 h-8 text-primary" />
                </div>
              </div>

              <p className="text-center text-sm text-muted-foreground">
                We'll send you a 6-digit code via SMS. Standard messaging rates apply.
              </p>

              <p className="text-xs text-muted-foreground mb-2">
                Enter your number without the leading zero
              </p>

              <div className="flex gap-2">
                <Select value={countryCode} onValueChange={setCountryCode}>
                  <SelectTrigger className="w-[110px] shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRY_CODES.map((cc) => (
                      <SelectItem key={cc.code} value={cc.code}>{cc.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="tel"
                  placeholder={selectedCountry?.placeholder || "Phone number"}
                  value={phoneNumber}
                  onChange={(e) => { setPhoneNumber(e.target.value); setError(null); }}
                  onKeyDown={(e) => e.key === "Enter" && handleSendOtp()}
                  className="flex-1"
                  autoFocus
                />
              </div>

              {cleanedNumber.length >= 4 && (
                <p className="text-xs text-muted-foreground mt-2">
                  We'll send the code to: <span className="text-foreground font-mono font-medium">{fullPhoneNumber}</span>
                </p>
              )}

              {error && <p className="text-sm text-destructive text-center">{error}</p>}

              <Button className="w-full" variant="gradient" onClick={handleSendOtp}
                disabled={isLoading || cleanedNumber.length < 4}>
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Send Verification Code
              </Button>
            </motion.div>
          )}

          {screen === "otp" && (
            <motion.div key="otp" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }} className="space-y-5 py-2">
              <button
                onClick={() => { setScreen("phone"); setOtp(["", "", "", "", "", ""]); setError(null); }}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>

              <p className="text-center text-sm text-muted-foreground">
                Enter the code sent to <span className="text-foreground font-medium">{maskedPhone}</span>
              </p>

              <motion.div className="flex justify-center gap-2"
                animate={shakeOtp ? { x: [0, -8, 8, -8, 8, 0] } : {}}
                transition={{ duration: 0.4 }} onPaste={handleOtpPaste}>
                {otp.map((digit, i) => (
                  <input key={i} ref={(el) => { otpRefs.current[i] = el; }}
                    type="text" inputMode="numeric" maxLength={1} value={digit}
                    autoComplete={i === 0 ? "one-time-code" : "off"}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    className="w-12 h-14 text-center text-xl font-display font-bold rounded-xl border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
                    disabled={isLoading}
                  />
                ))}
              </motion.div>

              {error && <p className="text-sm text-destructive text-center">{error}</p>}

              {isLoading && (
                <div className="flex justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                </div>
              )}

              <div className="text-center">
                {resendCooldown > 0 ? (
                  <p className="text-xs text-muted-foreground">Resend code in {resendCooldown}s</p>
                ) : (
                  <button onClick={() => { setOtp(["", "", "", "", "", ""]); setError(null); handleSendOtp(); }}
                    className="text-sm text-primary hover:underline" disabled={isLoading}>
                    Resend code
                  </button>
                )}
              </div>
            </motion.div>
          )}

          {screen === "success" && (
            <motion.div key="success" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-4 py-8">
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200, damping: 15 }}
                className="w-20 h-20 rounded-full bg-neon-cyan/20 flex items-center justify-center">
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
