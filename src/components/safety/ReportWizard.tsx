import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ArrowLeft, 
  Search, 
  UserX, 
  Camera,
  MessageCircleWarning,
  Frown,
  Shield,
  CheckCircle2,
  Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { ProfilePhoto } from "@/components/ui/ProfilePhoto";
import { formatDistanceToNow } from "date-fns";
import { REPORT_REASONS, type ReportReasonId } from "../../../shared/safety/reportReasons";

export interface ReportPreSelectedUser {
  id: string;
  name: string;
  avatar_url?: string;
  interactionType: string;
  interactionDate: string;
}

interface ReportWizardProps {
  onBack: () => void;
  onComplete: () => void;
  preSelectedUser?: ReportPreSelectedUser;
}

type ReportStep = "identify" | "reason" | "details" | "action" | "success";

interface ReportableUser {
  id: string;
  name: string;
  avatar_url?: string;
  interactionType: string;
  interactionDate: string;
}

const reasonIcon: Record<ReportReasonId, typeof MessageCircleWarning> = {
  harassment: MessageCircleWarning,
  fake: UserX,
  inappropriate: Camera,
  spam: Shield,
  safety: Shield,
  underage: UserX,
  other: Frown,
};

const HIGH_SEVERITY: ReadonlySet<ReportReasonId> = new Set([
  "harassment",
  "fake",
  "inappropriate",
  "spam",
  "safety",
  "underage",
]);

const ReportWizard = ({ onBack, onComplete, preSelectedUser }: ReportWizardProps) => {
  const { user } = useUserProfile();
  const [step, setStep] = useState<ReportStep>(preSelectedUser ? "reason" : "identify");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<ReportableUser | null>(
    preSelectedUser ? {
      id: preSelectedUser.id,
      name: preSelectedUser.name,
      avatar_url: preSelectedUser.avatar_url,
      interactionType: preSelectedUser.interactionType,
      interactionDate: preSelectedUser.interactionDate,
    } : null
  );
  const [selectedReason, setSelectedReason] = useState<ReportReasonId | null>(null);
  const [details, setDetails] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch real matches for user selection (only when no preSelectedUser)
  const { data: recentUsers = [], isLoading: isLoadingUsers } = useQuery({
    queryKey: ["recent-matches-for-report", user?.id],
    queryFn: async (): Promise<ReportableUser[]> => {
      if (!user?.id) return [];

      const { data: matches } = await supabase
        .from("matches")
        .select("id, profile_id_1, profile_id_2, matched_at")
        .or(`profile_id_1.eq.${user.id},profile_id_2.eq.${user.id}`)
        .order("matched_at", { ascending: false })
        .limit(20);

      if (!matches?.length) return [];

      const otherIds = matches.map(m =>
        m.profile_id_1 === user.id ? m.profile_id_2 : m.profile_id_1
      );

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, name, avatar_url")
        .in("id", otherIds);

      const profileMap = new Map((profiles || []).map(p => [p.id, p]));

      return matches.map(m => {
        const otherId = m.profile_id_1 === user.id ? m.profile_id_2 : m.profile_id_1;
        const profile = profileMap.get(otherId);
        return {
          id: otherId,
          name: profile?.name || "Unknown",
          avatar_url: profile?.avatar_url || undefined,
          interactionType: "Match",
          interactionDate: formatDistanceToNow(new Date(m.matched_at), { addSuffix: true }),
        };
      });
    },
    enabled: !preSelectedUser && !!user?.id,
  });

  const filteredUsers = recentUsers.filter((u) =>
    u.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      if (!user?.id || !selectedUser || !selectedReason) {
        throw new Error("Missing required data");
      }

      const { error: reportError } = await supabase
        .from("user_reports")
        .insert({
          reporter_id: user.id,
          reported_id: selectedUser.id,
          reason: selectedReason,
          details: details || null,
          also_blocked: alsoBlock,
        });

      if (reportError) throw reportError;

      // If "Also block" is checked, insert into blocked_users
      if (alsoBlock) {
        const { error: blockError } = await supabase
          .from("blocked_users")
          .insert({
            blocker_id: user.id,
            blocked_id: selectedUser.id,
            reason: `Reported: ${selectedReason}`,
          });
        // Ignore duplicate key errors
        if (blockError && !blockError.message.includes("duplicate")) {
          console.error("Block error:", blockError);
        }
      }

      setStep("success");
    } catch (error) {
      console.error("Report submission error:", error);
      toast.error("Failed to submit report. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const stepVariants = {
    initial: { opacity: 0, x: 20 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -20 },
  };

  const allSteps: ReportStep[] = preSelectedUser
    ? ["reason", "details", "action"]
    : ["identify", "reason", "details", "action"];

  const currentStepIndex = allSteps.indexOf(step);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-[60vh]"
    >
      {/* Header */}
      <div className="sticky top-0 z-10 p-6 pb-4 bg-card border-b border-border/50">
        <div className="flex items-center gap-3">
          {step !== "success" && (
            <button
              onClick={step === allSteps[0] ? onBack : () => {
                if (currentStepIndex > 0) setStep(allSteps[currentStepIndex - 1]);
              }}
              className="w-10 h-10 rounded-full bg-secondary/50 flex items-center justify-center hover:bg-secondary transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div>
            <h2 className="text-xl font-display font-bold text-foreground">
              {step === "success" ? "Report Submitted" : "Report a User"}
            </h2>
            {step !== "success" && (
              <p className="text-sm text-muted-foreground">
                Step {currentStepIndex + 1} of {allSteps.length}
              </p>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {step !== "success" && (
          <div className="flex gap-1 mt-4">
            {allSteps.map((s, i) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i <= currentStepIndex
                    ? "bg-gradient-to-r from-red-500 to-orange-500"
                    : "bg-secondary"
                }`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        {step === "identify" && (
          <motion.div
            key="identify"
            variants={stepVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="p-6 space-y-4"
          >
            <div className="space-y-2">
              <h3 className="font-semibold text-foreground">Who are you reporting?</h3>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search recent matches & dates"
                  className="pl-10 bg-secondary/50 border-border"
                />
              </div>
            </div>

            {isLoadingUsers ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredUsers.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No recent matches found
              </p>
            ) : (
              <div className="space-y-2">
                {filteredUsers.map((u) => (
                  <motion.button
                    key={u.id}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={() => {
                      setSelectedUser(u);
                      setStep("reason");
                    }}
                    className="w-full flex items-center gap-3 p-3 rounded-xl transition-all bg-secondary/30 border border-transparent hover:border-border"
                  >
                    <ProfilePhoto
                      avatarUrl={u.avatar_url}
                      name={u.name}
                      size="md"
                      rounded="full"
                    />
                    <div className="flex-1 text-left">
                      <p className="font-medium text-foreground">{u.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {u.interactionType} • {u.interactionDate}
                      </p>
                    </div>
                  </motion.button>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {step === "reason" && (
          <motion.div
            key="reason"
            variants={stepVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="p-6 space-y-4"
          >
            <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/30 mb-6">
              <ProfilePhoto
                avatarUrl={selectedUser?.avatar_url}
                name={selectedUser?.name || ""}
                size="sm"
                rounded="full"
              />
              <p className="font-medium text-foreground">{selectedUser?.name}</p>
            </div>

            <h3 className="font-semibold text-foreground">What happened?</h3>

            <div className="space-y-3">
              {REPORT_REASONS.map((reason) => {
                const Icon = reasonIcon[reason.id];
                const isHigh = HIGH_SEVERITY.has(reason.id);
                return (
                  <motion.button
                    key={reason.id}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={() => {
                      setSelectedReason(reason.id);
                      setStep("details");
                    }}
                    className={`w-full p-4 rounded-xl text-left transition-all ${
                      isHigh
                        ? "bg-gradient-to-r from-red-500/10 to-orange-500/10 border border-red-500/20 hover:border-red-500/40"
                        : "bg-secondary/30 border border-transparent hover:border-border"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Icon className={`w-5 h-5 mt-0.5 ${isHigh ? "text-red-400" : "text-muted-foreground"}`} />
                      <div>
                        <p className="font-medium text-foreground">{reason.label}</p>
                      </div>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        )}

        {step === "details" && (
          <motion.div
            key="details"
            variants={stepVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="p-6 space-y-6"
          >
            <div className="space-y-2">
              <h3 className="font-semibold text-foreground">
                Tell us more <span className="text-muted-foreground font-normal">(optional)</span>
              </h3>
              <Textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Provide any additional context that might help us investigate..."
                className="min-h-32 bg-secondary/50 border-border resize-none"
                maxLength={500}
              />
              <p className="text-xs text-muted-foreground text-right">
                {details.length}/500
              </p>
            </div>

            <Button
              variant="gradient"
              className="w-full"
              onClick={() => setStep("action")}
            >
              Continue
            </Button>
          </motion.div>
        )}

        {step === "action" && (
          <motion.div
            key="action"
            variants={stepVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="p-6 space-y-6"
          >
            <div className="p-4 rounded-xl bg-secondary/30 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <UserX className="w-5 h-5 text-red-400" />
                  <div>
                    <p className="font-medium text-foreground">Also block this user?</p>
                    <p className="text-sm text-muted-foreground">
                      They won't see your profile or contact you
                    </p>
                  </div>
                </div>
                <Switch checked={alsoBlock} onCheckedChange={setAlsoBlock} />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-gradient-to-r from-teal-500/10 to-cyan-500/10 border border-cyan-500/20">
              <div className="flex items-start gap-3">
                <Shield className="w-5 h-5 text-cyan-400 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground text-sm">
                    Your report is confidential
                  </p>
                  <p className="text-xs text-muted-foreground">
                    The reported user won't know who submitted this report.
                  </p>
                </div>
              </div>
            </div>

            <Button
              variant="gradient"
              className="w-full bg-gradient-to-r from-red-500 to-orange-500"
              onClick={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                "Submit Report"
              )}
            </Button>
          </motion.div>
        )}

        {step === "success" && (
          <motion.div
            key="success"
            variants={stepVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="p-6 py-12 text-center space-y-6"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 15 }}
              className="w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-teal-500/20 to-cyan-500/20 flex items-center justify-center"
            >
              <CheckCircle2 className="w-10 h-10 text-cyan-400" />
            </motion.div>

            <div className="space-y-2">
              <h3 className="text-2xl font-display font-bold text-foreground">
                We've got it
              </h3>
              <p className="text-muted-foreground">
                {alsoBlock
                  ? `${selectedUser?.name} has been blocked and won't see you again.`
                  : "Our team will review your report within 24 hours."}
              </p>
            </div>

            <Button variant="ghost" onClick={onComplete} className="mt-4">
              Close
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default ReportWizard;
