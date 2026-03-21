import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  User,
  Lock,
  ChevronRight,
  Trash2,
  Mail,
  Eye,
  EyeOff,
  Check,
  AlertCircle,
  Loader2,
  Phone,
  Moon,
  PauseCircle,
  Copy,
  LogOut,
  UserX,
  Crown,
} from "lucide-react";
import { PhoneVerification } from "@/components/PhoneVerification";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useNavigate } from "react-router-dom";
import { useUserProfile } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { usePremium } from "@/hooks/usePremium";
import { format } from "date-fns";

interface AccountSettingsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleteAccount: () => void;
  onRequestSignOut?: () => void;
}

type ActiveSection = null | "email" | "password";

type BreakKey = "24h" | "3d" | "1w" | "2w" | "indefinite";

function breakUntilForChip(chip: BreakKey): Date | null {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  switch (chip) {
    case "24h":
      return new Date(now + day);
    case "3d":
      return new Date(now + 3 * day);
    case "1w":
      return new Date(now + 7 * day);
    case "2w":
      return new Date(now + 14 * day);
    default:
      return null;
  }
}

export const AccountSettingsDrawer = ({
  open,
  onOpenChange,
  onDeleteAccount,
  onRequestSignOut,
}: AccountSettingsDrawerProps) => {
  const navigate = useNavigate();
  const { user } = useUserProfile();
  const { isPremium, premiumUntil } = usePremium();
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  
  const [activeSection, setActiveSection] = useState<ActiveSection>(null);
  const [showPhoneVerification, setShowPhoneVerification] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [showPasswordForPhone, setShowPasswordForPhone] = useState(false);
  const [phoneChangePassword, setPhoneChangePassword] = useState("");
  const [phoneReauthLoading, setPhoneReauthLoading] = useState(false);

  const [onBreak, setOnBreak] = useState(false);
  const [breakUntilIso, setBreakUntilIso] = useState<string | null>(null);
  const [breakChip, setBreakChip] = useState<BreakKey | null>(null);
  const [breakBusy, setBreakBusy] = useState(false);

  // Phone + take-a-break state from profile
  useEffect(() => {
    if (!open) return;
    void supabase.auth.getSession().then(({ data: { session } }) => {
      setEmailVerified(!!session?.user?.email_confirmed_at);
    });
  }, [open]);

  useEffect(() => {
    if (!open || !user) return;
    const fetchPhone = async () => {
      const { data } = await supabase
        .from("profiles")
        .select(
          "phone_verified, phone_number, account_paused, account_paused_until, is_paused, paused_until"
        )
        .eq("id", user.id)
        .maybeSingle();
      if (data) {
        setPhoneVerified(!!data.phone_verified);
        setPhoneNumber((data.phone_number as string) ?? null);
        setOnBreak(!!(data.account_paused || data.is_paused));
        setBreakUntilIso(
          (data.account_paused_until as string | null) ?? (data.paused_until as string | null) ?? null
        );
      }
    };
    fetchPhone();
  }, [open, user]);
  
  // Email change state
  const [newEmail, setNewEmail] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  
  // Password change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);

  const validateEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const getPasswordStrength = (password: string) => {
    if (password.length === 0) return { score: 0, label: "", color: "" };
    if (password.length < 6) return { score: 1, label: "Too short", color: "text-destructive" };
    
    let score = 0;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    if (score <= 2) return { score: 2, label: "Weak", color: "text-orange-500" };
    if (score <= 3) return { score: 3, label: "Fair", color: "text-yellow-500" };
    if (score <= 4) return { score: 4, label: "Good", color: "text-neon-cyan" };
    return { score: 5, label: "Strong", color: "text-green-500" };
  };

  const handleEmailChange = async () => {
    if (!validateEmail(newEmail)) {
      toast.error("Please enter a valid email address");
      return;
    }

    setEmailLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        email: newEmail,
      });

      if (error) throw error;

      toast.success("Verification email sent!", {
        description: "Please check your new email to confirm the change",
      });
      setNewEmail("");
      setActiveSection(null);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to update email";
      toast.error(message);
    } finally {
      setEmailLoading(false);
    }
  };

  const handlePasswordChange = async () => {
    if (newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("Passwords don't match");
      return;
    }

    setPasswordLoading(true);
    try {
      // Re-authenticate with current password first
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user?.email || "",
        password: currentPassword,
      });

      if (signInError) {
        toast.error("Current password is incorrect");
        setPasswordLoading(false);
        return;
      }

      // Update password
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;

      toast.success("Password updated successfully!");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setActiveSection(null);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to update password";
      toast.error(message);
    } finally {
      setPasswordLoading(false);
    }
  };

  const passwordStrength = getPasswordStrength(newPassword);
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;

  const applyTakeBreak = async () => {
    if (!user || !breakChip) return;
    const until = breakUntilForChip(breakChip);
    const now = new Date().toISOString();
    setBreakBusy(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          account_paused: true,
          account_paused_until: until?.toISOString() ?? null,
          is_paused: true,
          paused_until: until?.toISOString() ?? null,
          paused_at: now,
          pause_reason: "user_break",
          discoverable: false,
          discovery_mode: "hidden",
          discovery_snooze_until: null,
        })
        .eq("id", user.id);
      if (error) {
        toast.error(error.message);
        return;
      }
      setOnBreak(true);
      setBreakUntilIso(until?.toISOString() ?? null);
      setBreakChip(null);
      toast.success("You're on a break. We'll be here when you're ready.");
    } finally {
      setBreakBusy(false);
    }
  };

  const confirmTakeBreak = () => {
    if (!breakChip) return;
    const until = breakUntilForChip(breakChip);
    const line = until
      ? `You'll be hidden until ${until.toLocaleString()}.`
      : "You'll be hidden indefinitely.";
    if (!window.confirm(`${line}\n\nYour existing matches and chats won't be affected.`)) return;
    void applyTakeBreak();
  };

  const endBreak = async () => {
    if (!user) return;
    setBreakBusy(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          account_paused: false,
          account_paused_until: null,
          is_paused: false,
          paused_until: null,
          paused_at: null,
          discoverable: true,
          discovery_mode: "visible",
        })
        .eq("id", user.id);
      if (error) {
        toast.error(error.message);
        return;
      }
      setOnBreak(false);
      setBreakUntilIso(null);
      toast.success("Welcome back! You're visible in discovery again.");
    } finally {
      setBreakBusy(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh]">
        <DrawerHeader>
          <DrawerTitle className="font-display flex items-center gap-2">
            <User className="w-5 h-5 text-accent" />
            Account &amp; Security
          </DrawerTitle>
          <DrawerDescription>Manage your account and security settings</DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-4 space-y-3 overflow-y-auto">
          {/* Support ID */}
          {user?.id ? (
            <div className="rounded-xl border border-border/60 bg-secondary/30 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Support ID
              </p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <code className="truncate text-sm text-foreground">{user.id.slice(0, 8)}…</code>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 gap-1"
                  onClick={async () => {
                    await navigator.clipboard.writeText(user.id);
                    toast.success("Copied!", { description: "Full user ID copied to clipboard" });
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </Button>
              </div>
            </div>
          ) : null}

          <p className="pt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Sign-in &amp; Security
          </p>

          {/* Current Email Display */}
          <div className="p-4 rounded-xl bg-secondary/40 space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
              <Mail className="w-3 h-3" />
              Current Email
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-foreground font-medium break-all">{user?.email || "No email set"}</p>
              {emailVerified ? (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                  Verified ✓
                </span>
              ) : (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                  Unverified
                </span>
              )}
            </div>
            <button
              type="button"
              className="text-xs font-medium text-primary hover:underline"
              onClick={() => setActiveSection("email")}
            >
              Update email
            </button>
          </div>

          {/* Phone Number Section */}
          <div className="p-4 rounded-xl bg-secondary/40 space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
              <Phone className="w-3 h-3" />
              Phone Number
            </div>
            {phoneVerified && phoneNumber ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-foreground font-medium">
                    📱 {phoneNumber.replace(/(\+\d{1,3})\d+(\d{2})$/, "$1 •••• ••$2")}
                  </p>
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                    Verified ✓
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPasswordForPhone(true)}
                  className="text-xs text-primary hover:underline"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-sm">📱 Not set</p>
                <button
                  type="button"
                  onClick={() => setShowPhoneVerification(true)}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Add / verify
                </button>
              </div>
            )}
          </div>

          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Verification</p>
          <div className="space-y-2 rounded-xl bg-secondary/30 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">Phone</span>
              {phoneVerified ? (
                <span className="text-xs font-medium text-emerald-400">Verified</span>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setShowPhoneVerification(true)}>
                  Verify now
                </Button>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-border/40 pt-2">
              <span className="text-sm text-foreground">Email</span>
              {emailVerified ? (
                <span className="text-xs font-medium text-emerald-400">Verified</span>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setActiveSection("email")}>
                  Verify via update
                </Button>
              )}
            </div>
          </div>

          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Membership</p>
          <button
            type="button"
            onClick={async () => {
              if (!isPremium) {
                onOpenChange(false);
                navigate("/premium");
                return;
              }
              setPortalLoading(true);
              const { data, error } = await supabase.functions.invoke("create-portal-session");
              setPortalLoading(false);
              if (error || !(data as { success?: boolean })?.success) {
                toast.error("Could not open billing portal.");
                return;
              }
              window.location.href = (data as { url: string }).url;
            }}
            className="flex w-full items-center justify-between rounded-xl bg-secondary/40 p-3 text-left transition-colors hover:bg-secondary/60"
          >
            <div className="flex items-center gap-3">
              <Crown className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-medium text-foreground">Current plan</p>
                <p className="text-xs text-muted-foreground">
                  {isPremium && premiumUntil
                    ? `Renews ${format(premiumUntil, "MMM d, yyyy")}`
                    : "Free tier — upgrade anytime"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-bold",
                  isPremium ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground",
                )}
              >
                {isPremium ? "Premium" : "Free"}
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </button>
          {portalLoading ? <p className="text-center text-xs text-muted-foreground">Opening portal…</p> : null}

          {/* Take a break */}
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Take a Break</p>
          <div className="space-y-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4">
            {onBreak ? (
              <>
                <div className="flex items-center gap-2">
                  <PauseCircle className="h-6 w-6 shrink-0 text-amber-500" />
                  <span className="font-semibold text-foreground">Paused</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {breakUntilIso
                    ? `Paused · Resumes ${new Date(breakUntilIso).toLocaleString()}`
                    : "Paused indefinitely"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Profile hidden from discovery. No notifications. Matches and messages stay put.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
                  disabled={breakBusy}
                  onClick={() => void endBreak()}
                >
                  Resume now
                </Button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Moon className="h-6 w-6 shrink-0 text-amber-500" />
                  <span className="font-semibold text-foreground">Pause your account temporarily</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Hidden from discovery; notifications off; you can still use the app.
                </p>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["24h", "24 hours"],
                      ["3d", "3 days"],
                      ["1w", "1 week"],
                      ["2w", "2 weeks"],
                      ["indefinite", "Indefinitely"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setBreakChip(key)}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                        breakChip === key
                          ? "border-primary bg-primary/15 text-foreground"
                          : "border-border bg-secondary/40 text-muted-foreground hover:bg-secondary/60",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="gradient"
                  className="w-full"
                  disabled={!breakChip || breakBusy}
                  onClick={confirmTakeBreak}
                >
                  Take a break
                </Button>
              </>
            )}
          </div>

          {/* Password prompt for phone change */}
          <AnimatePresence>
            {showPasswordForPhone && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="p-4 rounded-xl bg-secondary/40 space-y-3">
                  <p className="text-sm text-muted-foreground">Enter your password to change your phone number</p>
                  <Input
                    type="password"
                    placeholder="Current password"
                    value={phoneChangePassword}
                    onChange={(e) => setPhoneChangePassword(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setShowPasswordForPhone(false); setPhoneChangePassword(""); }}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="gradient"
                      size="sm"
                      disabled={!phoneChangePassword || phoneReauthLoading}
                      onClick={async () => {
                        setPhoneReauthLoading(true);
                        try {
                          const { error } = await supabase.auth.signInWithPassword({
                            email: user?.email || "",
                            password: phoneChangePassword,
                          });
                          if (error) {
                            toast.error("Incorrect password");
                            return;
                          }
                          setShowPasswordForPhone(false);
                          setPhoneChangePassword("");
                          setShowPhoneVerification(true);
                        } catch {
                          toast.error("Verification failed");
                        } finally {
                          setPhoneReauthLoading(false);
                        }
                      }}
                    >
                      {phoneReauthLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirm & Change"}
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Edit Profile Button */}
          <button
            onClick={() => {
              onOpenChange(false);
              navigate("/profile");
            }}
            className="w-full flex items-center justify-between p-3 rounded-xl bg-secondary/40 hover:bg-secondary/60 transition-colors"
          >
            <div className="flex items-center gap-3">
              <User className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">Edit Profile</span>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>

          {/* Change Email Section */}
          <div className="rounded-xl bg-secondary/40 overflow-hidden">
            <button
              onClick={() => setActiveSection(activeSection === "email" ? null : "email")}
              className="w-full flex items-center justify-between p-3 hover:bg-secondary/60 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">Change Email</span>
              </div>
              <ChevronRight 
                className={cn(
                  "w-4 h-4 text-muted-foreground transition-transform",
                  activeSection === "email" && "rotate-90"
                )} 
              />
            </button>

            <AnimatePresence>
              {activeSection === "email" && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="p-4 pt-0 space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="new-email" className="text-sm text-muted-foreground">
                        New Email Address
                      </Label>
                      <div className="relative">
                        <Input
                          id="new-email"
                          type="email"
                          placeholder="Enter new email"
                          value={newEmail}
                          onChange={(e) => setNewEmail(e.target.value)}
                          className="pr-10"
                        />
                        {newEmail && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            {validateEmail(newEmail) ? (
                              <Check className="w-4 h-4 text-green-500" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-destructive" />
                            )}
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        We'll send a verification link to your new email
                      </p>
                    </div>

                    <Button
                      variant="gradient"
                      size="sm"
                      onClick={handleEmailChange}
                      disabled={!validateEmail(newEmail) || emailLoading}
                      className="w-full"
                    >
                      {emailLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        "Update Email"
                      )}
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Password */}
          <div className="rounded-xl bg-secondary/40 overflow-hidden">
            <button
              type="button"
              onClick={() => setActiveSection(activeSection === "password" ? null : "password")}
              className="flex w-full items-center justify-between p-3 transition-colors hover:bg-secondary/60"
            >
              <div className="flex items-center gap-3">
                <Lock className="h-4 w-4 text-muted-foreground" />
                <div className="text-left">
                  <p className="text-sm font-medium text-foreground">Password</p>
                  <p className="text-xs text-muted-foreground">••••••••</p>
                </div>
              </div>
              <ChevronRight 
                className={cn(
                  "w-4 h-4 text-muted-foreground transition-transform",
                  activeSection === "password" && "rotate-90"
                )} 
              />
            </button>

            <AnimatePresence>
              {activeSection === "password" && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="p-4 pt-0 space-y-4">
                    {/* Current Password */}
                    <div className="space-y-2">
                      <Label htmlFor="current-password" className="text-sm text-muted-foreground">
                        Current Password
                      </Label>
                      <div className="relative">
                        <Input
                          id="current-password"
                          type={showCurrentPassword ? "text" : "password"}
                          placeholder="Enter current password"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showCurrentPassword ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* New Password */}
                    <div className="space-y-2">
                      <Label htmlFor="new-password" className="text-sm text-muted-foreground">
                        New Password
                      </Label>
                      <div className="relative">
                        <Input
                          id="new-password"
                          type={showNewPassword ? "text" : "password"}
                          placeholder="Enter new password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPassword(!showNewPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showNewPassword ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>

                      {/* Password Strength Indicator */}
                      {newPassword && (
                        <div className="space-y-1">
                          <div className="flex gap-1">
                            {[1, 2, 3, 4, 5].map((level) => (
                              <div
                                key={level}
                                className={cn(
                                  "h-1 flex-1 rounded-full transition-colors",
                                  level <= passwordStrength.score
                                    ? passwordStrength.score <= 2
                                      ? "bg-destructive"
                                      : passwordStrength.score <= 3
                                        ? "bg-orange-500"
                                        : passwordStrength.score <= 4
                                          ? "bg-yellow-500"
                                          : "bg-green-500"
                                    : "bg-secondary"
                                )}
                              />
                            ))}
                          </div>
                          <p className={cn("text-xs", passwordStrength.color)}>
                            {passwordStrength.label}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Confirm Password */}
                    <div className="space-y-2">
                      <Label htmlFor="confirm-password" className="text-sm text-muted-foreground">
                        Confirm New Password
                      </Label>
                      <div className="relative">
                        <Input
                          id="confirm-password"
                          type={showConfirmPassword ? "text" : "password"}
                          placeholder="Confirm new password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showConfirmPassword ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>

                      {/* Password Match Indicator */}
                      {confirmPassword && (
                        <div className="flex items-center gap-1">
                          {passwordsMatch ? (
                            <>
                              <Check className="w-3 h-3 text-green-500" />
                              <span className="text-xs text-green-500">Passwords match</span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="w-3 h-3 text-destructive" />
                              <span className="text-xs text-destructive">Passwords don't match</span>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    <Button
                      variant="gradient"
                      size="sm"
                      onClick={handlePasswordChange}
                      disabled={
                        !currentPassword ||
                        !newPassword ||
                        !confirmPassword ||
                        !passwordsMatch ||
                        passwordStrength.score < 2 ||
                        passwordLoading
                      }
                      className="w-full"
                    >
                      {passwordLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        "Update Password"
                      )}
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="space-y-2 border-t border-border/50 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-destructive/90">Danger zone</p>
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    "Deactivate your account temporarily? You can sign in again later to reactivate.",
                  )
                ) {
                  toast.message("Deactivation", {
                    description: "Contact support@… or use Take a Break above for a self-serve pause.",
                  });
                }
              }}
              className="flex w-full items-center gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-left text-destructive transition-colors hover:bg-destructive/10"
            >
              <UserX className="h-4 w-4 shrink-0" />
              <div>
                <p className="text-sm font-medium">Deactivate account</p>
                <p className="text-xs opacity-80">Temporarily — you can come back anytime</p>
              </div>
            </button>
            <button
              type="button"
              onClick={onDeleteAccount}
              className="flex w-full items-center gap-3 rounded-xl bg-destructive/15 p-3 text-left text-destructive transition-colors hover:bg-destructive/25"
            >
              <Trash2 className="h-4 w-4 shrink-0" />
              <div>
                <p className="text-sm font-semibold">Delete account permanently</p>
                <p className="text-xs opacity-90">All data removed — use the guided flow</p>
              </div>
            </button>
          </div>

          <Button
            type="button"
            variant="outline"
            className="mt-4 w-full border-white/15 text-muted-foreground"
            onClick={() => {
              onOpenChange(false);
              onRequestSignOut?.();
            }}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </Button>
        </div>

        <DrawerFooter>
          <DrawerClose asChild>
            <Button variant="ghost">Close</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>

      <PhoneVerification
        open={showPhoneVerification}
        onOpenChange={setShowPhoneVerification}
        onVerified={() => {
          setPhoneVerified(true);
          setShowPhoneVerification(false);
        }}
      />
    </Drawer>
  );
};
