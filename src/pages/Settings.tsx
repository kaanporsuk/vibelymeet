import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Bell,
  Shield,
  User,
  LogOut,
  ChevronRight,
  MessageSquareText,
  Sparkles,
  Zap,
  Trash2,
  FileText,
  Compass,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BottomNav } from "@/components/navigation/BottomNav";
import { NotificationsDrawer } from "@/components/settings/NotificationsDrawer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DeleteAccountModal } from "@/components/settings/DeleteAccountModal";
import { AccountSettingsDrawer } from "@/components/settings/AccountSettingsDrawer";
import { PrivacyDrawer } from "@/components/settings/PrivacyDrawer";
import { DiscoveryDrawer } from "@/components/settings/DiscoveryDrawer";
import { FeedbackDrawer } from "@/components/settings/FeedbackDrawer";
import { useLogout } from "@/hooks/useLogout";
import { useDeleteAccount } from "@/hooks/useDeleteAccount";
import { PremiumSettingsCard } from "@/components/premium/PremiumSettingsCard";
import { openPremium } from "@/lib/premiumNavigation";
import { PREMIUM_ENTRY_SURFACE } from "@shared/premiumFunnel";
import { useCredits } from "@/hooks/useCredits";
import { useEntitlements } from "@/hooks/useEntitlements";
import { usePremium } from "@/hooks/usePremium";
import { useSubscription } from "@/hooks/useSubscription";
import { format } from "date-fns";
import {
  getSettingsAccessDateLine,
  getSettingsPlanLabel,
  showSettingsMemberElevated,
} from "@shared/settingsMembershipDisplay";
import { useUserProfile } from "@/contexts/AuthContext";
import { trackEvent } from "@/lib/analytics";

const Settings = () => {
  const navigate = useNavigate();
  const { user } = useUserProfile();
  const { handleLogout } = useLogout();
  const { deleteAccount, isDeleting } = useDeleteAccount();
  const { credits } = useCredits();
  const { tierId, tierLabel } = useEntitlements();
  const { premiumUntil } = usePremium();
  const { subscription, isPremium: hasBillableSubscription } = useSubscription();
  /** Display-only — same precedence as PremiumSettingsCard (@shared/settingsMembershipDisplay). */
  const membershipDisplay = {
    tierId,
    tierLabel,
    hasBillableSubscription,
    subscriptionPeriodEndIso: subscription.current_period_end,
    premiumUntil,
  };
  const planLabel = getSettingsPlanLabel(membershipDisplay);
  const accessDateLine = getSettingsAccessDateLine(membershipDisplay);
  const showElevatedMembership = showSettingsMemberElevated(membershipDisplay);

  const [activeDrawer, setActiveDrawer] = useState<"notifications" | "privacy" | "discovery" | "account" | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  const { id: deepLinkTicketId } = useParams<{ id?: string }>();

  useEffect(() => {
    if (deepLinkTicketId) {
      setShowFeedback(true);
    }
  }, [deepLinkTicketId]);

  const onLogoutConfirm = async () => {
    setShowLogoutDialog(false);
    await handleLogout();
  };

  const handleDeleteAccount = async (reason: string | null) => {
    const scheduled = await deleteAccount(reason);
    if (scheduled) {
      setShowDeleteDialog(false);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-[100px]">
      {/* Header */}
      <header className="sticky top-0 z-40 glass-card border-b border-border/50 px-4 py-4">
        <div className="flex items-center gap-4 max-w-lg mx-auto">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
            className="text-foreground"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-xl font-display font-bold text-foreground">Settings</h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-4">
        {/* Premium Status / Upgrade CTA */}
        <PremiumSettingsCard />

        {/* Credits Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass-card p-4"
        >
          <button
            onClick={() => navigate("/credits")}
            className="w-full flex items-center justify-between group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                <Zap className="w-5 h-5 text-primary" />
              </div>
              <div className="text-left">
                <h3 className="font-display font-semibold text-foreground">Video Date Credits</h3>
                <p className="text-xs text-muted-foreground">
                  {!showElevatedMembership
                    ? `${credits.extraTime} Extra Time · ${credits.extendedVibe} Extended Vibe`
                    : accessDateLine
                      ? `${planLabel} · ${
                          accessDateLine.kind === "renews"
                            ? `Renews ${format(new Date(accessDateLine.iso), "MMM d, yyyy")}`
                            : `Access through ${format(new Date(accessDateLine.iso), "MMM d, yyyy")}`
                        }`
                      : planLabel}
                </p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
          </button>
        </motion.div>

        {/* Invite friends */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="glass-card p-4"
        >
          <button
            type="button"
            onClick={() => {
              trackEvent("invite_hub_entry_tapped", { surface: "settings", platform: "web" });
              navigate("/settings/referrals");
            }}
            className="w-full flex items-center justify-between group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/25 to-pink-500/25 flex items-center justify-center">
                <UserPlus className="w-5 h-5 text-primary" />
              </div>
              <div className="text-left">
                <h3 className="font-display font-semibold text-foreground">Invite friends</h3>
                <p className="text-xs text-muted-foreground">Share your link so friends can join you on Vibely</p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
          </button>
        </motion.div>

        {/* Notifications Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-4"
        >
          <button
            onClick={() => setActiveDrawer("notifications")}
            className="w-full flex items-center justify-between group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <Bell className="w-5 h-5 text-primary" />
              </div>
              <div className="text-left">
                <h3 className="font-display font-semibold text-foreground">Notifications</h3>
                <p className="text-xs text-muted-foreground">Manage alerts and sounds</p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
          </button>
        </motion.div>

        {/* Privacy Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-card p-4"
        >
          <button
            onClick={() => setActiveDrawer("privacy")}
            className="w-full flex items-center justify-between group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-neon-cyan/20 flex items-center justify-center">
                <Shield className="w-5 h-5 text-neon-cyan" />
              </div>
              <div className="text-left">
                <h3 className="font-display font-semibold text-foreground">Privacy &amp; Visibility</h3>
                <p className="text-xs text-muted-foreground">Control who can see you and how</p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
          </button>
        </motion.div>

        {/* Discovery preferences */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="glass-card p-4"
        >
          <button
            onClick={() => setActiveDrawer("discovery")}
            className="w-full flex items-center justify-between group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
                <Compass className="w-5 h-5 text-primary" />
              </div>
              <div className="text-left">
                <h3 className="font-display font-semibold text-foreground">Discovery</h3>
                <p className="text-xs text-muted-foreground">Decks, intent, and default event filters</p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
          </button>
        </motion.div>

        {/* Account Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass-card p-4"
        >
          <button
            onClick={() => setActiveDrawer("account")}
            className="w-full flex items-center justify-between group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center">
                <User className="w-5 h-5 text-accent" />
              </div>
              <div className="text-left">
                <h3 className="font-display font-semibold text-foreground">Account &amp; Security</h3>
                <p className="text-xs text-muted-foreground">Manage your account and security settings</p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
          </button>
        </motion.div>

        {/* Quick Actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="space-y-2 pt-4"
        >
          <Button
            variant="outline"
            className="w-full justify-start gap-3 text-foreground"
            onClick={() => navigate("/how-it-works")}
          >
            <Sparkles className="w-4 h-4 text-primary" />
            How Vibely Works
          </Button>

          <Button
            variant="outline"
            className="w-full justify-start gap-3 text-foreground"
            onClick={() => setShowFeedback(true)}
          >
            <MessageSquareText className="w-4 h-4 text-primary" />
            Support & Feedback
          </Button>

          <Button
            variant="outline"
            className="w-full justify-start gap-3 text-foreground"
            onClick={() => navigate("/privacy")}
          >
            <Shield className="w-4 h-4 text-muted-foreground" />
            Privacy Policy
          </Button>

          <Button
            variant="outline"
            className="w-full justify-start gap-3 text-foreground"
            onClick={() => navigate("/terms")}
          >
            <FileText className="w-4 h-4 text-muted-foreground" />
            Terms of Service
          </Button>

          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => setShowLogoutDialog(true)}
          >
            <LogOut className="w-4 h-4" />
            Log Out
          </Button>
        </motion.div>

        {/* Danger Zone */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="pt-6 border-t border-destructive/20 space-y-2"
        >
          <h3 className="text-xs font-semibold uppercase tracking-wider text-destructive px-1">
            Danger Zone
          </h3>
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => setShowDeleteDialog(true)}
          >
            <Trash2 className="w-4 h-4" />
            Delete My Account
          </Button>
        </motion.div>
      </main>

      {/* Notifications Drawer */}
      <NotificationsDrawer
        open={activeDrawer === "notifications"}
        onOpenChange={(open) => !open && setActiveDrawer(null)}
      />

      <PrivacyDrawer
        open={activeDrawer === "privacy"}
        onOpenChange={(open) => !open && setActiveDrawer(null)}
      />

      <DiscoveryDrawer
        open={activeDrawer === "discovery"}
        onOpenChange={(open) => !open && setActiveDrawer(null)}
        onPremiumNavigate={() => {
          setActiveDrawer(null);
          openPremium(navigate, {
            entry_surface: PREMIUM_ENTRY_SURFACE.CITY_BROWSE_DISCOVERY,
            feature: "canCityBrowse",
          });
        }}
      />

      <AccountSettingsDrawer
        open={activeDrawer === "account"}
        onOpenChange={(open) => !open && setActiveDrawer(null)}
        onDeleteAccount={() => {
          setActiveDrawer(null);
          setShowDeleteDialog(true);
        }}
        onRequestSignOut={() => {
          setActiveDrawer(null);
          setShowLogoutDialog(true);
        }}
      />

      {/* Support & Feedback Drawer */}
      <FeedbackDrawer open={showFeedback} onOpenChange={setShowFeedback} initialTicketId={deepLinkTicketId} />

      {/* Logout Confirmation */}
      <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Log out?</AlertDialogTitle>
            <AlertDialogDescription>
              You'll need to sign in again to access your account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onLogoutConfirm}>Log Out</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Account Confirmation */}
      <DeleteAccountModal
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onConfirm={handleDeleteAccount}
        isDeleting={isDeleting}
      />

      <BottomNav />
    </div>
  );
};

export default Settings;
