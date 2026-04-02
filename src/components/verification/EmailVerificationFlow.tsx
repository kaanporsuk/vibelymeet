import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, Loader2, CheckCircle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useEmailVerification } from "@/hooks/useEmailVerification";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

interface EmailVerificationFlowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerified: () => void;
  userEmail?: string;
}

export const EmailVerificationFlow = ({
  open,
  onOpenChange,
  onVerified,
  userEmail = "",
}: EmailVerificationFlowProps) => {
  const [step, setStep] = useState<"email" | "otp" | "success">("email");
  const [email, setEmail] = useState(userEmail);
  const [otp, setOtp] = useState("");
  const { sendOtp, verifyOtp, isSending, isVerifying } = useEmailVerification();

  useEffect(() => {
    if (!open) return;
    setEmail(userEmail ?? "");
  }, [open, userEmail]);

  const handleSendOtp = async () => {
    if (!email || !email.includes("@")) return;
    
    const success = await sendOtp(email);
    if (success) {
      setStep("otp");
    }
  };

  const handleVerifyOtp = async () => {
    if (otp.length !== 6) return;
    
    const success = await verifyOtp(email, otp);
    if (success) {
      setStep("success");
      setTimeout(() => {
        onVerified();
        onOpenChange(false);
        // Reset state
        setStep("email");
        setOtp("");
      }, 1500);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    // Reset after close animation
    setTimeout(() => {
      setStep("email");
      setOtp("");
    }, 300);
  };

  return (
    <Drawer open={open} onOpenChange={handleClose}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader>
          <DrawerTitle className="font-display flex items-center gap-2">
            <Mail className="w-5 h-5 text-primary" />
            Email Verification
          </DrawerTitle>
          <DrawerDescription>
            Verify your email to complete your profile
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-4">
          <AnimatePresence mode="wait">
            {/* Step 1: Enter Email */}
            {step === "email" && (
              <motion.div
                key="email"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-4"
              >
                <div className="text-center py-4">
                  <div className="w-16 h-16 mx-auto rounded-full bg-primary/20 flex items-center justify-center mb-4">
                    <Mail className="w-8 h-8 text-primary" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    We'll send a 6-digit code to verify your email
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Email Address</label>
                  <Input
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-12 rounded-xl glass-card border-border"
                  />
                </div>

                <Button
                  variant="gradient"
                  className="w-full h-12 rounded-xl"
                  onClick={handleSendOtp}
                  disabled={!email || !email.includes("@") || isSending}
                >
                  {isSending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      Send Verification Code
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>
              </motion.div>
            )}

            {/* Step 2: Enter OTP */}
            {step === "otp" && (
              <motion.div
                key="otp"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground mb-2">
                    Enter the 6-digit code sent to
                  </p>
                  <p className="font-medium text-foreground">{email}</p>
                </div>

                <div className="flex justify-center">
                  <InputOTP
                    maxLength={6}
                    value={otp}
                    onChange={setOtp}
                  >
                    <InputOTPGroup>
                      <InputOTPSlot index={0} />
                      <InputOTPSlot index={1} />
                      <InputOTPSlot index={2} />
                      <InputOTPSlot index={3} />
                      <InputOTPSlot index={4} />
                      <InputOTPSlot index={5} />
                    </InputOTPGroup>
                  </InputOTP>
                </div>

                <Button
                  variant="gradient"
                  className="w-full h-12 rounded-xl"
                  onClick={handleVerifyOtp}
                  disabled={otp.length !== 6 || isVerifying}
                >
                  {isVerifying ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    "Verify Code"
                  )}
                </Button>

                <button
                  onClick={() => setStep("email")}
                  className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Didn't receive the code? Try again
                </button>
              </motion.div>
            )}

            {/* Step 3: Success */}
            {step === "success" && (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center py-8"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", delay: 0.1 }}
                  className="w-20 h-20 mx-auto rounded-full bg-green-500/20 flex items-center justify-center mb-4"
                >
                  <CheckCircle className="w-10 h-10 text-green-500" />
                </motion.div>
                <h3 className="text-xl font-display font-semibold text-foreground mb-2">
                  Email Verified!
                </h3>
                <p className="text-sm text-muted-foreground">
                  Your email has been successfully verified
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <DrawerFooter>
          <DrawerClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
};
