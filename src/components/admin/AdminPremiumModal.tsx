import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, X, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { supabase } from "@/integrations/supabase/client";
import { format, addWeeks, addMonths, addYears } from "date-fns";
import { toast } from "sonner";

interface AdminPremiumModalProps {
  userId: string;
  userName: string;
  currentIsPremium: boolean;
  currentPremiumUntil: string | null;
  isOpen: boolean;
  onClose: () => void;
}

type Duration = "1week" | "1month" | "3months" | "1year" | "custom";

const durationOptions: { value: Duration; label: string }[] = [
  { value: "1week", label: "1 Week" },
  { value: "1month", label: "1 Month" },
  { value: "3months", label: "3 Months" },
  { value: "1year", label: "1 Year" },
  { value: "custom", label: "Custom" },
];

const calcDate = (from: Date, duration: Duration): Date => {
  switch (duration) {
    case "1week": return addWeeks(from, 1);
    case "1month": return addMonths(from, 1);
    case "3months": return addMonths(from, 3);
    case "1year": return addYears(from, 1);
    default: return from;
  }
};

const AdminPremiumModal = ({
  userId,
  userName,
  currentIsPremium,
  currentPremiumUntil,
  isOpen,
  onClose,
}: AdminPremiumModalProps) => {
  const queryClient = useQueryClient();
  const [duration, setDuration] = useState<Duration>("1month");
  const [customDate, setCustomDate] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const { data: history } = useQuery({
    queryKey: ["premium-history", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("premium_history")
        .select("id, action, premium_until, reason, created_at, admin_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (!data?.length) return [];
      const adminIds = [...new Set(data.map((h) => h.admin_id).filter(Boolean))];
      let adminMap: Record<string, string> = {};
      if (adminIds.length) {
        const { data: admins } = await supabase
          .from("profiles")
          .select("id, name")
          .in("id", adminIds);
        admins?.forEach((a) => { adminMap[a.id] = a.name; });
      }
      return data.map((h) => ({
        ...h,
        adminName: h.admin_id ? adminMap[h.admin_id] || "Admin" : "System",
      }));
    },
    enabled: isOpen,
  });

  const getTargetDate = (baseDate: Date): Date => {
    if (duration === "custom") {
      return customDate ? new Date(customDate) : new Date();
    }
    return calcDate(baseDate, duration);
  };

  const handleGrant = async () => {
    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const targetDate = getTargetDate(new Date());

      const { error: updateErr } = await supabase
        .from("profiles")
        .update({
          is_premium: true,
          premium_until: targetDate.toISOString(),
          premium_granted_by: user!.id,
          premium_granted_at: new Date().toISOString(),
        })
        .eq("id", userId);
      if (updateErr) throw updateErr;

      await supabase.from("premium_history").insert({
        user_id: userId,
        admin_id: user!.id,
        action: "granted",
        premium_until: targetDate.toISOString(),
        reason: reason || null,
      });

      toast.success(`Premium granted to ${userName} until ${format(targetDate, "MMM d, yyyy")}`);
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-user-detail", userId] });
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Failed to grant premium");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExtend = async () => {
    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const base = currentPremiumUntil ? new Date(currentPremiumUntil) : new Date();
      let targetDate: Date;
      if (duration === "custom" && customDate) {
        const cd = new Date(customDate);
        targetDate = cd > base ? cd : base;
      } else {
        targetDate = calcDate(base, duration);
      }

      const { error: updateErr } = await supabase
        .from("profiles")
        .update({ premium_until: targetDate.toISOString() })
        .eq("id", userId);
      if (updateErr) throw updateErr;

      await supabase.from("premium_history").insert({
        user_id: userId,
        admin_id: user!.id,
        action: "extended",
        premium_until: targetDate.toISOString(),
        reason: reason || null,
      });

      toast.success(`Premium extended for ${userName} until ${format(targetDate, "MMM d, yyyy")}`);
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-user-detail", userId] });
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Failed to extend premium");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevoke = async () => {
    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const { error: updateErr } = await supabase
        .from("profiles")
        .update({ is_premium: false, premium_until: null })
        .eq("id", userId);
      if (updateErr) throw updateErr;

      await supabase.from("premium_history").insert({
        user_id: userId,
        admin_id: user!.id,
        action: "revoked",
        premium_until: null,
        reason: reason || null,
      });

      toast.success(`Premium revoked for ${userName}`);
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-user-detail", userId] });
      setShowRevokeConfirm(false);
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Failed to revoke premium");
    } finally {
      setIsSubmitting(false);
    }
  };

  const actionBadgeColor: Record<string, string> = {
    granted: "bg-green-500/20 text-green-400 border-green-500/30",
    extended: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    revoked: "bg-destructive/20 text-destructive border-destructive/30",
    expired: "bg-muted text-muted-foreground border-border",
  };

  if (!isOpen) return null;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md max-h-[85vh] overflow-y-auto bg-background border border-border rounded-2xl shadow-2xl z-[60] p-6 space-y-5"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <Crown className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h3 className="font-display font-bold text-foreground">Premium Status</h3>
              <p className="text-xs text-muted-foreground">{userName}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Current Status */}
        {currentIsPremium ? (
          <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/30">
            <Badge className="bg-green-500/20 text-green-400 border-green-500/30 mb-1">
              ✦ Active Premium
            </Badge>
            <p className="text-xs text-muted-foreground">
              Expires: {currentPremiumUntil ? format(new Date(currentPremiumUntil), "MMM d, yyyy 'at' h:mm a") : "Never"}
            </p>
          </div>
        ) : (
          <div className="p-3 rounded-xl bg-secondary/50 border border-border">
            <Badge variant="outline" className="text-muted-foreground">Free Account</Badge>
          </div>
        )}

        {/* Duration Picker */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground">
            {currentIsPremium ? "Extend Duration" : "Grant Premium"}
          </h4>
          <div className="flex flex-wrap gap-2">
            {durationOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDuration(opt.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                  duration === opt.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary/50 text-foreground border-border hover:border-primary/50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <AnimatePresence>
            {duration === "custom" && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
              >
                <Input
                  type="date"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  className="bg-secondary/50"
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Reason */}
        <Textarea
          placeholder="Why? e.g., Beta tester, compensation, contest winner"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="bg-secondary/50 min-h-[60px]"
        />

        {/* Actions */}
        <div className="space-y-2">
          {currentIsPremium ? (
            <>
              <Button
                variant="gradient"
                className="w-full"
                onClick={handleExtend}
                disabled={isSubmitting || (duration === "custom" && !customDate)}
              >
                Extend Premium
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="w-full"
                onClick={() => setShowRevokeConfirm(true)}
                disabled={isSubmitting}
              >
                Revoke Premium
              </Button>
            </>
          ) : (
            <Button
              variant="gradient"
              className="w-full"
              onClick={handleGrant}
              disabled={isSubmitting || (duration === "custom" && !customDate)}
            >
              Grant Premium
            </Button>
          )}
        </div>

        {/* History */}
        <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
          <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full">
            <ChevronDown className={`w-4 h-4 transition-transform ${historyOpen ? "rotate-180" : ""}`} />
            Premium History
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-2">
            {history?.length === 0 && (
              <p className="text-xs text-muted-foreground">No history yet</p>
            )}
            {history?.map((entry: any) => (
              <div key={entry.id} className="flex items-start gap-2 text-xs p-2 rounded-lg bg-secondary/30">
                <Badge variant="outline" className={`text-[10px] shrink-0 ${actionBadgeColor[entry.action] || ""}`}>
                  {entry.action}
                </Badge>
                <div className="min-w-0">
                  <p className="text-muted-foreground">
                    by {entry.adminName} · {format(new Date(entry.created_at), "MMM d, yyyy")}
                  </p>
                  {entry.reason && (
                    <p className="text-foreground truncate">{entry.reason}</p>
                  )}
                </div>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      </motion.div>

      {/* Revoke Confirmation */}
      <AlertDialog open={showRevokeConfirm} onOpenChange={setShowRevokeConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke Premium?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure? This will immediately remove premium access for {userName}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRevoke} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default AdminPremiumModal;
