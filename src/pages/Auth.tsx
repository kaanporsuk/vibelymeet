import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Loader2, Sparkles, Mail, Lock, User, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

type AuthMode = "signin" | "signup" | "success";

const Auth = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { signIn, signUp, isAuthenticated } = useAuth();
  
  // Check URL param for initial mode
  const initialMode = searchParams.get("mode") === "signup" ? "signup" : "signin";
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [glowIntensity, setGlowIntensity] = useState(0);

  useEffect(() => {
    const routeAfterAuth = async () => {
      if (!isAuthenticated) return;

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          navigate("/auth");
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("gender, photos")
          .eq("id", user.id)
          .maybeSingle();

        const photosCount = (profile?.photos as string[] | null)?.length ?? 0;
        const needsOnboarding = !profile || profile.gender === "prefer_not_to_say" || photosCount < 2;

        navigate(needsOnboarding ? "/onboarding" : "/dashboard");
      } catch {
        navigate("/dashboard");
      }
    };

    routeAfterAuth();
  }, [isAuthenticated, navigate]);

  // Update glow intensity based on form completion
  useEffect(() => {
    const filled = [email, password, mode === "signup" ? name : "filled"].filter(Boolean).length;
    setGlowIntensity(filled / 3);
  }, [email, password, name, mode]);

  const handleSignIn = async () => {
    if (!email || !password) {
      setError("Please fill in all fields");
      return;
    }
    
    setIsLoading(true);
    setError("");
    
    try {
      const { error } = await signIn(email, password);
      if (error) {
        setError(error.message || "Invalid email or password");
      } else {
        setMode("success");
        setTimeout(() => navigate("/dashboard"), 1500);
      }
    } catch {
      setError("Sign in failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignUp = async () => {
    if (!email || !password || !name) {
      setError("Please fill in all fields");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    
    setIsLoading(true);
    setError("");
    
    try {
      const { error } = await signUp(email, password, name);
      if (error) {
        if (error.message.includes("already registered")) {
          setError("This email is already registered. Try signing in.");
        } else {
          setError(error.message || "Sign up failed");
        }
      } else {
        toast.success("Account created! Check your email to confirm.");
        setMode("signin");
      }
    } catch {
      setError("Sign up failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "signin") {
      handleSignIn();
    } else if (mode === "signup") {
      handleSignUp();
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
          {(mode === "signin" || mode === "signup") && (
            <motion.div
              key={mode}
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
                <p className="text-muted-foreground">
                  {mode === "signin" ? "Welcome back! Sign in to continue." : "Create your account to get started."}
                </p>
              </motion.div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="glass-card p-6 space-y-4">
                  {mode === "signup" && (
                    <div className="space-y-2">
                      <Label htmlFor="name" className="text-sm font-medium text-foreground flex items-center gap-2">
                        <User className="w-4 h-4 text-muted-foreground" />
                        Name
                      </Label>
                      <Input
                        id="name"
                        type="text"
                        value={name}
                        onChange={(e) => { setName(e.target.value); setError(""); }}
                        placeholder="Your name"
                        className="h-12 bg-secondary/50 border-border focus:border-primary focus:ring-primary/20"
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-sm font-medium text-foreground flex items-center gap-2">
                      <Mail className="w-4 h-4 text-muted-foreground" />
                      Email
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); setError(""); }}
                      placeholder="you@example.com"
                      className="h-12 bg-secondary/50 border-border focus:border-primary focus:ring-primary/20"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-sm font-medium text-foreground flex items-center gap-2">
                      <Lock className="w-4 h-4 text-muted-foreground" />
                      Password
                    </Label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setError(""); }}
                      placeholder="••••••••"
                      className="h-12 bg-secondary/50 border-border focus:border-primary focus:ring-primary/20"
                    />
                  </div>

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
                  type="submit"
                  variant="gradient"
                  size="lg"
                  className="w-full h-14 text-lg font-semibold"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : mode === "signin" ? (
                    "Sign In"
                  ) : (
                    "Create Account"
                  )}
                </Button>
              </form>

              {/* Toggle Mode */}
              <div className="text-center space-y-2">
                {mode === "signin" && (
                  <button
                    type="button"
                    className="text-sm text-primary hover:text-primary/80 transition-colors"
                    onClick={() => navigate("/reset-password")}
                  >
                    Forgot password?
                  </button>
                )}
                <button
                  type="button"
                  className="text-sm text-muted-foreground hover:text-primary transition-colors block w-full"
                  onClick={() => {
                    setMode(mode === "signin" ? "signup" : "signin");
                    setError("");
                  }}
                >
                  {mode === "signin" ? (
                    <>Don't have an account? <span className="text-primary font-medium">Sign up</span></>
                  ) : (
                    <span className="flex items-center justify-center gap-1">
                      <ArrowLeft className="w-4 h-4" />
                      Already have an account? <span className="text-primary font-medium">Sign in</span>
                    </span>
                  )}
                </button>
              </div>

              <p className="text-xs text-center text-muted-foreground">
                By continuing, you agree to our Terms & Privacy Policy
              </p>
            </motion.div>
          )}

          {mode === "success" && (
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
                  Welcome!
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
