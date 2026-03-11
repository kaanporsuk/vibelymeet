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

interface AccountSettingsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleteAccount: () => void;
}

type ActiveSection = null | "email" | "password";

export const AccountSettingsDrawer = ({
  open,
  onOpenChange,
  onDeleteAccount,
}: AccountSettingsDrawerProps) => {
  const navigate = useNavigate();
  const { user } = useUserProfile();
  
  const [activeSection, setActiveSection] = useState<ActiveSection>(null);
  const [showPhoneVerification, setShowPhoneVerification] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [showPasswordForPhone, setShowPasswordForPhone] = useState(false);
  const [phoneChangePassword, setPhoneChangePassword] = useState("");
  const [phoneReauthLoading, setPhoneReauthLoading] = useState(false);

  // Fetch phone verification status
  useEffect(() => {
    if (!open || !user) return;
    const fetchPhone = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("phone_verified, phone_number")
        .eq("id", user.id)
        .maybeSingle();
      if (data) {
        setPhoneVerified(data.phone_verified);
        setPhoneNumber(data.phone_number);
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

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh]">
        <DrawerHeader>
          <DrawerTitle className="font-display flex items-center gap-2">
            <User className="w-5 h-5 text-accent" />
            Account Settings
          </DrawerTitle>
          <DrawerDescription>
            Manage your account and security
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-4 space-y-3 overflow-y-auto">
          {/* Current Email Display */}
          <div className="p-4 rounded-xl bg-secondary/40 space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
              <Mail className="w-3 h-3" />
              Current Email
            </div>
            <p className="text-foreground font-medium break-all">
              {user?.email || "No email set"}
            </p>
          </div>

          {/* Phone Number Section */}
          <div className="p-4 rounded-xl bg-secondary/40 space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
              <Phone className="w-3 h-3" />
              Phone Number
            </div>
            {phoneVerified && phoneNumber ? (
              <div className="flex items-center justify-between">
                <p className="text-foreground font-medium">
                  📱 {phoneNumber.replace(/(\+\d{1,3})\d+(\d{2})$/, "$1 •••• ••$2")}
                </p>
                <button
                  onClick={() => setShowPasswordForPhone(true)}
                  className="text-xs text-primary hover:underline"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-sm">📱 Not verified</p>
                <button
                  onClick={() => setShowPhoneVerification(true)}
                  className="text-xs text-primary hover:underline font-medium"
                >
                  Verify now
                </button>
              </div>
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

          {/* Change Password Section */}
          <div className="rounded-xl bg-secondary/40 overflow-hidden">
            <button
              onClick={() => setActiveSection(activeSection === "password" ? null : "password")}
              className="w-full flex items-center justify-between p-3 hover:bg-secondary/60 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Lock className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">Change Password</span>
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

          {/* Danger Zone */}
          <div className="pt-4 border-t border-border/50">
            <button
              onClick={onDeleteAccount}
              className="w-full flex items-center gap-3 p-3 rounded-xl bg-destructive/10 hover:bg-destructive/20 transition-colors text-destructive"
            >
              <Trash2 className="w-4 h-4" />
              <span className="text-sm font-medium">Delete Account</span>
            </button>
          </div>
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
