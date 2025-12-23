import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ArrowLeft, 
  Search, 
  UserX, 
  AlertTriangle, 
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

interface ReportWizardProps {
  onBack: () => void;
  onComplete: () => void;
}

type ReportStep = "identify" | "reason" | "details" | "action" | "success";

interface RecentUser {
  id: string;
  name: string;
  avatar: string;
  type: "match" | "video";
  date: string;
}

const mockRecentUsers: RecentUser[] = [
  {
    id: "1",
    name: "Jordan M.",
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100",
    type: "video",
    date: "Today",
  },
  {
    id: "2",
    name: "Casey R.",
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100",
    type: "match",
    date: "Yesterday",
  },
  {
    id: "3",
    name: "Taylor S.",
    avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100",
    type: "video",
    date: "2 days ago",
  },
  {
    id: "4",
    name: "Morgan K.",
    avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100",
    type: "match",
    date: "3 days ago",
  },
];

const reportReasons = [
  {
    id: "harassment",
    icon: MessageCircleWarning,
    label: "Harassment or Bullying",
    description: "Threatening, abusive, or intimidating behavior",
    severity: "high",
  },
  {
    id: "fake",
    icon: UserX,
    label: "Fake Profile / Catfish",
    description: "Using someone else's photos or fake identity",
    severity: "high",
  },
  {
    id: "inappropriate",
    icon: Camera,
    label: "Inappropriate Content",
    description: "Explicit or offensive photos/messages",
    severity: "high",
  },
  {
    id: "vibe",
    icon: Frown,
    label: "Did not match Vibe Check",
    description: "Misrepresented themselves in video call",
    severity: "low",
  },
];

const ReportWizard = ({ onBack, onComplete }: ReportWizardProps) => {
  const [step, setStep] = useState<ReportStep>("identify");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<RecentUser | null>(null);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredUsers = mockRecentUsers.filter((user) =>
    user.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSubmit = async () => {
    setIsSubmitting(true);
    // Mock API call
    await new Promise((resolve) => setTimeout(resolve, 2000));
    setStep("success");
    setIsSubmitting(false);
  };

  const stepVariants = {
    initial: { opacity: 0, x: 20 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -20 },
  };

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
              onClick={step === "identify" ? onBack : () => {
                const steps: ReportStep[] = ["identify", "reason", "details", "action"];
                const currentIndex = steps.indexOf(step);
                if (currentIndex > 0) setStep(steps[currentIndex - 1]);
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
                Step {["identify", "reason", "details", "action"].indexOf(step) + 1} of 4
              </p>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {step !== "success" && (
          <div className="flex gap-1 mt-4">
            {["identify", "reason", "details", "action"].map((s, i) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i <= ["identify", "reason", "details", "action"].indexOf(step)
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

            <div className="space-y-2">
              {filteredUsers.map((user) => (
                <motion.button
                  key={user.id}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => {
                    setSelectedUser(user);
                    setStep("reason");
                  }}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${
                    selectedUser?.id === user.id
                      ? "bg-primary/20 border border-primary"
                      : "bg-secondary/30 border border-transparent hover:border-border"
                  }`}
                >
                  <img
                    src={user.avatar}
                    alt={user.name}
                    className="w-12 h-12 rounded-full object-cover"
                  />
                  <div className="flex-1 text-left">
                    <p className="font-medium text-foreground">{user.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {user.type === "video" ? "Video Date" : "Match"} • {user.date}
                    </p>
                  </div>
                </motion.button>
              ))}
            </div>
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
              <img
                src={selectedUser?.avatar}
                alt={selectedUser?.name}
                className="w-10 h-10 rounded-full object-cover"
              />
              <p className="font-medium text-foreground">{selectedUser?.name}</p>
            </div>

            <h3 className="font-semibold text-foreground">What happened?</h3>

            <div className="space-y-3">
              {reportReasons.map((reason) => (
                <motion.button
                  key={reason.id}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => {
                    setSelectedReason(reason.id);
                    setStep("details");
                  }}
                  className={`w-full p-4 rounded-xl text-left transition-all ${
                    reason.severity === "high"
                      ? "bg-gradient-to-r from-red-500/10 to-orange-500/10 border border-red-500/20 hover:border-red-500/40"
                      : "bg-secondary/30 border border-transparent hover:border-border"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <reason.icon
                      className={`w-5 h-5 mt-0.5 ${
                        reason.severity === "high" ? "text-red-400" : "text-muted-foreground"
                      }`}
                    />
                    <div>
                      <p className="font-medium text-foreground">{reason.label}</p>
                      <p className="text-sm text-muted-foreground">{reason.description}</p>
                    </div>
                  </div>
                </motion.button>
              ))}
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
