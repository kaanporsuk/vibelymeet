import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Bell,
  Shield,
  User,
  LogOut,
  Volume2,
  ChevronRight,
  MessageSquare,
  Heart,
  Calendar,
  Sparkles,
  Eye,
  EyeOff,
  Zap,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { BottomNav } from "@/components/BottomNav";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
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
import { useLogout } from "@/hooks/useLogout";
import { useDeleteAccount } from "@/hooks/useDeleteAccount";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { PremiumSettingsCard } from "@/components/premium/PremiumSettingsCard";
import { useCredits } from "@/hooks/useCredits";
import { toast } from "sonner";

interface NotificationSettings {
  matches: boolean;
  messages: boolean;
  events: boolean;
  dateReminders: boolean;
  dailyDrop: boolean;
  sounds: boolean;
}

interface PrivacySettings {
  showOnlineStatus: boolean;
  showLastSeen: boolean;
  showReadReceipts: boolean;
  discoverableByLocation: boolean;
  showAge: boolean;
}

const Settings = () => {
  const navigate = useNavigate();
  const { handleLogout } = useLogout();
  const { deleteAccount, isDeleting } = useDeleteAccount();
  const { isGranted, requestPermission } = usePushNotifications();
  const { credits } = useCredits();

  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>({
    matches: true,
    messages: true,
    events: true,
    dateReminders: true,
    dailyDrop: true,
    sounds: true,
  });

  const [privacySettings, setPrivacySettings] = useState<PrivacySettings>({
    showOnlineStatus: true,
    showLastSeen: true,
    showReadReceipts: true,
    discoverableByLocation: true,
    showAge: true,
  });

  const [activeDrawer, setActiveDrawer] = useState<"notifications" | "privacy" | "account" | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);

  const onLogoutConfirm = async () => {
    setShowLogoutDialog(false);
    await handleLogout();
  };

  const handleDeleteAccount = async () => {
    await deleteAccount();
  };

  const updateNotification = (key: keyof NotificationSettings, value: boolean) => {
    setNotificationSettings(prev => ({ ...prev, [key]: value }));
    toast.success(`${key.charAt(0).toUpperCase() + key.slice(1)} notifications ${value ? 'enabled' : 'disabled'}`);
  };

  const updatePrivacy = (key: keyof PrivacySettings, value: boolean) => {
    setPrivacySettings(prev => ({ ...prev, [key]: value }));
    toast.success("Privacy setting updated");
  };

  return (
    <div className="min-h-screen bg-background pb-24">
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
                  {credits.extraTime} Extra Time · {credits.extendedVibe} Extended Vibe
                </p>
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
                <h3 className="font-display font-semibold text-foreground">Privacy</h3>
                <p className="text-xs text-muted-foreground">Control who sees what</p>
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
                <h3 className="font-display font-semibold text-foreground">Account</h3>
                <p className="text-xs text-muted-foreground">Manage your account</p>
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
            variant="ghost"
            className="w-full justify-start gap-3 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => setShowLogoutDialog(true)}
          >
            <LogOut className="w-4 h-4" />
            Log Out
          </Button>
        </motion.div>
      </main>

      {/* Notifications Drawer */}
      <Drawer open={activeDrawer === "notifications"} onOpenChange={(open) => !open && setActiveDrawer(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle className="font-display flex items-center gap-2">
              <Bell className="w-5 h-5 text-primary" />
              Notification Preferences
            </DrawerTitle>
            <DrawerDescription>
              Choose what you want to be notified about
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4 space-y-4 overflow-y-auto">
            {!isGranted && (
              <div className="p-4 rounded-xl bg-primary/10 border border-primary/30 mb-4">
                <p className="text-sm text-foreground mb-2">
                  Enable browser notifications to receive alerts
                </p>
                <Button variant="gradient" size="sm" onClick={requestPermission}>
                  Enable Notifications
                </Button>
              </div>
            )}

            <div className="space-y-3">
              {[
                { key: "matches" as const, icon: Heart, label: "New Matches", description: "When someone likes you back" },
                { key: "messages" as const, icon: MessageSquare, label: "Messages", description: "New messages from matches" },
                { key: "events" as const, icon: Calendar, label: "Events", description: "Event reminders and updates" },
                { key: "dateReminders" as const, icon: Bell, label: "Date Reminders", description: "Upcoming date notifications" },
                { key: "dailyDrop" as const, icon: Sparkles, label: "Daily Drop", description: "Daily match suggestions" },
                { key: "sounds" as const, icon: Volume2, label: "Sounds", description: "Play notification sounds" },
              ].map(({ key, icon: Icon, label, description }) => (
                <div key={key} className="flex items-center justify-between p-3 rounded-xl bg-secondary/40">
                  <div className="flex items-center gap-3">
                    <Icon className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-foreground">{label}</p>
                      <p className="text-xs text-muted-foreground">{description}</p>
                    </div>
                  </div>
                  <Switch
                    checked={notificationSettings[key]}
                    onCheckedChange={(checked) => updateNotification(key, checked)}
                  />
                </div>
              ))}
            </div>
          </div>
          <DrawerFooter>
            <DrawerClose asChild>
              <Button variant="gradient">Done</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Privacy Drawer */}
      <Drawer open={activeDrawer === "privacy"} onOpenChange={(open) => !open && setActiveDrawer(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle className="font-display flex items-center gap-2">
              <Shield className="w-5 h-5 text-neon-cyan" />
              Privacy Settings
            </DrawerTitle>
            <DrawerDescription>
              Control your visibility and data
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4 space-y-4 overflow-y-auto">
            <div className="space-y-3">
              {[
                { key: "showOnlineStatus" as const, icon: Eye, label: "Online Status", description: "Show when you're active" },
                { key: "showLastSeen" as const, icon: Eye, label: "Last Seen", description: "Show when you were last online" },
                { key: "showReadReceipts" as const, icon: Eye, label: "Read Receipts", description: "Show when you've read messages" },
                { key: "discoverableByLocation" as const, icon: Eye, label: "Location Discovery", description: "Appear in nearby searches" },
                { key: "showAge" as const, icon: User, label: "Show Age", description: "Display your age on profile" },
              ].map(({ key, icon: Icon, label, description }) => (
                <div key={key} className="flex items-center justify-between p-3 rounded-xl bg-secondary/40">
                  <div className="flex items-center gap-3">
                    {privacySettings[key] ? (
                      <Eye className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <EyeOff className="w-4 h-4 text-muted-foreground" />
                    )}
                    <div>
                      <p className="text-sm font-medium text-foreground">{label}</p>
                      <p className="text-xs text-muted-foreground">{description}</p>
                    </div>
                  </div>
                  <Switch
                    checked={privacySettings[key]}
                    onCheckedChange={(checked) => updatePrivacy(key, checked)}
                  />
                </div>
              ))}
            </div>
          </div>
          <DrawerFooter>
            <DrawerClose asChild>
              <Button variant="gradient">Done</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Account Drawer - Using new component */}
      <AccountSettingsDrawer
        open={activeDrawer === "account"}
        onOpenChange={(open) => !open && setActiveDrawer(null)}
        onDeleteAccount={() => {
          setActiveDrawer(null);
          setShowDeleteDialog(true);
        }}
      />

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
