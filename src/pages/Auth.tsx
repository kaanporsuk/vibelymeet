import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Loader2, Sparkles } from "lucide-react";

type AuthStep = "phone" | "otp" | "success";

const Auth = () => {
  const navigate = useNavigate();
  const { login, verifyOtp, loginWithGoogle, loginWithApple, isAuthenticated } = useAuth();
  
  const [step, setStep] = useState<AuthStep>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState(["", "", "", ""]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);
  const [glowIntensity, setGlowIntensity] = useState(0);
  
  const otpRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  useEffect(() => {
    if (isAuthenticated) {
      navigate("/dashboard");
    }
  }, [isAuthenticated, navigate]);

  // Update glow intensity based on phone input
  useEffect(() => {
    const intensity = Math.min(phone.replace(/\D/g, "").length / 10, 1);
    setGlowIntensity(intensity);
  }, [phone]);

  const formatPhone = (value: string) => {
    const numbers = value.replace(/\D/g, "");
    if (numbers.length <= 3) return numbers;
    if (numbers.length <= 6) return `(${numbers.slice(0, 3)}) ${numbers.slice(3)}`;
    return `(${numbers.slice(0, 3)}) ${numbers.slice(3, 6)}-${numbers.slice(6, 10)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhone(e.target.value);
    setPhone(formatted);
    setError("");
  };

  const handlePhoneSubmit = async () => {
    if (phone.replace(/\D/g, "").length < 10) {
      setError("Please enter a valid phone number");
      return;
    }
    
    setIsLoading(true);
    try {
      await login(phone);
      setStep("otp");
    } catch {
      setError("Failed to send code. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);
    setError("");
    
    // Auto-focus next input
    if (value && index < 3) {
      otpRefs[index + 1].current?.focus();
    }
    
    // Auto-submit when all digits entered
    if (newOtp.every((d) => d) && newOtp.join("").length === 4) {
      handleOtpSubmit(newOtp.join(""));
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs[index - 1].current?.focus();
    }
  };

  const handleOtpSubmit = async (code: string) => {
    setIsLoading(true);
    try {
      const success = await verifyOtp(code);
      if (success) {
        setStep("success");
        setTimeout(() => navigate("/dashboard"), 1500);
      } else {
        setError("Invalid code. Please try again.");
        setShake(true);
        setOtp(["", "", "", ""]);
        otpRefs[0].current?.focus();
        setTimeout(() => setShake(false), 500);
      }
    } catch {
      setError("Verification failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSocialLogin = async (provider: "google" | "apple") => {
    setIsLoading(true);
    try {
      if (provider === "google") {
        await loginWithGoogle();
      } else {
        await loginWithApple();
      }
      setStep("success");
      setTimeout(() => navigate("/dashboard"), 1500);
    } catch {
      setError(`Failed to sign in with ${provider}. Please try again.`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background relative overflow-hidden flex items-center justify-center">
      {/* Aurora Background */}
      <div className="absolute inset-0">
        <motion.div
          className="absolute inset-0 opacity-40"
          style={{
            background: `
              radial-gradient(ellipse 80% 50% at 20% 40%, hsl(var(--neon-violet) / 0.4), transparent),
              radial-gradient(ellipse 60% 40% at 80% 60%, hsl(var(--neon-cyan) / 0.3), transparent),
              radial-gradient(ellipse 50% 30% at 50% 80%, hsl(var(--neon-pink) / 0.2), transparent)
            `,
          }}
          animate={{
            backgroundPosition: ["0% 0%", "100% 100%", "0% 0%"],
          }}
          transition={{
            duration: 20,
            repeat: Infinity,
            ease: "linear",
          }}
        />
        <motion.div
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(ellipse 70% 40% at 30% 20%, hsl(var(--neon-cyan) / 0.3), transparent),
              radial-gradient(ellipse 50% 60% at 70% 80%, hsl(var(--neon-violet) / 0.25), transparent)
            `,
          }}
          animate={{
            opacity: [0.3, 0.6, 0.3],
          }}
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      </div>

      {/* Glow Intensifier based on input */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(circle at center, hsl(var(--neon-violet) / ${0.1 + glowIntensity * 0.3}), transparent 70%)`,
        }}
        animate={{ opacity: glowIntensity }}
      />

      {/* Content */}
      <div className="relative z-10 w-full max-w-md px-6">
        <AnimatePresence mode="wait">
          {step === "phone" && (
            <motion.div
              key="phone"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              {/* Logo */}
              <motion.div 
                className="text-center space-y-3"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.1 }}
              >
                <div className="w-20 h-20 mx-auto rounded-3xl bg-gradient-to-br from-primary to-accent flex items-center justify-center neon-glow-violet">
                  <Sparkles className="w-10 h-10 text-primary-foreground" />
                </div>
                <h1 className="text-4xl font-display font-bold gradient-text">Vibely</h1>
                <p className="text-muted-foreground">Find your vibe. Meet IRL.</p>
              </motion.div>

              {/* Phone Input */}
              <div className="space-y-4">
                <div className="glass-card p-6 space-y-4">
                  <label className="text-sm font-medium text-foreground">Phone Number</label>
                  <Input
                    type="tel"
                    value={phone}
                    onChange={handlePhoneChange}
                    placeholder="(555) 123-4567"
                    className="text-center text-2xl font-display tracking-wider h-16 bg-secondary/50 border-border focus:border-primary focus:ring-primary/20"
                    maxLength={14}
                  />
                  {error && (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-sm text-destructive text-center"
                    >
                      {error}
                    </motion.p>
                  )}
                </div>

                <Button
                  variant="gradient"
                  size="lg"
                  className="w-full h-14 text-lg font-semibold"
                  onClick={handlePhoneSubmit}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    "Continue"
                  )}
                </Button>
              </div>

              {/* Divider */}
              <div className="flex items-center gap-4">
                <div className="flex-1 h-px bg-border" />
                <span className="text-sm text-muted-foreground">or</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              {/* Social Buttons */}
              <div className="space-y-3">
                <Button
                  variant="outline"
                  size="lg"
                  className="w-full h-14 glass-card border-border hover:bg-secondary/50 gap-3"
                  onClick={() => handleSocialLogin("google")}
                  disabled={isLoading}
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="currentColor"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  Continue with Google
                </Button>

                <Button
                  variant="outline"
                  size="lg"
                  className="w-full h-14 glass-card border-border hover:bg-secondary/50 gap-3"
                  onClick={() => handleSocialLogin("apple")}
                  disabled={isLoading}
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                  </svg>
                  Continue with Apple
                </Button>
              </div>

              <p className="text-xs text-center text-muted-foreground">
                By continuing, you agree to our Terms & Privacy Policy
              </p>
            </motion.div>
          )}

          {step === "otp" && (
            <motion.div
              key="otp"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="text-center space-y-3">
                <h2 className="text-3xl font-display font-bold text-foreground">
                  Enter the code
                </h2>
                <p className="text-muted-foreground">
                  We sent a 4-digit code to {phone}
                </p>
              </div>

              {/* OTP Input */}
              <motion.div
                className="flex justify-center gap-4"
                animate={shake ? { x: [-10, 10, -10, 10, 0] } : {}}
                transition={{ duration: 0.4 }}
              >
                {otp.map((digit, index) => (
                  <Input
                    key={index}
                    ref={otpRefs[index]}
                    type="text"
                    inputMode="numeric"
                    value={digit}
                    onChange={(e) => handleOtpChange(index, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(index, e)}
                    className={`w-16 h-20 text-center text-3xl font-display glass-card border-2 transition-all ${
                      shake
                        ? "border-destructive bg-destructive/10"
                        : digit
                        ? "border-primary neon-glow-violet"
                        : "border-border"
                    }`}
                    maxLength={1}
                  />
                ))}
              </motion.div>

              {error && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-sm text-destructive text-center"
                >
                  {error}
                </motion.p>
              )}

              {isLoading && (
                <div className="flex justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              )}

              <div className="text-center space-y-4">
                <button
                  className="text-sm text-muted-foreground hover:text-primary transition-colors"
                  onClick={() => {
                    setStep("phone");
                    setOtp(["", "", "", ""]);
                    setError("");
                  }}
                >
                  ← Change phone number
                </button>
                <p className="text-xs text-muted-foreground">
                  Didn't receive the code?{" "}
                  <button className="text-primary font-medium">Resend</button>
                </p>
              </div>
            </motion.div>
          )}

          {step === "success" && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center space-y-6"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200, damping: 15 }}
                className="w-24 h-24 mx-auto rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center"
              >
                <Check className="w-12 h-12 text-white" />
              </motion.div>
              <div className="space-y-2">
                <h2 className="text-3xl font-display font-bold text-foreground">
                  Welcome back!
                </h2>
                <p className="text-muted-foreground">
                  Let's find your vibe...
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default Auth;
